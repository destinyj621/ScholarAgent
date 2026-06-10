import { useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import styles from "./Assignments.module.css";

const STATUS_LABELS = { not_started: "Not Started", in_progress: "In Progress", complete: "Complete" };
const STATUS_COLORS = { not_started: styles.grey, in_progress: styles.yellow, complete: styles.green };

export default function Assignments() {
  const { data, loading, error, refetch } = useApi("/assignments");
  const assignments = data?.assignments ?? [];

  const [expanded, setExpanded] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCourse, setFilterCourse] = useState("all");
  const [saving, setSaving] = useState(false);

  // Local editable state per assignment
  const [notes, setNotes] = useState({});
  const [hours, setHours] = useState({});
  const [percent, setPercent] = useState({});

  const courses = [...new Set(assignments.map((a) => a.course).filter(Boolean))];

  const visible = assignments.filter((a) => {
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    if (filterCourse !== "all" && a.course !== filterCourse) return false;
    return true;
  });

  const active = visible.filter((a) => a.status !== "complete");
  const done = visible.filter((a) => a.status === "complete");

  const grouped = active.reduce((acc, a) => {
    (acc[a.course] = acc[a.course] || []).push(a);
    return acc;
  }, {});

  function toggle(id) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  async function saveNotes(a) {
    try {
      await api(`/assignments/${a.id}`, { method: "PUT", body: { notes: notes[a.id] ?? a.notes } });
    } catch {
      // silent — notes save is best-effort
    }
  }

  async function logProgress(a) {
    setSaving(true);
    try {
      await api("/progress", {
        body: {
          assignment_id: a.id,
          hours_worked: parseFloat(hours[a.id] || 0),
          percent_complete: percent[a.id] ?? a.percent_complete ?? 0,
        },
      });
      refetch();
    } finally {
      setSaving(false);
    }
  }

  async function markComplete(a) {
    setSaving(true);
    try {
      await api(`/assignments/${a.id}`, { method: "PUT", body: { status: "complete" } });
      refetch();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className={styles.msg}>Loading assignments...</p>;
  if (error) return <p className={styles.error}>Error: {error}</p>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Assignments</h1>

      <div className={styles.filters}>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={styles.select}>
          <option value="all">All statuses</option>
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="complete">Complete</option>
        </select>
        <select value={filterCourse} onChange={(e) => setFilterCourse(e.target.value)} className={styles.select}>
          <option value="all">All courses</option>
          {courses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {Object.entries(grouped).map(([course, items]) => (
        <section key={course} className={styles.courseSection}>
          <h2 className={styles.courseName}>{course}</h2>
          {items
            .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
            .map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                isExpanded={expanded === a.id}
                onToggle={() => toggle(a.id)}
                note={notes[a.id] ?? a.notes ?? ""}
                onNoteChange={(v) => setNotes((p) => ({ ...p, [a.id]: v }))}
                onNoteBlur={() => saveNotes(a)}
                hoursInput={hours[a.id] ?? ""}
                onHoursChange={(v) => setHours((p) => ({ ...p, [a.id]: v }))}
                pct={percent[a.id] ?? a.percent_complete ?? 0}
                onPctChange={(v) => setPercent((p) => ({ ...p, [a.id]: v }))}
                onLogProgress={() => logProgress(a)}
                onMarkComplete={() => markComplete(a)}
                saving={saving}
              />
            ))}
        </section>
      ))}

      {done.length > 0 && (
        <section className={styles.courseSection}>
          <h2 className={styles.courseName}>Completed ({done.length})</h2>
          {done.map((a) => (
            <div key={a.id} className={`${styles.card} ${styles.cardDone}`}>
              <span className={styles.cardTitle}>{a.title}</span>
              <span className={`${styles.badge} ${styles.green}`}>Complete</span>
              <span className={styles.dueDate}>
                {a.actual_hours != null ? `${a.actual_hours}h actual` : ""}
              </span>
            </div>
          ))}
        </section>
      )}

      {assignments.length === 0 && (
        <p className={styles.msg}>No assignments yet. Import your calendar from the Dashboard.</p>
      )}
    </div>
  );
}

function AssignmentCard({
  assignment: a, isExpanded, onToggle,
  note, onNoteChange, onNoteBlur,
  hoursInput, onHoursChange,
  pct, onPctChange,
  onLogProgress, onMarkComplete, saving,
}) {
  return (
    <div className={`${styles.card} ${isExpanded ? styles.cardOpen : ""}`}>
      <div className={styles.cardHeader} onClick={onToggle}>
        <div className={styles.cardLeft}>
          <span className={styles.cardTitle}>{a.title}</span>
          <span className={`${styles.badge} ${STATUS_COLORS[a.status]}`}>
            {STATUS_LABELS[a.status]}
          </span>
        </div>
        <div className={styles.cardRight}>
          <span className={styles.dueDate}>Due {new Date(a.due_date).toLocaleDateString()}</span>
          {a.estimated_hours && (
            <span className={styles.hours}>{a.estimated_hours}h est.</span>
          )}
          <span className={styles.chevron}>{isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {(a.percent_complete > 0) && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${a.percent_complete}%` }} />
        </div>
      )}

      {isExpanded && (
        <div className={styles.cardBody}>
          {a.description && <p className={styles.description}>{a.description.slice(0, 300)}{a.description.length > 300 ? "..." : ""}</p>}

          <label className={styles.label}>
            Notes
            <textarea
              className={styles.textarea}
              rows={3}
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              onBlur={onNoteBlur}
              placeholder="Add notes..."
            />
          </label>

          <div className={styles.progressForm}>
            <label className={styles.label}>
              Hours worked this session
              <input
                type="number"
                min="0"
                step="0.25"
                value={hoursInput}
                onChange={(e) => onHoursChange(e.target.value)}
                className={styles.input}
              />
            </label>
            <label className={styles.label}>
              Overall completion — {pct}%
              <input
                type="range"
                min="0"
                max="100"
                value={pct}
                onChange={(e) => onPctChange(Number(e.target.value))}
                className={styles.slider}
              />
            </label>
          </div>

          <div className={styles.actions}>
            <button className={styles.btn} onClick={onLogProgress} disabled={saving || !hoursInput}>
              Log Progress
            </button>
            <button className={`${styles.btn} ${styles.primary}`} onClick={onMarkComplete} disabled={saving}>
              Mark Complete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
