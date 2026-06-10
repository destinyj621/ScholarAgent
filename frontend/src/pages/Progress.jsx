import { useApi } from "../lib/useApi";
import styles from "./Progress.module.css";

export default function Progress() {
  const { data: aData, loading: aLoading } = useApi("/assignments");
  const { data: accData } = useApi("/accuracy");

  const assignments = aData?.assignments ?? [];
  const accuracy = accData?.records ?? [];

  const now = new Date();
  const active = assignments.filter((a) => a.status !== "complete");
  const done = assignments.filter((a) => a.status === "complete");

  const atRisk = active.filter((a) => {
    const due = new Date(a.due_date);
    const hoursLeft = (due - now) / 36e5;
    const pct = a.percent_complete ?? 0;
    const implied = a.estimated_hours ? a.estimated_hours * (1 - pct / 100) : 0;
    return hoursLeft < 48 && pct < 80 || (a.actual_hours ?? 0) > (a.estimated_hours ?? Infinity);
  });

  // Accuracy by type
  const byType = accuracy.reduce((acc, r) => {
    const key = r.assignment_type || "unknown";
    if (!acc[key]) acc[key] = { estimated: [], actual: [] };
    acc[key].estimated.push(r.estimated_hours);
    acc[key].actual.push(r.actual_hours);
    return acc;
  }, {});

  if (aLoading) return <p className={styles.msg}>Loading...</p>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Progress</h1>

      {atRisk.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle + " " + styles.riskTitle}>At Risk</h2>
          {atRisk.map((a) => (
            <div key={a.id} className={styles.riskCard}>
              <div className={styles.riskHeader}>
                <strong>{a.title}</strong>
                <span className={styles.courseTag}>{a.course}</span>
              </div>
              <p className={styles.riskMeta}>
                Due {new Date(a.due_date).toLocaleDateString()} &middot; {a.percent_complete ?? 0}% complete &middot; {a.estimated_hours ?? "?"}h estimated
              </p>
            </div>
          ))}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Active Assignments</h2>
        {active.length === 0 && <p className={styles.msg}>No active assignments.</p>}
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Assignment</th>
              <th>Course</th>
              <th>Due</th>
              <th>Est. Hours</th>
              <th>Logged</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td className={styles.muted}>{a.course}</td>
                <td className={styles.muted}>{new Date(a.due_date).toLocaleDateString()}</td>
                <td>{a.estimated_hours ?? "—"}</td>
                <td>{a.actual_hours ?? 0}</td>
                <td>
                  <div className={styles.miniBar}>
                    <div className={styles.miniFill} style={{ width: `${a.percent_complete ?? 0}%` }} />
                  </div>
                  <span className={styles.pctLabel}>{a.percent_complete ?? 0}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {done.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Completed</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Assignment</th>
                <th>Course</th>
                <th>Estimated</th>
                <th>Actual</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {done.map((a) => {
                const variance = (a.actual_hours ?? 0) - (a.estimated_hours ?? 0);
                return (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td className={styles.muted}>{a.course}</td>
                    <td>{a.estimated_hours ?? "—"}</td>
                    <td>{a.actual_hours ?? "—"}</td>
                    <td className={variance > 0 ? styles.over : styles.under}>
                      {variance > 0 ? `+${variance.toFixed(1)}h` : `${variance.toFixed(1)}h`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {Object.keys(byType).length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Agent Accuracy by Type</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Avg Estimated</th>
                <th>Avg Actual</th>
                <th>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byType).map(([type, { estimated, actual }]) => {
                const avgEst = avg(estimated);
                const avgAct = avg(actual);
                const acc = avgEst > 0 ? Math.round((1 - Math.abs(avgAct - avgEst) / avgEst) * 100) : null;
                return (
                  <tr key={type}>
                    <td className={styles.typeCell}>{type}</td>
                    <td>{avgEst.toFixed(1)}h</td>
                    <td>{avgAct.toFixed(1)}h</td>
                    <td className={acc >= 80 ? styles.under : styles.over}>
                      {acc != null ? `${acc}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + (v ?? 0), 0) / arr.length;
}
