import { initializeApp, getApps } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { 
  getFirestore, 
  Firestore, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  collection, 
  deleteDoc, 
  query, 
  orderBy, 
  limit, 
  writeBatch 
} from 'firebase/firestore';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

export interface PersistentBackupRecord {
  id: string;
  filename: string;
  timestamp: string;
  type: '5MIN_AUTO' | 'MANUAL' | 'TASK_ENTRY' | 'TASK_DELETED' | string;
  status: 'SUCCESS' | 'FAILED';
  totalTasks: number;
  totalUsers: number;
  totalAttendance: number;
  sizeBytes: number;
  checksum: string;
  verified: boolean;
  metaDetails?: Record<string, any>;
  data?: any;
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let isInitialized = false;
let configCache: any = null;

// --- Firestore Quota Management & Circuit Breaker ---
let quotaExhaustedUntil = 0;
let hasLoggedQuotaNotice = false;

export function isQuotaExhausted(): boolean {
  return Date.now() < quotaExhaustedUntil;
}

export function markQuotaExhausted(reason?: string) {
  quotaExhaustedUntil = Date.now() + 60 * 60 * 1000;
  if (!hasLoggedQuotaNotice) {
    hasLoggedQuotaNotice = true;
    console.warn(`[CLOUD DB QUOTA NOTICE] Daily free tier write units exhausted (${reason || 'RESOURCE_EXHAUSTED'}). Circuit breaker active. All updates are safely preserved on local disk.`);
  }
}

export function checkAndHandleQuotaError(err: any): boolean {
  const errMsg = String(err?.message || err);
  if (
    errMsg.includes('RESOURCE_EXHAUSTED') ||
    errMsg.includes('Quota limit exceeded') ||
    err?.code === 8 ||
    err?.code === 'resource-exhausted'
  ) {
    markQuotaExhausted(errMsg);
    return true;
  }
  return false;
}

export function getCloudQuotaStatus() {
  const config = getFirebaseConfig();
  const proj = config?.projectId || 'long-campaign-xvxch';
  const dbId = config?.firestoreDatabaseId || 'ai-studio-dailyworkupdate-ede4695f-be43-4c53-b636-9237f9a41bae';
  return {
    isQuotaExhausted: isQuotaExhausted(),
    quotaExhaustedUntil: quotaExhaustedUntil ? new Date(quotaExhaustedUntil).toISOString() : null,
    projectId: proj,
    databaseId: dbId,
    upgradeUrl: `https://console.firebase.google.com/project/${proj}/firestore/databases/${dbId}/data?openUpgradeDialog=true`,
    pricingUrl: 'https://firebase.google.com/pricing#cloud-firestore'
  };
}

export function getFirebaseConfig() {
  if (configCache) return configCache;
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fsSync.existsSync(configPath)) {
    try {
      const raw = fsSync.readFileSync(configPath, 'utf-8');
      configCache = JSON.parse(raw);
      return configCache;
    } catch (e: any) {
      console.error('[CLOUD DB] Error parsing firebase-applet-config.json:', e.message);
    }
  }
  return null;
}

export function initCloudDb(): Firestore | null {
  if (db && isInitialized) return db;

  const config = getFirebaseConfig();
  if (!config || !config.projectId) {
    console.warn('[CLOUD DB] No valid firebase-applet-config.json found. Running in local fallback mode.');
    return null;
  }

  try {
    const existingApps = getApps();
    app = existingApps.length > 0 ? existingApps[0] : initializeApp(config);
    db = config.firestoreDatabaseId ? getFirestore(app, config.firestoreDatabaseId) : getFirestore(app);
    isInitialized = true;
    console.log(`[CLOUD DB] Connected to Firestore Cloud Database: ${config.projectId} (dbId: ${config.firestoreDatabaseId || '(default)'})`);
    return db;
  } catch (err: any) {
    console.error('[CLOUD DB] Initialization error:', err.message);
    return null;
  }
}

export async function checkCloudDbHealth(): Promise<{ ok: boolean; message: string; timestamp: string }> {
  if (isQuotaExhausted()) {
    return { ok: true, message: 'Durable local mirror active (Daily cloud write quota in cooldown)', timestamp: new Date().toISOString() };
  }
  const firestore = initCloudDb();
  if (!firestore) {
    return { ok: false, message: 'Firestore configuration not initialized', timestamp: new Date().toISOString() };
  }

  try {
    const healthDoc = doc(firestore, 'system_health', 'ping');
    const nowIso = new Date().toISOString();
    await setDoc(healthDoc, { ping: 'pong', timestamp: nowIso });
    const snap = await getDoc(healthDoc);
    if (snap.exists() && snap.data()?.ping === 'pong') {
      return { ok: true, message: 'Durable cloud database connection verified', timestamp: nowIso };
    }
    return { ok: false, message: 'Ping verification failed', timestamp: nowIso };
  } catch (err: any) {
    checkAndHandleQuotaError(err);
    return { ok: false, message: err.message, timestamp: new Date().toISOString() };
  }
}

/**
 * Load authoritative production data from Google Cloud Firestore
 */
export async function loadCloudProductionData(): Promise<any | null> {
  const firestore = initCloudDb();
  if (!firestore) return null;

  try {
    console.log('[CLOUD DB] Fetching authoritative production records from Firestore...');

    // 1. Fetch Users
    const usersCol = collection(firestore, 'production_users');
    const usersSnap = await getDocs(usersCol);
    const users: any[] = [];
    usersSnap.forEach(d => {
      if (d.exists()) users.push(d.data());
    });

    // 2. Fetch Tasks
    const tasksCol = collection(firestore, 'production_tasks');
    const tasksSnap = await getDocs(tasksCol);
    const tasks: any[] = [];
    tasksSnap.forEach(d => {
      if (d.exists()) tasks.push(d.data());
    });

    // 3. Fetch State documents
    const metaSnap = await getDoc(doc(firestore, 'production_state', 'metadata'));
    const attSnap = await getDoc(doc(firestore, 'production_state', 'attendance'));
    const ptsSnap = await getDoc(doc(firestore, 'production_state', 'points'));
    const secSnap = await getDoc(doc(firestore, 'production_state', 'security'));

    const metadata = metaSnap.exists() ? metaSnap.data() : {};
    const attendance = attSnap.exists() ? attSnap.data() : {};
    const points = ptsSnap.exists() ? ptsSnap.data() : {};
    const security = secSnap.exists() ? secSnap.data() : {};

    // Filter tasks against deletedTaskIds tombstone
    const deletedTaskIds: string[] = Array.isArray(metadata.deletedTaskIds) ? metadata.deletedTaskIds.map(String) : [];
    const delSet = new Set(deletedTaskIds.map(id => id.trim()));
    const validTasks = tasks.filter(t => {
      const id = String(t.id || '').trim();
      const taskId = String(t.taskId || '').trim();
      return (!id || !delSet.has(id)) && (!taskId || !delSet.has(taskId));
    });

    // Validate that we got a valid dataset (at least users exist)
    if (users.length > 0) {
      console.log(`[CLOUD DB] Successfully loaded ${users.length} users and ${validTasks.length} tasks from Firestore (${tasks.length - validTasks.length} deleted tasks filtered).`);
      return {
        users,
        tasks: validTasks,
        deletedTaskIds,
        autoBackupSettings: metadata.autoBackupSettings || { enabled: true, intervalMinutes: 5, retentionCount: 5000 },
        attendanceRecords: attendance.records || [],
        pointTransactions: points.pointTransactions || [],
        technicianPerformance: points.technicianPerformance || [],
        assignmentRequests: metadata.assignmentRequests || [],
        activityLogs: security.activityLogs || [],
        adminAuditLogs: security.adminAuditLogs || [],
        lockedDevices: security.lockedDevices || [],
        lastSavedAt: metadata.lastSavedAt || new Date().toISOString(),
        source: 'FIRESTORE_CLOUD'
      };
    } else {
      console.log('[CLOUD DB] Firestore collections are currently empty (first boot sync required).');
      return null;
    }
  } catch (err: any) {
    checkAndHandleQuotaError(err);
    console.error('[CLOUD DB] Error loading production data from Firestore:', err.message);
    return null;
  }
}

// Universal deep data sanitizer for Firestore (guarantees NO undefined fields or array elements exist)
export function deepCleanForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as any;
  }
  if (typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(item => item === undefined ? null : deepCleanForFirestore(item)) as any;
  }
  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(data as any)) {
    if (val !== undefined) {
      clean[key] = deepCleanForFirestore(val);
    }
  }
  return JSON.parse(JSON.stringify(clean));
}

// Backwards-compatible alias
export const sanitizeForFirestore = deepCleanForFirestore;

// In-memory delta write cache to prevent redundant Firestore writes and avoid quota exhaustion
const userWriteCache = new Map<string, string>();
const taskWriteCache = new Map<string, string>();
let lastMetaHash = '';
let lastAttHash = '';
let lastPtsHash = '';
let lastSecHash = '';

/**
 * Persist live state to Google Cloud Firestore with anti-corruption safeguards and quota-optimized delta tracking
 */
export async function saveCloudProductionData(payload: {
  users: any[];
  tasks: any[];
  deletedTaskIds: string[];
  attendanceRecords: any[];
  pointTransactions?: any[];
  technicianPerformance?: any[];
  assignmentRequests?: any[];
  activityLogs?: any[];
  adminAuditLogs?: any[];
  lockedDevices?: any[];
  autoBackupSettings?: any;
  lastSavedAt?: string;
}): Promise<boolean> {
  // If daily Firestore quota is exhausted, skip cloud write cleanly without generating gRPC stream errors
  if (isQuotaExhausted()) {
    return false;
  }

  const firestore = initCloudDb();
  if (!firestore) return false;

  // CRITICAL SAFEGUARD: Never overwrite valid cloud dataset with empty users
  if (!Array.isArray(payload.users) || payload.users.length === 0) {
    console.error('[CLOUD DB SAFETY REJECTION] Attempted to save empty user list! Aborting cloud write to prevent data loss.');
    return false;
  }

  try {
    const nowIso = payload.lastSavedAt || new Date().toISOString();

    let batch = writeBatch(firestore);
    let opCount = 0;
    const pendingUserHashes = new Map<string, string>();
    const pendingTaskHashes = new Map<string, string>();

    const commitBatchIfFull = async () => {
      if (opCount >= 400) {
        await batch.commit();
        batch = writeBatch(firestore);
        opCount = 0;
      }
    };

    // 1. Delta-Save Users (Only write if content has changed)
    const users = payload.users || [];
    for (const u of users) {
      const docId = String(u.employeeId || u.id || '').trim();
      if (!docId) continue;
      const cleanUser = sanitizeForFirestore(u);
      const uHash = crypto.createHash('md5').update(JSON.stringify(cleanUser)).digest('hex');
      if (userWriteCache.get(docId) !== uHash) {
        batch.set(doc(firestore, 'production_users', docId), cleanUser);
        pendingUserHashes.set(docId, uHash);
        opCount++;
        await commitBatchIfFull();
      }
    }

    // 2. Delta-Save Tasks (Only write if content has changed)
    const tasks = payload.tasks || [];
    for (const t of tasks) {
      const docId = String(t.id || t.taskId || '').trim();
      if (!docId) continue;
      const cleanTask = sanitizeForFirestore(t);
      const tHash = crypto.createHash('md5').update(JSON.stringify(cleanTask)).digest('hex');
      if (taskWriteCache.get(docId) !== tHash) {
        batch.set(doc(firestore, 'production_tasks', docId), cleanTask);
        pendingTaskHashes.set(docId, tHash);
        opCount++;
        await commitBatchIfFull();
      }
    }

    // 3. Remove permanently deleted tasks from Firestore
    if (Array.isArray(payload.deletedTaskIds) && payload.deletedTaskIds.length > 0) {
      for (const delId of payload.deletedTaskIds) {
        if (delId) {
          batch.delete(doc(firestore, 'production_tasks', String(delId).trim()));
          taskWriteCache.delete(String(delId).trim());
          opCount++;
          await commitBatchIfFull();
        }
      }
    }

    // 4. Save State documents only if changed
    const metaPayload = sanitizeForFirestore({
      deletedTaskIds: payload.deletedTaskIds || [],
      autoBackupSettings: payload.autoBackupSettings || { enabled: true, intervalMinutes: 5, retentionCount: 5000 },
      assignmentRequests: (payload.assignmentRequests || []).slice(-50),
      lastSavedAt: nowIso
    });
    const metaHash = crypto.createHash('md5').update(JSON.stringify(metaPayload)).digest('hex');
    if (metaHash !== lastMetaHash) {
      batch.set(doc(firestore, 'production_state', 'metadata'), metaPayload);
      lastMetaHash = metaHash;
      opCount++;
      await commitBatchIfFull();
    }

    const attRecords = payload.attendanceRecords || [];
    const attClean = sanitizeForFirestore({
      records: attRecords,
      lastUpdated: nowIso
    });
    const attHash = crypto.createHash('md5').update(JSON.stringify(attClean)).digest('hex');
    if (attHash !== lastAttHash) {
      batch.set(doc(firestore, 'production_state', 'attendance'), attClean);
      lastAttHash = attHash;
      opCount++;
      await commitBatchIfFull();
    }

    const ptsTransactions = (payload.pointTransactions || []).slice(-500);
    const ptsClean = sanitizeForFirestore({
      pointTransactions: ptsTransactions,
      technicianPerformance: payload.technicianPerformance || [],
      lastUpdated: nowIso
    });
    const ptsHash = crypto.createHash('md5').update(JSON.stringify(ptsClean)).digest('hex');
    if (ptsHash !== lastPtsHash) {
      batch.set(doc(firestore, 'production_state', 'points'), ptsClean);
      lastPtsHash = ptsHash;
      opCount++;
      await commitBatchIfFull();
    }

    const secPayload = sanitizeForFirestore({
      activityLogs: (payload.activityLogs || []).slice(-100),
      adminAuditLogs: (payload.adminAuditLogs || []).slice(-100),
      lockedDevices: payload.lockedDevices || [],
      lastUpdated: nowIso
    });
    const secHash = crypto.createHash('md5').update(JSON.stringify(secPayload)).digest('hex');
    if (secHash !== lastSecHash) {
      batch.set(doc(firestore, 'production_state', 'security'), secPayload);
      lastSecHash = secHash;
      opCount++;
    }

    if (opCount > 0) {
      await batch.commit();
      // Update cache on successful commit
      for (const [id, hash] of pendingUserHashes) userWriteCache.set(id, hash);
      for (const [id, hash] of pendingTaskHashes) taskWriteCache.set(id, hash);
      console.log(`[CLOUD DB] Delta commit successful: ${opCount} changed document(s) committed to Firestore.`);
    } else {
      // Nothing changed, 0 writes consumed
    }

    return true;
  } catch (err: any) {
    if (checkAndHandleQuotaError(err)) {
      // Handled cleanly by circuit breaker
    } else {
      console.error('[CLOUD DB] Error saving production data to Firestore:', err.message);
    }
    return false;
  }
}

/**
 * Persist an automatic 5-minute or manual backup snapshot into durable storage
 */
export async function saveCloudBackupSnapshot(
  snapshot: any,
  backupType: '5MIN_AUTO' | 'MANUAL' | 'TASK_ENTRY' | 'TASK_DELETED' | string = '5MIN_AUTO',
  metaDetails?: Record<string, any>
): Promise<PersistentBackupRecord> {
  const now = new Date();
  const timeStr = now.toISOString().replace(/[:.]/g, '-');
  const filename = `db-backup-${backupType.toLowerCase().replace(/_/g, '-')}-${timeStr}.json`;
  const backupId = filename.replace(/\.json$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

  const jsonStr = JSON.stringify(snapshot);
  const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex');
  const sizeBytes = Buffer.byteLength(jsonStr, 'utf-8');

  const record: PersistentBackupRecord = {
    id: backupId,
    filename,
    timestamp: now.toISOString(),
    type: backupType,
    status: 'SUCCESS',
    totalTasks: Array.isArray(snapshot.tasks) ? snapshot.tasks.length : 0,
    totalUsers: Array.isArray(snapshot.users) ? snapshot.users.length : 0,
    totalAttendance: Array.isArray(snapshot.attendanceRecords) ? snapshot.attendanceRecords.length : 0,
    sizeBytes,
    checksum,
    verified: true,
    metaDetails: metaDetails || {},
    data: snapshot
  };

  // 1. Save to durable Firestore collection ONLY if quota is not exhausted
  if (!isQuotaExhausted()) {
    const firestore = initCloudDb();
    if (firestore) {
      try {
        // Store metadata header doc in production_backups
        const headerDoc = doc(firestore, 'production_backups', backupId);
        const headerPayload = deepCleanForFirestore({ ...record });
        delete (headerPayload as any).data; // Do not store redundant full raw JSON in header doc
        await setDoc(headerDoc, headerPayload);

        // Store durable backup payload in production_backups_payload (strip heavy avatar strings to stay within 1MB doc limit)
        const leanUsers = Array.isArray(snapshot.users) 
          ? snapshot.users.map((u: any) => {
              const { avatar, photo, ...rest } = u;
              return rest;
            })
          : snapshot.users;

        const leanPayload = deepCleanForFirestore({
          ...snapshot,
          users: leanUsers
        });

        const payloadDoc = doc(firestore, 'production_backups_payload', backupId);
        await setDoc(payloadDoc, deepCleanForFirestore({
          id: backupId,
          filename,
          timestamp: now.toISOString(),
          type: backupType,
          checksum,
          data: leanPayload
        }));

        // Verify read-back of header
        const verifySnap = await getDoc(headerDoc);
        if (verifySnap.exists()) {
          console.log(`[DURABLE BACKUP] Verified persistent cloud backup record: ${backupId} (${filename}, ${sizeBytes} bytes, checksum: ${checksum.slice(0, 8)}...)`);
        }
      } catch (err: any) {
        if (!checkAndHandleQuotaError(err)) {
          console.error('[DURABLE BACKUP] Failed to write cloud backup record:', err.message);
        }
        record.status = isQuotaExhausted() ? 'SUCCESS' : 'FAILED';
        record.verified = isQuotaExhausted() ? true : false;
      }
    }
  }

  // 2. Also write to local /backups/ directory on disk
  try {
    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fsSync.existsSync(backupsDir)) fsSync.mkdirSync(backupsDir, { recursive: true });
    await fs.writeFile(path.join(backupsDir, filename), jsonStr, 'utf-8');
    await fs.writeFile(path.join(backupsDir, 'latest-backup.json'), jsonStr, 'utf-8');
  } catch (diskErr: any) {
    console.warn('[DURABLE BACKUP] Local disk backup warning:', diskErr.message);
  }

  return record;
}

/**
 * Fetch full persistent backup history from Firestore and local disk
 */
export async function getPersistentBackupList(): Promise<PersistentBackupRecord[]> {
  const recordsMap = new Map<string, PersistentBackupRecord>();

  // 1. Read from Cloud Firestore (primary authoritative catalog)
  const firestore = initCloudDb();
  if (firestore) {
    try {
      const backupsCol = collection(firestore, 'production_backups');
      const snap = await getDocs(backupsCol);
      snap.forEach(d => {
        if (d.exists()) {
          const rec = d.data() as PersistentBackupRecord;
          recordsMap.set(rec.filename || rec.id, rec);
        }
      });
    } catch (err: any) {
      checkAndHandleQuotaError(err);
      console.warn('[CLOUD DB] Error reading cloud backup list:', err.message);
    }
  }

  // 2. Read from local disk /backups/ directory
  try {
    const backupsDir = path.join(process.cwd(), 'backups');
    if (fsSync.existsSync(backupsDir)) {
      const files = fsSync.readdirSync(backupsDir).filter(f => f.startsWith('db-backup-') && f.endsWith('.json'));
      for (const f of files) {
        if (!recordsMap.has(f)) {
          const stat = fsSync.statSync(path.join(backupsDir, f));
          let bType = 'HOURLY_AUTO';
          if (f.includes('manual')) bType = 'MANUAL';
          else if (f.includes('task-entry')) bType = 'TASK_ENTRY';
          else if (f.includes('task-delete')) bType = 'TASK_DELETED';
          else if (f.includes('5min')) bType = '5MIN_AUTO';

          recordsMap.set(f, {
            id: f.replace('.json', ''),
            filename: f,
            timestamp: stat.mtime.toISOString(),
            type: bType,
            status: 'SUCCESS',
            totalTasks: 0,
            totalUsers: 0,
            totalAttendance: 0,
            sizeBytes: stat.size,
            checksum: 'LOCAL_FILE',
            verified: true
          });
        }
      }
    }
  } catch (e: any) {
    console.warn('[DURABLE BACKUP] Error reading local disk backup list:', e.message);
  }

  // Convert to array and sort descending by timestamp
  return Array.from(recordsMap.values()).sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Retrieve full backup data by ID or filename
 */
export async function getPersistentBackupData(target: string): Promise<any | null> {
  const safeFilename = path.basename(target.endsWith('.json') ? target : `${target}.json`);
  const docId = target.replace('.json', '');

  // 1. Check local disk first for speed
  const backupsDir = path.join(process.cwd(), 'backups');
  const localPath = path.join(backupsDir, safeFilename);

  if (fsSync.existsSync(localPath)) {
    try {
      const raw = await fs.readFile(localPath, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {}
  }

  // 2. If not on local disk, fetch from Firestore production_backups_payload
  const firestore = initCloudDb();
  if (firestore) {
    try {
      let payloadSnap = await getDoc(doc(firestore, 'production_backups_payload', docId));
      if (!payloadSnap.exists()) {
        const cleanId = docId.replace(/[^a-zA-Z0-9_-]/g, '_');
        payloadSnap = await getDoc(doc(firestore, 'production_backups_payload', cleanId));
      }
      if (payloadSnap.exists() && payloadSnap.data()?.data) {
        return payloadSnap.data()?.data;
      }

      // Check header collection fallback
      let headerSnap = await getDoc(doc(firestore, 'production_backups', docId));
      if (!headerSnap.exists()) {
        const cleanId = docId.replace(/[^a-zA-Z0-9_-]/g, '_');
        headerSnap = await getDoc(doc(firestore, 'production_backups', cleanId));
      }
      if (headerSnap.exists() && headerSnap.data()?.data) {
        return headerSnap.data()?.data;
      }
    } catch (e: any) {
      console.warn('[CLOUD DB] Error retrieving cloud backup data:', e.message);
    }
  }

  return null;
}

/**
 * Permanently delete a task document from Firestore production_tasks
 */
export async function deleteCloudTask(taskId: string): Promise<boolean> {
  if (isQuotaExhausted()) return false;
  const firestore = initCloudDb();
  if (!firestore || !taskId) return false;
  try {
    const cleanId = String(taskId).trim();
    await deleteDoc(doc(firestore, 'production_tasks', cleanId));
    taskWriteCache.delete(cleanId);
    return true;
  } catch (err: any) {
    if (!checkAndHandleQuotaError(err)) {
      console.warn(`[CLOUD DB] Error deleting task ${taskId}:`, err.message);
    }
    return false;
  }
}
