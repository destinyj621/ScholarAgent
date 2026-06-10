import re
from datetime import date, datetime, timezone

import requests
from icalendar import Calendar


def parse_ics_url(url: str, semester_start: datetime | None = None, semester_end: datetime | None = None) -> list[dict]:
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise ValueError(f"Could not fetch ICS feed: {exc}") from exc
    return _parse(resp.content, semester_start, semester_end)


def parse_ics_bytes(data: bytes, semester_start: datetime | None = None, semester_end: datetime | None = None) -> list[dict]:
    return _parse(data, semester_start, semester_end)


def _parse(data: bytes, semester_start: datetime | None, semester_end: datetime | None) -> list[dict]:
    try:
        cal = Calendar.from_ical(data)
    except Exception as exc:
        raise ValueError(f"Invalid ICS data: {exc}") from exc

    events = []
    for component in cal.walk():
        if component.name != "VEVENT":
            continue

        title = str(component.get("SUMMARY", "")).strip()
        description = str(component.get("DESCRIPTION", "")).strip()
        uid = str(component.get("UID", ""))

        dtend = component.get("DTEND")
        dtstart = component.get("DTSTART")
        raw_dt = dtend.dt if dtend else (dtstart.dt if dtstart else None)
        due_date = _to_utc(raw_dt)

        if due_date is None:
            continue
        if semester_start and due_date < semester_start:
            continue
        if semester_end and due_date > semester_end:
            continue

        categories: list[str] = []
        cats_prop = component.get("CATEGORIES")
        if cats_prop:
            items = cats_prop if isinstance(cats_prop, list) else [cats_prop]
            for item in items:
                if hasattr(item, "cats"):
                    categories.extend(str(c) for c in item.cats)
                else:
                    categories.append(str(item))

        events.append({
            "title": title,
            "due_date": due_date.isoformat(),
            "description": description,
            "categories": categories,
            "uid": uid,
        })

    return events


def _to_utc(dt) -> datetime | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    if isinstance(dt, date):
        return datetime(dt.year, dt.month, dt.day, 23, 59, 59, tzinfo=timezone.utc)
    return None
