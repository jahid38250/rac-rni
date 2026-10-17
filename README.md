# Daily Work Update - Hierarchical Enterprise Task Management System

A robust, production-grade, full-stack task management, workforce monitoring, and operational governance platform engineered specifically for structured manufacturing, research, and engineering workflows (RAC R&I).

**Architected & Developed by: Jahid Hasan (38250) RAC R&I**  
**Version:** 3.4.0 (Production Release)  
**Permanent Data Persistence & Disaster Recovery Guaranteed**

---

## 📋 Table of Contents
1. [System Architecture & Data Permanence Guarantee](#1-system-architecture--data-permanence-guarantee)
2. [7-Tier Organizational Hierarchy & Access Matrix](#2-7-tier-organizational-hierarchy--access-matrix)
3. [Step-by-Step User Role Operational Guides](#3-step-by-step-user-role-operational-guides)
   - [Super Admin](#role-1-super-admin)
   - [Head of Department (HOD) & Executive Command](#role-2-head-of-department-hod--executive-command)
   - [In-Charge / Section Supervisor](#role-3-in-charge--section-supervisor)
   - [Model Manager](#role-4-model-manager)
   - [Engineer (Technical Governance)](#role-5-engineer-technical-governance)
   - [Officer (Operational Supervisor)](#role-6-officer-operational-supervisor)
   - [Technician (Field Specialist)](#role-7-technician-field-specialist)
4. [Step-by-Step Core Feature Guides](#4-step-by-step-core-feature-guides)
   - [Feature 1: Task Creation, Execution & Completion Lifecycle](#feature-1-task-creation-execution--completion-lifecycle)
   - [Feature 2: 6-State Shift Attendance & Live Workforce Monitoring](#feature-2-6-state-shift-attendance--live-workforce-monitoring)
   - [Feature 3: Single vs. Team Work & Shifting Technician Borrowing](#feature-3-single-vs-team-work--shifting-technician-borrowing)
   - [Feature 4: 100-Mark Performance Evaluation System](#feature-4-100-mark-performance-evaluation-system)
   - [Feature 5: Dynamic Role-Grounded Reporting & Document Export](#feature-5-dynamic-role-grounded-reporting--document-export)
   - [Feature 6: AI-Powered Diagnostics & Delay Probability (Gemini)](#feature-6-ai-powered-diagnostics--delay-probability-gemini)
   - [Feature 7: Enterprise Security Suite & Device Hardware Fingerprinting](#feature-7-enterprise-security-suite--device-hardware-fingerprinting)
   - [Feature 8: 5-Minute Automated Backups & One-Click Disaster Recovery](#feature-8-5-minute-automated-backups--one-click-disaster-recovery)
5. [Operational Rules & Security Safeguards](#5-operational-rules--security-safeguards)
6. [API Endpoints Reference](#6-api-endpoints-reference)
7. [Installation, Environment & Production Deployment](#7-installation-environment--production-deployment)
8. [License & Mandatory Attribution](#8-license--mandatory-attribution)

---

## 1. System Architecture & Data Permanence Guarantee

### 🛡️ Why Data Is Preserved Permanently Across Restarts, Redeployments & Hosting Sleep
The platform implements an industrial **tri-tier atomic persistence and self-healing storage engine** designed to prevent data loss even in cloud hosting environments subject to process cycling, container teardown, or ephemeral resets:

1. **Dual-Disk Process-Isolated Atomic Writes**:
   - Whenever any business record (user, task, attendance, points, logs) is created or modified, the backend serializes the write through a strict sequential Promise queue (`saveDataQueue`).
   - The payload is written to unique PID and timestamped temporary files (`.tmp`) before being atomically renamed simultaneously to both `data.json` and `data/db.json`.
   - In the event of a disk failure or interruption, `data.json.bak` maintains the prior clean state.

2. **Permanent Staff Directory Protection (`data/permanent-staff.json`)**:
   - Employee credentials, roles, and profiles are backed up to a dedicated immutable staff registry `data/permanent-staff.json` and `backups/staff-backups/staff-backup-baseline-permanent.json`.
   - On server cold boot, if any disk synchronization discrepancy occurs, the startup sequence **auto-heals** the employee roster, ensuring valid staff records are never lost.
   - Deletions are strictly restricted: staff records can only be permanently removed when an authorized Super Admin executes an explicit deletion command.

3. **Persistent Task Tombstones (`deletedTaskIds`)**:
   - Hard-deleted tasks are registered in a persistent tombstone set (`deletedTaskIds`) that survives server restarts and backups.
   - Prevents stale caches, offline devices, or background restore tasks from accidentally resurrecting deleted tasks.

4. **Automated 5-Minute Server-Side Snapshots**:
   - An autonomous server timer triggers a full, uncorrupted snapshot of all database tables every **5 minutes** into `backups/`.
   - Preserves up to 5,000 rolling verified snapshots with zero auto-wipe.
   - Operates independent of open browser tabs or active user sessions.

---

## 2. 7-Tier Organizational Hierarchy & Access Matrix

| Role | Scope & Permissions | Key Interfaces & Capabilities |
| :--- | :--- | :--- |
| **SUPER_ADMIN** | Total administrative sovereignty across entire application, data stores, sessions, and devices. | Security Center, Device Lockout, Active Sessions Killer, Permanent Staff Deletion, Full DB Restore, System Backup, Task Clear Tool. |
| **HOD** *(Head of Dept)* | Department-wide leadership, executive workforce coordination, final approval authority. | Executive Command Center (ECC), Department Overview, 6-State Staff Attendance Marker, Executive 360° Reports. |
| **IN_CHARGE** | Factory section operational leadership, line balance, and inter-officer coordination. | Section Overview, Technician Rebalancing, Shifting Request Approval, Line Workload Tracking. |
| **MODEL_MANAGER**| RAC product model-focused execution (e.g., 18K, 24K, 36K, Inverter series). | Model-Wise Work Distribution, Model Delivery Schedules, Model Quality Tracking. |
| **ENGINEER** | Technical governance, quality evaluation, technical deadline control. | Technical Deadline Assignment (`engineer_deadline`), Quality Ratings (1-5), Work Recommendations, External Privacy Reports. |
| **OFFICER** | Daily work initiation, field supervision, technician shift management. | Task Creation (Single/Team), Rotating Technician Borrow Requests, Daily Progress Logs, Internal Accountability Reports. |
| **TECHNICIAN** | Direct maintenance, repair, and assembly execution. | "My Work" Mobile/Desktop Card, 0-100% Progress Sliders, Shift Check-In, Status Indicator (`FREE`/`WORKING`/`ON_LEAVE`). |

---

## 3. Step-by-Step User Role Operational Guides

### Role 1: Super Admin
1. **Managing System Security & Logins**:
   - Navigate to the **Security Center** from the top navigation bar.
   - Review live **User Activity Logs** showing local & external IP, hardware fingerprint, browser family, and timestamp.
   - View **Active Sessions**: Terminate suspicious or rogue sessions with one click (`Force Logout`).
   - If a device exhibits malicious or unauthorized activity, click **Lock Device** to permanently blacklist the hardware hash and IP.
2. **Managing Staff Members**:
   - Access **Staff Management** to view all registered personnel.
   - To add an employee, click **Add Staff**, enter Name, Employee ID, Designation, Role, Mobile, and Supervisor mapping.
   - To process resigned personnel, select the employee and click **Delete User** (permanently synchronizes deletion across `data.json`, `data/db.json`, and `permanent-staff.json`).
3. **Triggering Manual Backups & Disaster Restores**:
   - Go to **System Backups** tab.
   - Click **Create Instant Backup Now** to capture an immediate snapshot.
   - To restore the entire system from a previous snapshot, select a backup file from the catalog or upload a JSON backup file and confirm the restore passphrase.

---

### Role 2: Head of Department (HOD) & Executive Command
1. **Reviewing Department Status**:
   - Access the **Executive Command Center (ECC)** or **Department Overview**.
   - Monitor real-time KPIs: Total Active Tasks, Completed Tasks Today, On-Time Delivery Ratio, and Overdue Alerts.
2. **Marking Daily Staff Attendance**:
   - In the **Staff Directory & Attendance Table**, view each employee's current status badge.
   - Click the interactive quick-action buttons for any employee to update their status for today:
     - 🟢 **Present**
     - 🟡 **Short-Leave** (temporary exit during shift)
     - 🔴 **Leave** (authorized leave)
     - ⚪ **Absent** (unauthorized absence)
     - 🕒 **Shift A** (06:00 AM – 02:00 PM)
     - 🌙 **Shift B** (02:00 PM – 10:00 PM)
   - Status immediately propagates to task dispatch boards and technician availability calculations.
3. **Approving Completed Deliverables**:
   - Review tasks in `PENDING_APPROVAL` status submitted by Officers and recommended by Engineers.
   - Verify completion remarks and photos. Click **Approve Task** to finalize points and commit to history.

---

### Role 3: In-Charge / Section Supervisor
1. **Section Workload Balancing**:
   - Open **Section Overview** to inspect pending tasks categorized by production line and priority.
   - Identify overloaded technicians and rebalance unstarted tasks by reassigning them to available personnel.
2. **Processing Shifting Technician Borrow Requests**:
   - When an Officer submits an **Assignment Request** to borrow a technician from your section, review the request in **Requests Panel**.
   - Click **Approve** or **Reject** with comments. Approved requests grant the borrowing officer task assignment rights for the specified duration.

---

### Role 4: Model Manager
1. **Tracking RAC Product Model Progress**:
   - Navigate to **Model-Wise Work**.
   - Filter by specific models (e.g., `18K`, `24K`, `36K`, `Inverter Split`, `Cassette Type`).
   - Monitor aggregate percentage progress, bottlenecks, and open defect resolution tasks.

---

### Role 5: Engineer (Technical Governance)
1. **Setting Technical Deadlines & Specifications**:
   - When reviewing new tasks created by Officers, verify technical parameters.
   - Set the strict `engineer_deadline` alongside the operational deadline.
2. **Recommending Completed Tasks**:
   - Once a technician marks a task at 100%, review the deliverable.
   - Assign a **Quality Rating (1 to 5 Stars)** and click **Recommend for Final Approval**.
3. **Generating External Privacy Reports**:
   - Go to **Reports**, select `Monthly` or `Custom Range`.
   - Export report: technician identities are **strictly masked** in accordance with external supplier confidentiality standards, leaving clean technical metrics and model progress.

---

### Role 6: Officer (Operational Supervisor)
1. **Creating Tasks (Single & Team)**:
   - Click **+ New Task**.
   - Select **Single Work** (one technician) or **Team Work** (multiple technicians).
   - Enter Title, Product Model, Details, Priority (`REGULAR`, `URGENT`, `MOST_URGENT`), and Target Deadlines.
   - Set Custom Start Time and Estimated Duration (e.g., `1h 30m`).
   - Assign to active technicians (system highlights available technicians in green).
2. **Submitting Assignment Requests for Rotating Technicians**:
   - If an urgent task requires a technician currently under another supervisor's roster, navigate to **Assignment Requests**.
   - Select Technician, Target Officer, Reason, and Shift Duration, then submit for In-Charge approval.
3. **Generating Internal Accountability Reports**:
   - Export Daily/Weekly reports: **both Engineer and Technician names are fully visible** to maintain internal factory accountability.

---

### Role 7: Technician (Field Specialist)
1. **Managing Daily Work on "My Work"**:
   - Log in using your Employee ID and password.
   - The top banner shows your real-time status: 🟢 **FREE** (ready for tasks), 🔵 **WORKING** (active task running), or ⚪ **ON_LEAVE**.
2. **Executing a Task**:
   - When assigned a task, click **Start Task** (starts the live countdown timer).
   - If blocked by materials or parts, click **Hold** and provide a reason.
   - As progress is made, adjust the **Progress Slider** (0% ➔ 25% ➔ 50% ➔ 75% ➔ 100%).
   - At 100%, enter completion remarks and click **Submit for Completion**. The server calculates exact `taskTakenTime` and overtime.

---

## 4. Step-by-Step Core Feature Guides

### Feature 1: Task Creation, Execution & Completion Lifecycle
```
[OFFICER CREATES TASK] ➔ Urgency, Model, Start Time, Duration, Single/Team
          │
          ▼
[TECHNICIAN ACCEPTS] ➔ Clicks "Start" ➔ Status = RUNNING (Live Countdown Active)
          │
          ├── [HOLD] ➔ Pauses Timer, Records Reason & Timestamp
          │
          ▼
[PROGRESS 100%] ➔ Technician submits remarks & completion photos
          │
          ▼
[ENGINEER RECOMMENDS] ➔ Assigns 1-5 Star Quality Score & confirms technical specs
          │
          ▼
[HOD / ADMIN APPROVES] ➔ Final Point Allocation & Permanent History Archival
```

- **Live Countdown & Dynamic Visual Alerts**:
  - Tasks in `RUNNING` status show real-time animated second-by-second countdowns.
  - 🟢 **Green Badge**: Normal progress (< 60% of estimated time elapsed).
  - 🟡 **Amber Badge**: Approaching deadline (60% to 85% elapsed).
  - 🔴 **Red Badge**: Imminent deadline (> 85% elapsed).
  - 🚨 **Red Pulsing Overtime Alert**: Once target deadline is breached, timer displays exact overtime accrued in format: `Over: Xh Ym Zs`.

---

### Feature 2: 6-State Shift Attendance & Live Workforce Monitoring
- **The Six Attendance States**:
  1. `PRESENT`: Available for assignment; status displays as 🟢 **FREE** (if no tasks) or 🔵 **WORKING** (if assigned active tasks).
  2. `LEAVE`: Approved full-day leave; excluded from active monitoring rosters.
  3. `SHORT_LEAVE`: Temporarily away from line during duty hours.
  4. `ABSENT`: Unexcused absence; flagged for administrative review.
  5. `SHIFT_A`: Morning Shift duty (06:00 AM – 02:00 PM). Active during morning hours.
  6. `SHIFT_B`: Evening Shift duty (02:00 PM – 10:00 PM). Active during evening hours.
- **Dedicated Technician Monitoring Board**:
  - Divided into three distinct operational panes:
    - **Active Working Technicians**: Shows live task ID, elapsed work time, and progress.
    - **Available Free Technicians**: Personnel ready for instantaneous dispatch.
    - **On Leave / Off-Duty Technicians**: Clearly lists off-shift or absent staff so supervisors avoid assigning tasks to unavailable workers.

---

### Feature 3: Single vs. Team Work & Shifting Technician Borrowing
- **Single Work**:
  - Assigned to a single primary technician.
  - Linear 0% to 100% progress tracking.
- **Team Work**:
  - Supports multiple concurrent technicians (`assignedTechnicians`).
  - Each technician has an independent status and individual progress slider.
  - The system dynamically computes the **aggregate weighted team completion percentage**.
- **Cross-Section Technician Borrowing**:
  - Enables flexible resource reallocation across factory lines.
  - Full audit logging: tracks borrower ID, lender ID, technician ID, and approval timestamps.

---

### Feature 4: 100-Mark Performance Evaluation System
A mathematically rigorous appraisal engine scores staff performance out of 100 points:

$$\mathbf{Total\ Score\ (100)} = \mathbf{Task\ Performance\ (60)} + \mathbf{Attendance\ Reliability\ (10)} + \mathbf{Operational\ Efficiency\ (30)}$$

1. **Task Performance (Max 60 Marks)**:
   - For Technicians: Cumulative points earned from successfully completed tasks, adjusted by task urgency and complexity weights.
   - For Officers: Cumulative points earned from tasks initiated, supervised, and finalized.
2. **Attendance Reliability (Max 10 Marks)**:
   - Computed as: $(\text{Present Days} / \text{Working Days}) \times 10$.
   - Deductions apply for unauthorized absences.
3. **Operational Delivery Efficiency (Max 30 Marks)**:
   - Evaluates on-time task delivery rate:
   - Computed as: $(\text{On-Time Completed Tasks} / \text{Total Completed Tasks}) \times 30$.
4. **Audited Manual Adjustments (`MANUAL_ADJUSTMENT`)**:
   - Supervisors can award audited bonus points or apply penalties.
   - All manual entries are stored permanently in the ledger and are **strictly preserved** during automated recalculations.

---

### Feature 5: Dynamic Role-Grounded Reporting & Document Export
- **Strict Role-Based Privacy Masking**:
  - **Engineer Reports (External Supplier Privacy)**: Technician names are completely stripped to protect factory personnel information when sharing files with third parties.
  - **Officer Reports (Internal Shop-Floor Governance)**: Both Engineer and Technician names are displayed side-by-side for full accountability.
  - **Super Admin & HOD (Executive 360°)**: Complete metadata visibility across all fields.
- **Print-Ready Export Formats**:
  - **High-Resolution Landscape PDF**: Incorporates header branding, tabular pagination, summary statistics cards, and digital signature blocks.
  - **Excel Workbook (.xlsx)**: Raw structured data including timestamps, duration strings, and log history.
  - **Mandatory Attribution**: All generated exports contain the legal software footer:  
    *`Software development by Jahid Hasan (38250) RAC R&I`*

---

### Feature 6: AI-Powered Diagnostics & Delay Probability (Gemini)
- **Automatic Urgency Classification**:
  - Scans task descriptions, technical models, and requirements to provide contextual recommendations (`REGULAR`, `URGENT`, `MOST_URGENT`).
- **Real-Time Deadline Delay Risk Prediction**:
  - Uses Google Gemini models to analyze remaining hours, technician current workload, and historical task durations to compute a **Delay Probability Score (0.0 to 1.0)** with mitigation recommendations.

---

### Feature 7: Enterprise Security Suite & Device Hardware Fingerprinting
- **Hardware Device Fingerprinting**:
  - Combines browser characteristics, screen resolution, GPU canvas rendering, and network identifiers into a unique device hash.
- **Suspicious Login Threat Detection**:
  - Triggers alerts when an account logs in from multiple distinct hardware hashes or unexpected IP addresses.
- **Active Session Termination**:
  - Super Admins can view all connected devices and terminate any session instantly with remote JWT invalidation.
- **Device & IP Blacklist Locking**:
  - Blacklisted devices receive an immediate 403 Forbidden on all API calls.

---

### Feature 8: 5-Minute Automated Backups & One-Click Disaster Recovery
- **Autonomous Server-Side Backup Engine**:
  - Background scheduler creates full snapshots every **5 minutes** in `/backups`.
  - Backs up all tables: users, tasks, attendance records, point transactions, security logs, and configuration.
  - Each backup is verified for integrity and logged in persistent metadata.
- **Manual Backup On Demand**:
  - Super Admins can click **Backup Now** at any moment before major operational shifts.
- **One-Click Disaster Restoration**:
  - Upload any JSON backup snapshot through the Administrative UI to restore complete system state in under 3 seconds.

---

## 5. Operational Rules & Security Safeguards

1. **Permanent Task Deletion**: Only Super Admins may permanently delete tasks. Deleted task IDs are immediately added to `deletedTaskIds` and synchronized to disk, preventing resurrection upon subsequent logins.
2. **Permanent Staff Integrity**: Staff records cannot be wiped by server restarts or daily rollover scripts. Deletions must be explicitly performed via Super Admin staff management.
3. **Read-Only Backup Guarantee**: The automated backup engine executes in a strictly non-destructive read-only mode that never clears, resets, or overwrites active production tables.
4. **Historical Month Data Retention**: Tasks from previous months are permanently stored. Monthly filters isolate views for display without deleting historical records.
5. **No Telemetry / No AI Slop**: The application interface is purpose-built for clean, distraction-free manufacturing operations without unnecessary telemetry or third-party tracking.

---

## 6. API Endpoints Reference

### Authentication & Session Management
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/login` | Authenticate user, log device fingerprint & IP, return JWT. |
| `POST` | `/api/logout` | Terminate session and record session duration. |
| `GET` | `/api/profile` | Fetch authenticated user profile and permissions. |
| `POST` | `/api/change-password` | Update account password with verification. |

### Task Management
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/tasks` | Fetch tasks (filtered by role, month, year, or all). |
| `POST` | `/api/tasks` | Create new Single or Team task. |
| `PUT` | `/api/tasks/:id` | Update task progress (0-100%), status, or remarks. |
| `DELETE` | `/api/tasks/:id` | Soft delete task (authorized roles). |
| `DELETE` | `/api/admin/tasks/:id` | Permanent hard delete with persistent tombstone sync (Super Admin). |
| `POST` | `/api/tasks/:id/recommend` | Submit technical quality recommendation (Engineer). |
| `POST` | `/api/tasks/:id/approve` | Final task approval and point allocation (HOD/Admin). |

### Staff & Attendance Management
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/staff` | List all personnel, roles, and supervisor mappings. |
| `POST` | `/api/staff` | Register new employee. |
| `PUT` | `/api/staff/:id` | Update employee profile or credentials. |
| `DELETE` | `/api/staff/:id` | Permanently remove employee from all storage files. |
| `GET` | `/api/attendance` | Fetch daily shift attendance records. |
| `POST` | `/api/attendance` | Record daily shift attendance status for personnel. |

### Performance, Requests & Notifications
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/points` | Retrieve point transactions and leaderboard data. |
| `POST` | `/api/points/adjust` | Record audited manual point adjustment. |
| `GET` | `/api/assignment-requests` | List technician borrowing requests. |
| `POST` | `/api/assignment-requests` | Create new technician borrowing request. |
| `PUT` | `/api/assignment-requests/:id` | Approve or reject technician assignment request. |
| `GET` | `/api/notifications` | Fetch user notification inbox. |
| `PUT` | `/api/notifications/:id/read` | Mark notification as read. |

### Security & System Administration
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/security/activity-logs` | Retrieve real-time user authentication and activity logs. |
| `GET` | `/api/security/active-sessions` | Inspect all active logged-in device sessions. |
| `DELETE` | `/api/security/sessions/:id` | Force terminate an active session. |
| `POST` | `/api/security/lock-device` | Blacklist and lock a hardware device fingerprint or IP. |
| `GET` | `/api/admin/audit-logs` | Fetch administrative governance audit trail. |
| `GET` | `/api/system/backups-catalog` | Retrieve list of verified persistent backups with metadata. |
| `POST` | `/api/system/backup-now` | Trigger instantaneous database snapshot. |
| `POST` | `/api/system/backup-settings` | Configure auto-backup interval (5m default) and retention. |
| `GET` | `/api/system/backup` | Download complete instantaneous JSON backup. |
| `POST` | `/api/system/restore` | Restore system state from uploaded JSON snapshot. |
| `POST` | `/api/system/clear-tasks` | Clear operational tasks while preserving all staff credentials. |

---

## 7. Installation, Environment & Production Deployment

### Prerequisites
- Node.js `>= 20.19.0`
- NPM or Bun package manager

### Environment Configuration
Configure your `.env` file in the project root:
```env
PORT=3000
JWT_SECRET=your-enterprise-production-jwt-secret-38250
GEMINI_API_KEY=your-gemini-api-key-here
```

### Build & Run
```bash
# 1. Install dependencies
npm install

# 2. Run full-stack development server (Express + Vite)
npm run dev

# 3. Compile production build
npm run build

# 4. Start production server
npm start
```

---

## 8. License & Mandatory Attribution

This software is engineered for specialized manufacturing, research, and technical workforce governance.

**Software development by Jahid Hasan (38250) RAC R&I**  
Copyright © 2026 Daily Work Update. All rights reserved.
