# Daily Work Update - Hierarchical Enterprise Task Management System

A robust, production-grade, full-stack task management and workforce monitoring application engineered for structured manufacturing and engineering workflows. Features a 7-tier organizational hierarchy, real-time progress tracking, AI-powered predictive analytics, military-grade audit & security center, dual-file atomic persistence, automated hourly backups, and comprehensive regulatory reporting.

**Developed by: Jahid Hasan (38250) RAC R&I**

---

## 📋 Table of Contents
1. [Core Architectural Highlights](#-core-architectural-highlights)
2. [Organizational Hierarchy & Role Matrix](#-organizational-hierarchy--role-matrix)
3. [Comprehensive Feature Guide](#-comprehensive-feature-guide)
   - [1. Authentication & Security Center](#1-authentication--security-center)
   - [2. Advanced Task Lifecycle & Execution](#2-advanced-task-lifecycle--execution)
   - [3. Team Work & Shifting Technicians Management](#3-team-work--shifting-technicians-management)
   - [4. Shift Scheduling & Live Attendance](#4-shift-scheduling--live-attendance)
   - [5. 100-Mark Performance Evaluation System](#5-100-mark-performance-evaluation-system)
   - [6. AI-Powered Insights (Google Gemini)](#6-ai-powered-insights-google-gemini)
   - [7. Advanced Reporting & Data Visibility Rules](#7-advanced-reporting--data-visibility-rules)
   - [8. Real-Time Analytics & Departmental Overviews](#8-real-time-analytics--departmental-overviews)
   - [9. Data Persistence, Backup & Disaster Recovery](#9-data-persistence-backup--disaster-recovery)
4. [Strict Operational Rules & Protocols](#-strict-operational-rules--protocols)
5. [API Endpoints Reference](#-api-endpoints-reference)
6. [Tech Stack](#-tech-stack)
7. [Installation & Deployment](#-installation--deployment)
8. [License & Attribution](#-license--attribution)

---

## ⚡ Core Architectural Highlights

- **Dual-File Atomic Persistence**: State is simultaneously written using unique process-isolated temporary files (`.tmp`) and atomically renamed to both `data.json` and `data/db.json` with synchronous fallback to `data.json.bak` and timestamp conflict resolution.
- **Strict Task Deletion Protocol**: Hard deletes backed by persistent `deletedTaskIds` tracking across memory and disk to permanently prevent resurrected or ghost tasks upon relogin.
- **Automated Hourly Rolling Backups**: Background cron-like scheduler creates full database snapshots every 60 minutes with rolling 72-version retention in `/backups` and immediate one-click restoration.
- **Enterprise Security Suite**: Real-time IP and device-fingerprint logging, active session termination, suspicious login threat detection, device blacklist locking, and immutable administrative audit trails.
- **Role-Grounded Data Privacy**: Dynamic report masking strictly isolates technician identity from external engineering reports while enforcing complete visibility on internal accountability sheets.
- **AI-Powered Diagnostics**: Server-side integration with Google Gemini 2.5/3.0 models for automated task urgency classification and real-time deadline delay probability predictions.

---

## 👥 Organizational Hierarchy & Role Matrix

The system enforces a 7-tier organizational structure with strictly scoped permissions and capabilities:

| Role | Scope & Permissions | Key Views & Actions |
| :--- | :--- | :--- |
| **SUPER_ADMIN** | Complete system authority across all modules, data stores, and staff. | Security Center, Staff Management, Permanent Task Deletion, Disaster Recovery & Restore, Audit Trail. |
| **HOD** *(Head of Department)* | Executive oversight over all department operations, personnel, and workflows. | Department Overview, Staff Directory, Full Approval Authority, Comprehensive Analytics, Executive Reports. |
| **IN_CHARGE** | Section-level supervision, resource balancing, and inter-officer coordination. | Section Overview, Team Requests Approval, Technician Workload Balancing, Operational Reports. |
| **MODEL_MANAGER** | Product model-focused production management and deliverable tracking. | Model-Wise Work Distribution, Model Progress Analytics, Task Monitoring, Model Reports. |
| **ENGINEER** | Technical governance, task evaluation, quality scoring, and technician assignment. | Technical Deadlines (`engineer_deadline`), Request Approvals, Quality Ratings (1-5), External Privacy Reports. |
| **OFFICER** | Day-to-day work initiation, team task creation, and technician supervision. | Single & Team Task Creation, Shifting Technician Requests, Daily Task Logs, Internal Accountability Reports. |
| **TECHNICIAN** | Field operations, maintenance execution, and real-time task progress logging. | Personal "My Work" Dashboard, Task Progress Sliders (0-100%), Shift Attendance, Status Indicator (`FREE`/`WORKING`). |

---

## 🚀 Comprehensive Feature Guide

### 1. Authentication & Security Center
- **JWT & Bcrypt Security**: Authenticates users using unique Employee IDs and encrypted passwords via signed JSON Web Tokens.
- **Activity Logging**: Tracks every authentication event with:
  - Timestamp, Employee ID, User Role, and Success/Failure status.
  - Client IP Address and Local IP detection.
  - Browser family, OS version, Device Type, and Canvas/Hardware Device Fingerprint Hash.
  - Geo-IP location approximation (Country, City, Region).
- **Active Session Management**: Super Admins can monitor all active user sessions in real-time and instantly revoke/terminate unauthorized sessions remotely.
- **Suspicious Login Threat Detection**: Flags logins from new geographic zones, unfamiliar devices, rapid sequential IP hops, or excessive brute-force attempts.
- **Hardware Device Locking**: Allows Super Admins to permanently blacklist and block specific devices or IP addresses from accessing the platform.
- **Immutable Admin Audit Trail**: Records administrative actions (user edits, deletions, permissions changes, password resets, database restorations) with timestamps and IP addresses.

### 2. Advanced Task Lifecycle & Execution
- **Task Creation**: Officers, Engineers, and Admins can create tasks with:
  - Unique Task ID, Title, Product Model, Detailed Specifications.
  - Urgency Level: `REGULAR`, `URGENT`, or `MOST_URGENT`.
  - Work Type: `SINGLE` (assigned to one technician) or `TEAM` (assigned to multiple technicians).
  - Target Deadlines: Operational `deadline` and Technical `engineer_deadline`.
  - Custom Start Time & Estimated Duration (e.g., `2h 30m` or minutes).
  - Performance Points and Quality Metrics.
- **Live Countdown Timer & Dynamic Indicators**:
  - Tasks in `RUNNING` status show live animated countdown timers.
  - **Dynamic Color Shifts**:
    - 🟢 Green: Safe progress (< 60% elapsed).
    - 🟡 Amber: Caution window (60% - 85% elapsed).
    - 🔴 Red: Critical threshold (> 85% elapsed).
    - 🚨 Red Alert Pulse: Overtime counter showing exact elapsed hours, minutes, and seconds overdue (`Over: Xh Ym Zs`).
- **Status Lifecycle**:
  - `PENDING` ➔ Task created and assigned.
  - `RUNNING` ➔ Technician accepted work; live timers activate.
  - `HOLD` / `DELAYED` ➔ Temporarily suspended with logged reason.
  - `COMPLETED` ➔ Reached 100% progress; automatically records `actualCompletionTime`, `taskTakenTime`, and calculates overtime.
  - `REQUESTED` / `REJECTED` ➔ Cross-departmental approval workflow states.

### 3. Team Work & Shifting Technicians Management
- **Single vs Team Work Architecture**:
  - **Single Work**: Assigned to a single technician who controls progress from 0% to 100%.
  - **Team Work**: Multiple technicians assigned simultaneously (`assignedTechnicians`). Each team member updates their individual progress percentage and task status independently. The system computes a weighted `totalTeamProgress`.
- **Shifting Technicians Protocol**:
  - Supports rotating technicians (`20368`, `52903`, `50328`, `42692`, `43264`, `43249`, `60578`, `60914`, `62536`, `63513`, `64456`, `63124`) who operate under dual/multiple officer supervision (`supervisor_ids`: `41412`, `67123` - Yousuf and Shakib).
  - Officers can submit **Assignment Requests** (`/api/assignment-requests`) to temporarily borrow technicians from other sections.
  - Workflow: `PENDING` ➔ `RECOMMENDED` by Engineer ➔ `APPROVED` by In-Charge/Supervisor.

### 4. Shift Scheduling & Live Attendance
- **Shift Coverage**:
  - `SHIFT_6_2`: Morning Shift (06:00 AM – 02:00 PM).
  - `SHIFT_2_6`: Evening Shift (02:00 PM – 10:00 PM).
  - `SHIFT_A` & `SHIFT_B`: Rotational departmental rosters.
  - `PRESENT`, `ABSENT`, `LEAVE`, `SHORT_LEAVE`.
- **Automated Technician Availability Engine**:
  - Background tick runs every 60 seconds to synchronize technician availability.
  - If marked `PRESENT` with zero active tasks ➔ Status displays as 🟢 **FREE**.
  - If marked `PRESENT` with active tasks in progress ➔ Status switches to 🔵 **WORKING**.
  - If marked `LEAVE` or `ABSENT` ➔ Status displays as ⚪ **ON_LEAVE** / **SHIFT_OFF**.

### 5. 100-Mark Performance Evaluation System
A strict, objective performance appraisal engine evaluates staff out of 100 total points:

$$\text{Final Score (100)} = \text{Task Score (60)} + \text{Attendance Score (10)} + \text{Efficiency Score (30)}$$

1. **Task Performance (Max 60 Marks)**:
   - Evaluated based on cumulative verified completed task points.
   - For Technicians: Number of completed tasks multiplied by priority weight factors.
   - For Officers: Cumulative verified points from tasks initiated and approved.
2. **Attendance Reliability (Max 10 Marks)**:
   - Calculated as: $(\text{Present Days} / \text{Total Working Days}) \times 10$.
3. **Operational Efficiency (Max 30 Marks)**:
   - Evaluates on-time delivery against assigned deadlines:
   - Calculated as: $(\text{Tasks Completed On Time} / \text{Total Completed Tasks}) \times 30$.
- **Manual Point Adjustments**: Supervisors can record audited bonus/penalty point adjustments (`MANUAL_ADJUSTMENT`), which are strictly preserved during system-wide recalculations.

### 6. AI-Powered Insights (Google Gemini)
- **Automated Urgency Classification**: Evaluates task descriptions and technical specs to recommend whether a task should be tagged `REGULAR`, `URGENT`, or `MOST_URGENT` with contextual reasoning.
- **Delay Risk Prediction**: Analyzes current technician velocity, task complexity, remaining time, and historical deadlines to output a probability score ($0.0 - 1.0$) of whether a task will breach its deadline.

### 7. Advanced Reporting & Data Visibility Rules
- **Report Types**: `DAILY`, `WEEKLY`, `MONTHLY`, and `CUSTOM` (with exact date-time range pickers).
- **Strict Role-Based Privacy Rules**:
  - **Engineer Reports (External Privacy Rule)**: Technician identities are **strictly hidden** to preserve external client privacy. Displays Task ID, Title, Model, Officer/Concern, Status, Deadline, Completed At, Time Taken, and Audit History.
  - **Officer Reports (Internal Accountability Rule)**: Mandatorily includes **both Engineer and Technician names** to ensure complete accountability within internal factory teams.
  - **Admin / HOD Reports (Executive 360° Rule)**: Full visibility of Engineer, Officer/Concern, and Technician columns.
- **Document Exporting**:
  - **Landscape PDF**: High-resolution print-ready layout with header branding, tabular auto-pagination, and mandatory footer attribution.
  - **Excel Spreadsheet (.xlsx)**: Formatted workbook with complete metrics, timestamps, and metadata.
  - **Mandatory Footer**: Every exported document mandatorily bears:  
    *`Software development by Jahid Hasan (38250) RAC R&I`*

### 8. Real-Time Analytics & Departmental Overviews
- **Visual Analytics**: Interactive Recharts displaying:
  - Task distribution by urgency and status breakdown.
  - Workload balance per engineer and technician.
  - Monthly task completion velocity and performance trends.
- **Multi-Level Overview Screens**:
  - **Department Overview**: Executive bird's-eye view for HOD and Super Admin.
  - **Section Overview**: Operational breakdown across factory lines for In-Charge.
  - **Model-Wise Work**: RAC product model tracking for Model Managers.
  - **Technician Monitoring Board**: Real-time technician status with direct call action, assigned tasks, and time-on-task.

### 9. Data Persistence, Backup & Disaster Recovery
- **Sequential Save Queue**: Write operations are serialized via promise chaining to eliminate file locking collisions and race conditions.
- **Crash-Resistant Atomic Writes**: Changes are written to unique PID-timestamped temporary files and atomically renamed to `data.json` and `data/db.json`.
- **Tri-Tier Auto-Recovery**:
  1. Primary: Reads `data.json`.
  2. Database Mirror: Inspects `data/db.json`. If `db.json` has a newer timestamp (`lastSavedAt`), the system prioritizes `db.json`.
  3. Backup Fallback: Reads `data.json.bak`, followed by `/backups/latest-hourly-db.json`.
- **Rolling Automated Backups**:
  - Scheduled automatically every 60 minutes.
  - Retains the last 72 backup snapshots (3 full days of hourly state). Older snapshots are automatically pruned.
- **One-Click Disaster Restore**: Admins can upload any JSON backup file through the UI to restore system state with automated database schema verification.
- **Clean Task Utility**: Built-in `/api/system/clear-tasks` allows administrators to clear operational tasks while preserving all staff credentials, roles, and profiles.

---

## 🔒 Strict Operational Rules & Protocols

1. **Task Deletion Rule**: Only Super Admins may permanently delete tasks. Task IDs are immediately written to `deletedTaskIds` and synchronized across all disks, preventing deleted tasks from reappearing after logout/login.
2. **Technician Name Privacy Rule**: When an Engineer generates reports, technician names must be omitted from output data sheets to maintain external supplier confidentiality.
3. **Shift Handover Rule**: Shifting technicians must be acknowledged by their assigned shift supervisor before starting new tasks in a subsequent shift.
4. **Point Audit Integrity Rule**: Manual adjustments (`MANUAL_ADJUSTMENT`) in the point transactions registry must never be overwritten by automatic point recalculation scripts.
5. **Session Inactivity Rule**: Active sessions idle beyond configured limits are subject to automatic termination, requiring fresh JWT re-authentication.

---

## 🔌 API Endpoints Reference

### Authentication & Profiles
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/login` | Authenticate user, verify password, log device/IP metadata, return JWT. |
| `POST` | `/api/logout` | Terminate session, record logout timestamp and session duration. |
| `GET` | `/api/profile` | Retrieve authenticated user profile and permissions. |
| `POST` | `/api/change-password` | Update current user password with verification. |

### Task Management
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/tasks` | Fetch tasks filtered by role, month, year, or all. |
| `POST` | `/api/tasks` | Create a new task (Single or Team work). |
| `PUT` | `/api/tasks/:id` | Update task status, progress, deadline, or remarks. |
| `DELETE` | `/api/tasks/:id` | Delete task (requires authorization). |
| `DELETE` | `/api/admin/tasks/:id` | Strict Super Admin permanent task deletion with disk sync. |
| `POST` | `/api/tasks/:id/recommend` | Submit task recommendation / technical approval. |
| `POST` | `/api/tasks/:id/approve` | Final supervisor approval for task points and closure. |

### Staff & Attendance
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/staff` | List all employees, roles, statuses, and supervisors. |
| `POST` | `/api/staff` | Add new employee with role and supervisor mapping. |
| `PUT` | `/api/staff/:id` | Update employee profile or credentials. |
| `DELETE` | `/api/staff/:id` | Remove employee from system. |
| `GET` | `/api/attendance` | Fetch attendance records. |
| `POST` | `/api/attendance` | Record daily shift attendance for technician. |

### Performance, Requests & Notifications
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/points` | Retrieve point transactions and performance ratings. |
| `POST` | `/api/points/adjust` | Record audited manual point adjustment. |
| `GET` | `/api/assignment-requests` | List inter-team technician assignment requests. |
| `POST` | `/api/assignment-requests` | Submit cross-team technician borrowing request. |
| `PUT` | `/api/assignment-requests/:id` | Approve or reject technician assignment request. |
| `GET` | `/api/notifications` | Fetch user notification stream. |
| `PUT` | `/api/notifications/:id/read` | Mark individual notification as read. |

### Security & System Administration (Super Admin)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/security/activity-logs` | Fetch real-time user login and activity audit logs. |
| `GET` | `/api/security/active-sessions` | Fetch active logged-in device sessions. |
| `DELETE` | `/api/security/sessions/:id` | Force terminate an active user session. |
| `POST` | `/api/security/lock-device` | Blacklist and lock a hardware device or IP. |
| `GET` | `/api/admin/audit-logs` | Fetch administrative action audit trail. |
| `GET` | `/api/system/backup` | Download complete instantaneous system JSON backup. |
| `POST` | `/api/system/restore` | Restore database state from uploaded JSON snapshot. |
| `POST` | `/api/system/clear-tasks` | Clear operational tasks while preserving users. |
| `POST` | `/api/system/process-employees`| Bulk import/sync employees from `employee data.xlsx`. |

---

## 🛠️ Tech Stack

- **Frontend**:
  - React 19, TypeScript
  - Tailwind CSS v4 (Modern CSS theme engine)
  - Motion / Framer Motion (Fluid layout animations)
  - Lucide React (Enterprise iconography)
  - Recharts (Interactive SVG analytics charts)
  - Sonner (Toast notifications)
- **Backend**:
  - Node.js & Express
  - TSX & ESBuild (TypeScript execution runtime)
  - JWT (`jsonwebtoken`) & Bcrypt (`bcryptjs`)
  - Multer (Multipart file upload handling)
- **Document Generation**:
  - `jspdf` & `jspdf-autotable` (Landscape tabular PDF synthesis)
  - `xlsx` (Excel spreadsheet workbook generation)
- **AI & Intelligence**:
  - `@google/genai` TypeScript SDK (Gemini 2.5 / 3.0 integration)

---

## 📦 Installation & Deployment

### 1. Prerequisites
- Node.js `>= 20.19.0`
- NPM or Bun package manager

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
PORT=3000
JWT_SECRET=your-enterprise-secret-key-38250
GEMINI_API_KEY=your-google-gemini-api-key
```

### 3. Setup & Execution
```bash
# Install dependencies
npm install

# Run full-stack development server (Client + API)
npm run dev

# Production build
npm run build

# Start production server
npm start
```

---

## 📝 License & Attribution

This system is engineered for internal organizational and industrial operations.

**Software development by Jahid Hasan (38250) RAC R&I**  
Copyright © 2026 Daily Work Update. All rights reserved.
