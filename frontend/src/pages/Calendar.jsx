import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useState } from "react";
import EventDetailModal from "../components/EventDetailModal";
import { useApi } from "../lib/useApi";
import styles from "./Calendar.module.css";

const FALLBACK_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

export default function Calendar() {
  const { data: scheduleData, refetch: refetchSchedule } = useApi("/schedule");
  const { data: assignmentsData, refetch: refetchAssignments } = useApi("/assignments");
  const { data: classesData } = useApi("/classes");

  const [selected, setSelected] = useState(null);

  const blocks = scheduleData?.blocks ?? [];
  const assignments = assignmentsData?.assignments ?? [];
  const classes = classesData?.classes ?? [];

  const classColorMap = {};
  classes.forEach((c, i) => {
    classColorMap[c.name] = c.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  });

  function getColor(courseName) {
    if (classColorMap[courseName]) return classColorMap[courseName];
    const idx = Object.keys(classColorMap).length % FALLBACK_COLORS.length;
    return FALLBACK_COLORS[idx];
  }

  const calendarEvents = buildEvents(blocks, assignments, getColor);

  function handleEventClick({ event }) {
    setSelected(event);
  }

  function handleUpdated() {
    refetchSchedule();
    refetchAssignments();
  }

  const legend = [...new Set([...blocks.map((b) => b.course), ...assignments.map((a) => a.course)])].filter(Boolean);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Calendar</h1>

      {legend.length > 0 && (
        <div className={styles.legend}>
          {legend.map((course) => (
            <span key={course} className={styles.legendItem}>
              <span className={styles.dot} style={{ background: getColor(course) }} />
              {course}
            </span>
          ))}
        </div>
      )}

      <div className={styles.calendarWrap}>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          events={calendarEvents}
          eventClick={handleEventClick}
          height="auto"
          slotMinTime="08:00:00"
          slotMaxTime="23:00:00"
          nowIndicator
          eventDisplay="block"
        />
      </div>

      {selected && (
        <EventDetailModal
          event={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

function buildEvents(blocks, assignments, getColor) {
  const events = [];

  // Group blocks by date so we can stack same-day blocks
  const byDate = {};
  for (const block of blocks) {
    (byDate[block.date] = byDate[block.date] || []).push(block);
  }

  const assignmentMap = Object.fromEntries(assignments.map((a) => [a.id, a]));

  for (const [date, dayBlocks] of Object.entries(byDate)) {
    let cursorMin = 17 * 60; // start at 5 PM
    for (const block of dayBlocks) {
      const assignment = assignmentMap[block.assignment_id] ?? null;
      const color = getColor(block.course);
      const start = minutesToTime(date, cursorMin);
      const end = minutesToTime(date, cursorMin + block.duration_minutes);

      events.push({
        id: `block-${block.id}`,
        title: block.task || assignment?.title || "Study",
        start,
        end,
        backgroundColor: color,
        borderColor: color,
        textColor: "#fff",
        extendedProps: { type: "study_block", block, assignment },
      });

      cursorMin += block.duration_minutes + 5;
    }
  }

  // Due date markers
  for (const a of assignments) {
    if (a.status === "complete") continue;
    events.push({
      id: `due-${a.id}`,
      title: `Due: ${a.title}`,
      start: a.due_date.split("T")[0],
      allDay: true,
      backgroundColor: "transparent",
      borderColor: "#dc2626",
      textColor: "#dc2626",
      extendedProps: { type: "due_date", assignment: a },
    });
  }

  return events;
}

function minutesToTime(dateStr, totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}
