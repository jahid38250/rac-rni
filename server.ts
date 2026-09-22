import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import fs from "fs/promises";
import fsSync from "fs";
import XLSX from "xlsx";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import type { Role, User, Task, Attendance, TaskLog, TaskStatus, ActivityLog, AdminAuditLog, UserSession, FailedLoginAttempt, LockedDevice } from './types.js';

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!genAIClient) {
    genAIClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return genAIClient;
}

const upload = multer({ dest: 'uploads/' });

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "enterprise-secret-key";

async function startServer() {
  console.log("Starting server initialization...");
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // --- Data Variables (Initialized early to avoid ReferenceError) ---
  let users: User[] = [];
  let tasks: Task[] = [];
  let attendanceRecords: Attendance[] = [];
  let notifications: any[] = [];
  let pointTransactions: any[] = [];
  let technicianPerformance: any[] = [];
  let assignmentRequests: any[] = [];
  let activityLogs: ActivityLog[] = [];
  let adminAuditLogs: AdminAuditLog[] = [];
  let userSessions: UserSession[] = [];
  let failedLoginAttempts: FailedLoginAttempt[] = [];
  let lockedDevices: LockedDevice[] = [];

  // --- Shifting Technician Logic ---
  const shiftingTechnicianIds = [
    '20368', '52903', '50328', '42692', '43264', '43249', 
    '60578', '60914', '62536', '63513', '64456', '63124'
  ];
  const shiftingOfficerIds = ['41412', '67123']; // Yousuf and Shakib

  function applyShiftingTechnicianLogic() {
    users.forEach(u => {
      if (u.role === 'TECHNICIAN' && shiftingTechnicianIds.includes(u.employeeId)) {
        u.supervisor_ids = shiftingOfficerIds;
      }
    });
  }

  // --- Request Logging ---
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.originalUrl.startsWith('/api')) {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
      }
    });
    next();
  });

  // --- Data Persistence Configuration ---
  const DATA_FILE = path.join(process.cwd(), "data.json");
  const DATA_DIR = path.join(process.cwd(), "data");
  const DB_FILE = path.join(DATA_DIR, "db.json");
  const BACKUPS_DIR = path.join(process.cwd(), "backups");
  const UPLOADS_DIR = path.join(process.cwd(), "uploads");

  // Auto-backup configuration state
  let autoBackupSettings = {
    enabled: true,
    intervalMinutes: 60,
    lastBackupTime: null as string | null,
    nextBackupTime: null as string | null,
    retentionCount: 72
  };

  // Ensure necessary directories exist synchronously or on boot
  try {
    if (!fsSync.existsSync(DATA_DIR)) fsSync.mkdirSync(DATA_DIR, { recursive: true });
    if (!fsSync.existsSync(BACKUPS_DIR)) fsSync.mkdirSync(BACKUPS_DIR, { recursive: true });
    if (!fsSync.existsSync(UPLOADS_DIR)) fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.error("Error creating system directories:", err);
  }

  async function loadData() {
    let loadedContent: any = null;
    let loadedFrom: string = '';

    // 1. Attempt to load from primary DATA_FILE (data.json)
    try {
      if (fsSync.existsSync(DATA_FILE)) {
        console.log(`Checking data from primary file: ${DATA_FILE}`);
        const content = await fs.readFile(DATA_FILE, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') {
          loadedContent = parsed;
          loadedFrom = DATA_FILE;
        }
      }
    } catch (err: any) {
      console.error(`Error reading ${DATA_FILE}:`, err.message);
    }

    // 2. Inspect DB_FILE (data/db.json). Compare timestamps to pick the freshest version
    try {
      if (fsSync.existsSync(DB_FILE)) {
        console.log(`Checking data from database file: ${DB_FILE}`);
        const dbContent = await fs.readFile(DB_FILE, "utf-8");
        const parsedDb = JSON.parse(dbContent);
        if (parsedDb && typeof parsedDb === 'object') {
          if (!loadedContent) {
            loadedContent = parsedDb;
            loadedFrom = DB_FILE;
          } else {
            const dataTime = loadedContent.lastSavedAt ? new Date(loadedContent.lastSavedAt).getTime() : 0;
            const dbTime = parsedDb.lastSavedAt ? new Date(parsedDb.lastSavedAt).getTime() : 0;
            if (dbTime > dataTime) {
              console.log(`[DATA RECOVERY] DB_FILE has fresher timestamp (${parsedDb.lastSavedAt}) than DATA_FILE (${loadedContent.lastSavedAt}). Using DB_FILE.`);
              loadedContent = parsedDb;
              loadedFrom = DB_FILE;
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`Error reading ${DB_FILE}:`, err.message);
    }

    // 3. ONLY if neither DATA_FILE nor DB_FILE could be loaded (missing or corrupted), inspect recent backups
    if (!loadedContent) {
      try {
        const latestBackup = path.join(BACKUPS_DIR, 'latest-hourly-db.json');
        if (fsSync.existsSync(latestBackup)) {
          const content = await fs.readFile(latestBackup, "utf-8");
          const parsed = JSON.parse(content);
          if (parsed && typeof parsed === 'object') {
            loadedContent = parsed;
            loadedFrom = latestBackup;
            console.log(`[AUTO-RECOVERY] Recovered database state from backup ${latestBackup}!`);
          }
        }
      } catch (backupErr: any) {
        console.warn("Could not check latest backup:", backupErr.message);
      }
    }

    if (loadedContent) {
      console.log(`Successfully loaded database state from ${loadedFrom} (Tasks: ${loadedContent.tasks?.length || 0}, Users: ${loadedContent.users?.length || 0})`);
      if (loadedContent.autoBackupSettings) {
        autoBackupSettings = { ...autoBackupSettings, ...loadedContent.autoBackupSettings };
      }
      return loadedContent;
    }

    console.warn("No existing data found in data.json, data/db.json, or backups. Initializing with empty state.");
    return { 
      users: [], 
      tasks: [], 
      attendanceRecords: [], 
      notifications: [], 
      pointTransactions: [], 
      technicianPerformance: [], 
      assignmentRequests: [],
      activityLogs: [],
      adminAuditLogs: [],
      userSessions: [],
      failedLoginAttempts: [],
      lockedDevices: []
    };
  }

  function recalculateAllPoints() {
    console.log("Recalculating all points and task counts...");
    
    // 1. Preserve manual adjustments
    const manualAdjustments = pointTransactions.filter((pt: any) => pt.taskId === 'MANUAL_ADJUSTMENT');
    
    // 2. Reset all users
    users.forEach((u: any) => {
      u.total_point = 0;
      u.completedTask = 0;
    });

    // 3. Clear and rebuild task-based transactions
    pointTransactions.length = 0;
    pointTransactions.push(...manualAdjustments);

    // Create a map for faster user lookups
    const userMap = new Map();
    users.forEach(u => {
      userMap.set(u.employeeId, u);
      userMap.set(u.id, u);
    });

    // 4. Process all tasks
    tasks.forEach((t: any) => {
      const status = (t.status || '').toUpperCase();
      const isCompleted = status === 'COMPLETED';
      
      // Points criteria: COMPLETED and (APPROVED or from privileged role)
      const creator = userMap.get(t.createdBy);
      const isApproved = t.requestStatus === 'APPROVED' || 
                        t.requestStatus === 'RECOMMENDED' ||
                        !t.requestStatus || 
                        ['ENGINEER', 'SUPER_ADMIN', 'HOD'].includes(creator?.role || '');

      if (isCompleted) {
        // Technician Task Count
        if (t.assignedTo) {
          const tech = userMap.get(t.assignedTo);
          if (tech && tech.role === 'TECHNICIAN') {
            tech.completedTask = (tech.completedTask || 0) + 1;
            if (isApproved) {
              tech.total_point = (tech.total_point || 0) + (Number(t.points) || 0);
            }
          }
        }

        if (t.assignedTechnicians && Array.isArray(t.assignedTechnicians)) {
          t.assignedTechnicians.forEach((at: any) => {
            const tech = userMap.get(at.employeeId);
            if (tech && tech.role === 'TECHNICIAN') {
              tech.completedTask = (tech.completedTask || 0) + 1;
              if (isApproved) {
                tech.total_point = (tech.total_point || 0) + (Number(t.points) || 0);
              }
            }
          });
        }

        // Officer Points
        if (isApproved) {
          let assignedOfficer = null;
          if (creator?.role === 'OFFICER') {
            assignedOfficer = creator;
          } else if (t.assignedBy) {
            const assigner = userMap.get(t.assignedBy);
            if (assigner?.role === 'OFFICER') {
              assignedOfficer = assigner;
            }
          }

          if (assignedOfficer) {
            const pointValue = Number(t.points) || 1;
            assignedOfficer.total_point = (assignedOfficer.total_point || 0) + pointValue;
            
            // Add to transactions for history
            pointTransactions.push({
              id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
              taskId: t.id,
              officerId: assignedOfficer.id,
              engineerId: t.approvedBy || (creator?.role !== 'OFFICER' ? creator?.employeeId : ''),
              pointValue: pointValue,
              taskPriority: t.urgency,
              completedAt: t.completedAt
            });
          }
        }
      }
    });

    // 5. Apply manual adjustments to user totals
    manualAdjustments.forEach((pt: any) => {
      const user = userMap.get(pt.officerId);
      if (user) {
        user.total_point = (user.total_point || 0) + (Number(pt.pointValue) || 0);
      }
    });

    console.log("Recalculation complete.");
  }

  let isSaving = false;
  let savePending = false;

  async function saveData(_allowEmpty?: boolean) {
    if (isSaving) {
      savePending = true;
      return;
    }
    isSaving = true;
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.mkdir(BACKUPS_DIR, { recursive: true });

      const dataToSave = {
        users,
        tasks,
        attendanceRecords,
        notifications,
        pointTransactions,
        technicianPerformance,
        assignmentRequests,
        activityLogs,
        adminAuditLogs,
        userSessions,
        failedLoginAttempts,
        lockedDevices,
        autoBackupSettings,
        lastSavedAt: new Date().toISOString()
      };

      const jsonStr = JSON.stringify(dataToSave, null, 2);

      // 1. Atomic write to DATA_FILE (data.json)
      const tmpDataFile = DATA_FILE + ".tmp";
      await fs.writeFile(tmpDataFile, jsonStr, "utf-8");
      await fs.rename(tmpDataFile, DATA_FILE);

      // 2. Atomic write to DB_FILE (data/db.json)
      const tmpDbFile = DB_FILE + ".tmp";
      await fs.writeFile(tmpDbFile, jsonStr, "utf-8");
      await fs.rename(tmpDbFile, DB_FILE);

    } catch (err) {
      console.error("Error saving data:", err);
    } finally {
      isSaving = false;
      if (savePending) {
        savePending = false;
        saveData().catch(err => console.error("Error in pending save:", err));
      }
    }
  }

  async function createHourlyBackup(isManual = false) {
    try {
      await fs.mkdir(BACKUPS_DIR, { recursive: true });
      await fs.mkdir(DATA_DIR, { recursive: true });

      const now = new Date();
      const timeStr = now.toISOString().replace(/[:.]/g, '-');
      const filename = `db-backup-${timeStr}.json`;
      const filepath = path.join(BACKUPS_DIR, filename);

      const backupPayload = {
        users,
        tasks,
        attendanceRecords,
        notifications,
        pointTransactions,
        technicianPerformance,
        assignmentRequests,
        activityLogs,
        adminAuditLogs,
        userSessions,
        failedLoginAttempts,
        lockedDevices,
        autoBackupSettings,
        backupMeta: {
          type: isManual ? 'MANUAL' : 'HOURLY_AUTO',
          timestamp: now.toISOString(),
          tasksCount: tasks.length,
          usersCount: users.length,
          source: 'AUTO_BACKUP_SERVICE'
        }
      };

      const jsonStr = JSON.stringify(backupPayload, null, 2);

      // 1. Write timestamped backup snapshot
      const tmpFile = filepath + '.tmp';
      await fs.writeFile(tmpFile, jsonStr, 'utf-8');
      await fs.rename(tmpFile, filepath);

      // 2. Update backups/latest-hourly-db.json
      const latestPath = path.join(BACKUPS_DIR, 'latest-hourly-db.json');
      const tmpLatest = latestPath + '.tmp';
      await fs.writeFile(tmpLatest, jsonStr, 'utf-8');
      await fs.rename(tmpLatest, latestPath);

      // 3. Keep data/db.json in sync as well
      const tmpDb = DB_FILE + '.tmp';
      await fs.writeFile(tmpDb, jsonStr, 'utf-8');
      await fs.rename(tmpDb, DB_FILE);

      autoBackupSettings.lastBackupTime = now.toISOString();
      autoBackupSettings.nextBackupTime = new Date(now.getTime() + (autoBackupSettings.intervalMinutes || 60) * 60 * 1000).toISOString();

      await pruneOldBackups();

      console.log(`[BACKUP SUCCESS] ${isManual ? 'Manual' : 'Hourly Auto'} Backup created: ${filename} (Tasks: ${tasks.length}, Users: ${users.length}, Size: ${Buffer.byteLength(jsonStr)} bytes)`);

      return {
        filename,
        timestamp: now.toISOString(),
        type: isManual ? 'MANUAL' : 'HOURLY_AUTO',
        size: Buffer.byteLength(jsonStr),
        tasksCount: tasks.length,
        usersCount: users.length
      };
    } catch (err) {
      console.error("[BACKUP ERROR] Failed to create backup:", err);
      throw err;
    }
  }

  async function pruneOldBackups() {
    try {
      const files = await fs.readdir(BACKUPS_DIR);
      const backupFiles = files.filter(f => f.startsWith('db-backup-') && f.endsWith('.json'));
      if (backupFiles.length <= autoBackupSettings.retentionCount) return;

      // Sort descending (newest first)
      backupFiles.sort().reverse();
      const filesToDelete = backupFiles.slice(autoBackupSettings.retentionCount);
      for (const file of filesToDelete) {
        try {
          await fs.unlink(path.join(BACKUPS_DIR, file));
        } catch (e) {}
      }
      console.log(`[BACKUP PRUNE] Removed ${filesToDelete.length} older backups. Kept ${autoBackupSettings.retentionCount}.`);
    } catch (err) {
      console.error("Error pruning old backups:", err);
    }
  }

  let autoBackupInterval: NodeJS.Timeout | null = null;
  function startAutoBackupSchedule() {
    if (autoBackupInterval) clearInterval(autoBackupInterval);

    // Initial snapshot 5s after startup to guarantee a starting point
    setTimeout(async () => {
      try {
        await createHourlyBackup(false);
      } catch (e) {
        console.error("Initial auto-backup snapshot failed:", e);
      }
    }, 5000);

    const intervalMs = Math.max(5, autoBackupSettings.intervalMinutes || 60) * 60 * 1000;
    autoBackupInterval = setInterval(async () => {
      if (!autoBackupSettings.enabled) return;
      try {
        console.log(`[AUTO-BACKUP] Triggering scheduled hourly backup...`);
        await createHourlyBackup(false);
      } catch (err) {
        console.error("[AUTO-BACKUP] Scheduled hourly backup error:", err);
      }
    }, intervalMs);
    console.log(`[AUTO-BACKUP] Hourly auto-backup scheduler initialized (Every ${autoBackupSettings.intervalMinutes}m / 1 hour).`);
  }

  function rebuildTechnicianStatuses() {
    const todayDate = new Date().toISOString().split('T')[0];
    users.forEach((u: any) => {
      if (u.role === 'TECHNICIAN') {
        const techAttendance = attendanceRecords.find((a: any) => a.technicianId === u.employeeId && a.date === todayDate);
        const hasActiveTasks = tasks.some((t: any) => 
          (t.status === 'RUNNING' || (t.status === 'PENDING' && t.requestStatus === 'RECOMMENDED')) && 
          (
            t.assignedTo === u.employeeId || 
            t.assignedTo === u.id || 
            (t.assignedTo && u.name && t.assignedTo.toLowerCase() === u.name.toLowerCase()) ||
            (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => at.employeeId === u.employeeId))
          )
        );

        // Preserve leave/off statuses if they exist
        if (techAttendance) {
          if (techAttendance.status === 'PRESENT') {
            u.status = hasActiveTasks ? 'WORKING' : 'FREE';
          } else if (techAttendance.status === 'LEAVE' || techAttendance.status === 'ABSENT') {
            u.status = 'ON_LEAVE';
          } else if (techAttendance.status === 'SHORT_LEAVE') {
            u.status = 'SHORT_LEAVE';
          } else if (techAttendance.status === 'SHIFT_6_2' || techAttendance.status === 'SHIFT_2_6') {
            const now = new Date();
            const currentHour = now.getHours();
            let isWorkingShift = false;
            if (techAttendance.status === 'SHIFT_6_2') isWorkingShift = currentHour >= 6 && currentHour < 14;
            else if (techAttendance.status === 'SHIFT_2_6') isWorkingShift = currentHour >= 14 && currentHour < 18;
            
            if (isWorkingShift) {
              u.status = hasActiveTasks ? 'WORKING' : 'FREE';
            } else {
              u.status = 'SHIFT_OFF';
            }
          }
        } else {
          // If no attendance record, base it solely on tasks
          u.status = hasActiveTasks ? 'WORKING' : 'FREE';
        }
      }
    });
  }

  const initialData = await loadData();
  console.log("Data loaded successfully.");
  if (!initialData.notifications) initialData.notifications = [];
  if (!initialData.pointTransactions) initialData.pointTransactions = [];
  if (!initialData.technicianPerformance) initialData.technicianPerformance = [];
  if (!initialData.assignmentRequests) initialData.assignmentRequests = [];
  if (!initialData.activityLogs) initialData.activityLogs = [];
  if (!initialData.adminAuditLogs) initialData.adminAuditLogs = [];
  if (!initialData.userSessions) initialData.userSessions = [];
  if (!initialData.failedLoginAttempts) initialData.failedLoginAttempts = [];
  if (!initialData.lockedDevices) initialData.lockedDevices = [];
  
  // Initialize users with defaults if empty or missing default admins
  const defaultUsers = [
    { employeeId: "ADMIN001", name: "Super Admin", password: "admin123", role: "SUPER_ADMIN" },
    { employeeId: "jhfboss", name: "JHF Boss", password: "jhfboss", role: "SUPER_ADMIN" },
    { employeeId: "jhfadmin@jhf.com", name: "JHF Admin", password: "3624", role: "SUPER_ADMIN" },
    { employeeId: "54589", name: "Md. Shofikul Islam", password: "3624", role: "IN_CHARGE", designation: "IN CHARGE", department: "Chemical & Polymer" },
    { employeeId: "58175", name: "Mohammad Alik Pramanik", password: "3624", role: "OFFICER", designation: "OFFICER" },
    { employeeId: "48566", name: "Mahmudul Hasan", password: "3624", role: "TECHNICIAN", designation: "TECHNICIAN" },
    { employeeId: "63195", name: "Bijoy Kumar Haolader", password: "3624", role: "TECHNICIAN", designation: "TECHNICIAN" }
  ];

  if (!initialData.users) initialData.users = [];
  
  users = initialData.users || [];
  tasks = initialData.tasks || [];
  attendanceRecords = initialData.attendanceRecords || initialData.assignments || [];
  notifications = initialData.notifications || [];
  pointTransactions = initialData.pointTransactions || [];
  technicianPerformance = initialData.technicianPerformance || [];
  assignmentRequests = initialData.assignmentRequests || [];
  activityLogs = initialData.activityLogs || [];
  adminAuditLogs = initialData.adminAuditLogs || [];
  userSessions = initialData.userSessions || [];
  failedLoginAttempts = initialData.failedLoginAttempts || [];
  lockedDevices = initialData.lockedDevices || [];

  applyShiftingTechnicianLogic();

  let updated = false;
  for (const user of defaultUsers) {
    const existingUser = users.find((u: any) => u.employeeId.toLowerCase() === user.employeeId.toLowerCase());
    if (!existingUser) {
      console.log(`Initializing default user: ${user.employeeId}`);
      const hashedPassword = await bcrypt.hash(user.password, 10);
      users.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        employeeId: user.employeeId,
        name: user.name,
        password: hashedPassword,
        role: user.role as Role,
        designation: (user as any).designation || "",
        department: (user as any).department || "",
        supervisorId: "",
        assignedEngineers: []
      });
      updated = true;
    } else if (existingUser.password) {
      // Force update password for default users if it doesn't match the default
      const isMatch = await bcrypt.compare(user.password, existingUser.password);
      if (!isMatch) {
        console.log(`Updating password for default user: ${user.employeeId}`);
        existingUser.password = await bcrypt.hash(user.password, 10);
        updated = true;
      }
    } else {
      // If user exists but has no password, set it
      console.log(`Setting missing password for default user: ${user.employeeId}`);
      existingUser.password = await bcrypt.hash(user.password, 10);
      updated = true;
    }
  }

  // Force rebuild technician statuses on startup to recover from any broken states
  rebuildTechnicianStatuses();

  // Initialize technician status if missing or needs update
  const todayDate = new Date().toISOString().split('T')[0];
  users.forEach((u: any) => {
    if (u.role === 'TECHNICIAN') {
      const techAttendance = attendanceRecords.find((a: any) => a.technicianId === u.employeeId && a.date === todayDate);
      const hasRunningTasks = tasks.some((t: any) => 
        t.status === 'RUNNING' && 
        (t.assignedTo === u.employeeId || t.assignedTo === u.name || t.assignedTo === u.id || (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => at.employeeId === u.employeeId)))
      );

      if (techAttendance) {
        if (techAttendance.status === 'PRESENT') {
          u.status = hasRunningTasks ? 'WORKING' : 'FREE';
        } else if (techAttendance.status === 'LEAVE' || techAttendance.status === 'ABSENT') {
          u.status = 'ON_LEAVE';
        } else if (techAttendance.status === 'SHORT_LEAVE') {
          u.status = 'SHORT_LEAVE';
        } else if (techAttendance.status === 'SHIFT_6_2' || techAttendance.status === 'SHIFT_2_6') {
          const now = new Date();
          const currentHour = now.getHours();
          let isWorkingShift = false;
          if (techAttendance.status === 'SHIFT_6_2') isWorkingShift = currentHour >= 6 && currentHour < 14;
          else if (techAttendance.status === 'SHIFT_2_6') isWorkingShift = currentHour >= 14 && currentHour < 18;
          
          if (isWorkingShift) {
            u.status = hasRunningTasks ? 'WORKING' : 'FREE';
          } else {
            u.status = 'SHIFT_OFF';
          }
        }
      } else {
        // Default to FREE if no attendance yet, but check for running tasks
        u.status = hasRunningTasks ? 'WORKING' : 'FREE';
      }
      updated = true;
    }
  });

  if (updated) {
    await saveData();
  }

  // --- Helper Functions ---
  function getClientInfo(req: Request) {
    const userAgent = req.headers?.['user-agent'] || 'Unknown';
    
    // Better IP detection: check x-forwarded-for, x-real-ip, and then remoteAddress
    let ip = '0.0.0.0';
    const forwardedFor = req.headers?.['x-forwarded-for'] as string;
    const realIp = req.headers?.['x-real-ip'] as string;
    
    if (forwardedFor) {
      ip = forwardedFor.split(',')[0].trim();
    } else if (realIp) {
      ip = realIp.trim();
    } else if (req.socket?.remoteAddress) {
      ip = req.socket.remoteAddress;
    }
    
    // Clean up IPv6 mapped IPv4 addresses
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    
    // Simple parsing for browser and OS
    let browser = 'Unknown';
    if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';
    
    let os = 'Unknown';
    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac OS')) os = 'Mac OS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iPhone')) os = 'iPhone';
    
    const deviceType = /Mobile|Android|iPhone/i.test(userAgent) ? 'Mobile' : 'Desktop';
    
    // Accept deviceName and platform from body if available (sent from frontend)
    const deviceName = req.body?.deviceName || 'Unknown Device';
    const platform = req.body?.platform || os;
    
    const deviceHash = Buffer.from(`${ip}-${userAgent}-${deviceName}`).toString('base64');
    
    return { ip, browser, os, deviceType, userAgent, deviceHash, deviceName, platform };
  }

  async function logAdminAction(admin: any, actionType: string, details: string, targetUser?: string, targetTask?: string) {
    const { ip } = getClientInfo({ headers: {} } as any); // Simplified for internal calls
    adminAuditLogs.push({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      adminId: admin.id,
      adminName: admin.name,
      actionType,
      targetUser,
      targetTask,
      timestamp: new Date().toISOString(),
      ipAddress: ip,
      details
    });
    await saveData();
  }

  // --- Auth Middleware ---
  const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      console.log(`Authenticating user: ${decoded.employeeId || decoded.id} for ${req.method} ${req.url}`);
      
      // Verify user exists in database
      const user = users.find(u => 
        (decoded.id && u.id === decoded.id) || 
        (decoded.employeeId && u.employeeId && u.employeeId.toLowerCase() === decoded.employeeId.toLowerCase())
      );
      if (!user) {
        return res.status(401).json({ error: "Invalid session: User no longer exists" });
      }

      // Check or recover session
      if (decoded.sessionId) {
        let session = userSessions.find(s => s.id === decoded.sessionId);
        if (!session) {
          console.log(`Auto-recovering session ${decoded.sessionId} for user ${user.name} (${user.employeeId})`);
          const clientInfo = getClientInfo(req);
          session = {
            id: decoded.sessionId,
            userId: user.id,
            employeeId: user.employeeId,
            loginTime: new Date().toISOString(),
            ipAddress: clientInfo.ip,
            browser: clientInfo.browser,
            os: clientInfo.os,
            deviceHash: clientInfo.deviceHash,
            deviceName: clientInfo.deviceName,
            platform: clientInfo.platform,
            active: true,
            lastActivity: new Date().toISOString()
          };
          userSessions.push(session);

          // Add activity log if missing
          if (!activityLogs.some(l => l.id === decoded.sessionId)) {
            activityLogs.push({
              id: decoded.sessionId,
              userId: user.id,
              employeeId: user.employeeId,
              name: user.name,
              role: user.role,
              loginTime: session.loginTime,
              ipAddress: clientInfo.ip,
              browser: clientInfo.browser,
              os: clientInfo.os,
              deviceType: clientInfo.deviceType,
              deviceName: clientInfo.deviceName,
              platform: clientInfo.platform,
              loginStatus: 'SUCCESS',
              createdAt: new Date().toISOString()
            });
          }
          saveData().catch(err => console.error("Error saving recovered session:", err));
        } else if (!session.active) {
          const isExplicitLogout = (session as any).logoutReason === 'ADMIN_FORCED' || (session as any).logoutReason === 'USER_LOGOUT';
          const logoutTime = session.logoutTime ? new Date(session.logoutTime).getTime() : 0;
          const now = Date.now();
          
          if (!isExplicitLogout || (logoutTime > 0 && (now - logoutTime) < 300000)) {
            console.log(`Reactivating session ${decoded.sessionId} for user ${user.employeeId}`);
            session.active = true;
            session.logoutTime = undefined;
            (session as any).logoutReason = undefined;
            saveData().catch(err => console.error("Error saving reactivated session:", err));
          } else {
            console.warn(`Auth failed: Session ${decoded.sessionId} is inactive (Logout time: ${session.logoutTime})`);
            return res.status(401).json({ error: "Session expired or logged out from another device" });
          }
        }
        
        // Update last activity
        session.lastActivity = new Date().toISOString();
      }

      // Synchronize req.user with up-to-date user details
      req.user = {
        ...decoded,
        id: user.id,
        role: user.role,
        name: user.name,
        employeeId: user.employeeId
      };
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const user = users.find(u => 
          (decoded.id && u.id === decoded.id) || 
          (decoded.employeeId && u.employeeId && u.employeeId.toLowerCase() === decoded.employeeId.toLowerCase())
        );
        if (user) {
          req.user = {
            ...decoded,
            id: user.id,
            role: user.role,
            name: user.name,
            employeeId: user.employeeId
          };
        }
      } catch {
        // Continue silently without blocking if token is expired/invalid
      }
    }
    next();
  };

  // --- API Routes ---
  app.get("/api/ping", (req, res) => {
    res.json({ status: "pong", time: new Date().toISOString() });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString(), users: users.length });
  });

  app.get("/api/test", (req, res) => {
    res.json({ status: "ok", usersCount: users.length });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { employeeId, password } = req.body;
    const trimmedId = (employeeId || "").toString().trim();
    const passwordStr = (password || "").toString();
    const clientInfo = getClientInfo(req);
    
    // Check for device lock
    const isLocked = lockedDevices.some(d => 
      (d.ipAddress && d.ipAddress === clientInfo.ip) || 
      (d.deviceHash && d.deviceHash === clientInfo.deviceHash)
    );
    if (isLocked) {
      return res.status(403).json({ error: "Access denied from this device" });
    }

    // Check for account lock
    const failedAttempt = failedLoginAttempts.find(a => a.employeeId.toLowerCase() === trimmedId.toLowerCase());
    if (failedAttempt && failedAttempt.isLocked) {
      if (new Date(failedAttempt.lockUntil!) > new Date()) {
        const remaining = Math.ceil((new Date(failedAttempt.lockUntil!).getTime() - Date.now()) / 60000);
        return res.status(403).json({ error: `Account temporarily locked. Try again in ${remaining} minutes.` });
      } else {
        failedAttempt.isLocked = false;
        failedAttempt.attemptCount = 0;
      }
    }

    const user = users.find(u => u.employeeId.toLowerCase() === trimmedId.toLowerCase());
    if (user) {
      let isMatch = await bcrypt.compare(passwordStr, user.password);
      
      // Fallback: if password is '3624' but doesn't match, check if it matches employeeId (old default)
      if (!isMatch && passwordStr === "3624") {
        isMatch = await bcrypt.compare(user.employeeId, user.password);
        if (isMatch) {
          user.password = await bcrypt.hash("3624", 10);
          await saveData();
        }
      }

      if (isMatch) {
        // Reset failed attempts on success
        if (failedAttempt) {
          failedAttempt.attemptCount = 0;
          failedAttempt.isLocked = false;
        }

        const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        const token = jwt.sign({ 
          id: user.id, 
          role: user.role, 
          name: user.name, 
          employeeId: user.employeeId,
          sessionId 
        }, JWT_SECRET);

        // Create new session
        const newSession: UserSession = {
          id: sessionId,
          userId: user.id,
          employeeId: user.employeeId,
          loginTime: new Date().toISOString(),
          ipAddress: clientInfo.ip,
          browser: clientInfo.browser,
          os: clientInfo.os,
          deviceHash: clientInfo.deviceHash,
          deviceName: clientInfo.deviceName,
          platform: clientInfo.platform,
          active: true,
          lastActivity: new Date().toISOString()
        };
        userSessions.push(newSession);

        // Create activity log
        activityLogs.push({
          id: sessionId,
          userId: user.id,
          employeeId: user.employeeId,
          name: user.name,
          role: user.role,
          loginTime: newSession.loginTime,
          ipAddress: clientInfo.ip,
          browser: clientInfo.browser,
          os: clientInfo.os,
          deviceType: clientInfo.deviceType,
          deviceName: clientInfo.deviceName,
          platform: clientInfo.platform,
          loginStatus: 'SUCCESS',
          createdAt: new Date().toISOString()
        });

        await saveData();
        const { password: _, ...userWithoutPassword } = user;
        return res.json({ token, user: userWithoutPassword });
      } else {
        // Track failed attempt
        if (failedAttempt) {
          failedAttempt.attemptCount++;
          failedAttempt.timestamp = new Date().toISOString();
          if (failedAttempt.attemptCount >= 5) {
            failedAttempt.isLocked = true;
            failedAttempt.lockUntil = new Date(Date.now() + 15 * 60000).toISOString();
          }
        } else {
          failedLoginAttempts.push({
            id: Date.now().toString(),
            employeeId: trimmedId,
            ipAddress: clientInfo.ip,
            browser: clientInfo.browser,
            os: clientInfo.os,
            timestamp: new Date().toISOString(),
            attemptCount: 1,
            isLocked: false
          });
        }

        // Log failed activity
        activityLogs.push({
          id: Date.now().toString(),
          userId: user.id,
          employeeId: user.employeeId,
          name: user.name,
          role: user.role,
          loginTime: new Date().toISOString(),
          ipAddress: clientInfo.ip,
          browser: clientInfo.browser,
          os: clientInfo.os,
          deviceType: clientInfo.deviceType,
          loginStatus: 'FAILED',
          failedAttemptCount: failedAttempt ? failedAttempt.attemptCount : 1,
          createdAt: new Date().toISOString()
        });
        await saveData();
      }
    } else {
      // Log failed attempt for non-existent user
      failedLoginAttempts.push({
        id: Date.now().toString(),
        employeeId: trimmedId,
        ipAddress: clientInfo.ip,
        browser: clientInfo.browser,
        os: clientInfo.os,
        timestamp: new Date().toISOString(),
        attemptCount: 1,
        isLocked: false
      });
      await saveData();
    }
    res.status(401).json({ error: "Invalid credentials" });
  });

  app.post("/api/auth/logout", authenticate, async (req: Request, res: Response) => {
    const session = userSessions.find(s => s.id === req.user.sessionId);
    if (session) {
      session.active = false;
      session.logoutTime = new Date().toISOString();
      (session as any).logoutReason = 'USER_LOGOUT';
      
      const log = activityLogs.find(l => l.id === session.id);
      if (log) {
        log.logoutTime = session.logoutTime;
        const durationMs = new Date(log.logoutTime).getTime() - new Date(log.loginTime).getTime();
        const minutes = Math.floor(durationMs / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);
        log.sessionDuration = `${minutes}m ${seconds}s`;
      }
      await saveData();
    }
    res.json({ success: true });
  });

  app.post("/api/auth/change-password", authenticate, async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid current password" });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await saveData();
    res.json({ message: "Password changed successfully" });
  });

  app.post("/api/users/:id/reset-password", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const { newPassword } = req.body;
    const user = users.find(u => u.id === id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await logAdminAction(req.user, 'PASSWORD_RESET', `Reset password for user ${user.name} (${user.employeeId})`, user.id);
    await saveData();
    res.json({ message: "Password reset successfully" });
  });

  app.get("/api/users", authenticate, (req: Request, res: Response) => {
    const allowedRoles = ['SUPER_ADMIN', 'HOD', 'IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    rebuildTechnicianStatuses();
    res.json(users.map(({ password, ...u }) => u));
  });

  app.post("/api/users", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HOD') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { employeeId, name, role, password, avatar, supervisorId, phone, designation, email, department, assignedEngineers, supervisor_ids } = req.body;
    
    let formattedPhone = phone;
    if (formattedPhone && !formattedPhone.startsWith('0') && /^\d+$/.test(formattedPhone)) {
      formattedPhone = '0' + formattedPhone;
    }

    const newUser: User = {
      id: Date.now().toString(),
      employeeId,
      name,
      role,
      avatar,
      supervisorId,
      supervisor_ids: shiftingTechnicianIds.includes(employeeId) ? shiftingOfficerIds : supervisor_ids,
      phone: formattedPhone,
      designation,
      email,
      department: department || "RAC R&I",
      assignedEngineers: assignedEngineers || [],
      status: (role === 'TECHNICIAN' ? 'FREE' : undefined) as User['status'],
      password: await bcrypt.hash(password || "3624", 10)
    };
    users.push(newUser);
    await logAdminAction(req.user, 'USER_CREATED', `Created user ${newUser.name} (${newUser.employeeId})`, newUser.id);
    await saveData();
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  });

  app.put("/api/users/:id", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HOD') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const { name, role, employeeId, password, avatar, supervisorId, phone, designation, email, department, assignedEngineers, supervisor_ids } = req.body;
    
    let formattedPhone = phone;
    if (formattedPhone && !formattedPhone.startsWith('0') && /^\d+$/.test(formattedPhone)) {
      formattedPhone = '0' + formattedPhone;
    }

    const index = users.findIndex(u => u.id === id);
    if (index !== -1) {
      const updatedUser = { 
        ...users[index], 
        name: name || users[index].name, 
        role: role || users[index].role, 
        employeeId: employeeId || users[index].employeeId, 
        avatar: avatar !== undefined ? avatar : users[index].avatar, 
        supervisorId: supervisorId !== undefined ? supervisorId : users[index].supervisorId, 
        supervisor_ids: shiftingTechnicianIds.includes(employeeId || users[index].employeeId) ? shiftingOfficerIds : (req.body.supervisor_ids !== undefined ? req.body.supervisor_ids : users[index].supervisor_ids),
        phone: formattedPhone !== undefined ? formattedPhone : users[index].phone, 
        designation: designation !== undefined ? designation : users[index].designation, 
        email: email !== undefined ? email : users[index].email, 
        department: department || users[index].department || "RAC R&I", 
        assignedEngineers: assignedEngineers || [] 
      };
      if (password) {
        updatedUser.password = await bcrypt.hash(password, 10);
      }
      users[index] = updatedUser;
      await logAdminAction(req.user, 'USER_EDITED', `Edited user ${updatedUser.name} (${updatedUser.employeeId})`, updatedUser.id);
      await saveData();
      const { password: _, ...userWithoutPassword } = users[index];
      res.json(userWithoutPassword);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  app.delete("/api/users/:id", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HOD') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const index = users.findIndex(u => u.id === id);
    if (index !== -1) {
      const deletedUser = users[index];
      users.splice(index, 1);
      await logAdminAction(req.user, 'USER_DELETED', `Deleted user ${deletedUser.name} (${deletedUser.employeeId})`, deletedUser.id);
      await saveData();
      res.status(204).send();
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  // --- Notifications ---
  app.get("/api/notifications", authenticate, (req: Request, res: Response) => {
    const user = (req as any).user;
    const userNotifications = (notifications || []).filter((n: any) => n.userId === user.id);
    res.json(userNotifications);
  });

  app.put("/api/notifications/:id/read", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const index = (notifications || []).findIndex((n: any) => n.id === req.params.id && n.userId === user.id);
    if (index !== -1) {
      notifications[index].read = true;
      await saveData();
    }
    res.json({ success: true });
  });

  app.delete("/api/notifications", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const newNotifications = (notifications || []).filter((n: any) => n.userId !== user.id);
    notifications.length = 0;
    notifications.push(...newNotifications);
    await saveData();
    res.json({ success: true });
  });

  app.get("/api/points", authenticate, async (req: Request, res: Response) => {
    // Points are already recalculated on data changes
    res.json(pointTransactions);
  });

  app.post("/api/admin/recalculate", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'HOD') {
      return res.status(403).json({ error: "Access Denied" });
    }
    recalculateAllPoints();
    await saveData();
    res.json({ success: true, message: "Points recalculated" });
  });

  app.get("/api/performance", authenticate, (req: Request, res: Response) => {
    res.json(technicianPerformance);
  });

  app.get("/api/assignment-requests", authenticate, (req: Request, res: Response) => {
    const user = (req as any).user;
    // Supervisors see requests for their technicians
    // Officers see requests they made
    const filtered = assignmentRequests.filter((r: any) => 
      r.supervisorId === user.id || r.requestingOfficerId === user.id
    );
    res.json(filtered);
  });

  app.post("/api/assignment-requests", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { taskId, targetTechnicianId, supervisorId, reason } = req.body;
    
    const newRequest = {
      id: Date.now().toString(),
      taskId,
      requestingOfficerId: user.id,
      targetTechnicianId,
      supervisorId,
      status: 'PENDING',
      reason,
      createdAt: new Date().toISOString()
    };
    
    assignmentRequests.push(newRequest);
    
    // Notify supervisor
    notifications.push({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      userId: supervisorId,
      senderId: user.id,
      type: 'ASSIGNMENT_REQUEST',
      message: `Officer ${user.name} requested a technician for a task.`,
      read: false,
      timestamp: new Date().toISOString()
    });

    await saveData();
    res.status(201).json(newRequest);
  });

  // --- Security Dashboard Endpoints ---
  app.post("/api/admin/recalculate", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    recalculateAllPoints();
    rebuildTechnicianStatuses();
    await saveData();
    res.json({ message: "Recalculation complete" });
  });

  app.get("/api/admin/activity-logs", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(activityLogs);
  });

  app.get("/api/admin/active-sessions", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(userSessions.filter(s => s.active));
  });

  app.post("/api/admin/sessions/force-logout", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { sessionId } = req.body;
    const session = userSessions.find(s => s.id === sessionId);
    if (session) {
      session.active = false;
      session.logoutTime = new Date().toISOString();
      (session as any).logoutReason = 'ADMIN_FORCED';
      const log = activityLogs.find(l => l.id === sessionId);
      if (log) {
        log.logoutTime = session.logoutTime;
        log.sessionDuration = "Admin Forced Logout";
      }
      await logAdminAction(req.user, 'FORCE_LOGOUT', `Forced logout for session ${sessionId} (User: ${session.employeeId})`, session.userId);
      await saveData();
    }
    res.json({ success: true });
  });

  app.get("/api/admin/audit-logs", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(adminAuditLogs);
  });

  app.get("/api/admin/locked-devices", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(lockedDevices);
  });

  app.post("/api/admin/devices/lock", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { ipAddress, deviceHash, reason } = req.body;
    const newLock: LockedDevice = {
      id: Date.now().toString(),
      ipAddress,
      deviceHash,
      reason,
      lockedBy: req.user.name,
      lockedAt: new Date().toISOString()
    };
    lockedDevices.push(newLock);
    await logAdminAction(req.user, 'DEVICE_LOCKED', `Locked device/IP: ${ipAddress || deviceHash}`, undefined);
    await saveData();
    res.status(201).json(newLock);
  });

  app.post("/api/admin/devices/unlock", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { id } = req.body;
    const index = lockedDevices.findIndex(d => d.id === id);
    if (index !== -1) {
      const lock = lockedDevices[index];
      lockedDevices.splice(index, 1);
      await logAdminAction(req.user, 'DEVICE_UNLOCKED', `Unlocked device/IP: ${lock.ipAddress || lock.deviceHash}`, undefined);
      await saveData();
    }
    res.json({ success: true });
  });

  app.get("/api/admin/suspicious-logins", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    // Define suspicious as: same user from different IPs within 1 hour
    const suspicious: any[] = [];
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    const recentLogs = activityLogs.filter(l => new Date(l.loginTime) > oneHourAgo && l.loginStatus === 'SUCCESS');
    const userGroups = recentLogs.reduce((acc: any, log) => {
      if (!acc[log.userId]) acc[log.userId] = [];
      acc[log.userId].push(log);
      return acc;
    }, {});

    for (const userId in userGroups) {
      const logs = userGroups[userId];
      const ips = new Set(logs.map((l: any) => l.ipAddress));
      if (ips.size > 1) {
        suspicious.push({
          userId,
          employeeId: logs[0].employeeId,
          name: logs[0].name,
          ips: Array.from(ips),
          logs: logs,
          reason: 'Multiple IPs in short time'
        });
      }
    }
    res.json(suspicious);
  });

  app.get("/api/admin/locked-accounts", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(failedLoginAttempts.filter(a => a.isLocked));
  });

  app.post("/api/admin/unlock-account", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { employeeId } = req.body;
    const attempt = failedLoginAttempts.find(a => a.employeeId.toLowerCase() === employeeId.toLowerCase());
    if (attempt) {
      attempt.isLocked = false;
      attempt.attemptCount = 0;
      await logAdminAction(req.user, 'ACCOUNT_UNLOCKED', `Manually unlocked account for ${employeeId}`, undefined);
      await saveData();
    }
    res.json({ success: true });
  });

  app.get("/api/tasks", authenticate, (req: Request, res: Response) => {
    const { month, year, all } = req.query;
    
    if (all === 'true') {
      return res.json(tasks);
    }

    const currentMonth = month ? parseInt(month as string) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year as string) : new Date().getFullYear();

    const filteredTasks = tasks.filter((t: any) => {
      const taskDate = new Date(t.createdAt);
      const deadlineDate = t.deadline ? new Date(t.deadline) : null;
      
      const isCreatedInMonth = taskDate.getMonth() + 1 === currentMonth && taskDate.getFullYear() === currentYear;
      const isDeadlineInMonth = deadlineDate && (deadlineDate.getMonth() + 1 === currentMonth && deadlineDate.getFullYear() === currentYear);
      const isNotCompleted = t.status !== 'COMPLETED';

      return isCreatedInMonth || isDeadlineInMonth || isNotCompleted;
    });

    res.json(filteredTasks);
  });

  app.post("/api/system/process-employees", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      let filePath = path.join(process.cwd(), "employee data.xlsx");
      if (!fsSync.existsSync(filePath)) {
        filePath = path.join(__dirname, "employee data.xlsx");
      }
      if (!fsSync.existsSync(filePath)) {
        return res.status(404).json({ error: "employee data.xlsx file not found on server" });
      }
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      console.log(`Processing ${data.length} employees from Excel. First row keys:`, data.length > 0 ? Object.keys(data[0]) : 'None');

      let createdCount = 0;
      let updatedCount = 0;

      for (const row of data as any[]) {
        // Try multiple common column names for ID and Name
        const employeeId = (row.ID || row["Employee ID"] || row.employeeId || row["HRMS ID"] || "").toString().trim();
        const name = (row.Name || row["Employee Name"] || row.name || row["Name of Employee"] || "Unknown").toString().trim();
        const rawRole = (row.Role || row.role || row.Designation || row.designation || "TECHNICIAN").toString().trim().toUpperCase();
        
        // Extract additional fields
        let phone = (row.Phone || row["Phone Number"] || row.phone || row.Mobile || row.mobile || row["Mobile No"] || row["Mobile Number"] || row.Contact || row["Contact No"] || row["Phone No"] || row.Cell || row["Cell No"] || row["Cell Number"] || "").toString().trim();
        
        // Add leading zero if missing (common Excel issue)
        if (phone && !phone.startsWith('0') && /^\d+$/.test(phone)) {
          phone = '0' + phone;
        }

        const designation = (row.Designation || row.designation || row.Role || row.role || "").toString().trim();
        const email = (row.Email || row["Email Address"] || row.email || row["Email ID"] || row["E-mail"] || "").toString().trim();
        const department = (row.Department || row.department || row.Dept || row.dept || "RAC R&I").toString().trim();

        // Map common role names to system roles
        let role: string = "TECHNICIAN";
        const upperRole = rawRole.toUpperCase();
        
        if (upperRole.includes('SUPER ADMIN') || upperRole === 'ADMIN') role = 'SUPER_ADMIN';
        else if (upperRole.includes('HOD')) role = 'HOD';
        else if (upperRole.includes('INCHARGE') || upperRole.includes('IN-CHARGE') || upperRole === 'IN_CHARGE') role = 'IN_CHARGE';
        else if (upperRole.includes('MODEL MANAGER') || upperRole.includes('MODEL-MANAGER')) role = 'MODEL_MANAGER';
        else if (upperRole.includes('ENGINEER')) role = 'ENGINEER';
        else if (upperRole.includes('OFFICER')) role = 'OFFICER';
        else if (upperRole.includes('TECHNICIAN')) role = 'TECHNICIAN';
        else if (upperRole.includes('MANAGER')) role = 'MODEL_MANAGER';
        else if (upperRole.includes('SUPERVISOR')) role = 'IN_CHARGE';
        else {
          // Fallback mapping based on common titles if Role column is actually a Designation column
          if (upperRole.includes('MANAGER')) role = 'MODEL_MANAGER';
          else if (upperRole.includes('HOD')) role = 'HOD';
          else if (upperRole.includes('ENGINEER')) role = 'ENGINEER';
          else if (upperRole.includes('OFFICER')) role = 'OFFICER';
          else role = 'TECHNICIAN';
        }

        if (!employeeId) continue;

        const existingUser = users.find(u => u.employeeId.toString().toLowerCase() === employeeId.toLowerCase());
        const hashedPassword = await bcrypt.hash(employeeId, 10);

        if (existingUser) {
          // Update password to match ID as requested
          existingUser.password = hashedPassword;
          // Also update other fields
          existingUser.name = name;
          existingUser.role = role as any;
          existingUser.phone = phone;
          existingUser.designation = designation;
          existingUser.email = email;
          existingUser.department = department;
          updatedCount++;
        } else {
          users.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            employeeId,
            name,
            role: role as any,
            password: hashedPassword,
            supervisorId: "",
            assignedEngineers: [],
            phone,
            designation,
            email,
            department
          });
          createdCount++;
        }
      }

      await saveData();
      res.json({ message: "Employee data processed successfully", createdCount, updatedCount });
    } catch (err) {
      console.error("Error processing employee data:", err);
      res.status(500).json({ error: "Failed to process employee data: " + err.message });
    }
  });

  app.post("/api/system/backfill-points", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    recalculateAllPoints();
    await saveData();
    res.json({ message: `Points recalculated and backfilled.` });
  });

  app.post("/api/system/clear-tasks", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    tasks.length = 0;
    attendanceRecords.length = 0;
    pointTransactions.length = 0;
    technicianPerformance.length = 0;
    assignmentRequests.length = 0;
    notifications.length = 0;
    adminAuditLogs.length = 0;
    
    // Reset points and task counts on all users, keep user and employee data intact
    users.forEach((u: any) => {
      u.total_point = 0;
      u.completedTask = 0;
      if (u.role === 'TECHNICIAN') {
        u.status = 'FREE';
      }
    });

    await saveData(true);
    await logAdminAction(req.user, 'CLEAR_TASKS', 'Cleared all dummy tasks and operational data, preserving employee and user records');
    res.json({ message: "All tasks and operational data cleared successfully. All employee and user accounts preserved.", userCount: users.length });
  });

  app.get("/api/system/backup", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const backupData = {
      users,
      tasks,
      attendanceRecords,
      notifications,
      pointTransactions,
      technicianPerformance,
      assignmentRequests,
      activityLogs,
      adminAuditLogs,
      userSessions,
      failedLoginAttempts,
      lockedDevices,
      autoBackupSettings,
      timestamp: new Date().toISOString()
    };
    res.json(backupData);
  });

  // --- Auto-Backup & Database Management Endpoints ---
  app.get("/api/system/backup-settings", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    try {
      await fs.mkdir(BACKUPS_DIR, { recursive: true });
      const files = await fs.readdir(BACKUPS_DIR);
      const backupFiles = files.filter(f => f.startsWith('db-backup-') && f.endsWith('.json'));

      const backupsWithMeta = await Promise.all(
        backupFiles.sort().reverse().slice(0, 30).map(async (filename) => {
          const filePath = path.join(BACKUPS_DIR, filename);
          const stat = await fs.stat(filePath);
          let tasksCount = 0;
          let usersCount = 0;
          let type = 'HOURLY_AUTO';
          let timestamp = stat.mtime.toISOString();
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            tasksCount = Array.isArray(parsed.tasks) ? parsed.tasks.length : 0;
            usersCount = Array.isArray(parsed.users) ? parsed.users.length : 0;
            if (parsed.backupMeta) {
              type = parsed.backupMeta.type || type;
              timestamp = parsed.backupMeta.timestamp || timestamp;
            }
          } catch (e) {}
          return {
            filename,
            timestamp,
            size: stat.size,
            tasksCount,
            usersCount,
            type
          };
        })
      );

      res.json({
        autoBackupEnabled: autoBackupSettings.enabled,
        intervalMinutes: autoBackupSettings.intervalMinutes,
        lastBackupTime: autoBackupSettings.lastBackupTime,
        nextBackupTime: autoBackupSettings.nextBackupTime,
        liveStats: {
          tasksCount: tasks.length,
          usersCount: users.length,
          attendanceCount: attendanceRecords.length
        },
        backups: backupsWithMeta
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch backup settings: " + err.message });
    }
  });

  app.post("/api/system/backup-settings", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { enabled, intervalMinutes } = req.body;
    if (typeof enabled === 'boolean') {
      autoBackupSettings.enabled = enabled;
    }
    if (typeof intervalMinutes === 'number' && intervalMinutes >= 5) {
      autoBackupSettings.intervalMinutes = intervalMinutes;
    }
    startAutoBackupSchedule();
    await saveData();
    await logAdminAction(req.user, 'UPDATE_BACKUP_SETTINGS', `Updated auto-backup configuration: enabled=${autoBackupSettings.enabled}, interval=${autoBackupSettings.intervalMinutes}m`);
    res.json({ success: true, settings: autoBackupSettings });
  });

  app.post("/api/system/backup-now", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    try {
      const backupInfo = await createHourlyBackup(true);
      await logAdminAction(req.user, 'MANUAL_BACKUP', `Manual DB snapshot created: ${backupInfo.filename} with ${tasks.length} tasks, ${users.length} users`);
      res.json({ message: "Database snapshot created successfully!", backup: backupInfo });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to create database snapshot: " + err.message });
    }
  });

  app.get("/api/system/download-db", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    try {
      await saveData();
      const filePath = fsSync.existsSync(DB_FILE) ? DB_FILE : DATA_FILE;
      res.download(filePath, `rac-ri-daily-work-db-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to download database file: " + err.message });
    }
  });

  app.get("/api/system/backups/:filename", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const filename = path.basename(req.params.filename);
    const filePath = path.join(BACKUPS_DIR, filename);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: "Backup snapshot file not found" });
    }
    res.download(filePath, filename);
  });

  app.post("/api/system/restore-backup", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: "Filename is required" });

    const safeName = path.basename(filename);
    const filePath = path.join(BACKUPS_DIR, safeName);
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: "Backup snapshot file not found" });
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(content);
      
      const replaceArray = (target: any[], source: any) => {
        if (Array.isArray(source)) {
          target.length = 0;
          for (const item of source) target.push(item);
          return true;
        }
        return false;
      };

      replaceArray(users, data.users);
      replaceArray(tasks, data.tasks);
      replaceArray(attendanceRecords, data.attendanceRecords);
      replaceArray(notifications, data.notifications);
      replaceArray(pointTransactions, data.pointTransactions);
      replaceArray(technicianPerformance, data.technicianPerformance);
      replaceArray(assignmentRequests, data.assignmentRequests);
      replaceArray(activityLogs, data.activityLogs);
      replaceArray(adminAuditLogs, data.adminAuditLogs);
      replaceArray(failedLoginAttempts, data.failedLoginAttempts);
      replaceArray(lockedDevices, data.lockedDevices);

      recalculateAllPoints();
      rebuildTechnicianStatuses();
      await saveData(true);

      await logAdminAction(req.user, 'RESTORE_BACKUP', `Restored system from backup snapshot: ${safeName} (${tasks.length} tasks, ${users.length} users)`);
      res.json({
        message: `System successfully restored from ${safeName}!`,
        tasksCount: tasks.length,
        usersCount: users.length
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to restore backup snapshot: " + err.message });
    }
  });

  app.post("/api/system/restore", authenticate, async (req: Request, res: Response) => {
    console.log(`Full system restore request received from user: ${req.user.name} (${req.user.role})`);
    if (req.user.role !== 'SUPER_ADMIN') {
      console.warn(`Unauthorized restore attempt by user: ${req.user.name}`);
      return res.status(403).json({ error: "Forbidden" });
    }
    
    const data = req.body;
    
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: "Invalid backup data" });
    }

    try {
      // Helper to safely replace array content without stack overflow
      const replaceArray = (target: any[], source: any) => {
        if (Array.isArray(source)) {
          target.length = 0;
          // Use a loop instead of spread operator to avoid stack overflow on large arrays
          for (const item of source) {
            target.push(item);
          }
          return true;
        }
        return false;
      };

      // Restore all major data arrays
      replaceArray(users, data.users);
      replaceArray(tasks, data.tasks);
      replaceArray(attendanceRecords, data.attendanceRecords);
      replaceArray(notifications, data.notifications);
      replaceArray(pointTransactions, data.pointTransactions);
      replaceArray(technicianPerformance, data.technicianPerformance);
      replaceArray(assignmentRequests, data.assignmentRequests);
      replaceArray(activityLogs, data.activityLogs);
      replaceArray(adminAuditLogs, data.adminAuditLogs);
      replaceArray(failedLoginAttempts, data.failedLoginAttempts);
      replaceArray(lockedDevices, data.lockedDevices);
      
      // Special handling for userSessions: 
      // We want to keep the current session active if possible, 
      // but also restore other sessions if they are in the backup.
      if (Array.isArray(data.userSessions)) {
        const currentSessionId = req.user.sessionId;
        const currentSession = userSessions.find(s => s.id === currentSessionId);
        
        userSessions.length = 0;
        for (const session of data.userSessions) {
          userSessions.push(session);
        }
        
        // Ensure current session is in the list and active
        const sessionInRestored = userSessions.find(s => s.id === currentSessionId);
        if (sessionInRestored) {
          sessionInRestored.active = true;
          sessionInRestored.logoutTime = undefined;
        } else if (currentSession) {
          currentSession.active = true;
          userSessions.push(currentSession);
        }
      }

      recalculateAllPoints();
      rebuildTechnicianStatuses();
      await saveData(true);
      console.log('System fully restored successfully');
      res.json({ 
        message: "System restored successfully", 
        userCount: users.length, 
        taskCount: tasks.length, 
        attendanceCount: attendanceRecords.length 
      });
    } catch (err) {
      console.error('Error during system restore:', err);
      res.status(500).json({ error: "Internal server error during restore" });
    }
  });

  app.post("/api/tasks", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    // Task Creation Restriction (STRICT RULE)
    const allowedCreators = ['SUPER_ADMIN', 'HOD', 'IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER'];
    if (!allowedCreators.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Your role is not authorized to create tasks." });
    }

    // Strict Assignment Rule for Officers
    const { urgency, points, assignedTechnicians } = req.body;
    const assignedToName = req.body.assignedTo || (req.body.workType === 'TEAM' && Array.isArray(assignedTechnicians) && assignedTechnicians.length > 0 ? assignedTechnicians[0].name : '');
    const workType = req.body.workType;
    
    if (user.role === 'OFFICER') {
      if (!assignedToName && workType !== 'TEAM') {
        return res.status(400).json({ error: "Task must be assigned to a Technician." });
      }
      if (assignedToName) {
        const targetUser = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);
        if (!targetUser || targetUser.role !== 'TECHNICIAN') {
          return res.status(403).json({ error: "Access Denied: Officers can only assign tasks to Technicians." });
        }
        // Technician Monitoring: Cannot assign to WORKING technician
        if (targetUser.status === 'WORKING') {
          return res.status(400).json({ error: `Technician ${targetUser.name} is currently WORKING. Please wait until they are FREE.` });
        }
      }
      if (workType === 'TEAM' && Array.isArray(assignedTechnicians)) {
        for (const at of assignedTechnicians) {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech && tech.status === 'WORKING') {
            return res.status(400).json({ error: `Technician ${tech.name} is currently WORKING. Please wait until they are FREE.` });
          }
        }
      }
    }
    
    // Point Validation
    if (urgency === 'REGULAR' && points > 1) {
      return res.status(400).json({ error: "Regular work cannot exceed 1 point." });
    }
    if (urgency === 'URGENT' && points > 2) {
      return res.status(400).json({ error: "Urgent work cannot exceed 2 points." });
    }
    if (urgency === 'MOST_URGENT') {
      if (user.role !== 'ENGINEER' && user.role !== 'SUPER_ADMIN' && user.role !== 'HOD') {
        return res.status(403).json({ error: "Only Engineers or higher can assign Most Urgent tasks." });
      }
      if (points > 3) {
        return res.status(400).json({ error: "Most Urgent work cannot exceed 3 points." });
      }
    }

    const targetUser = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);

    let status: TaskStatus = "PENDING";
    let requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RECOMMENDED' | undefined = undefined;

    if (user.role === 'OFFICER') {
      // Officer creates task -> goes to Recommendation Panel
      // Officer can ONLY create tasks for Technicians
      const targetTechs = workType === 'TEAM' ? assignedTechnicians : [targetUser];
      const allTechs = targetTechs.every((t: any) => {
        const u = users.find(usr => usr.employeeId === (t?.employeeId || t?.name) || usr.name === (t?.name || t?.employeeId) || usr.id === (t?.id || t?.employeeId));
        return u && u.role === 'TECHNICIAN';
      });

      if (!allTechs) {
        return res.status(403).json({ error: "Officers can only create tasks for Technicians." });
      }

      const hasOtherTeamTech = targetTechs.some((t: any) => {
        const u = users.find(usr => usr.employeeId === (t?.employeeId || t?.name) || usr.name === (t?.name || t?.employeeId) || usr.id === (t?.id || t?.employeeId));
        return u && u.supervisorId !== user.id;
      });

      if (hasOtherTeamTech) {
        // STRICT FLOW: Officer -> Request -> Technician Supervisor
        status = "REQUESTED";
        requestStatus = "PENDING";
      } else {
        // Own Technician -> Direct Assign
        status = "RUNNING";
        requestStatus = "RECOMMENDED";
      }
    } else if (workType === 'TEAM') {
      if (!assignedTechnicians || assignedTechnicians.length < 2) {
        return res.status(400).json({ error: "Team work requires at least 2 technicians." });
      }
      
      const hasOtherTeamTech = assignedTechnicians.some((at: any) => {
        const tech = users.find(u => u.employeeId === at.employeeId);
        return tech && tech.supervisorId !== user.id;
      });

      if (hasOtherTeamTech) {
        status = "REQUESTED";
        requestStatus = "PENDING";
      } else {
        status = "RUNNING";
      }
    } else if (targetUser && targetUser.role === 'TECHNICIAN') {
      if (user.role !== 'ENGINEER' && targetUser.supervisorId !== user.id) {
        status = "REQUESTED";
        requestStatus = "PENDING";
      } else {
        status = "RUNNING";
      }
    }

    const newTask: Task = {
      ...req.body,
      assignedTo: assignedToName,
      id: Date.now().toString(),
      taskId: `${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${new Date().getHours()}${new Date().getMinutes()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
      createdAt: new Date().toISOString(),
      createdBy: user.employeeId,
      assignedBy: user.employeeId,
      status: status,
      requestStatus: requestStatus as any,
      startedAt: user.role === 'OFFICER' ? new Date().toISOString() : undefined,
      progress: req.body.progress || 0,
      points: user.role === 'OFFICER' ? 0 : (req.body.points || 1),
      customStartTime: req.body.customStartTime || '',
      estimatedDuration: req.body.estimatedDuration || '',
      workType: workType || 'SINGLE',
      assignedTechnicians: workType === 'TEAM' ? assignedTechnicians.map((t: any) => ({
        ...t,
        progress: 0,
        status: status === 'RUNNING' ? 'RUNNING' : 'PENDING',
        startedAt: status === 'RUNNING' ? new Date().toISOString() : undefined
      })) : undefined,
      logs: [{
        id: Date.now().toString(),
        action: user.role === 'OFFICER' ? "Task Created (Sent for Engineer Recommendation)" : (requestStatus === "RECOMMENDED" ? "Task Created (Sent for Engineer Recommendation)" : (status === "REQUESTED" ? "Task Requested (Cross-Team)" : "Task Created")),
        timestamp: new Date().toISOString(),
        user: user.name
      }]
    };

    if (status === "RUNNING") {
      newTask.startedAt = req.body.customStartTime || new Date().toISOString();
      if (workType !== 'TEAM') {
        newTask.logs.push({
          id: (Date.now() + 1).toString(),
          action: `Task assigned to ${targetUser?.name} - Started`,
          timestamp: new Date().toISOString(),
          user: "System"
        });
      }
    }

    tasks.push(newTask);
    
    // Update Technician Status to WORKING
    if (status === "RUNNING" || (user.role === 'OFFICER' && status === 'PENDING' && requestStatus === 'RECOMMENDED')) {
      if (workType === 'TEAM' && Array.isArray(assignedTechnicians)) {
        assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech) tech.status = 'WORKING';
        });
      } else if (assignedToName) {
        const tech = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);
        if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
      }
    }

    // Add notification for the assignee (if not recommended)
    if (assignedToName && status !== 'PENDING') {
      const targetUser = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);
      if (targetUser) {
        notifications.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          userId: targetUser.id,
          senderId: user.id,
          taskId: newTask.id,
          type: 'TASK_ASSIGNED',
          message: `${user.role} ${user.name} assigned you a task: ${req.body.title}`,
          read: false,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Add notification for Engineers if recommended
    if (status === 'PENDING' && requestStatus === 'RECOMMENDED') {
      const assignedEngIds = user.assignedEngineers || [];
      assignedEngIds.forEach((engId: string) => {
        const eng = users.find(u => u.employeeId === engId);
        if (eng) {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: eng.id,
            senderId: user.id,
            taskId: newTask.id,
            type: 'TASK_RECOMMENDATION',
            message: `Officer ${user.name} created a task for recommendation: ${req.body.title}`,
            read: false,
            timestamp: new Date().toISOString()
          });
        }
      });
    }

    // Add notification for team members
    if (workType === 'TEAM' && Array.isArray(assignedTechnicians)) {
      assignedTechnicians.forEach((at: any) => {
        const targetUser = users.find(u => u.employeeId === at.employeeId);
        if (targetUser) {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: targetUser.id,
            senderId: user.id,
            taskId: newTask.id,
            type: 'TASK_ASSIGNED',
            message: `${user.role} ${user.name} assigned you a team task: ${req.body.title}`,
            read: false,
            timestamp: new Date().toISOString()
          });
        }
      });
    }

    recalculateAllPoints();
    await saveData();
    res.status(201).json(newTask);
  });

  app.put("/api/tasks/:id/approve", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { points, engineer_deadline } = req.body; // Engineer can edit points and deadline
    const taskIndex = tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) return res.status(404).json({ error: "Task not found" });
    const task = tasks[taskIndex];

    // Engineer Approval Logic
    if (user.role === 'ENGINEER') {
      if (task.requestStatus !== 'RECOMMENDED') {
        return res.status(400).json({ error: "This task is not in the recommendation panel." });
      }
      
      // Engineer must be assigned to the Officer who created the task
      const officer = users.find(u => u.employeeId === task.createdBy);
      if (!officer || !(officer.assignedEngineers || []).includes(user.employeeId)) {
        return res.status(403).json({ error: "You are not authorized to approve tasks for this Officer." });
      }

      task.points = points || task.points || 1;
      task.engineer_deadline = engineer_deadline || task.deadline;
      task.status = "RUNNING";
      task.requestStatus = "APPROVED";
      task.approvedBy = user.employeeId;
      task.startedAt = new Date().toISOString();

      // Update Technician Status to WORKING
      if (task.workType === 'TEAM' && Array.isArray(task.assignedTechnicians)) {
        task.assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech) tech.status = 'WORKING';
        });
      } else if (task.assignedTo) {
        const tech = users.find(u => u.id === task.assignedTo || u.name === task.assignedTo || u.employeeId === task.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
      }

      if (task.workType === 'TEAM' && task.assignedTechnicians) {
        task.assignedTechnicians = task.assignedTechnicians.map((at: any) => ({
          ...at,
          status: 'RUNNING',
          startedAt: new Date().toISOString()
        }));
      }

      task.logs.push({
        id: Date.now().toString(),
        action: `Task Approved by Engineer ${user.name} with ${task.points} points`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      // Point System: Point added to Officer Profile only after Task COMPLETE + Engineer APPROVE
      // This is handled in the main update-task logic when status changes to COMPLETED.
      // We only check here if the task was ALREADY completed before approval (rare case).
      if ((task.status as string) === 'COMPLETED' && officer && !task.pointAdded) {
        pointTransactions.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          taskId: task.id,
          officerId: officer.id,
          engineerId: user.employeeId,
          pointValue: task.points || 0,
          taskPriority: task.urgency,
          completedAt: task.completedAt || new Date().toISOString()
        });
        task.pointAdded = true;
      }

      // Update Technician Status to WORKING
      if (task.workType === 'TEAM' && task.assignedTechnicians) {
        task.assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech) tech.status = 'WORKING';
        });
      } else if (task.assignedTo) {
        const tech = users.find(u => u.id === task.assignedTo || u.name === task.assignedTo || u.employeeId === task.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
      }

      // Notify Officer
      if (officer) {
        notifications.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          userId: officer.id,
          message: `Engineer ${user.name} approved your task "${task.title}" and assigned ${task.points} points.`,
          read: false,
          timestamp: new Date().toISOString()
        });
      }

      await saveData();
      return res.json(task);
    }

    // Supervisor Approval Logic (Cross-Team or Officer Request)
    const targetTechnician = users.find(u => u.employeeId === task.assignedTo || u.name === task.assignedTo || u.id === task.assignedTo);
    const isTeamMemberSupervisor = task.workType === 'TEAM' && task.assignedTechnicians?.some((at: any) => {
      const tech = users.find(u => u.employeeId === at.employeeId);
      return tech && tech.supervisorId === user.id;
    });

    if ((!targetTechnician || targetTechnician.supervisorId !== user.id) && !isTeamMemberSupervisor) {
      return res.status(403).json({ error: "Only the technician's supervisor can approve this request" });
    }

    const creator = users.find(u => u.employeeId === task.createdBy);
    if (creator && creator.role === 'OFFICER') {
      // If approved by Supervisor, it goes to Engineer Recommendation Panel
      task.requestStatus = "RECOMMENDED";
      task.status = "PENDING";
      
      task.logs.push({
        id: Date.now().toString(),
        action: `Request Approved by Supervisor ${user.name} (Sent for Engineer Recommendation)`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      // Notify Engineer
      const assignedEngineers = creator.assignedEngineers || [];
      assignedEngineers.forEach(engId => {
        const eng = users.find(u => u.employeeId === engId || u.id === engId);
        if (eng) {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: eng.id,
            message: `New task recommendation request from Officer ${creator.name} (Approved by Supervisor)`,
            read: false,
            timestamp: new Date().toISOString()
          });
        }
      });
    } else {
      // Normal cross-team request from another supervisor/manager
      task.status = "RUNNING";
      task.requestStatus = "APPROVED";
      task.startedAt = new Date().toISOString();
      
      if (task.workType === 'TEAM' && task.assignedTechnicians) {
        task.assignedTechnicians = task.assignedTechnicians.map((at: any) => ({
          ...at,
          status: 'RUNNING',
          startedAt: new Date().toISOString()
        }));
      }

      task.logs.push({
        id: Date.now().toString(),
        action: `Request Approved by Supervisor ${user.name}`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      // Update Technician Status to WORKING
      if (task.workType === 'TEAM' && task.assignedTechnicians) {
        task.assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech) tech.status = 'WORKING';
        });
      } else if (task.assignedTo) {
        const tech = users.find(u => u.name === task.assignedTo || u.employeeId === task.assignedTo || u.id === task.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
      }
    }

    // Notify requester
    const requester = users.find(u => u.employeeId === task.assignedBy);
    if (requester) {
      notifications.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        userId: requester.id,
        message: `Your request for task "${task.title}" has been APPROVED by ${user.name}`,
        read: false,
        timestamp: new Date().toISOString()
      });
    }

    recalculateAllPoints();
    await saveData();
    res.json(task);
  });

  app.post("/api/tasks/:id/reject", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { remarks } = req.body;

    if (!remarks) return res.status(400).json({ error: "Reject remarks are required" });

    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return res.status(404).json({ error: "Task not found" });
    const task = tasks[taskIndex];

    const targetTechnician = users.find(u => u.employeeId === task.assignedTo || u.name === task.assignedTo);
    const isTeamMemberSupervisor = task.workType === 'TEAM' && task.assignedTechnicians?.some((at: any) => {
      const tech = users.find(u => u.employeeId === at.employeeId);
      return tech && tech.supervisorId === user.id;
    });

    if ((!targetTechnician || targetTechnician.supervisorId !== user.id) && !isTeamMemberSupervisor) {
      return res.status(403).json({ error: "Only the technician's supervisor can reject this request" });
    }

    task.status = "REJECTED";
    task.requestStatus = "REJECTED";
    task.requestRemarks = remarks;
    task.logs.push({
      id: Date.now().toString(),
      action: `Request Rejected by Supervisor ${user.name}: ${remarks}`,
      timestamp: new Date().toISOString(),
      user: user.name
    });

    // Notify requester
    const requester = users.find(u => u.employeeId === task.assignedBy);
    if (requester) {
      notifications.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        userId: requester.id,
        message: `Your request for task "${task.title}" has been REJECTED by ${user.name}. Reason: ${remarks}`,
        read: false,
        timestamp: new Date().toISOString()
      });
    }

    recalculateAllPoints();
    await saveData();
    res.json(task);
  });

  app.post("/api/user/theme", authenticate, upload.single('background') as any, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { theme, customBackground, removeBg } = req.body;
    const userIndex = users.findIndex(u => u.id === user.id);
    if (userIndex === -1) return res.status(404).json({ error: "User not found" });

    if (theme) users[userIndex].theme = theme;
    
    if (req.file) {
      // If a file was uploaded, use its path
      users[userIndex].customBackground = `/uploads/${req.file.filename}`;
    } else if (customBackground) {
      users[userIndex].customBackground = customBackground;
    }

    if (removeBg) users[userIndex].customBackground = undefined;

    await saveData();
    res.json(users[userIndex]);
  });

  app.get("/api/attendance", authenticate, async (req: Request, res: Response) => {
    const today = new Date().toISOString().split('T')[0];
    const technicians = users.filter(u => u.role === 'TECHNICIAN');
    
    let updated = false;
    const todayRecords = technicians.map(tech => {
      const existingRecord = attendanceRecords.find(r => r.technicianId === tech.employeeId && r.date === today);
      if (existingRecord) {
        return existingRecord;
      } else {
        const newRecord = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          technicianId: tech.employeeId,
          status: 'PRESENT' as const,
          date: today
        };
        attendanceRecords.push(newRecord);
        updated = true;
        return newRecord;
      }
    });
    
    if (updated) {
      await saveData();
    }
    
    res.json(todayRecords);
  });

  app.post("/api/attendance", authenticate, async (req: Request, res: Response) => {
    const { technicianId, status } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const index = attendanceRecords.findIndex(r => r.technicianId === technicianId && r.date === today);
    if (index !== -1) {
      attendanceRecords[index].status = status;
    } else {
      attendanceRecords.push({ id: Date.now().toString(), technicianId, status: status as Attendance['status'], date: today });
    }

    // Update Technician Status based on attendance
    const tech = users.find(u => u.employeeId === technicianId);
    if (tech) {
      if (status === 'PRESENT') {
        const hasRunningTasks = tasks.some(t => 
          t.status === 'RUNNING' && 
          (t.assignedTo === technicianId || (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => at.employeeId === technicianId)))
        );
        tech.status = hasRunningTasks ? 'WORKING' : 'FREE';
      } else if (status === 'LEAVE' || status === 'ABSENT') {
        tech.status = 'ON_LEAVE';
      } else if (status === 'SHORT_LEAVE') {
        tech.status = 'SHORT_LEAVE';
      } else if (status === 'SHIFT_6_2' || status === 'SHIFT_2_6') {
        const now = new Date();
        const currentHour = now.getHours();
        let isWorkingShift = false;
        if (status === 'SHIFT_6_2') isWorkingShift = currentHour >= 6 && currentHour < 14;
        else if (status === 'SHIFT_2_6') isWorkingShift = currentHour >= 14 && currentHour < 18;
        
        if (isWorkingShift) {
          const hasRunningTasks = tasks.some(t => 
            t.status === 'RUNNING' && 
            (t.assignedTo === technicianId || (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => at.employeeId === technicianId)))
          );
          tech.status = hasRunningTasks ? 'WORKING' : 'FREE';
        } else {
          tech.status = 'SHIFT_OFF';
        }
      }
    }

    await saveData();
    res.json({ success: true });
  });

  app.put("/api/tasks/:id", authenticate, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
    const { id } = req.params;
    const index = tasks.findIndex(t => t.id === id);
    
    if (index === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    const oldTask = tasks[index];

    // Role-based authorization
    if (user.role === 'TECHNICIAN') {
      // Technicians can only update tasks assigned to them
      if (oldTask.assignedTo !== user.id && oldTask.assignedTo !== user.name && oldTask.assignedTo !== user.employeeId) {
        return res.status(403).json({ error: "Access Denied: You can only update tasks assigned to you." });
      }
      // Technicians can only update specific fields
      const allowedFields = ['status', 'progress', 'remarks', 'logs', 'startedAt', 'completedAt'];
      const updates = req.body;
      const requestedFields = Object.keys(updates);
      const isAllowed = requestedFields.every(field => allowedFields.includes(field));
      
      if (!isAllowed) {
        return res.status(403).json({ error: "Access Denied: Technicians can only update status, progress, remarks, logs, startedAt, and completedAt." });
      }
    } else if (user.role === 'ENGINEER') {
      // Strict Assignment Rule for Engineers on Update
      const assignedToName = req.body.assignedTo;
      if (assignedToName && assignedToName !== oldTask.assignedTo) {
        const targetUser = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);
        if (!targetUser || targetUser.role !== 'OFFICER') {
          return res.status(403).json({ error: "Access Denied: Engineers can only assign tasks to Officers." });
        }
        // Ensure the Engineer is authorized for this Officer
        if (!(targetUser.assignedEngineers || []).includes(user.employeeId)) {
          return res.status(403).json({ error: "Access Denied: You are not authorized to assign tasks to this Officer." });
        }
      }
      
      // Engineers shouldn't be able to update points or quality unless they created the task
      if (req.body.points !== undefined || req.body.quality !== undefined) {
        if (oldTask.createdBy !== user.employeeId && user.role !== 'SUPER_ADMIN' && user.role !== 'HOD') {
          return res.status(403).json({ error: "Access Denied: Only the creator or admin can update points and quality." });
        }
      }
    } else if (user.role === 'OFFICER') {
      // Officers can only assign tasks to Technicians
      const assignedToName = req.body.assignedTo;
      const isTeam = req.body.workType === 'TEAM' || oldTask.workType === 'TEAM';
      
      if (assignedToName && assignedToName !== oldTask.assignedTo && !isTeam) {
        const targetUser = users.find(u => 
          u.id === assignedToName || 
          u.name === assignedToName || 
          u.employeeId === assignedToName
        );
        if (!targetUser || targetUser.role !== 'TECHNICIAN') {
          return res.status(403).json({ error: "Access Denied: Officers can only assign tasks to Technicians." });
        }
      }

      // If it's a team task, validate assignedTechnicians if provided
      if (req.body.assignedTechnicians && Array.isArray(req.body.assignedTechnicians)) {
        for (const at of req.body.assignedTechnicians) {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (!tech || tech.role !== 'TECHNICIAN') {
            return res.status(403).json({ error: `Access Denied: ${at.name || 'Technician'} is not a valid technician.` });
          }
        }
      }
    }

    const updatedData = { ...req.body };

    // Mandatory remarks for every update (except when assigning a task or editing task details)
    if (!updatedData.remarks && user.role !== 'SUPER_ADMIN' && !updatedData.assignedTo && !updatedData.title && !updatedData.assignedTechnicians) {
      return res.status(400).json({ error: "Remarks are mandatory for every update" });
    }
      
    // Handle Team Work Assignment
    if (updatedData.workType === 'TEAM' && updatedData.assignedTechnicians) {
      // Check if any technician is not in my team
      const hasOtherTeamTech = updatedData.assignedTechnicians.some((at: any) => {
        const tech = users.find(u => u.employeeId === at.employeeId);
        return tech && tech.supervisorId !== user.id;
      });

      if (hasOtherTeamTech && user.role === 'OFFICER') {
        updatedData.status = 'REQUESTED';
        updatedData.requestStatus = 'PENDING';
      } else {
        updatedData.status = 'RUNNING';
        updatedData.startedAt = new Date().toISOString();
      }

      updatedData.assignedBy = user.employeeId;
      updatedData.assignedTechnicians = updatedData.assignedTechnicians.map((t: any) => ({
        ...t,
        progress: t.progress || 0,
        status: t.status || (updatedData.status === 'REQUESTED' ? 'PENDING' : 'RUNNING'),
        startedAt: t.startedAt || (updatedData.status === 'REQUESTED' ? undefined : new Date().toISOString())
      }));
      
      if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
      updatedData.logs.push({
        id: Date.now().toString(),
        action: updatedData.status === 'REQUESTED' ? `Team task requested (${updatedData.assignedTechnicians.length} technicians)` : `Task assigned to Team (${updatedData.assignedTechnicians.length} technicians) - Started`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      // Notify supervisors if requested
      if (updatedData.status === 'REQUESTED') {
        const supervisorsToNotify = new Set();
        updatedData.assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech && tech.supervisorId && tech.supervisorId !== user.id) {
            supervisorsToNotify.add(tech.supervisorId);
          }
        });
        supervisorsToNotify.forEach(supId => {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: supId,
            message: `Officer ${user.name} requested your technician for a team task: ${oldTask.title}`,
            read: false,
            timestamp: new Date().toISOString()
          });
        });
      }
    }

    // Auto-start system: If assigned to a technician, status becomes RUNNING
    if (updatedData.assignedTo && updatedData.assignedTo !== oldTask.assignedTo && updatedData.workType !== 'TEAM') {
      const assignedUser = users.find(u => u.id === updatedData.assignedTo || u.employeeId === updatedData.assignedTo || u.name === updatedData.assignedTo);
      if (assignedUser && assignedUser.role === 'TECHNICIAN') {
        // Check for cross-team
        if (user.role === 'OFFICER' && assignedUser.supervisorId !== user.id) {
          updatedData.status = 'REQUESTED';
          updatedData.requestStatus = 'PENDING';
        } else {
          updatedData.status = 'RUNNING';
          updatedData.startedAt = new Date().toISOString();
        }
        updatedData.assignedBy = user.employeeId; 
        if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
        updatedData.logs.push({
          id: Date.now().toString(),
          action: updatedData.status === 'REQUESTED' ? `Task requested for ${assignedUser.name}` : `Task assigned to ${assignedUser.name} - Started`,
          timestamp: new Date().toISOString(),
          user: user.name
        });

        // Notify supervisor if requested
        if (updatedData.status === 'REQUESTED' && assignedUser.supervisorId) {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: assignedUser.supervisorId,
            message: `Officer ${user.name} requested your technician ${assignedUser.name} for task: ${oldTask.title}`,
            read: false,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Handle Approval/Rejection
    // Handle Approval/Rejection (Strict Authorization)
    if (updatedData.requestStatus === 'APPROVED' && oldTask.requestStatus === 'PENDING') {
      // Only Supervisor can approve PENDING requests
      const targetTechnician = users.find(u => u.employeeId === oldTask.assignedTo || u.name === oldTask.assignedTo || u.id === oldTask.assignedTo);
      const isTeamMemberSupervisor = oldTask.workType === 'TEAM' && oldTask.assignedTechnicians?.some((at: any) => {
        const tech = users.find(u => u.employeeId === at.employeeId);
        return tech && tech.supervisorId === user.id;
      });

      if ((!targetTechnician || targetTechnician.supervisorId !== user.id) && !isTeamMemberSupervisor) {
        return res.status(403).json({ error: "Only the technician's supervisor can approve this request" });
      }

      const creator = users.find(u => u.employeeId === oldTask.createdBy);
      if (creator && creator.role === 'OFFICER') {
        updatedData.requestStatus = 'RECOMMENDED';
        updatedData.status = 'PENDING';
        
        if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
        updatedData.logs.push({
          id: Date.now().toString(),
          action: `Request Approved by Supervisor ${user.name} (Sent for Engineer Recommendation)`,
          timestamp: new Date().toISOString(),
          user: user.name
        });

        // Notify Engineer
        const assignedEngineers = creator.assignedEngineers || [];
        assignedEngineers.forEach(engId => {
          const eng = users.find(u => u.employeeId === engId || u.id === engId);
          if (eng) {
            notifications.push({
              id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
              userId: eng.id,
              message: `New task recommendation request from Officer ${creator.name} (Approved by Supervisor)`,
              read: false,
              timestamp: new Date().toISOString()
            });
          }
        });
      } else {
        updatedData.status = 'RUNNING';
        updatedData.requestStatus = 'APPROVED';
        updatedData.startedAt = new Date().toISOString();
        
        if (oldTask.workType === 'TEAM' && oldTask.assignedTechnicians) {
          updatedData.assignedTechnicians = oldTask.assignedTechnicians.map(at => ({
            ...at,
            status: 'RUNNING',
            startedAt: new Date().toISOString()
          }));
        }
        
        if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
        updatedData.logs.push({
          id: Date.now().toString(),
          action: `Request Approved by Supervisor ${user.name}`,
          timestamp: new Date().toISOString(),
          user: user.name
        });

        // Update Technician Status to WORKING
        if (oldTask.workType === 'TEAM' && oldTask.assignedTechnicians) {
          oldTask.assignedTechnicians.forEach((at: any) => {
            const tech = users.find(u => u.employeeId === at.employeeId);
            if (tech) tech.status = 'WORKING';
          });
        } else if (oldTask.assignedTo) {
          const tech = users.find(u => u.name === oldTask.assignedTo || u.employeeId === oldTask.assignedTo || u.id === oldTask.assignedTo);
          if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
        }
      }
    } else if (updatedData.requestStatus === 'REJECTED' && oldTask.requestStatus === 'PENDING') {
      // Only Supervisor can reject PENDING requests
      const targetTechnician = users.find(u => u.employeeId === oldTask.assignedTo || u.name === oldTask.assignedTo || u.id === oldTask.assignedTo);
      const isTeamMemberSupervisor = oldTask.workType === 'TEAM' && oldTask.assignedTechnicians?.some((at: any) => {
        const tech = users.find(u => u.employeeId === at.employeeId);
        return tech && tech.supervisorId === user.id;
      });

      if ((!targetTechnician || targetTechnician.supervisorId !== user.id) && !isTeamMemberSupervisor) {
        return res.status(403).json({ error: "Only the technician's supervisor can reject this request" });
      }

      updatedData.status = 'REJECTED';
      
      if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
      updatedData.logs.push({
        id: Date.now().toString(),
        action: `Request Rejected by Supervisor ${user.name}: ${updatedData.requestRemarks || 'No reason provided'}`,
        timestamp: new Date().toISOString(),
        user: user.name
      });
    } else if (updatedData.requestStatus === 'APPROVED' && oldTask.requestStatus === 'RECOMMENDED') {
      // Only Engineer can approve RECOMMENDED requests
      const creator = users.find(u => u.employeeId === oldTask.createdBy);
      const isMyOfficer = creator && creator.role === 'OFFICER' && (creator.assignedEngineers || []).includes(user.employeeId);
      
      if (user.role !== 'ENGINEER' || !isMyOfficer) {
        return res.status(403).json({ error: "Only the assigned Engineer can approve this recommendation" });
      }

      updatedData.status = 'RUNNING';
      updatedData.requestStatus = 'APPROVED';
      updatedData.startedAt = new Date().toISOString();
      updatedData.approvedBy = user.employeeId;

      if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
      updatedData.logs.push({
        id: Date.now().toString(),
        action: `Task Recommended & Approved by Engineer ${user.name}`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      // Update Technician Status to WORKING
      if (oldTask.workType === 'TEAM' && oldTask.assignedTechnicians) {
        oldTask.assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech) tech.status = 'WORKING';
        });
      } else if (oldTask.assignedTo) {
        const tech = users.find(u => u.name === oldTask.assignedTo || u.employeeId === oldTask.assignedTo || u.id === oldTask.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
      }
    }

    // Handle Team Progress Updates
    if (oldTask.workType === 'TEAM' && updatedData.assignedTechnicians) {
      const totalProgress = updatedData.assignedTechnicians.reduce((sum: number, t: any) => sum + (t.progress || 0), 0);
      updatedData.totalTeamProgress = Math.round(totalProgress / updatedData.assignedTechnicians.length);
      updatedData.progress = updatedData.totalTeamProgress;
      
      if (updatedData.assignedTechnicians.every((t: any) => t.status === 'COMPLETED')) {
        updatedData.status = 'COMPLETED';
        updatedData.completedAt = new Date().toISOString();
        
        // Update Technician Status to FREE if no other running tasks
        updatedData.assignedTechnicians.forEach((at: any) => {
          const techId = at.employeeId;
          const hasOtherRunningTasks = tasks.some(t => 
            t.id !== oldTask.id && 
            t.status === 'RUNNING' && 
            (t.assignedTo === techId || (t.assignedTechnicians && t.assignedTechnicians.some((at2: any) => at2.employeeId === techId)))
          );
          if (!hasOtherRunningTasks) {
            const tech = users.find(u => u.employeeId === techId);
            if (tech) tech.status = 'FREE';
          }
        });
      }
    }

    // Handle Completion Logic
    if (updatedData.status === 'COMPLETED' && oldTask.status !== 'COMPLETED') {
      updatedData.progress = 100;
      const completedAt = updatedData.actualCompletionTime || new Date().toISOString();
      updatedData.completedAt = completedAt;

      // Update Technician Status to FREE if no other running tasks
      if (oldTask.workType !== 'TEAM' && oldTask.assignedTo) {
        const tech = users.find(u => u.id === oldTask.assignedTo || u.name === oldTask.assignedTo || u.employeeId === oldTask.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') {
          const techId = tech.employeeId;
          const hasOtherRunningTasks = tasks.some(t => 
            t.id !== oldTask.id && 
            t.status === 'RUNNING' && 
            (t.assignedTo === techId || (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => at.employeeId === techId)))
          );
          if (!hasOtherRunningTasks) {
            tech.status = 'FREE';
          }
        }
      }

      // Point System: Add points if COMPLETED + APPROVED
      const creator = users.find(u => u.employeeId === oldTask.createdBy);
      const isOfficerTask = creator?.role === 'OFFICER';
      const isEngineerTask = creator?.role === 'ENGINEER';
      const isApproved = updatedData.requestStatus === 'APPROVED' || oldTask.requestStatus === 'APPROVED' || (!oldTask.requestStatus && oldTask.status === 'RUNNING');

      // Point System: Add points if COMPLETED + APPROVED

      if (!oldTask.pointAdded && (isEngineerTask || (isOfficerTask && isApproved))) {
        const officer = users.find(u => u.employeeId === oldTask.assignedBy) || users.find(u => u.employeeId === oldTask.createdBy);
        if (officer && officer.role === 'OFFICER') {
          pointTransactions.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            taskId: oldTask.id,
            officerId: officer.id,
            engineerId: oldTask.approvedBy || oldTask.createdBy || '',
            pointValue: updatedData.points || oldTask.points || 1,
            taskPriority: oldTask.urgency,
            completedAt: updatedData.completedAt
          });
          updatedData.pointAdded = true;
        }
      }
      
      // Calculate Task Taken Time
      const start = new Date(oldTask.customStartTime || oldTask.startedAt || oldTask.createdAt);
      const end = new Date(completedAt);
      const diffMs = end.getTime() - start.getTime();
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      updatedData.taskTakenTime = `${diffHrs}h ${diffMins}m`;

      // Calculate Remaining and Over Time relative to Estimated Duration
      const parseDuration = (dur: string) => {
        if (!dur) return 60;
        if (/^\d+$/.test(dur)) return parseInt(dur);
        let mins = 0;
        const hMatch = dur.match(/(\d+)h/);
        const mMatch = dur.match(/(\d+)m/);
        if (hMatch) mins += parseInt(hMatch[1]) * 60;
        if (mMatch) mins += parseInt(mMatch[1]);
        return mins || 60;
      };

      const estimatedMinutes = parseDuration(oldTask.estimatedDuration);
      const actualMinutes = Math.floor(diffMs / (1000 * 60));
      const timeDiffMins = estimatedMinutes - actualMinutes;
      const absDiffMins = Math.abs(timeDiffMins);
      const dHrs = Math.floor(absDiffMins / 60);
      const dMins = absDiffMins % 60;
      const formattedDiff = `${dHrs}h ${dMins}m`;

      if (timeDiffMins >= 0) {
        updatedData.remainingTime = formattedDiff;
        updatedData.overTime = "0h 0m";
      } else {
        updatedData.remainingTime = "0h 0m";
        updatedData.overTime = formattedDiff;
      }

      // 2. Technician Performance & Status Update
      const techniciansToUpdate = [];
      if (oldTask.workType === 'TEAM' && oldTask.assignedTechnicians) {
        techniciansToUpdate.push(...oldTask.assignedTechnicians.map(at => at.employeeId));
      } else if (oldTask.assignedTo) {
        const tech = users.find(u => u.id === oldTask.assignedTo || u.employeeId === oldTask.assignedTo || u.name === oldTask.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') {
          techniciansToUpdate.push(tech.employeeId);
        }
      }

      for (const techId of techniciansToUpdate) {
        const deadline = new Date(oldTask.deadline);
        const remainingMs = deadline.getTime() - end.getTime();
        const remainingMinutes = Math.floor(remainingMs / (1000 * 60));
        
        const efficiency = actualMinutes > 0 ? (estimatedMinutes / actualMinutes) * 100 : 100;
        
        let completionSpeedScore = 10;
        if (efficiency > 120) completionSpeedScore = 15;
        else if (efficiency < 80) completionSpeedScore = 5;

        technicianPerformance.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          technicianId: techId,
          taskId: oldTask.id,
          date: completedAt.split('T')[0],
          totalWorkMinutes: actualMinutes,
          estimatedMinutes: estimatedMinutes,
          remainingMinutes,
          completionSpeedScore,
          attendanceScore: 10,
          efficiencyScore: Math.min(Math.round(efficiency / 2), 50), // Max 50 points for efficiency
          finalDailyScore: Math.min(Math.round(efficiency / 2) + 10 + completionSpeedScore, 100)
        });

        // Update technician status to FREE if no other running tasks
        const runningTasks = tasks.filter(t => 
          t.id !== oldTask.id && 
          t.status === 'RUNNING' && 
          (t.assignedTo === techId || (t.assignedTechnicians && t.assignedTechnicians.some(at => at.employeeId === techId)))
        );
        if (runningTasks.length === 0) {
          const techUser = users.find(u => u.employeeId === techId);
          if (techUser) techUser.status = 'FREE';
        }
      }
    } else if (updatedData.status === 'COMPLETED' && oldTask.status !== 'COMPLETED') {
      // Handle case where status is set to COMPLETED directly
      updatedData.progress = 100;
      // Recurse or handle similarly to above (simplified for now)
      updatedData.completedAt = new Date().toISOString();
    }

      // Handle HOLD status
      if (updatedData.status === 'HOLD') {
        updatedData.progress = 0; // No progress shown during HOLD
        if (!updatedData.remarks) {
          return res.status(400).json({ error: "Remarks are required for Temporary Hold" });
        }
      }

      // If status changes from HOLD back to RUNNING or a percentage is set
      if (oldTask.status === 'HOLD' && (updatedData.status === 'RUNNING' || (updatedData.progress > 0 && updatedData.status !== 'HOLD'))) {
        updatedData.status = 'RUNNING';
        updatedData.startedAt = new Date().toISOString();
      }

      // Ensure logs are appended if not already handled by the logic above or the request body
      if (!updatedData.logs) {
        updatedData.logs = [
          ...(oldTask.logs || []),
          {
            id: Date.now().toString(),
            action: `Task updated by ${user.name}`,
            timestamp: new Date().toISOString(),
            user: user.name
          }
        ];
      }

      tasks[index] = { ...oldTask, ...updatedData };
      recalculateAllPoints();
      rebuildTechnicianStatuses(); // Ensure statuses are consistent after update
      await saveData();
      res.json(tasks[index]);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.put("/api/users/theme", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { theme, customBackground } = req.body;
    const userIndex = users.findIndex(u => u.employeeId === user.employeeId);
    if (userIndex !== -1) {
      users[userIndex].theme = theme;
      users[userIndex].customBackground = customBackground;
      await saveData();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  app.delete("/api/tasks/:id", authenticate, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;
      const cleanId = String(id || '').trim();
      console.log(`Delete task request for ID: "${cleanId}" from user: ${user.name} (${user.role})`);
      
      const index = tasks.findIndex(t => 
        String(t.id).trim() === cleanId || 
        String(t.taskId).trim() === cleanId ||
        (t.id && cleanId && String(t.id) == cleanId) ||
        (t.taskId && cleanId && String(t.taskId) == cleanId)
      );
      if (index === -1) {
        console.warn(`Task "${cleanId}" not found for deletion. Available task IDs: ${tasks.map(t => `${t.id}/${t.taskId}`).join(', ')}`);
        return res.status(404).json({ error: "Task not found" });
      }

      const task = tasks[index];
      const isSuperAdmin = user.role === 'SUPER_ADMIN';
      const isHod = user.role === 'HOD';
      const isCreator = task.createdBy === user.employeeId || 
                        task.createdBy === user.id || 
                        task.createdBy === user.name ||
                        task.assignedBy === user.employeeId;

      if (!isSuperAdmin && !isHod && !isCreator) {
        console.warn(`Unauthorized delete attempt by user: ${user.name}`);
        return res.status(403).json({ error: "Access Denied: You are not authorized to delete this task" });
      }

      tasks.splice(index, 1);

      // Clean up point transactions associated with this task
      for (let i = pointTransactions.length - 1; i >= 0; i--) {
        const pt = pointTransactions[i];
        if (
          pt.taskId === task.id || 
          pt.taskId === task.taskId ||
          String(pt.taskId).trim() === String(task.id).trim() ||
          String(pt.taskId).trim() === String(task.taskId).trim()
        ) {
          pointTransactions.splice(i, 1);
        }
      }

      recalculateAllPoints();
      rebuildTechnicianStatuses();

      await logAdminAction(user, 'TASK_DELETED', `Deleted task ${task.title} (${task.taskId || task.id})`, undefined, task.id);
      await saveData();
      console.log(`Task ${cleanId} deleted successfully. Remaining tasks in memory: ${tasks.length}`);
      res.json({ success: true, message: "Task deleted successfully", taskId: task.id });
    } catch (err: any) {
      console.error("Error deleting task:", err);
      res.status(500).json({ error: err.message || "Failed to delete task" });
    }
  });

  app.post("/api/ai/insights", optionalAuth, async (req: Request, res: Response) => {
    try {
      const incomingTasks: any[] = Array.isArray(req.body?.tasks) && req.body.tasks.length > 0 
        ? req.body.tasks 
        : tasks;

      const criticalTasks = incomingTasks.filter((t: any) => t.urgency === 'CRITICAL' && t.status !== 'COMPLETED');
      const urgentTasks = incomingTasks.filter((t: any) => t.urgency === 'URGENT' && t.status !== 'COMPLETED');
      const runningTasks = incomingTasks.filter((t: any) => t.status === 'RUNNING');
      const pendingTasks = incomingTasks.filter((t: any) => t.status === 'PENDING');
      const completedTasks = incomingTasks.filter((t: any) => t.status === 'COMPLETED');

      const todayStr = new Date().toISOString().split('T')[0];
      const overdueTasks = incomingTasks.filter((t: any) => t.status !== 'COMPLETED' && t.deadline && t.deadline < todayStr);

      let heuristicUrgency: 'REGULAR' | 'URGENT' | 'CRITICAL' = 'REGULAR';
      let heuristicReason = 'Tasks are progressing steadily with balanced distribution across teams.';
      let delayProbability = 12;

      if (criticalTasks.length > 0 || overdueTasks.length > 0) {
        heuristicUrgency = 'CRITICAL';
        heuristicReason = `${criticalTasks.length > 0 ? `${criticalTasks.length} critical task(s) active.` : ''} ${overdueTasks.length > 0 ? `${overdueTasks.length} task(s) overdue.` : ''} Immediate intervention recommended.`.trim();
        delayProbability = Math.min(88, 45 + (criticalTasks.length * 15) + (overdueTasks.length * 10));
      } else if (urgentTasks.length > 0 || (pendingTasks.length > runningTasks.length * 2 && pendingTasks.length > 3)) {
        heuristicUrgency = 'URGENT';
        heuristicReason = `${urgentTasks.length} urgent task(s) in queue. Prioritize dispatch to maintain scheduled turnaround.`;
        delayProbability = Math.min(65, 25 + (urgentTasks.length * 10));
      } else if (completedTasks.length > 0 && pendingTasks.length === 0 && runningTasks.length === 0) {
        heuristicUrgency = 'REGULAR';
        heuristicReason = 'All assigned tasks for today have been completed or are on schedule.';
        delayProbability = 5;
      }

      const heuristicTip = criticalTasks.length > 0 
        ? "Reassign secondary duties to focus senior technicians on critical repairs."
        : urgentTasks.length > 0
        ? "Pair technicians on complex urgent tasks to accelerate turnaround time."
        : "Workload distribution is balanced. Maintain current workflow pace.";

      const fallbackResult = {
        urgency: heuristicUrgency,
        reason: heuristicReason,
        delayPrediction: {
          isLikelyDelayed: delayProbability > 40,
          probability: delayProbability
        },
        efficiencyTip: heuristicTip
      };

      // Try Gemini API if key is available
      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = getGenAI();
          if (ai) {
            const sampleTasks = incomingTasks.slice(0, 15).map((t: any) => ({
              title: t.title,
              urgency: t.urgency,
              status: t.status,
              deadline: t.deadline
            }));

            const prompt = `Analyze these daily maintenance tasks and output a concise JSON assessment:
Tasks: ${JSON.stringify(sampleTasks)}
Output JSON format:
{
  "urgency": "REGULAR" | "URGENT" | "CRITICAL",
  "reason": "concise 1-sentence assessment",
  "delayPrediction": {
    "isLikelyDelayed": boolean,
    "probability": number between 0 and 100
  },
  "efficiencyTip": "actionable 1-sentence recommendation"
}`;

            const responsePromise = ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: prompt,
              config: {
                responseMimeType: "application/json",
              }
            });

            // 4-second timeout to prevent any slow responses
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error("AI timeout")), 4000)
            );

            const result: any = await Promise.race([responsePromise, timeoutPromise]);
            if (result && result.text) {
              const parsed = JSON.parse(result.text);
              if (parsed.urgency && parsed.reason) {
                return res.json({
                  urgency: parsed.urgency,
                  reason: parsed.reason,
                  delayPrediction: parsed.delayPrediction || fallbackResult.delayPrediction,
                  efficiencyTip: parsed.efficiencyTip || fallbackResult.efficiencyTip
                });
              }
            }
          }
        } catch (aiErr: any) {
          // Gemini temporary 503/429/timeout handled silently with smart fallback
          console.warn("AI Insights served via fallback:", aiErr?.status || aiErr?.message || "unavailable");
        }
      }

      return res.json(fallbackResult);
    } catch (err: any) {
      console.error("AI Insights route error:", err);
      res.json({
        urgency: "REGULAR",
        reason: "Tasks are proceeding normally. Work distribution is optimal.",
        delayPrediction: { isLikelyDelayed: false, probability: 10 },
        efficiencyTip: "Keep monitoring task progress throughout the shift."
      });
    }
  });

  app.get("/api/backup/:role/:type", authenticate, async (req: Request, res: Response) => {
    const { role, type } = req.params;
    const { format } = req.query;

    if (req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden: Role mismatch" });
    }

    // Define scope based on role
    const myScope = {
      id: req.user.id,
      employeeId: req.user.employeeId,
      role: req.user.role,
      assignedEngineers: req.user.assignedEngineers || []
    };

    const isTaskInScope = (task: any) => {
      if (myScope.role === 'SUPER_ADMIN' || myScope.role === 'HOD') return true;
      if (myScope.role === 'IN_CHARGE' || myScope.role === 'MODEL_MANAGER') {
        // Created by them or assigned to someone they manage
        return task.createdBy === myScope.employeeId || myScope.assignedEngineers.includes(task.assignedToEmployeeId);
      }
      if (myScope.role === 'ENGINEER') {
        // Assigned to them or created by them
        return task.assignedTo === req.user.name || task.createdBy === myScope.employeeId;
      }
      if (myScope.role === 'OFFICER') {
        // Assigned to them or created by them
        return task.assignedTo === req.user.name || task.createdBy === myScope.employeeId;
      }
      return false;
    };

    const scopedTasks = tasks.filter(isTaskInScope);
    let backupData: any = {
      role: myScope.role,
      type,
      timestamp: new Date().toISOString(),
      tasks: scopedTasks
    };

    if (type === 'full') {
      // Include users in scope
      const scopedUsers = users.filter((u: any) => {
        if (myScope.role === 'SUPER_ADMIN' || myScope.role === 'HOD') return true;
        if (myScope.role === 'IN_CHARGE' || myScope.role === 'MODEL_MANAGER') {
          return myScope.assignedEngineers.includes(u.employeeId) || u.supervisorId === myScope.id;
        }
        if (myScope.role === 'ENGINEER') {
          return u.supervisorId === myScope.id || (u.assignedEngineers || []).includes(myScope.employeeId);
        }
        return u.id === myScope.id;
      });

      backupData.users = scopedUsers;
      backupData.mapping = users.filter((u: any) => u.assignedEngineers && u.assignedEngineers.length > 0).map((u: any) => ({
        employeeId: u.employeeId,
        assignedEngineers: u.assignedEngineers
      }));
      // Performance data (simplified)
      backupData.performance = scopedTasks.map(t => ({
        taskId: t.taskId,
        points: t.points,
        status: t.status,
        completedAt: t.completedAt
      }));
    }

    if (format === 'excel') {
      const wb = XLSX.utils.book_new();
      const wsTasks = XLSX.utils.json_to_sheet(scopedTasks);
      XLSX.utils.book_append_sheet(wb, wsTasks, "Tasks");
      
      if (type === 'full') {
        const wsUsers = XLSX.utils.json_to_sheet(backupData.users);
        XLSX.utils.book_append_sheet(wb, wsUsers, "Users");
        const wsMapping = XLSX.utils.json_to_sheet(backupData.mapping);
        XLSX.utils.book_append_sheet(wb, wsMapping, "Mapping");
        const wsPerformance = XLSX.utils.json_to_sheet(backupData.performance);
        XLSX.utils.book_append_sheet(wb, wsPerformance, "Performance");
      }

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename=backup_${role.toLowerCase()}_${type}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    res.json(backupData);
  });

  app.post("/api/restore/:role", authenticate, upload.single('backup') as any, async (req: Request, res: Response) => {
    const { role } = req.params;
    if (req.user.role !== role) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: "Forbidden: Role mismatch" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No backup file uploaded" });
    }

    try {
      let restoredData: any;
      if (req.file.originalname.endsWith('.json')) {
        const content = await fs.readFile(req.file.path, 'utf-8');
        restoredData = JSON.parse(content);
      } else if (req.file.originalname.endsWith('.xlsx')) {
        const workbook = XLSX.readFile(req.file.path);
        const tasksSheet = workbook.Sheets['Tasks'];
        const usersSheet = workbook.Sheets['Users'];

        restoredData = {
          tasks: tasksSheet ? XLSX.utils.sheet_to_json(tasksSheet) : [],
          users: usersSheet ? XLSX.utils.sheet_to_json(usersSheet) : []
        };
      } else {
        await fs.unlink(req.file.path);
        return res.status(400).json({ error: "Unsupported file format" });
      }

      // Validation and scoped restore logic
      if (restoredData.role && restoredData.role !== role) {
        await fs.unlink(req.file.path);
        return res.status(400).json({ error: "Backup file role mismatch" });
      }

      // Get current user's scope
      const myScope = {
        id: req.user.id,
        employeeId: req.user.employeeId,
        role: req.user.role,
        assignedEngineers: req.user.assignedEngineers || []
      };

      const isTaskInScope = (task: any) => {
        if (myScope.role === 'SUPER_ADMIN' || myScope.role === 'HOD') return true;
        if (myScope.role === 'IN_CHARGE' || myScope.role === 'MODEL_MANAGER') {
          return task.createdBy === myScope.employeeId || myScope.assignedEngineers.includes(task.assignedToEmployeeId);
        }
        if (myScope.role === 'ENGINEER') {
          return task.assignedTo === req.user.name || task.createdBy === myScope.employeeId;
        }
        if (myScope.role === 'OFFICER') {
          return task.assignedTo === req.user.name || task.createdBy === myScope.employeeId;
        }
        return false;
      };

      // Restore tasks
      if (Array.isArray(restoredData.tasks)) {
        restoredData.tasks.forEach((restoredTask: any) => {
          if (isTaskInScope(restoredTask)) {
            const index = tasks.findIndex(t => t.id === restoredTask.id);
            if (index !== -1) {
              tasks[index] = { ...tasks[index], ...restoredTask };
            } else {
              tasks.push(restoredTask);
            }
          }
        });
      }

      // Restore users (only for SUPER_ADMIN/HOD)
      if ((myScope.role === 'SUPER_ADMIN' || myScope.role === 'HOD') && Array.isArray(restoredData.users)) {
        restoredData.users.forEach((restoredUser: any) => {
          const index = users.findIndex(u => u.employeeId === restoredUser.employeeId);
          if (index !== -1) {
            users[index] = { ...users[index], ...restoredUser };
          } else {
            users.push(restoredUser);
          }
        });
      }

      await saveData();
      await fs.unlink(req.file.path); // Clean up uploaded file
      res.json({ message: "Data restored successfully within your scope" });
    } catch (err) {
      console.error("Restore error:", err);
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: "Failed to restore data" });
    }
  });

  app.post("/api/admin/adjust-points", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Only Super Admin can adjust points" });
    }

    const { officerId, newPoints, actionType, reason } = req.body;
    const officer = users.find(u => u.id === officerId);
    if (!officer || officer.role !== 'OFFICER') {
      return res.status(404).json({ error: "Officer not found" });
    }

    // Calculate current points from all sources
    const currentPoints = pointTransactions
      .filter(pt => pt.officerId === officerId)
      .reduce((sum, pt) => sum + pt.pointValue, 0);

    if (actionType === 'EDIT') {
      // Direct set: Calculate adjustment needed to reach newPoints
      const adjustment = (Number(newPoints) || 0) - currentPoints;
      
      if (adjustment !== 0) {
        pointTransactions.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          taskId: 'MANUAL_ADJUSTMENT',
          officerId: officerId,
          engineerId: user.employeeId,
          pointValue: adjustment,
          taskPriority: 'REGULAR',
          completedAt: new Date().toISOString()
        });
      }
    } else if (actionType === 'RESET' || actionType === 'DELETE') {
      // Full Reset: Remove all point transactions for this officer
      for (let i = pointTransactions.length - 1; i >= 0; i--) {
        if (pointTransactions[i].officerId === officerId) {
          pointTransactions.splice(i, 1);
        }
      }
      
      // Also mark tasks as not having points added if they were linked
      tasks.forEach(t => {
        const isOfficerTask = (t.createdBy === officer.employeeId || t.assignedBy === officer.employeeId);
        if (isOfficerTask) {
          t.pointAdded = false;
        }
      });
    }

      await logAdminAction(user, `POINT_${actionType}`, `Admin ${user.name} ${actionType === 'EDIT' ? 'edited' : 'reset'} points for ${officer.name}. Reason: ${reason || 'Manual Override'}`, officer.id);
      
      // Force recalculation before saving and returning
      recalculateAllPoints();
      await saveData();
      
      res.json({ success: true, newPoints: officer.total_point });
  });

  app.post("/api/admin/sync-data", authenticate, async (req: Request, res: Response) => {
    try {
      console.log("SYNC STARTED");
      const user = (req as any).user;
      if (user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: "Only Super Admin can synchronize data" });
      }
      
      // ✅ STEP 1: RESET
      users.forEach((u: any) => {
        if (u.role === 'OFFICER') u.total_point = 0;
        if (u.role === 'TECHNICIAN') u.completedTask = 0;
      });
      console.log("RESET DONE");

      // ✅ STEP 1.5: AUTO-FIX MISSING ASSIGNEDBY
      let fixedCount = 0;
      tasks.forEach((t: any) => {
        if (!t.assignedBy && t.createdBy) {
          t.assignedBy = t.createdBy;
          fixedCount++;
        }
      });
      if (fixedCount > 0) console.log(`AUTO-FIXED ${fixedCount} tasks with missing assignedBy`);

      // ✅ STEP 2 & 3: RECALCULATE
      recalculateAllPoints();
      console.log("OFFICER & TECHNICIAN SYNC DONE");

      await saveData();
      console.log("SAVE DONE");
      
      return res.json({ 
        success: true, 
        message: "REAL DATA SYNC COMPLETED" 
      });
    } catch (error: any) {
      console.error("SYNC ERROR:", error);
      return res.status(500).json({ 
        success: false, 
        message: "SYNC FAILED", 
        error: error.message 
      });
    }
  });

  app.delete("/api/admin/tasks/:id", authenticate, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (user.role !== 'SUPER_ADMIN' && user.role !== 'HOD') {
        return res.status(403).json({ error: "Only Super Admin can delete tasks" });
      }
      const { id } = req.params;
      const cleanId = String(id || '').trim();
      console.log(`[ADMIN DELETE] Delete task request for ID: "${cleanId}" from user: ${user.name} (${user.role})`);
      
      const taskIndex = tasks.findIndex(t => 
        String(t.id).trim() === cleanId || 
        String(t.taskId).trim() === cleanId ||
        (t.id && cleanId && String(t.id) == cleanId) ||
        (t.taskId && cleanId && String(t.taskId) == cleanId)
      );
      if (taskIndex === -1) {
        console.warn(`[ADMIN DELETE] Task "${cleanId}" not found for deletion. Available task IDs: ${tasks.map(t => `${t.id}/${t.taskId}`).join(', ')}`);
        return res.status(404).json({ error: "Task not found" });
      }
      
      const task = tasks[taskIndex];
      tasks.splice(taskIndex, 1);

      // Clean up point transactions associated with this task
      for (let i = pointTransactions.length - 1; i >= 0; i--) {
        const pt = pointTransactions[i];
        if (
          pt.taskId === task.id || 
          pt.taskId === task.taskId ||
          String(pt.taskId).trim() === String(task.id).trim() ||
          String(pt.taskId).trim() === String(task.taskId).trim()
        ) {
          pointTransactions.splice(i, 1);
        }
      }

      recalculateAllPoints();
      rebuildTechnicianStatuses();
      
      await logAdminAction(user, 'TASK_DELETED', `Deleted task ${task.title} (${task.taskId || task.id})`, undefined, task.id);
      await saveData();
      console.log(`[ADMIN DELETE] Task ${cleanId} (${task.title}) successfully deleted. Remaining tasks in memory: ${tasks.length}`);
      res.json({ success: true, message: "Task deleted successfully", taskId: task.id });
    } catch (err: any) {
      console.error("Error in admin delete task:", err);
      res.status(500).json({ error: err.message || "Failed to delete task" });
    }
  });

  app.put("/api/admin/tasks/:id/points", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Only Super Admin can edit task points" });
    }
    const { id } = req.params;
    const { newPoints } = req.body;

    if (newPoints < 0 || newPoints > 3) {
      return res.status(400).json({ error: "Points must be between 0 and 3" });
    }

    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    
    const oldPoints = task.points || 0;
    task.points = newPoints;
    
    // Update point transaction if it exists
    const pt = pointTransactions.find(pt => pt.taskId === id);
    if (pt) {
      pt.pointValue = newPoints;
    }
    
    await logAdminAction(user, 'TASK_POINT_EDITED', `Updated points for task ${task.title} from ${oldPoints} to ${newPoints}`, undefined, id);
    await saveData();
    res.json({ success: true });
  });

  // --- API 404 Handler ---
  app.all("/api/*", (req, res) => {
    console.warn(`404 API Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: `API endpoint ${req.method} ${req.originalUrl} not found` });
  });

  // --- Global Error Handler ---
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      path: req.originalUrl
    });
  });

  // --- Vite Integration ---
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  if (process.env.NODE_ENV !== "production") {
    console.log("Starting Vite in development mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in production mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  // --- Global Error Handler ---
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled Error:", err);
    res.status(500).json({ error: "Internal Server Error", message: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
    
    // Run initial recalculation and status rebuild after server is up
    setTimeout(async () => {
      console.log("Running initial data synchronization...");
      recalculateAllPoints();
      rebuildTechnicianStatuses();
      await saveData();
      console.log("Initial data synchronization completed.");
    }, 1000);
  });

  process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  });

  // --- Session Cleanup Task ---
  // Runs every hour to clean up old inactive sessions
  setInterval(async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let changed = false;

    userSessions.forEach(s => {
      if (s.active) {
        const lastActivity = new Date(s.lastActivity);
        if (lastActivity < sevenDaysAgo) {
          s.active = false;
          s.logoutTime = now.toISOString();
          changed = true;
          
          const log = activityLogs.find(l => l.id === s.id);
          if (log) {
            log.logoutTime = s.logoutTime;
            log.sessionDuration = "Timeout (7 days inactivity)";
          }
        }
      }
    });

    // Also remove very old inactive sessions (e.g. older than 30 days) to keep data.json small
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const initialCount = userSessions.length;
    const filteredSessions = userSessions.filter(s => {
      if (s.active) return true;
      const loginTime = new Date(s.loginTime);
      return loginTime > thirtyDaysAgo;
    });

    if (filteredSessions.length !== initialCount) {
      userSessions.length = 0;
      for (const session of filteredSessions) {
        userSessions.push(session);
      }
      changed = true;
    }

    if (changed) {
      console.log(`Cleaned up sessions. Active sessions: ${userSessions.filter(s => s.active).length}`);
      await saveData();
    }
  }, 3600000); // Every hour

  // --- Periodic Auto-Save ---
  // Save data every 5 minutes to persist in-memory changes (like lastActivity)
  setInterval(async () => {
    console.log('Periodic auto-save...');
    await saveData();
  }, 300000); // Every 5 minutes

  // --- Start Hourly Auto-Backup Engine ---
  startAutoBackupSchedule();
}

startServer().catch(err => {
  console.error("CRITICAL: Server failed to start:", err);
  process.exit(1);
});
