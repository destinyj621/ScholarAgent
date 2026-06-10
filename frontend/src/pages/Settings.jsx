import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import styles from "./Settings.module.css";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };

const DEFAULT_SETTINGS = {
  daily_hour_cap: 3,
  buffer_days: 1,
  semester_start: "",
  semester_end: "",
  digest_enabled: false,
  digest_frequency: "daily",
  digest_day: "monday",
  digest_time: "08:00",
  google_sync_enabled: false,
  availability: {
    monday:    { available: true,  hours: 3 },
    tuesday:   { available: true,  hours: 3 },
    wednesday: { available: true,  hours: 3 },
    thursday:  { available: true,  hours: 3 },
    friday:    { available: true,  hours: 3 },
    saturday:  { available: false, hours: 0 },
    sunday:    { available: true,  hours: 2 },
  },
};

export default function Settings() {
  const { data: settingsData, loading: sLoading } = useApi("/settings");
  const { data: classesData, refetch: refetchClasses } = useApi("/classes");
  const { data: googleStatus } = useApi("/auth/google/status");

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // New class form
  const [newClass, setNewClass] = useState({ name: "", color: "#6366f1", is_high_priority: false });
  const [addingClass, setAddingClass] = useState(false);

  useEffect(() => {
    if (settingsData) {
      setSettings({ ...DEFAULT_SETTINGS, ...settingsData });
    }
  }, [settingsData]);

  async function saveSettings() {
    setSaving(true);
    setSaved(false);
    try {
      await api("/settings", { method: "PUT", body: settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  function set(key, value) {
    setSettings((p) => ({ ...p, [key]: value }));
  }

  function setAvailability(day, field, value) {
    setSettings((p) => ({
      ...p,
      availability: {
        ...p.availability,
        [day]: { ...p.availability[day], [field]: value },
      },
    }));
  }

  async function addClass() {
    setAddingClass(true);
    try {
      await api("/classes", { body: newClass });
      setNewClass({ name: "", color: "#6366f1", is_high_priority: false });
      refetchClasses();
    } finally {
      setAddingClass(false);
    }
  }

  async function deleteClass(id) {
    await api(`/classes/${id}`, { method: "DELETE" });
    refetchClasses();
  }

  async function togglePriority(cls) {
    await api(`/classes/${cls.id}`, {
      method: "PUT",
      body: { ...cls, is_high_priority: !cls.is_high_priority },
    });
    refetchClasses();
  }

  const classes = classesData?.classes ?? [];
  const isGoogleConnected = googleStatus?.connected ?? false;

  if (sLoading) return <p className={styles.msg}>Loading settings...</p>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <button className={`${styles.btn} ${styles.primary}`} onClick={saveSettings} disabled={saving}>
          {saved ? "Saved!" : saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      {/* Semester */}
      <Section title="Semester">
        <div className={styles.row}>
          <label className={styles.label}>
            Start date
            <input type="date" className={styles.input} value={settings.semester_start || ""} onChange={(e) => set("semester_start", e.target.value)} />
          </label>
          <label className={styles.label}>
            End date
            <input type="date" className={styles.input} value={settings.semester_end || ""} onChange={(e) => set("semester_end", e.target.value)} />
          </label>
          <label className={styles.label}>
            Buffer days before deadlines
            <input type="number" min="0" max="7" className={styles.input} value={settings.buffer_days} onChange={(e) => set("buffer_days", Number(e.target.value))} />
          </label>
        </div>
      </Section>

      {/* Availability */}
      <Section title="Weekly Availability">
        <p className={styles.hint}>Set which days you study and for how long.</p>
        <div className={styles.availGrid}>
          {DAYS.map((day) => {
            const cfg = settings.availability[day] || { available: false, hours: 0 };
            return (
              <div key={day} className={`${styles.dayCard} ${cfg.available ? styles.dayOn : styles.dayOff}`}>
                <label className={styles.dayToggle}>
                  <input
                    type="checkbox"
                    checked={cfg.available}
                    onChange={(e) => setAvailability(day, "available", e.target.checked)}
                  />
                  <span className={styles.dayName}>{DAY_LABELS[day]}</span>
                </label>
                {cfg.available && (
                  <div className={styles.dayHours}>
                    <input
                      type="number"
                      min="0.5"
                      max="12"
                      step="0.5"
                      value={cfg.hours}
                      onChange={(e) => setAvailability(day, "hours", Number(e.target.value))}
                      className={styles.hoursInput}
                    />
                    <span className={styles.hoursLabel}>h</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <label className={styles.label} style={{ marginTop: "1rem", maxWidth: 200 }}>
          Daily hour cap
          <input type="number" min="1" max="12" step="0.5" className={styles.input} value={settings.daily_hour_cap} onChange={(e) => set("daily_hour_cap", Number(e.target.value))} />
        </label>
      </Section>

      {/* Class Management */}
      <Section title="Class Management">
        <p className={styles.hint}>Add your courses, pick a color, and mark high-priority classes for extra scheduling buffer.</p>

        {classes.map((cls) => (
          <div key={cls.id} className={styles.classRow}>
            <span className={styles.classDot} style={{ background: cls.color }} />
            <span className={styles.className}>{cls.name}</span>
            <button
              className={`${styles.tagBtn} ${cls.is_high_priority ? styles.tagOn : ""}`}
              onClick={() => togglePriority(cls)}
            >
              {cls.is_high_priority ? "High Priority" : "Set High Priority"}
            </button>
            <button className={styles.deleteBtn} onClick={() => deleteClass(cls.id)}>Remove</button>
          </div>
        ))}

        <div className={styles.addClassRow}>
          <input
            type="text"
            placeholder="Course name"
            value={newClass.name}
            onChange={(e) => setNewClass((p) => ({ ...p, name: e.target.value }))}
            className={styles.input}
          />
          <input
            type="color"
            value={newClass.color}
            onChange={(e) => setNewClass((p) => ({ ...p, color: e.target.value }))}
            className={styles.colorPicker}
            title="Pick class color"
          />
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={newClass.is_high_priority}
              onChange={(e) => setNewClass((p) => ({ ...p, is_high_priority: e.target.checked }))}
            />
            High priority
          </label>
          <button className={`${styles.btn} ${styles.primary}`} onClick={addClass} disabled={addingClass || !newClass.name.trim()}>
            Add Class
          </button>
        </div>
      </Section>

      {/* Notifications */}
      <Section title="Email Digest">
        <label className={styles.toggleRow}>
          <input type="checkbox" checked={settings.digest_enabled} onChange={(e) => set("digest_enabled", e.target.checked)} />
          <span>Enable email digest</span>
        </label>
        {settings.digest_enabled && (
          <div className={styles.row}>
            <label className={styles.label}>
              Frequency
              <select className={styles.select} value={settings.digest_frequency} onChange={(e) => set("digest_frequency", e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            {settings.digest_frequency === "weekly" && (
              <label className={styles.label}>
                Day
                <select className={styles.select} value={settings.digest_day} onChange={(e) => set("digest_day", e.target.value)}>
                  {DAYS.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
                </select>
              </label>
            )}
            <label className={styles.label}>
              Time
              <input type="time" className={styles.input} value={settings.digest_time || "08:00"} onChange={(e) => set("digest_time", e.target.value)} />
            </label>
          </div>
        )}
      </Section>

      {/* Google Calendar */}
      <Section title="Google Calendar">
        <label className={styles.toggleRow}>
          <input type="checkbox" checked={settings.google_sync_enabled} onChange={(e) => set("google_sync_enabled", e.target.checked)} />
          <span>Sync study blocks to Google Calendar</span>
        </label>
        {settings.google_sync_enabled && (
          <div className={styles.googleRow}>
            {isGoogleConnected ? (
              <span className={styles.connected}>Google account connected</span>
            ) : (
              <a href={`${import.meta.env.VITE_API_URL || ""}/auth/google`} className={`${styles.btn} ${styles.primary}`}>
                Connect Google Account
              </a>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}
