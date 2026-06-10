import json
import os
import re
from collections.abc import Generator

import anthropic

MODEL = "claude-opus-4-8"

# Default rules applied when no per-class override exists.
DEFAULT_RULES = {
    "exam": {
        "proctored": {"hours": 1.5, "sessions": [90], "note": "One study session the night before"},
        "open_note": {"hours": 0, "sessions": [], "note": "No prep — just time to take it"},
    },
    "quiz": {
        "closed_note": {"hours": 0.5, "sessions": [30], "note": "30 minutes day of"},
        "open_note": {"hours": 0, "sessions": [], "note": "Nothing scheduled — just time to take it"},
    },
    "discussion": {"hours": 0.625, "sessions": [37], "note": "30–45 minutes"},
    "assignment": {"hours": 4.0, "sessions": [60, 90, 90], "note": "Estimate from description — typically 3–5 hours"},
    "project": {"hours": 8.0, "sessions": [120, 120, 120, 120], "note": "Estimate from description — typically 6–10 hours"},
}

_SYSTEM = """You are the EstimatorAgent for ScholarAgent, an AI study scheduler.

Your task: estimate how long each assignment will take and break it into study sessions.

Rules:
- Read the description carefully — more detail means a more accurate estimate.
- Proctored exam → one study session night before, 1–2 hours.
- Open-note exam → no prep scheduled (hours: 0).
- Closed-note quiz → 30 minutes day of.
- Open-note quiz → nothing scheduled (hours: 0).
- Discussion post → 30–45 minutes total.
- Programming assignment → estimate from description, typically 3–5 hours.
- Research paper → estimate from description, typically 6–10 hours.
- Team project → set needs_input to true and leave hours as null.
- If the description is empty or too vague to estimate accurately, set needs_input to true.
- Never schedule lecture review or note review sessions — assume the student works through material while doing the assignment.
- Break larger estimates into sessions of 60–120 minutes each.

For each assignment output:
- title, course, due_date, event_type, uid (pass through unchanged)
- estimated_hours: number (null if needs_input)
- session_breakdown: array of minutes per session (empty if needs_input)
- needs_input: true if you need more context (vague description or team project)
- needs_input_reason: "vague_description" | "team_project" | null
- notes: brief reasoning for your estimate

Output all estimates as a JSON array inside <result> tags after your reasoning.

<result>
[{"title": "...", "course": "...", "due_date": "...", "event_type": "...", "uid": "...",
  "estimated_hours": 3.0, "session_breakdown": [90, 90], "needs_input": false,
  "needs_input_reason": null, "notes": "..."}]
</result>"""


def run(assignments: list[dict], class_overrides: dict | None = None) -> Generator[dict, None, None]:
    """
    Yields {"stage": "estimate", "token": str} during streaming,
    then {"stage": "estimate_complete", "estimated": list, "needs_input": list} when done.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    overrides_text = ""
    if class_overrides:
        overrides_text = f"\n\nPer-class overrides (take precedence over defaults):\n{json.dumps(class_overrides, indent=2)}"

    user_msg = (
        f"Estimate time for these {len(assignments)} assignments:{overrides_text}\n\n"
        f"{json.dumps(assignments, indent=2, default=str)}"
    )

    accumulated = ""
    with client.messages.stream(
        model=MODEL,
        max_tokens=4096,
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        for text in stream.text_stream:
            accumulated += text
            yield {"stage": "estimate", "token": text}

    all_estimated = _extract(accumulated)
    needs_input = [a for a in all_estimated if a.get("needs_input")]
    ready = [a for a in all_estimated if not a.get("needs_input")]

    yield {"stage": "estimate_complete", "estimated": ready, "needs_input": needs_input}


def _extract(text: str) -> list[dict]:
    match = re.search(r"<result>(.*?)</result>", text, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group(1).strip())
    except json.JSONDecodeError:
        return []
