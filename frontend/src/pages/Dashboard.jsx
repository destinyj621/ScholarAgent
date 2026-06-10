import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AgentStream from "../components/AgentStream";
import { api } from "../lib/api";
import styles from "./Dashboard.module.css";

const API = import.meta.env.VITE_API_URL || "";

export default function Dashboard() {
  const navigate = useNavigate();

  // ICS input
  const [icsUrl, setIcsUrl] = useState("");
  const [icsFile, setIcsFile] = useState(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState(null);

  // Deadline review
  const [events, setEvents] = useState(null);

  // Pipeline
  const [streaming, setStreaming] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [streamBody, setStreamBody] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [pipelineError, setPipelineError] = useState(null);

  // Daily check-in
  const [checkinBlocks, setCheckinBlocks] = useState(null); // null = not loaded yet
  const [checkinResponses, setCheckinResponses] = useState({}); // block_id -> {status, hours?, percent?}
  const [checkinDone, setCheckinDone] = useState(false);
  const [checkinWarnings, setCheckinWarnings] = useState([]);

  // PDF / context uploads for vague assignments
  const [needsInput, setNeedsInput] = useState(null); // {session_id, assignments}
  const [contextMap, setContextMap] = useState({}); // uid -> description
  const [teamDetails, setTeamDetails] = useState({}); // uid -> {meeting_date, tasks, split}
  const pdfInputRef = useRef(null);

  // Load yesterday's check-in on mount
  useEffect(() => {
    api("/checkin/pending")
      .then((d) => setCheckinBlocks(d.blocks || []))
      .catch(() => setCheckinBlocks([]));
  }, []);

  async function handleIngest(e) {
    e.preventDefault();
    setIngesting(true);
    setIngestError(null);
    setEvents(null);

    try {
      const form = new FormData();
      if (icsFile) {
        form.append("file", icsFile);
      } else if (icsUrl.trim()) {
        form.append("url", icsUrl.trim());
      } else {
        setIngestError("Enter a URL or upload an ICS file.");
        setIngesting(false);
        return;
      }

      const resp = await fetch(`${API}/ingest/ics`, { method: "POST", body: form });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.detail || "Ingestion failed.");
      setEvents(json.events);
    } catch (err) {
      setIngestError(err.message);
    } finally {
      setIngesting(false);
    }
  }

  async function handlePdfUpload(uid, file) {
    const form = new FormData();
    form.append("file", file);
    form.append("assignment_id", uid);
    const resp = await fetch(`${API}/ingest/pdf`, { method: "POST", body: form });
    const json = await resp.json();
    if (resp.ok) {
      setContextMap((prev) => ({ ...prev, [uid]: json.text }));
    }
  }

  function handleGenerate() {
    setPipelineError(null);
    setWarnings([]);
    setNeedsInput(null);
    setStreamUrl(`${API}/pipeline/run`);
    setStreamBody({ events });
    setStreaming(true);
  }

  function handleNeedsInput(event) {
    setStreaming(false);
    setNeedsInput({ session_id: event.session_id, assignments: event.assignments });
  }

  function handleComplete(event) {
    setStreaming(false);
    if (event.warnings?.length) {
      setWarnings(event.warnings);
    } else {
      navigate("/calendar");
    }
  }

  function handleStreamError(msg) {
    setStreaming(false);
    setPipelineError(msg);
  }

  async function handleContinue() {
    const context = needsInput.assignments.map((a) => ({
      uid: a.uid || a.title,
      description: contextMap[a.uid || a.title] || "",
    }));
    setStreamUrl(`${API}/pipeline/continue`);
    setStreamBody({ session_id: needsInput.session_id, context });
    setNeedsInput(null);
    setStreaming(true);
  }

  function groupByCourse(events) {
    return events.reduce((acc, e) => {
      const course = e.course || "Unknown Course";
      (acc[course] = acc[course] || []).push(e);
      return acc;
    }, {});
  }

  async function submitCheckin() {
    const items = (checkinBlocks || []).map((b) => {
      const resp = checkinResponses[b.id] || { status: "done" };
      return { block_id: b.id, ...resp };
    });
    try {
      const result = await api("/checkin", { body: { items } });
      setCheckinDone(true);
      if (result.needs_rebuild) {
        setCheckinWarnings([{ message: "Schedule rebuilt from today based on your check-in." }]);
      }
    } catch {
      setCheckinDone(true);
    }
  }

  const checkinPending = checkinBlocks && checkinBlocks.length > 0 && !checkinDone;
  const canGenerate = events && events.length > 0 && !streaming && !needsInput && !checkinPending;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Dashboard</h1>

      {/* Daily Check-In Banner */}
      {checkinPending && (
        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Daily Check-In</h2>
          <p className={styles.hint}>What happened with yesterday's scheduled work?</p>
          {checkinBlocks.map((b) => {
            const resp = checkinResponses[b.id] || {};
            return (
              <div key={b.id} className={styles.checkinBlock}>
                <div className={styles.checkinMeta}>
                  <strong>{b.task}</strong>
                  <span className={styles.muted}>{b.course} &middot; {b.duration_minutes} min</span>
                </div>
                <div className={styles.checkinBtns}>
                  {["done", "partial", "skipped"].map((s) => (
                    <button
                      key={s}
                      className={`${styles.checkinBtn} ${resp.status === s ? styles.checkinSelected : ""}`}
                      onClick={() => setCheckinResponses((p) => ({ ...p, [b.id]: { ...p[b.id], status: s } }))}
                    >
                      {s === "done" ? "Done" : s === "partial" ? "Partially Done" : "Didn't Do It"}
                    </button>
                  ))}
                </div>
                {resp.status === "partial" && (
                  <div className={styles.checkinExtra}>
                    <label className={styles.label}>
                      Hours worked
                      <input type="number" min="0" step="0.25" className={styles.inputSm}
                        value={resp.hours || ""}
                        onChange={(e) => setCheckinResponses((p) => ({ ...p, [b.id]: { ...p[b.id], hours_worked: parseFloat(e.target.value) } }))}
                      />
                    </label>
                    <label className={styles.label}>
                      % Complete — {resp.percent_complete ?? 0}%
                      <input type="range" min="0" max="100"
                        value={resp.percent_complete ?? 0}
                        onChange={(e) => setCheckinResponses((p) => ({ ...p, [b.id]: { ...p[b.id], percent_complete: Number(e.target.value) } }))}
                        className={styles.slider}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
          {checkinWarnings.map((w, i) => (
            <p key={i} className={styles.infoMsg}>{w.message}</p>
          ))}
          <button className={`${styles.btn} ${styles.primary}`} onClick={submitCheckin}>
            Submit Check-In
          </button>
        </section>
      )}

      {/* ICS Input */}
      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>Import your D2L calendar</h2>
        <form onSubmit={handleIngest} className={styles.icsForm}>
          <input
            type="url"
            placeholder="Paste your D2L ICS feed URL..."
            value={icsUrl}
            onChange={(e) => { setIcsUrl(e.target.value); setIcsFile(null); }}
            className={styles.input}
          />
          <span className={styles.or}>or</span>
          <label className={styles.fileLabel}>
            {icsFile ? icsFile.name : "Upload .ics file"}
            <input
              type="file"
              accept=".ics"
              hidden
              onChange={(e) => { setIcsFile(e.target.files[0]); setIcsUrl(""); }}
            />
          </label>
          <button type="submit" className={styles.btn} disabled={ingesting}>
            {ingesting ? "Loading..." : "Import"}
          </button>
        </form>
        {ingestError && <p className={styles.error}>{ingestError}</p>}
      </section>

      {/* Deadline Review */}
      {events && (
        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>
            Filtered deadlines <span className={styles.badge}>{events.length}</span>
          </h2>
          {Object.entries(groupByCourse(events)).map(([course, items]) => (
            <div key={course} className={styles.courseGroup}>
              <h3 className={styles.courseName}>{course}</h3>
              <ul className={styles.eventList}>
                {items.map((ev) => (
                  <li key={ev.uid || ev.title} className={styles.eventItem}>
                    <div className={styles.eventHeader}>
                      <span className={styles.eventTitle}>{ev.title}</span>
                      <span className={`${styles.typeBadge} ${styles[ev.event_type]}`}>
                        {ev.event_type}
                      </span>
                      <span className={styles.dueDate}>
                        Due {new Date(ev.due_date).toLocaleDateString()}
                      </span>
                    </div>
                    {!ev.description && (
                      <p className={styles.vagueWarning}>
                        No description — upload the assignment PDF or paste instructions for a better estimate.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* Needs-Input Section */}
      {needsInput && (
        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Additional context needed</h2>
          <p className={styles.hint}>
            The EstimatorAgent needs more detail for the assignments below before it can schedule them.
          </p>
          {needsInput.assignments.map((a) => (
            <div key={a.uid || a.title} className={styles.contextBlock}>
              <div className={styles.contextHeader}>
                <strong>{a.title}</strong>
                <span className={styles.contextReason}>{a.needs_input_reason}</span>
              </div>
              {contextMap[a.uid || a.title] ? (
                <p className={styles.contextProvided}>Context received.</p>
              ) : a.needs_input_reason === "team_project" ? (
                <div className={styles.contextActions}>
                  <p className={styles.hint}>Answer these questions so the agent can estimate your share of the work.</p>
                  {[
                    { key: "meeting_date", label: "When is your next team meeting?", type: "date" },
                    { key: "tasks", label: "What do you need done before that meeting?", type: "text" },
                    { key: "split", label: "How is work split across the team?", type: "text" },
                  ].map(({ key, label, type }) => (
                    <label key={key} className={styles.label}>
                      {label}
                      <input
                        type={type}
                        className={styles.input}
                        value={teamDetails[a.uid || a.title]?.[key] || ""}
                        onChange={(e) =>
                          setTeamDetails((p) => ({
                            ...p,
                            [a.uid || a.title]: { ...p[a.uid || a.title], [key]: e.target.value },
                          }))
                        }
                      />
                    </label>
                  ))}
                  <button
                    className={styles.btn}
                    onClick={() => {
                      const details = teamDetails[a.uid || a.title] || {};
                      const summary = `Meeting: ${details.meeting_date || "TBD"}. Pre-meeting tasks: ${details.tasks || "TBD"}. Work split: ${details.split || "TBD"}.`;
                      setContextMap((p) => ({ ...p, [a.uid || a.title]: summary }));
                    }}
                  >
                    Save Team Details
                  </button>
                </div>
              ) : (
                <div className={styles.contextActions}>
                  <label className={styles.fileLabel}>
                    Upload PDF
                    <input
                      type="file"
                      accept=".pdf"
                      hidden
                      onChange={(e) => handlePdfUpload(a.uid || a.title, e.target.files[0])}
                    />
                  </label>
                  <textarea
                    placeholder="Or paste assignment instructions here..."
                    className={styles.textarea}
                    rows={4}
                    onChange={(e) =>
                      setContextMap((prev) => ({ ...prev, [a.uid || a.title]: e.target.value }))
                    }
                  />
                </div>
              )}
            </div>
          ))}
          <button className={styles.btn} onClick={handleContinue}>
            Continue with this context
          </button>
        </section>
      )}

      {/* Generate */}
      {canGenerate && (
        <section className={styles.generateRow}>
          <button className={`${styles.btn} ${styles.primary}`} onClick={handleGenerate}>
            Generate Schedule
          </button>
        </section>
      )}

      {/* Warnings after complete */}
      {warnings.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Schedule warnings</h2>
          {warnings.map((w, i) => (
            <div key={i} className={`${styles.warning} ${w.at_risk ? styles.atRisk : ""}`}>
              <strong>{w.assignment}</strong> — {w.message}
            </div>
          ))}
          <button className={`${styles.btn} ${styles.primary}`} onClick={() => navigate("/calendar")}>
            View Calendar
          </button>
        </section>
      )}

      {pipelineError && (
        <section className={styles.card}>
          <p className={styles.error}>Pipeline error: {pipelineError}</p>
          <button className={styles.btn} onClick={handleGenerate}>Retry</button>
        </section>
      )}

      {/* Streaming Panel */}
      {streaming && (
        <AgentStream
          url={streamUrl}
          body={streamBody}
          onNeedsInput={handleNeedsInput}
          onComplete={handleComplete}
          onError={handleStreamError}
        />
      )}
    </div>
  );
}
