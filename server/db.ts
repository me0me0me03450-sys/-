import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashSecret } from './security.ts';

export type StaffRole = 'super_admin' | 'queue_monitor';
export type PickupStatus = 'new' | 'called' | 'exited' | 'cancelled';
export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

export interface AcademicYearRow {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface SectionRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface GradeRow {
  id: string;
  sectionId: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomRow {
  id: string;
  sectionId: string;
  gradeId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentRow {
  id: string;
  fullName: string;
  normalizedName: string;
  sectionId: string;
  gradeId: string;
  classroomId: string;
  pinHash: string;
  isActive: boolean;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffAccountRow {
  id: string;
  fullName: string;
  username: string;
  role: StaffRole;
  sectionId: string | null;
  passwordHash: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PickupRequestRow {
  id: string;
  studentId: string;
  sectionId: string;
  gradeId: string;
  classroomId: string;
  academicYearId: string | null;
  status: PickupStatus;
  requestedAt: string;
  calledAt: string | null;
  exitedAt: string | null;
  cancelledAt: string | null;
  handledById: string | null;
  handledByName: string | null;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface SettingsRow {
  schoolName: string;
  platformName: string;
  timezone: 'Asia/Riyadh';
  maxParentAttempts: number;
  lockoutMinutes: number;
  activeAcademicYearId: string | null;
  updatedAt: string;
}

export interface ParentRateLimitRow {
  rateKey: string;
  failedAttempts: number;
  lockedUntil: string | null;
  updatedAt: string;
}

export interface ParentRegistrationRow {
  id: string;
  studentName: string;
  normalizedName: string;
  gradeName: string;
  classroomName: string;
  sectionId: string | null;
  gradeId: string | null;
  classroomId: string | null;
  pinHash: string;
  status: RegistrationStatus;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  rejectionReason: string | null;
  studentId: string | null;
}

export interface NidaaDatabase {
  academicYears: AcademicYearRow[];
  sections: SectionRow[];
  grades: GradeRow[];
  classrooms: ClassroomRow[];
  students: StudentRow[];
  parentRegistrations: ParentRegistrationRow[];
  staffAccounts: StaffAccountRow[];
  pickupRequests: PickupRequestRow[];
  auditLogs: AuditLogRow[];
  settings: SettingsRow;
  parentRateLimits: Record<string, ParentRateLimitRow>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'nidaa-db.json');

function createSeedDatabase(): NidaaDatabase {
  const now = new Date().toISOString();
  const yearId = crypto.randomUUID();

  const sections: SectionRow[] = [
    {
      id: 'sec-kg',
      code: 'kg',
      name: 'الروضة',
      isActive: true,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sec-primary',
      code: 'primary',
      name: 'الابتدائي',
      isActive: true,
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sec-middle-high',
      code: 'middle_high',
      name: 'المتوسط والثانوي',
      isActive: true,
      sortOrder: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sec-diploma',
      code: 'diploma',
      name: 'الدبلومة',
      isActive: true,
      sortOrder: 4,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const envAdminPass = process.env.NIDAA_ADMIN_PASSWORD?.trim();
  const staffAccounts: StaffAccountRow[] = [];
  if (envAdminPass) {
    staffAccounts.push({
      id: crypto.randomUUID(),
      fullName: 'مديرة النظام',
      username: 'admin',
      role: 'super_admin',
      sectionId: null,
      passwordHash: hashSecret(envAdminPass),
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    academicYears: [
      {
        id: yearId,
        name: '1447-1448 هـ',
        isActive: true,
        createdAt: now,
      },
    ],
    sections,
    grades: [],
    classrooms: [],
    students: [],
    parentRegistrations: [],
    staffAccounts,
    pickupRequests: [],
    auditLogs: [],
    settings: {
      schoolName: 'شركة تربية الأجيال الأهلية',
      platformName: 'منصة نداء',
      timezone: 'Asia/Riyadh',
      maxParentAttempts: 5,
      lockoutMinutes: 10,
      activeAcademicYearId: yearId,
      updatedAt: now,
    },
    parentRateLimits: {},
  };
}

let cachedDb: NidaaDatabase | null = null;

export function loadDb(): NidaaDatabase {
  if (cachedDb) return cachedDb;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial = createSeedDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    cachedDb = initial;
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as NidaaDatabase;
    cachedDb = {
      academicYears: parsed.academicYears ?? [],
      sections: parsed.sections ?? [],
      grades: parsed.grades ?? [],
      classrooms: parsed.classrooms ?? [],
      students: parsed.students ?? [],
      parentRegistrations: parsed.parentRegistrations ?? [],
      staffAccounts: parsed.staffAccounts ?? [],
      pickupRequests: parsed.pickupRequests ?? [],
      auditLogs: parsed.auditLogs ?? [],
      settings: {
        ...createSeedDatabase().settings,
        ...(parsed.settings ?? {}),
      },
      parentRateLimits: parsed.parentRateLimits ?? {},
    };
    return cachedDb;
  } catch {
    const initial = createSeedDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    cachedDb = initial;
    return initial;
  }
}

export function saveDb(db: NidaaDatabase): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const nowMs = Date.now();
  const staleCutoffMs = 24 * 60 * 60 * 1000;
  for (const [key, entry] of Object.entries(db.parentRateLimits)) {
    const updatedMs = new Date(entry.updatedAt).getTime();
    const lockExpired =
      !entry.lockedUntil || new Date(entry.lockedUntil).getTime() <= nowMs;
    if (lockExpired && (!Number.isFinite(updatedMs) || nowMs - updatedMs > staleCutoffMs)) {
      delete db.parentRateLimits[key];
    }
  }
  cachedDb = db;
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempFile, DB_FILE);
}

export function appendAuditLog(
  db: NidaaDatabase,
  entry: Omit<AuditLogRow, 'id' | 'createdAt'>
): void {
  const row: AuditLogRow = {
    id: crypto.randomUUID(),
    ...entry,
    createdAt: new Date().toISOString(),
  };
  db.auditLogs.unshift(row);
  if (db.auditLogs.length > 2000) {
    db.auditLogs = db.auditLogs.slice(0, 2000);
  }
}

export function getRiyadhDateKey(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
