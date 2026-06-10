# ScholarAgent

A full-stack agentic AI study scheduler that ingests your D2L calendar feed, reasons about assignment complexity through a three-agent pipeline, and builds a personalized study schedule displayed in a built-in calendar view with optional Google Calendar sync and a Gmail digest.

---

## How It Works

ScholarAgent connects to your D2L course calendar, runs it through three AI agents in sequence, and produces a balanced day-by-day study plan tailored to your availability and workload limits. As you log progress throughout the semester, the agent recalibrates estimates and rebuilds the schedule automatically.

### The Three-Agent Pipeline

**FilterAgent** receives all parsed calendar events and classifies each one as a real academic deadline or noise. It keeps assignments, exams, quizzes, discussions, and project milestones. It discards availability windows, class sessions, and open office hours. Output is a clean list of deadlines grouped by course.

**EstimatorAgent** receives each filtered deadline and estimates how long it will take based on the assignment type and description. It reads the event description first, and if that's too vague, it prompts you to upload the assignment PDF or paste the instructions. Default estimates by type:

| Assignment Type | Default |
|---|---|
| Proctored exam | 1-2 hour study session the night before |
| Open-note exam | No prep, just time to take it |
| Closed-note quiz | 30 minutes day of |
| Open-note quiz | Nothing scheduled |
| Discussion post | 30-45 minutes |
| Programming assignment | 3-5 hours, estimated from description |
| Research paper | 6-10 hours, estimated from description |
| Team project | Interactive mode (see below) |

For team projects, the agent collects your meeting date, what you need done before that meeting, and how work is split across the team. It treats the meeting as a soft deadline and the submission date as the hard deadline.

**SchedulerAgent** takes all estimated assignments and builds a day-by-day schedule working backwards from each deadline. It respects prerequisites, enforces daily hour caps, and applies load balancing rules so you never end up with two heavy assignments on the same day. It flags anything at risk due to a tight timeline and surfaces explicit warnings.

---

## Features

**Adaptive Recalibration**
Progress is logged as hours worked and percent complete. When those two numbers imply a different total than the original estimate, the agent recalculates and rebuilds the remaining schedule. Over time it tracks actual vs. estimated hours per assignment type per class and adjusts future defaults accordingly.

**Daily Check-In**
Each day the app surfaces what was scheduled for yesterday. You mark each item done, partially done, or skipped. Anything incomplete triggers a full schedule rebuild from today forward. If a deadline is now at risk, the app tells you exactly what is at risk, how many hours remain, and what it would take to finish on time.

**Class Management**
Each class gets a color, a label, and an optional priority flag. High-priority classes get more scheduling buffer and are worked on earlier relative to their deadlines. Assignment type defaults can be overridden per class.

**Google Calendar Sync**
An optional toggle in Settings pushes all study blocks to your Google Calendar. Each time the schedule rebuilds, old ScholarAgent events are cleared and replaced.

**Gmail Digest**
Sends a scheduled email at your chosen day and time showing only days with study blocks. If anything is at risk, the digest opens with a warning section.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Calendar UI | FullCalendar.js |
| Backend | FastAPI |
| AI Agents | Anthropic Claude API |
| Database and Auth | Supabase |
| ICS Parsing | icalendar (Python) |
| PDF Parsing | PyMuPDF |
| Google Calendar | Google Calendar API |
| Email Digest | Gmail API |
| Frontend Hosting | Vercel |
| Backend Hosting | Railway |

---

## Pages

**Dashboard** — paste your D2L ICS URL or upload a file, review filtered deadlines by class, provide context for vague assignments, and launch the pipeline. Agent reasoning streams to the screen in real time as each stage runs.

**Calendar** — full FullCalendar.js view of your schedule in month, week, and day views. Color coded by class. Click any event to see assignment details, estimated time, prerequisites, and progress.

**Assignments** — all active assignments organized by class with status tracking, progress logging, prerequisite assignment, and notes.

**Progress** — semester-wide view of estimated vs. actual hours, at-risk assignments highlighted, and a breakdown of how accurate the agent's estimates have been per assignment type.

**Settings** — configure availability by day, daily hour cap, load balancing rules, assignment type defaults, class management, semester boundaries, notification preferences, and Google Calendar sync.

---

## Project Roadmap

### Phase 1 — Foundation
- [ ] Repo structure and environment setup
- [ ] Supabase schema and auth configuration
- [ ] FastAPI backend scaffolding
- [ ] React + Vite frontend scaffolding
- [ ] Supabase Auth login page and protected routes

### Phase 2 — Ingestion
- [ ] D2L ICS feed parser
- [ ] PDF and document parser

### Phase 3 — Agent Pipeline
- [ ] FilterAgent
- [ ] EstimatorAgent (core logic and team project mode)
- [ ] SchedulerAgent
- [ ] Pipeline orchestration
- [ ] Real-time agent reasoning streaming to frontend

### Phase 4 — Frontend Pages
- [ ] Dashboard
- [ ] Calendar page with FullCalendar.js
- [ ] Assignments page
- [ ] Progress page
- [ ] Settings page

### Phase 5 — Intelligence Layer
- [ ] Adaptive recalibration on progress log
- [ ] Daily check-in system with schedule rebuild
- [ ] Class management and per-class overrides
- [ ] Semester boundary enforcement

### Phase 6 — Output Integrations
- [ ] Google Calendar sync
- [ ] Gmail digest

### Phase 7 — Polish
- [ ] Mobile responsive design
- [ ] End-to-end testing
- [ ] Deployment to Railway and Vercel
