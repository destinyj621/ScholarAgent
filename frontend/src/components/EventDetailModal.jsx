import { useEffect, useState } from "react";
import { api } from "../lib/api";
import styles from "./EventDetailModal.module.css";

export default function EventDetailModal({ event, onClose, onUpdated }) {
  const [hours, setHours] = useState("");
  const [percent, setPercent] = useState(event?.extendedProps?.assignment?.percent_complete ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!event) return null;

  const { block, assignment, type } = event.extendedProps ?? {};

  async function handleLogProgress(e) {
    e.preventDefault();
    if (!assignment?.id) return;
    setSaving(true);
    setError(null);
    try {
      await api("/progress", {
        body: {
          assignment_id: assignment.id,
          hours_worked: parseFloat(hours),
          percent_complete: percent,
        },
      });
      onUpdated?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkComplete() {
    if (!assignment?.id) return;
    setSaving(true);
    try {
      await api(`/assignments/${assignment.id}`, {
        method: "PUT",
        body: { status: "complete" },
      });
      onUpdated?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const estimated = assignment?.estimated_hours ?? 0;
  const logged = assignment?.actual_hours ?? 0;
  const pct = assignment?.percent_complete ?? 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose}>✕</button>

        {type === "due_date" ? (
          <>
            <p className={styles.tag}>Due Date</p>
            <h2 className={styles.title}>{assignment?.title}</h2>
            <p className={styles.meta}>{assignment?.course}</p>
            <p className={styles.meta}>
              Due {new Date(assignment?.due_date).toLocaleDateString(undefined, { dateStyle: "long" })}
            </p>
          </>
        ) : (
          <>
            <p className={styles.tag}>Study Block — {block?.duration_minutes} min</p>
            <h2 className={styles.title}>{block?.task ?? assignment?.title}</h2>
            <p className={styles.meta}>{block?.course ?? assignment?.course}</p>
            <p className={styles.meta}>
              Due {new Date(block?.deadline ?? assignment?.due_date).toLocaleDateString(undefined, { dateStyle: "long" })}
            </p>

            {assignment && (
              <>
                <div className={styles.statsRow}>
                  <span>{estimated}h estimated</span>
                  <span>{logged}h logged</span>
                  <span>{pct}% done</span>
                </div>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                </div>

                <form onSubmit={handleLogProgress} className={styles.form}>
                  <h3 className={styles.formTitle}>Log progress</h3>
                  <label className={styles.label}>
                    Hours worked this session
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                      className={styles.input}
                      required
                    />
                  </label>
                  <label className={styles.label}>
                    Overall completion — {percent}%
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={percent}
                      onChange={(e) => setPercent(Number(e.target.value))}
                      className={styles.slider}
                    />
                  </label>
                  {error && <p className={styles.error}>{error}</p>}
                  <div className={styles.actions}>
                    <button type="submit" className={styles.btn} disabled={saving}>
                      {saving ? "Saving..." : "Log Progress"}
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.complete}`}
                      onClick={handleMarkComplete}
                      disabled={saving}
                    >
                      Mark Complete
                    </button>
                  </div>
                </form>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
