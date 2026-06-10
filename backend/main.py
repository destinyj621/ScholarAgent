import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client

load_dotenv()

app = FastAPI(title="ScholarAgent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_url = os.getenv("SUPABASE_URL", "")
_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
db = create_client(_url, _key) if _url and _key else None


@app.get("/health")
def health():
    return {"status": "ok"}


def _not_implemented():
    raise HTTPException(status_code=501, detail="Not implemented yet")


# --- Ingestion ---

@app.post("/ingest/ics")
def ingest_ics():
    _not_implemented()


@app.post("/ingest/pdf")
def ingest_pdf():
    _not_implemented()


# --- Pipeline ---

@app.post("/pipeline/run")
def pipeline_run():
    _not_implemented()


@app.post("/pipeline/continue")
def pipeline_continue():
    _not_implemented()


# --- Schedule ---

@app.get("/schedule")
def get_schedule():
    _not_implemented()


# --- Progress & check-in ---

@app.post("/progress")
def log_progress():
    _not_implemented()


@app.get("/accuracy")
def get_accuracy():
    _not_implemented()


@app.get("/checkin/pending")
def checkin_pending():
    _not_implemented()


@app.post("/checkin")
def submit_checkin():
    _not_implemented()


# --- Assignments ---

@app.get("/assignments")
def get_assignments():
    _not_implemented()


# --- Settings ---

@app.get("/settings")
def get_settings():
    _not_implemented()


@app.put("/settings")
def update_settings():
    _not_implemented()


# --- Classes ---

@app.get("/classes")
def get_classes():
    _not_implemented()


@app.post("/classes")
def create_class():
    _not_implemented()


@app.put("/classes/{class_id}")
def update_class(class_id: str):
    _not_implemented()


@app.delete("/classes/{class_id}")
def delete_class(class_id: str):
    _not_implemented()


# --- Google OAuth ---

@app.get("/auth/google")
def google_auth():
    _not_implemented()


@app.get("/auth/google/callback")
def google_callback():
    _not_implemented()


@app.get("/auth/google/status")
def google_status():
    _not_implemented()


# --- Integrations ---

@app.post("/google/sync")
def google_sync():
    _not_implemented()


@app.post("/digest/send")
def digest_send():
    _not_implemented()
