import json
import os
import re
from collections.abc import Generator

import anthropic

MODEL = "claude-opus-4-8"

_SYSTEM = """You are the FilterAgent for ScholarAgent, an AI study scheduler.

Your task: classify each D2L calendar event as a real academic deadline or noise.

KEEP:
- Assignments (programming, writing, labs, problem sets, homework)
- Exams and midterms (proctored or take-home)
- Quizzes (graded, any format)
- Discussion posts and replies
- Project milestones and final submissions
- Lab reports and submissions

DISCARD:
- Lecture and class sessions
- Office hours and availability windows
- Open study periods or review sessions
- Generic calendar blocks with no student deliverable
- Duplicate entries for the same deadline

For each event you keep, extract:
- title: clean title of the assignment
- course: the course name (infer from title/description if not explicit)
- due_date: the ISO datetime string from the event
- description: the event description (preserve as-is)
- event_type: one of "exam", "quiz", "discussion", "assignment", "project"
- uid: the event UID

Think through each event briefly, then output your final answer as a JSON array inside <result> tags.

<result>
[{"title": "...", "course": "...", "due_date": "...", "description": "...", "event_type": "...", "uid": "..."}]
</result>"""


def run(events: list[dict]) -> Generator[dict, None, None]:
    """
    Yields {"stage": "filter", "token": str} during streaming,
    then {"stage": "filter_complete", "assignments": list} when done.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    user_msg = f"Classify these {len(events)} calendar events:\n\n{json.dumps(events, indent=2, default=str)}"

    accumulated = ""
    with client.messages.stream(
        model=MODEL,
        max_tokens=4096,
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        for text in stream.text_stream:
            accumulated += text
            yield {"stage": "filter", "token": text}

    yield {"stage": "filter_complete", "assignments": _extract(accumulated)}


def _extract(text: str) -> list[dict]:
    match = re.search(r"<result>(.*?)</result>", text, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group(1).strip())
    except json.JSONDecodeError:
        return []
