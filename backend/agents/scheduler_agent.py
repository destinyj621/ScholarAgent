import json
import os
import re
from collections.abc import Generator
from datetime import date, datetime, timedelta, timezone

import anthropic

MODEL = "claude-opus-4-8"

_SYSTEM = """You are the SchedulerAgent for ScholarAgent, an AI study scheduler.

A Python algorithm has computed a draft schedule based on the user's availability and load-balancing rules.
Your job is to:
1. Briefly narrate the scheduling approach for the user (2–4 sentences per major assignment).
2. Review the draft for any issues — tight deadlines, uneven loads, high-priority class needs.
3. Output a final warnings list as JSON inside <warnings> tags.

Each warning should be: {"assignment": "...", "message": "...", "at_risk": bool}

If there are no warnings, output <warnings>[]</warnings>.

Be concise. The user wants to understand the schedule at a glance."""


def run(
    assignments: list[dict],
    settings: dict,
) -> Generator[dict, None, None]:
    """
    Builds the schedule using a deterministic Python algorithm, then streams
    Claude's narration and warning analysis.

    Yields {"stage": "schedule", "token": str} during streaming,
    then {"stage": "schedule_complete", "blocks": list, "warnings": list}.
    """
    blocks, algo_warnings = _build_schedule(assignments, settings)

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    summary = _build_summary(assignments, blocks, algo_warnings, settings)
    user_msg = f"Here is the computed schedule summary:\n\n{summary}"

    accumulated = ""
    with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        for text in stream.text_stream:
            accumulated += text
            yield {"stage": "schedule", "token": text}

    claude_warnings = _extract_warnings(accumulated)
    all_warnings = algo_warnings + [w for w in claude_warnings if w not in algo_warnings]

    yield {"stage": "schedule_complete", "blocks": blocks, "warnings": all_warnings}


# ---------------------------------------------------------------------------
# Deterministic scheduling algorithm
# ---------------------------------------------------------------------------

_DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

_DEFAULT_AVAILABILITY = {
    "monday":    {"available": True,  "hours": 3.0},
    "tuesday":   {"available": True,  "hours": 3.0},
    "wednesday": {"available": True,  "hours": 3.0},
    "thursday":  {"available": True,  "hours": 3.0},
    "friday":    {"available": True,  "hours": 3.0},
    "saturday":  {"available": False, "hours": 0.0},
    "sunday":    {"available": True,  "hours": 2.0},
}


def _build_schedule(assignments: list[dict], settings: dict) -> tuple[list[dict], list[dict]]:
    today = date.today()

    raw_end = settings.get("semester_end")
    if raw_end:
        semester_end = date.fromisoformat(str(raw_end)[:10])
    else:
        semester_end = today + timedelta(days=120)

    daily_cap_minutes = int(settings.get("daily_hour_cap", 3.0) * 60)
    buffer_days = int(settings.get("buffer_days", 1))
    availability_cfg = settings.get("availability", _DEFAULT_AVAILABILITY)

    # Build daily capacity map
    capacity: dict[date, int] = {}
    cur = today
    while cur <= semester_end:
        day_name = _DAY_NAMES[cur.weekday()]
        day_cfg = availability_cfg.get(day_name, {})
        if day_cfg.get("available", False):
            hours = min(float(day_cfg.get("hours", 3.0)), daily_cap_minutes / 60)
            capacity[cur] = int(hours * 60)
        cur += timedelta(days=1)

    # Track usage per day
    used: dict[date, int] = {d: 0 for d in capacity}
    # Track whether a heavy assignment is already on a day
    heavy_on_day: dict[date, bool] = {d: False for d in capacity}

    blocks: list[dict] = []
    warnings: list[dict] = []

    # Sort by deadline ascending so earlier deadlines get first pick of days
    sorted_assignments = sorted(
        [a for a in assignments if not a.get("needs_input") and (a.get("estimated_hours") or 0) > 0],
        key=lambda a: a.get("due_date", ""),
    )

    for assignment in sorted_assignments:
        due_str = assignment.get("due_date", "")
        if not due_str:
            continue

        deadline = date.fromisoformat(due_str[:10])
        target_end = max(today, deadline - timedelta(days=buffer_days))
        total_minutes = int(float(assignment.get("estimated_hours", 0)) * 60)
        is_heavy = float(assignment.get("estimated_hours", 0)) >= 2.0
        is_high_priority = assignment.get("is_high_priority", False)

        # High priority: finish one extra day early
        if is_high_priority:
            target_end = max(today, target_end - timedelta(days=1))

        eligible = sorted(
            [d for d in capacity if today <= d <= target_end],
            reverse=True,  # fill backwards from deadline
        )

        if not eligible:
            warnings.append({
                "assignment": assignment["title"],
                "message": f"No available days before deadline {deadline}. Consider adjusting your schedule.",
                "at_risk": True,
            })
            continue

        remaining = total_minutes

        for day in eligible:
            if remaining <= 0:
                break

            # Heavy assignment conflict check
            if is_heavy and heavy_on_day.get(day, False):
                continue

            available_on_day = capacity[day] - used[day]
            if available_on_day < 15:
                continue

            session = min(remaining, available_on_day)
            # Round to nearest 5 minutes
            session = max(15, (session // 5) * 5)

            blocks.append({
                "date": day.isoformat(),
                "assignment_id": assignment.get("uid", assignment.get("title")),
                "task": assignment["title"],
                "course": assignment["course"],
                "duration_minutes": session,
                "deadline": deadline.isoformat(),
                "is_heavy": is_heavy,
            })

            used[day] = used.get(day, 0) + session
            if is_heavy:
                heavy_on_day[day] = True

            remaining -= session

        if remaining > 0:
            hours_left = round(remaining / 60, 1)
            warnings.append({
                "assignment": assignment["title"],
                "message": (
                    f"Could only schedule {round((total_minutes - remaining) / 60, 1)}h of "
                    f"{assignment['estimated_hours']}h needed. {hours_left}h unscheduled — deadline at risk."
                ),
                "at_risk": True,
            })

    return sorted(blocks, key=lambda b: b["date"]), warnings


def _build_summary(assignments, blocks, warnings, settings):
    block_counts = {}
    for b in blocks:
        block_counts[b["task"]] = block_counts.get(b["task"], 0) + b["duration_minutes"]

    lines = [f"Assignments to schedule: {len(assignments)}"]
    lines.append(f"Total study blocks created: {len(blocks)}")
    lines.append(f"Buffer days before deadlines: {settings.get('buffer_days', 1)}")
    lines.append(f"Daily hour cap: {settings.get('daily_hour_cap', 3)}")
    lines.append("")

    for a in assignments:
        scheduled = block_counts.get(a["title"], 0)
        total = int(float(a.get("estimated_hours", 0)) * 60)
        lines.append(
            f"- {a['title']} ({a['course']}): {a.get('estimated_hours', 0)}h estimated, "
            f"{round(scheduled / 60, 1)}h scheduled, due {a.get('due_date', '')[:10]}"
        )

    if warnings:
        lines.append("\nAlgorithm warnings:")
        for w in warnings:
            lines.append(f"- {w['assignment']}: {w['message']}")

    return "\n".join(lines)


def _extract_warnings(text: str) -> list[dict]:
    match = re.search(r"<warnings>(.*?)</warnings>", text, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group(1).strip())
    except json.JSONDecodeError:
        return []
