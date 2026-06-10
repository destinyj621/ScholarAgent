import json
import os
import uuid
from io import BytesIO

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import create_client

from backend.agents import filter_agent, estimator_agent, scheduler_agent
from backend.ingestion.parse_calendar import parse_ics_bytes, parse_ics_url
from backend.ingestion.parse_document import parse_pdf

load_dotenv()

app = FastAPI(title="ScholarAgent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_supabase_url = os.getenv("SUPABASE_URL", "")
_supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
db = create_client(_supabase_url, _supabase_key) if _supabase_url and _supabase_key else None

# In-memory pipeline state (single-user app — one active session at a time)
_pipeline_sessions: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _get_settings() -> dict:
    if db:
        rows = db.table("settings").select("*").limit(1).execute()
        if rows.data:
            return rows.data[0]
    return {
        "daily_hour_cap": 3.0,
        "buffer_days": 1,
        "semester_start": None,
        "semester_end": None,
        "availability": {
            "monday":    {"available": True,  "hours": 3.0},
            "tuesday":   {"available": True,  "hours": 3.0},
            "wednesday": {"available": True,  "hours": 3.0},
            "thursday":  {"available": True,  "hours": 3.0},
            "friday":    {"available": True,  "hours": 3.0},
            "saturday":  {"available": False, "hours": 0.0},
            "sunday":    {"available": True,  "hours": 2.0},
        },
    }


def _get_class_overrides() -> dict:
    if db:
        rows = db.table("classes").select("name,type_overrides").execute()
        return {r["name"]: r["type_overrides"] for r in rows.data if r.get("type_overrides")}
    return {}


def _persist_assignments(assignments: list[dict]) -> None:
    if not db:
        return
    for a in assignments:
        db.table("assignments").upsert(
            {
                "title": a["title"],
                "course": a["course"],
                "due_date": a["due_date"],
                "assignment_type": a.get("event_type"),
                "description": a.get("description", ""),
                "estimated_hours": a.get("estimated_hours"),
                "status": "not_started",
            },
            on_conflict="title,due_date",
        ).execute()


def _persist_blocks(blocks: list[dict]) -> None:
    if not db:
        return
    db.table("schedule_blocks").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    for b in blocks:
        db.table("schedule_blocks").insert(
            {
                "date": b["date"],
                "duration_minutes": b["duration_minutes"],
                "course": b.get("course"),
            }
        ).execute()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------

@app.post("/ingest/ics")
async def ingest_ics(
    url: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
):
    settings = _get_settings()
    semester_start = settings.get("semester_start")
    semester_end = settings.get("semester_end")

    if url:
        events = parse_ics_url(url, semester_start, semester_end)
    elif file:
        data = await file.read()
        events = parse_ics_bytes(data, semester_start, semester_end)
    else:
        raise HTTPException(status_code=422, detail="Provide either a url or a file.")

    return {"events": events, "count": len(events)}


@app.post("/ingest/pdf")
async def ingest_pdf_route(
    assignment_id: str | None = Form(default=None),
    file: UploadFile = File(...),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    data = await file.read()
    text = parse_pdf(data)

    if db and assignment_id:
        db.table("assignments").update({"description": text}).eq("id", assignment_id).execute()

    return {"text": text, "word_count": len(text.split())}


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class PipelineRunRequest(BaseModel):
    ics_url: str | None = None
    events: list[dict] | None = None  # pre-parsed events if already ingested


@app.post("/pipeline/run")
def pipeline_run(req: PipelineRunRequest):
    def generate():
        try:
            settings = _get_settings()
            class_overrides = _get_class_overrides()

            # Use provided events or fetch from ICS URL
            if req.events:
                events = req.events
            elif req.ics_url:
                events = parse_ics_url(
                    req.ics_url,
                    settings.get("semester_start"),
                    settings.get("semester_end"),
                )
            else:
                yield _sse({"stage": "error", "message": "No ICS source provided."})
                return

            yield _sse({"stage": "filter", "token": f"Reviewing {len(events)} calendar events...\n\n"})

            # --- FilterAgent ---
            assignments = []
            for event in filter_agent.run(events):
                if event.get("stage") == "filter":
                    yield _sse(event)
                elif event.get("stage") == "filter_complete":
                    assignments = event["assignments"]

            yield _sse({"stage": "filter", "token": f"\n\nKept {len(assignments)} deadlines.\n\n"})
            _persist_assignments(assignments)

            # --- EstimatorAgent ---
            yield _sse({"stage": "estimate", "token": "Estimating time for each assignment...\n\n"})

            estimated_all = []
            needs_input = []
            for event in estimator_agent.run(assignments, class_overrides):
                if event.get("stage") == "estimate":
                    yield _sse(event)
                elif event.get("stage") == "estimate_complete":
                    estimated_all = event["estimated"]
                    needs_input = event["needs_input"]

            _persist_assignments(estimated_all + needs_input)

            if needs_input:
                session_id = str(uuid.uuid4())
                _pipeline_sessions[session_id] = {
                    "estimated": estimated_all,
                    "needs_input": needs_input,
                    "settings": settings,
                    "class_overrides": class_overrides,
                }
                yield _sse({
                    "stage": "needs_input",
                    "session_id": session_id,
                    "assignments": needs_input,
                })
                return

            # --- SchedulerAgent ---
            yield _sse({"stage": "schedule", "token": "Building your study schedule...\n\n"})

            blocks = []
            warnings = []
            for event in scheduler_agent.run(estimated_all, settings):
                if event.get("stage") == "schedule":
                    yield _sse(event)
                elif event.get("stage") == "schedule_complete":
                    blocks = event["blocks"]
                    warnings = event["warnings"]

            _persist_blocks(blocks)
            yield _sse({"stage": "complete", "schedule": blocks, "warnings": warnings})

        except Exception as exc:
            yield _sse({"stage": "error", "message": str(exc)})

    return StreamingResponse(generate(), media_type="text/event-stream")


class PipelineContinueRequest(BaseModel):
    session_id: str
    context: list[dict]  # [{uid: str, description: str, is_team_project: bool, team_details: dict|None}]


@app.post("/pipeline/continue")
def pipeline_continue(req: PipelineContinueRequest):
    session = _pipeline_sessions.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Pipeline session not found or expired.")

    def generate():
        try:
            settings = session["settings"]
            class_overrides = session["class_overrides"]
            already_estimated = session["estimated"]
            needs_input = session["needs_input"]

            # Inject provided context into the flagged assignments
            context_map = {c["uid"]: c for c in req.context}
            updated = []
            for a in needs_input:
                ctx = context_map.get(a.get("uid", a.get("title")), {})
                updated.append({**a, "description": ctx.get("description", a.get("description", ""))})

            yield _sse({"stage": "estimate", "token": "Re-estimating with the context you provided...\n\n"})

            newly_estimated = []
            for event in estimator_agent.run(updated, class_overrides):
                if event.get("stage") == "estimate":
                    yield _sse(event)
                elif event.get("stage") == "estimate_complete":
                    newly_estimated = event["estimated"]

            all_estimated = already_estimated + newly_estimated
            _persist_assignments(all_estimated)

            yield _sse({"stage": "schedule", "token": "Rebuilding your full schedule...\n\n"})

            blocks = []
            warnings = []
            for event in scheduler_agent.run(all_estimated, settings):
                if event.get("stage") == "schedule":
                    yield _sse(event)
                elif event.get("stage") == "schedule_complete":
                    blocks = event["blocks"]
                    warnings = event["warnings"]

            _persist_blocks(blocks)
            del _pipeline_sessions[req.session_id]
            yield _sse({"stage": "complete", "schedule": blocks, "warnings": warnings})

        except Exception as exc:
            yield _sse({"stage": "error", "message": str(exc)})

    return StreamingResponse(generate(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------

@app.get("/schedule")
def get_schedule():
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    rows = db.table("schedule_blocks").select("*").order("date").execute()
    return {"blocks": rows.data}


# ---------------------------------------------------------------------------
# Progress & check-in
# ---------------------------------------------------------------------------

class ProgressRequest(BaseModel):
    assignment_id: str
    hours_worked: float
    percent_complete: int


@app.post("/progress")
def log_progress(req: ProgressRequest):
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")

    db.table("progress_logs").insert({
        "assignment_id": req.assignment_id,
        "hours_worked": req.hours_worked,
        "percent_complete": req.percent_complete,
    }).execute()

    # Fetch current estimate
    rows = db.table("assignments").select("estimated_hours,assignment_type,course").eq("id", req.assignment_id).execute()
    if not rows.data:
        raise HTTPException(status_code=404, detail="Assignment not found.")

    assignment = rows.data[0]
    current_estimate = float(assignment.get("estimated_hours") or 0)
    warnings = []

    # Recalibrate if implied total diverges by more than 15%
    if req.percent_complete > 0:
        implied_total = req.hours_worked / (req.percent_complete / 100)
        if current_estimate > 0 and abs(implied_total - current_estimate) / current_estimate > 0.15:
            db.table("assignments").update({"estimated_hours": round(implied_total, 2)}).eq("id", req.assignment_id).execute()
            warnings.append({
                "message": f"Estimate updated from {current_estimate}h to {round(implied_total, 2)}h based on your progress."
            })

    if req.percent_complete >= 100:
        db.table("assignments").update({"status": "complete", "actual_hours": req.hours_worked}).eq("id", req.assignment_id).execute()
        if assignment.get("assignment_type") and assignment.get("course"):
            db.table("estimate_accuracy").insert({
                "course": assignment["course"],
                "assignment_type": assignment["assignment_type"],
                "estimated_hours": current_estimate,
                "actual_hours": req.hours_worked,
            }).execute()

    return {"warnings": warnings}


@app.get("/accuracy")
def get_accuracy():
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    rows = db.table("estimate_accuracy").select("*").execute()
    return {"records": rows.data}


@app.get("/checkin/pending")
def checkin_pending():
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    from datetime import date, timedelta
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    rows = db.table("schedule_blocks").select("*").eq("date", yesterday).execute()
    return {"blocks": rows.data}


class CheckinItem(BaseModel):
    block_id: str
    status: str  # "done" | "partial" | "skipped"
    hours_worked: float | None = None
    percent_complete: int | None = None


class CheckinRequest(BaseModel):
    items: list[CheckinItem]


@app.post("/checkin")
def submit_checkin(req: CheckinRequest):
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")

    needs_rebuild = False
    for item in req.items:
        if item.status == "done":
            continue
        elif item.status == "partial" and item.hours_worked is not None and item.percent_complete is not None:
            block = db.table("schedule_blocks").select("assignment_id").eq("id", item.block_id).execute()
            if block.data:
                log_progress(ProgressRequest(
                    assignment_id=block.data[0]["assignment_id"],
                    hours_worked=item.hours_worked,
                    percent_complete=item.percent_complete,
                ))
        elif item.status == "skipped":
            needs_rebuild = True

    return {"needs_rebuild": needs_rebuild}


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------

@app.get("/assignments")
def get_assignments():
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    rows = db.table("assignments").select("*").order("due_date").execute()
    return {"assignments": rows.data}


class UpdateAssignmentRequest(BaseModel):
    notes: str | None = None
    prerequisites: list[str] | None = None
    status: str | None = None
    actual_hours: float | None = None


@app.put("/assignments/{assignment_id}")
def update_assignment(assignment_id: str, req: UpdateAssignmentRequest):
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    db.table("assignments").update(updates).eq("id", assignment_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@app.get("/settings")
def get_settings_route():
    return _get_settings()


class UpdateSettingsRequest(BaseModel):
    availability: dict | None = None
    daily_hour_cap: float | None = None
    buffer_days: int | None = None
    semester_start: str | None = None
    semester_end: str | None = None
    digest_enabled: bool | None = None
    digest_frequency: str | None = None
    digest_day: str | None = None
    digest_time: str | None = None
    google_sync_enabled: bool | None = None
    load_rules: dict | None = None
    type_defaults: dict | None = None


@app.put("/settings")
def update_settings(req: UpdateSettingsRequest):
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = db.table("settings").select("id").limit(1).execute()
    if rows.data:
        db.table("settings").update(updates).eq("id", rows.data[0]["id"]).execute()
    else:
        db.table("settings").insert(updates).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------

@app.get("/classes")
def get_classes():
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    rows = db.table("classes").select("*").execute()
    return {"classes": rows.data}


class ClassRequest(BaseModel):
    name: str
    color: str
    is_high_priority: bool = False
    type_overrides: dict | None = None


@app.post("/classes")
def create_class(req: ClassRequest):
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    row = db.table("classes").insert(req.model_dump()).execute()
    return row.data[0]


@app.put("/classes/{class_id}")
def update_class(class_id: str, req: ClassRequest):
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    db.table("classes").update(updates).eq("id", class_id).execute()
    return {"ok": True}


@app.delete("/classes/{class_id}")
def delete_class(class_id: str):
    if not db:
        raise HTTPException(status_code=503, detail="Database not configured.")
    db.table("classes").delete().eq("id", class_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Google OAuth (implemented in Phase 6)
# ---------------------------------------------------------------------------

@app.get("/auth/google")
def google_auth():
    raise HTTPException(status_code=501, detail="Not implemented yet.")


@app.get("/auth/google/callback")
def google_callback():
    raise HTTPException(status_code=501, detail="Not implemented yet.")


@app.get("/auth/google/status")
def google_status():
    raise HTTPException(status_code=501, detail="Not implemented yet.")


@app.post("/google/sync")
def google_sync():
    raise HTTPException(status_code=501, detail="Not implemented yet.")


@app.post("/digest/send")
def digest_send():
    raise HTTPException(status_code=501, detail="Not implemented yet.")
