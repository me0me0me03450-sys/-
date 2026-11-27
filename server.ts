import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  appendAuditLog,
  getRiyadhDateKey,
  loadDb,
  NidaaDatabase,
  PickupStatus,
  saveDb,
} from './server/db.ts';
import {
  generateSecurePin,
  hashSecret,
  normalizeArabicText,
  signParentRegistrationToken,
  signParentTrackingToken,
  signStaffToken,
  StaffTokenPayload,
  verifyParentRegistrationToken,
  verifyParentTrackingToken,
  verifySecret,
  verifyStaffToken,
} from './server/security.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface AuthenticatedRequest extends Request {
  staffUser?: StaffTokenPayload;
}

// ============================================================================
// SSE Real-time Subscribers
// ============================================================================
interface SseSubscriber {
  id: string;
  res: Response;
  kind: 'staff' | 'parent' | 'parent_reg';
  staffId?: string;
  role?: 'super_admin' | 'queue_monitor';
  sectionId?: string | null;
  callId?: string;
  regId?: string;
}

const sseSubscribers = new Map<string, SseSubscriber>();

function broadcastRealtimeEvent(
  eventType: string,
  payload: {
    sectionId?: string;
    callId?: string;
    call?: unknown;
    regId?: string;
    registration?: unknown;
    adminOnly?: boolean;
  }
) {
  const data = JSON.stringify({ type: eventType, ...payload, ts: Date.now() });
  const db = loadDb();
  for (const sub of sseSubscribers.values()) {
    if (sub.kind === 'parent') {
      if (sub.callId && payload.callId === sub.callId) {
        sub.res.write(`data: ${data}\n\n`);
      }
      continue;
    }
    if (sub.kind === 'parent_reg') {
      if (sub.regId && payload.regId === sub.regId) {
        sub.res.write(`data: ${data}\n\n`);
      }
      continue;
    }
    const account = sub.staffId
      ? db.staffAccounts.find((a) => a.id === sub.staffId && a.isActive)
      : null;
    if (!account) {
      continue;
    }
    if (account.role === 'super_admin') {
      sub.res.write(`data: ${data}\n\n`);
    } else if (
      account.role === 'queue_monitor' &&
      !payload.adminOnly &&
      (!payload.sectionId || account.sectionId === payload.sectionId)
    ) {
      sub.res.write(`data: ${data}\n\n`);
    }
  }
}

// ============================================================================
// Helpers: Denormalize records safely without exposing hashes
// ============================================================================
function enrichStudent(db: NidaaDatabase, s: NidaaDatabase['students'][number]) {
  const section = db.sections.find((x) => x.id === s.sectionId);
  const grade = db.grades.find((x) => x.id === s.gradeId);
  const classroom = db.classrooms.find((x) => x.id === s.classroomId);
  return {
    id: s.id,
    fullName: s.fullName,
    sectionId: s.sectionId,
    sectionName: section?.name ?? '',
    gradeId: s.gradeId,
    gradeName: grade?.name ?? '',
    classroomId: s.classroomId,
    classroomName: classroom?.name ?? '',
    isActive: s.isActive,
    isArchived: s.isArchived,
    archivedAt: s.archivedAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function enrichCall(db: NidaaDatabase, c: NidaaDatabase['pickupRequests'][number]) {
  const student = db.students.find((x) => x.id === c.studentId);
  const section = db.sections.find((x) => x.id === c.sectionId);
  const grade = db.grades.find((x) => x.id === c.gradeId);
  const classroom = db.classrooms.find((x) => x.id === c.classroomId);
  return {
    id: c.id,
    studentId: c.studentId,
    studentName: student?.fullName ?? '',
    sectionId: c.sectionId,
    sectionName: section?.name ?? '',
    gradeId: c.gradeId,
    gradeName: grade?.name ?? '',
    classroomId: c.classroomId,
    classroomName: classroom?.name ?? '',
    academicYearId: c.academicYearId,
    status: c.status,
    requestedAt: c.requestedAt,
    calledAt: c.calledAt,
    exitedAt: c.exitedAt,
    cancelledAt: c.cancelledAt,
    handledByName: c.handledByName,
  };
}

function enrichStaff(db: NidaaDatabase, a: NidaaDatabase['staffAccounts'][number]) {
  const section = a.sectionId
    ? db.sections.find((x) => x.id === a.sectionId)
    : null;
  return {
    id: a.id,
    fullName: a.fullName,
    username: a.username,
    role: a.role,
    sectionId: a.sectionId,
    sectionName: section?.name ?? 'جميع الأقسام',
    isActive: a.isActive,
    lastLoginAt: a.lastLoginAt,
    createdAt: a.createdAt,
  };
}

function enrichRegistration(
  db: NidaaDatabase,
  r: NidaaDatabase['parentRegistrations'][number]
) {
  const section = r.sectionId
    ? db.sections.find((x) => x.id === r.sectionId)
    : null;
  return {
    id: r.id,
    studentName: r.studentName,
    gradeName: r.gradeName,
    classroomName: r.classroomName,
    sectionId: r.sectionId,
    sectionName: section?.name ?? '',
    gradeId: r.gradeId,
    classroomId: r.classroomId,
    status: r.status,
    requestedAt: r.requestedAt,
    reviewedAt: r.reviewedAt,
    reviewedByName: r.reviewedByName,
    rejectionReason: r.rejectionReason,
    studentId: r.studentId,
  };
}

function getClientIp(req: Request): string {
  const xff = req.ip;
  if (typeof xff === 'string' && xff.trim()) {
    return xff.trim();
  }
  return req.ip || 'local';
}

// ============================================================================
// Auth Middlewares
// ============================================================================
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

function requireStaffAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'يلزم تسجيل الدخول أولاً.' });
    return;
  }
  const payload = verifyStaffToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: 'انتهت الجلسة، يرجى إعادة الدخول.' });
    return;
  }
  const db = loadDb();
  const account = db.staffAccounts.find(
    (a) => a.id === payload.sub && a.isActive
  );
  if (!account) {
    res.status(403).json({ ok: false, error: 'الحساب غير نشط أو غير مصرح له.' });
    return;
  }
  req.staffUser = {
    ...payload,
    role: account.role,
    sectionId: account.sectionId,
    fullName: account.fullName,
  };
  next();
}

function requireSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  requireStaffAuth(req, res, () => {
    if (req.staffUser?.role !== 'super_admin') {
      res.status(403).json({
        ok: false,
        error: 'هذه الصلاحية مخصصة لمديرة النظام فقط.',
      });
      return;
    }
    next();
  });
}

// ============================================================================
// App & Routes
// ============================================================================
async function startServer() {
  const app = express();
  app.set('trust proxy', /^\d+$/.test(process.env.NIDAA_TRUST_PROXY_HOPS ?? '') ? Number(process.env.NIDAA_TRUST_PROXY_HOPS) : false);
  app.use(express.json({ limit: '2mb' }));

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timezone: 'Asia/Riyadh', now: new Date().toISOString() });
  });

  // --------------------------------------------------------------------------
  // Auth Routes
  // --------------------------------------------------------------------------
  app.get('/api/auth/status', (_req, res) => {
    const db = loadDb();
    const hasSuperAdmin = db.staffAccounts.some(
      (a) => a.role === 'super_admin' && a.isActive
    );
    const envAdminConfigured = Boolean(process.env.NIDAA_ADMIN_PASSWORD?.trim());
    res.json({
      ok: true,
      needsSetup: !hasSuperAdmin && !envAdminConfigured,
      envAdminConfigured,
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    const db = loadDb();
    const hasSuperAdmin = db.staffAccounts.some(
      (a) => a.role === 'super_admin' && a.isActive
    );
    const envAdminConfigured = Boolean(process.env.NIDAA_ADMIN_PASSWORD?.trim());

    if (hasSuperAdmin || envAdminConfigured) {
      res.status(409).json({
        ok: false,
        error: 'تم إعداد حساب مديرة النظام مسبقاً.',
      });
      return;
    }

    const fullName = String(req.body?.fullName ?? '').trim();
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '').trim();

    if (fullName.length < 3 || username.length < 3 || password.length < 6) {
      res.status(400).json({
        ok: false,
        error:
          'يرجى إدخال الاسم الكامل واسم مستخدم (3 أحرف فأكثر) وكلمة مرور (6 أحرف فأكثر).',
      });
      return;
    }

    const now = new Date().toISOString();
    const accountId = crypto.randomUUID();
    const created = {
      id: accountId,
      fullName,
      username,
      role: 'super_admin' as const,
      sectionId: null,
      passwordHash: hashSecret(password),
      isActive: true,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    };

    db.staffAccounts.push(created);
    appendAuditLog(db, {
      actorId: accountId,
      actorName: fullName,
      action: 'SETUP_SUPER_ADMIN',
      entityType: 'staff_accounts',
      entityId: accountId,
      details: { username },
    });
    saveDb(db);

    const token = signStaffToken({
      sub: created.id,
      username: created.username,
      fullName: created.fullName,
      role: created.role,
      sectionId: null,
    });

    res.status(201).json({
      ok: true,
      token,
      user: enrichStaff(db, created),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const db = loadDb();
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '').trim();

    if (!username || !password) {
      res.status(400).json({
        ok: false,
        error: 'يرجى إدخال اسم المستخدم وكلمة المرور.',
      });
      return;
    }

    const loginRateKey = `staff-login:${getClientIp(req)}:${username.slice(0, 48)}`;
    const loginRate = db.parentRateLimits[loginRateKey];
    const nowMs = Date.now();
    if (loginRate?.lockedUntil && new Date(loginRate.lockedUntil).getTime() > nowMs) {
      res.status(429).json({
        ok: false,
        error: 'تم تجاوز محاولات الدخول مؤقتاً. يرجى المحاولة بعد قليل.',
      });
      return;
    }

    // Optional env override for Super Admin
    const envPass = process.env.NIDAA_ADMIN_PASSWORD?.trim();
    let account = db.staffAccounts.find(
      (a) => a.username.toLowerCase() === username
    );

    if (
      envPass &&
      username === 'admin' &&
      password.length === envPass.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(envPass))
    ) {
      const now = new Date().toISOString();
      if (!account) {
        account = {
          id: crypto.randomUUID(),
          fullName: 'مديرة النظام',
          username: 'admin',
          role: 'super_admin',
          sectionId: null,
          passwordHash: hashSecret(envPass),
          isActive: true,
          lastLoginAt: now,
          createdAt: now,
          updatedAt: now,
        };
        db.staffAccounts.push(account);
      } else {
        account.isActive = true;
        account.role = 'super_admin';
        account.sectionId = null;
        account.lastLoginAt = now;
        account.updatedAt = now;
      }
      appendAuditLog(db, {
        actorId: account.id,
        actorName: account.fullName,
        action: 'STAFF_LOGIN',
        entityType: 'staff_accounts',
        entityId: account.id,
        details: { role: account.role },
      });
      saveDb(db);
    } else {
      if (!account || !account.isActive || !verifySecret(password, account.passwordHash)) {
        const attempts =
          loginRate?.lockedUntil && new Date(loginRate.lockedUntil).getTime() <= nowMs
            ? 1
            : (loginRate?.failedAttempts ?? 0) + 1;
        const maxAttempts = Math.max(3, db.settings.maxParentAttempts || 5);
        const lockoutMinutes = Math.max(1, db.settings.lockoutMinutes || 10);
        const lockedUntil =
          attempts >= maxAttempts
            ? new Date(nowMs + lockoutMinutes * 60 * 1000).toISOString()
            : null;
        db.parentRateLimits[loginRateKey] = {
          rateKey: loginRateKey,
          failedAttempts: attempts,
          lockedUntil,
          updatedAt: new Date().toISOString(),
        };
        saveDb(db);
        res.status(401).json({
          ok: false,
          error: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
        });
        return;
      }
      account.lastLoginAt = new Date().toISOString();
      appendAuditLog(db, {
        actorId: account.id,
        actorName: account.fullName,
        action: 'STAFF_LOGIN',
        entityType: 'staff_accounts',
        entityId: account.id,
        details: { role: account.role },
      });
      saveDb(db);
    }

    if (db.parentRateLimits[loginRateKey]) {
      delete db.parentRateLimits[loginRateKey];
      saveDb(db);
    }

    const token = signStaffToken({
      sub: account.id,
      username: account.username,
      fullName: account.fullName,
      role: account.role,
      sectionId: account.sectionId,
    });

    res.json({
      ok: true,
      token,
      user: enrichStaff(db, account),
    });
  });

  app.get('/api/auth/me', requireStaffAuth, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const account = db.staffAccounts.find((a) => a.id === req.staffUser?.sub);
    if (!account) {
      res.status(401).json({ ok: false, error: 'الحساب غير موجود.' });
      return;
    }
    res.json({ ok: true, user: enrichStaff(db, account) });
  });

  // --------------------------------------------------------------------------
  // Parent Public API (Rate-Limited Server Verification, Zero Directory Leak)
  // --------------------------------------------------------------------------
  app.get('/api/parent/structure', (_req, res) => {
    const db = loadDb();
    const activeSections = db.sections
      .filter((s) => s.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, code: s.code, name: s.name, isActive: s.isActive, sortOrder: s.sortOrder }));
    const activeSectionIds = new Set(activeSections.map((s) => s.id));

    const activeGrades = db.grades
      .filter((g) => g.isActive && activeSectionIds.has(g.sectionId))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({
        id: g.id,
        sectionId: g.sectionId,
        name: g.name,
        isActive: g.isActive,
        sortOrder: g.sortOrder,
      }));
    const activeGradeIds = new Set(activeGrades.map((g) => g.id));

    const activeClassrooms = db.classrooms
      .filter((c) => c.isActive && activeGradeIds.has(c.gradeId))
      .map((c) => ({
        id: c.id,
        sectionId: c.sectionId,
        gradeId: c.gradeId,
        name: c.name,
        isActive: c.isActive,
      }));

    res.json({
      ok: true,
      sections: activeSections,
      grades: activeGrades,
      classrooms: activeClassrooms,
    });
  });

  app.post('/api/parent/register', (req, res) => {
    const db = loadDb();
    const studentName = String(req.body?.studentName ?? '').trim();
    const gradeName = String(req.body?.gradeName ?? '').trim();
    const classroomName = String(req.body?.classroomName ?? '').trim();
    const pin = String(req.body?.pin ?? '').trim();
    const requestedSectionId =
      typeof req.body?.sectionId === 'string' && req.body.sectionId.trim()
        ? req.body.sectionId.trim()
        : null;

    const clientIp = getClientIp(req);
    const rateKey = `reg:${clientIp}`;
    const rateEntry = db.parentRateLimits[rateKey];
    const nowMs = Date.now();

    if (rateEntry?.lockedUntil && new Date(rateEntry.lockedUntil).getTime() > nowMs) {
      res.status(429).json({
        ok: false,
        error: 'تم تجاوز الحد المسموح لطلبات التسجيل المتكررة مؤقتاً. يرجى المحاولة بعد قليل.',
      });
      return;
    }

    const recordRegAttempt = () => {
      const currentAttempts =
        rateEntry?.lockedUntil && new Date(rateEntry.lockedUntil).getTime() <= nowMs
          ? 1
          : (rateEntry?.failedAttempts ?? 0) + 1;
      const limit = Math.max(10, (db.settings.maxParentAttempts || 5) * 3);
      const lockoutMinutes = db.settings.lockoutMinutes || 10;
      const lockedUntil =
        currentAttempts >= limit
          ? new Date(nowMs + lockoutMinutes * 60 * 1000).toISOString()
          : null;
      db.parentRateLimits[rateKey] = {
        rateKey,
        failedAttempts: currentAttempts,
        lockedUntil,
        updatedAt: new Date().toISOString(),
      };
      saveDb(db);
    };

    const normalizedName = normalizeArabicText(studentName);
    if (normalizedName.length < 2 || !gradeName || !classroomName) {
      recordRegAttempt();
      res.status(400).json({
        ok: false,
        error: 'يرجى إدخال اسم الطالبة أو الطالب والصف والفصل بشكل كامل.',
      });
      return;
    }

    if (pin.length < 4 || pin.length > 20) {
      recordRegAttempt();
      res.status(400).json({
        ok: false,
        error: 'يجب أن يتكون الرقم السري من 4 أرقام أو أحرف على الأقل.',
      });
      return;
    }

    const hasExistingStudent = db.students.some(
      (s) => !s.isArchived && s.normalizedName === normalizedName
    );
    if (hasExistingStudent) {
      recordRegAttempt();
      res.status(409).json({
        ok: false,
        error: 'هذا الاسم مسجل مسبقاً في النظام، يمكنك إرسال النداء مباشرة أو مراجعة الإدارة.',
      });
      return;
    }

    const hasPendingRegistration = db.parentRegistrations.some(
      (r) => r.status === 'pending' && r.normalizedName === normalizedName
    );
    if (hasPendingRegistration) {
      recordRegAttempt();
      res.status(409).json({
        ok: false,
        error: 'يوجد طلب تسجيل معلق مسبقاً بانتظار موافقة إدارة النظام.',
      });
      return;
    }

    // Attempt automatic match against active sections/grades/classrooms without failing free-text entries
    let matchedSectionId: string | null = requestedSectionId && db.sections.some((s) => s.id === requestedSectionId && s.isActive)
      ? requestedSectionId
      : null;
    let matchedGradeId: string | null = null;
    let matchedClassroomId: string | null = null;

    const normGrade = normalizeArabicText(gradeName);
    const matchingGrades = db.grades.filter((g) => {
      if (!g.isActive) return false;
      if (matchedSectionId && g.sectionId !== matchedSectionId) return false;
      const sec = db.sections.find((s) => s.id === g.sectionId);
      if (!sec?.isActive) return false;
      return normalizeArabicText(g.name) === normGrade;
    });

    if (matchingGrades.length === 1) {
      matchedGradeId = matchingGrades[0].id;
      matchedSectionId = matchingGrades[0].sectionId;
      const normClass = normalizeArabicText(classroomName);
      const matchingClass = db.classrooms.find(
        (c) =>
          c.isActive &&
          c.gradeId === matchedGradeId &&
          normalizeArabicText(c.name) === normClass
      );
      if (matchingClass) {
        matchedClassroomId = matchingClass.id;
      }
    }

    const nowIso = new Date().toISOString();
    const created: NidaaDatabase['parentRegistrations'][number] = {
      id: `reg-${crypto.randomUUID().slice(0, 8)}`,
      studentName,
      normalizedName,
      gradeName,
      classroomName,
      sectionId: matchedSectionId,
      gradeId: matchedGradeId,
      classroomId: matchedClassroomId,
      pinHash: hashSecret(pin),
      status: 'pending',
      requestedAt: nowIso,
      reviewedAt: null,
      reviewedById: null,
      reviewedByName: null,
      rejectionReason: null,
      studentId: null,
    };

    db.parentRegistrations.unshift(created);
    recordRegAttempt();
    appendAuditLog(db, {
      actorId: null,
      actorName: 'ولي أمر',
      action: 'SUBMIT_PARENT_REGISTRATION',
      entityType: 'parent_registrations',
      entityId: created.id,
      details: {
        studentName: created.studentName,
        gradeName: created.gradeName,
        classroomName: created.classroomName,
      },
    });
    saveDb(db);

    const enriched = enrichRegistration(db, created);
    broadcastRealtimeEvent('REGISTRATION_CREATED', {
      regId: created.id,
      registration: enriched,
      adminOnly: true,
    });

    res.status(201).json({
      ok: true,
      registration: enriched,
      trackingToken: signParentRegistrationToken(created.id),
    });
  });

  app.get('/api/parent/register/:id', (req, res) => {
    const regId = String(req.params.id ?? '');
    const token = String(req.query.token ?? '');
    if (!verifyParentRegistrationToken(regId, token)) {
      res.status(403).json({ ok: false, error: 'رمز متابعة الطلب غير صالح.' });
      return;
    }
    const db = loadDb();
    const found = db.parentRegistrations.find((r) => r.id === regId);
    if (!found) {
      res.status(404).json({ ok: false, error: 'طلب التسجيل غير موجود.' });
      return;
    }
    res.json({ ok: true, registration: enrichRegistration(db, found) });
  });

  app.post('/api/parent/call', (req, res) => {
    const db = loadDb();
    const studentName = String(req.body?.studentName ?? '');
    const pin = String(req.body?.pin ?? '');
    const normalizedName = normalizeArabicText(studentName);

    if (!normalizedName || !pin.trim()) {
      res.status(400).json({
        ok: false,
        error: 'يرجى إدخال اسم الطالبة أو الطالب والرقم السري.',
      });
      return;
    }

    const clientIp = getClientIp(req);
    const rateKey = `${clientIp}:${normalizedName.slice(0, 48)}`;
    const rateEntry = db.parentRateLimits[rateKey];
    const nowMs = Date.now();

    if (rateEntry?.lockedUntil && new Date(rateEntry.lockedUntil).getTime() > nowMs) {
      res.status(429).json({
        ok: false,
        error: 'تم تجاوز عدد المحاولات المسموح بها مؤقتاً. يرجى المحاولة بعد قليل.',
      });
      return;
    }

    const matchedStudent = db.students.find((s) => {
      if (!s.isActive || s.isArchived) return false;
      if (s.normalizedName !== normalizedName) return false;
      const sec = db.sections.find((x) => x.id === s.sectionId);
      const gr = db.grades.find((x) => x.id === s.gradeId);
      const cls = db.classrooms.find((x) => x.id === s.classroomId);
      if (!sec?.isActive || !gr?.isActive || !cls?.isActive) return false;
      return verifySecret(pin, s.pinHash);
    });

    if (!matchedStudent) {
      // Check if credentials match an inactive/disabled student or a pending/rejected registration
      const pendingMatch = db.parentRegistrations.find(
        (r) =>
          r.status === 'pending' &&
          r.normalizedName === normalizedName &&
          verifySecret(pin, r.pinHash)
      );
      if (pendingMatch) {
        res.status(403).json({
          ok: false,
          error: 'طلب التسجيل لا يزال بانتظار موافقة إدارة النظام. لا يُسمح بإرسال النداء قبل التفعيل.',
        });
        return;
      }

      const disabledStudentMatch = db.students.find((s) => {
        if (s.normalizedName !== normalizedName) return false;
        const sec = db.sections.find((x) => x.id === s.sectionId);
        const gr = db.grades.find((x) => x.id === s.gradeId);
        const cls = db.classrooms.find((x) => x.id === s.classroomId);
        const inactiveOrArchived =
          !s.isActive || s.isArchived || !sec?.isActive || !gr?.isActive || !cls?.isActive;
        return inactiveOrArchived && verifySecret(pin, s.pinHash);
      });
      if (disabledStudentMatch) {
        res.status(403).json({
          ok: false,
          error: 'تم تعطيل الرقم السري أو حساب الطالبة/الطالب أو القسم التابع له من إدارة النظام.',
        });
        return;
      }

      const rejectedMatch = db.parentRegistrations.find(
        (r) =>
          r.status === 'rejected' &&
          r.normalizedName === normalizedName &&
          verifySecret(pin, r.pinHash)
      );
      if (rejectedMatch) {
        res.status(403).json({
          ok: false,
          error: 'تم رفض طلب التسجيل السابق. يرجى مراجعة إدارة النظام أو تقديم طلب جديد.',
        });
        return;
      }

      const currentAttempts =
        rateEntry?.lockedUntil && new Date(rateEntry.lockedUntil).getTime() <= nowMs
          ? 1
          : (rateEntry?.failedAttempts ?? 0) + 1;
      const maxAttempts = db.settings.maxParentAttempts || 5;
      const lockoutMinutes = db.settings.lockoutMinutes || 10;
      const lockedUntil =
        currentAttempts >= maxAttempts
          ? new Date(nowMs + lockoutMinutes * 60 * 1000).toISOString()
          : null;

      db.parentRateLimits[rateKey] = {
        rateKey,
        failedAttempts: currentAttempts,
        lockedUntil,
        updatedAt: new Date().toISOString(),
      };
      saveDb(db);

      res.status(lockedUntil ? 429 : 401).json({
        ok: false,
        error: lockedUntil
          ? 'تم تجاوز عدد المحاولات المسموح بها مؤقتاً. يرجى المحاولة بعد قليل.'
          : 'تعذر التحقق من اسم الطالبة أو الطالب أو الرقم السري.',
      });
      return;
    }

    // Clear rate limit on valid verification
    if (db.parentRateLimits[rateKey]) {
      delete db.parentRateLimits[rateKey];
    }

    // Prevent duplicate active call
    const existingActive = db.pickupRequests.find(
      (c) =>
        c.studentId === matchedStudent.id &&
        (c.status === 'new' || c.status === 'called')
    );

    if (existingActive) {
      saveDb(db);
      const enriched = enrichCall(db, existingActive);
      res.json({
        ok: true,
        duplicate: true,
        call: enriched,
        trackingToken: signParentTrackingToken(existingActive.id),
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const created: NidaaDatabase['pickupRequests'][number] = {
      id: crypto.randomUUID(),
      studentId: matchedStudent.id,
      sectionId: matchedStudent.sectionId,
      gradeId: matchedStudent.gradeId,
      classroomId: matchedStudent.classroomId,
      academicYearId: db.settings.activeAcademicYearId,
      status: 'new',
      requestedAt: nowIso,
      calledAt: null,
      exitedAt: null,
      cancelledAt: null,
      handledById: null,
      handledByName: null,
    };

    db.pickupRequests.unshift(created);
    saveDb(db);

    const enriched = enrichCall(db, created);
    broadcastRealtimeEvent('CALL_CREATED', {
      sectionId: created.sectionId,
      callId: created.id,
      call: enriched,
    });

    res.status(201).json({
      ok: true,
      duplicate: false,
      call: enriched,
      trackingToken: signParentTrackingToken(created.id),
    });
  });

  app.get('/api/parent/call/:id', (req, res) => {
    const callId = String(req.params.id ?? '');
    const token = String(req.query.token ?? '');
    if (!verifyParentTrackingToken(callId, token)) {
      res.status(403).json({ ok: false, error: 'رمز التتبع غير صالح.' });
      return;
    }
    const db = loadDb();
    const found = db.pickupRequests.find((c) => c.id === callId);
    if (!found) {
      res.status(404).json({ ok: false, error: 'الطلب غير موجود.' });
      return;
    }
    res.json({ ok: true, call: enrichCall(db, found) });
  });

  // --------------------------------------------------------------------------
  // Real-time SSE Stream
  // --------------------------------------------------------------------------
  app.get('/api/realtime', (req, res) => {
    const tokenParam = String(req.query.token ?? '');
    const callIdParam = String(req.query.callId ?? '');
    const trackingParam = String(req.query.trackingToken ?? '');
    const regIdParam = String(req.query.regId ?? '');
    const regTokenParam = String(req.query.regToken ?? '');

    let subscriber: SseSubscriber | null = null;
    const subId = crypto.randomUUID();

    if (callIdParam && trackingParam) {
      if (!verifyParentTrackingToken(callIdParam, trackingParam)) {
        res.status(403).end();
        return;
      }
      subscriber = {
        id: subId,
        res,
        kind: 'parent',
        callId: callIdParam,
      };
    } else if (regIdParam && regTokenParam) {
      if (!verifyParentRegistrationToken(regIdParam, regTokenParam)) {
        res.status(403).end();
        return;
      }
      subscriber = {
        id: subId,
        res,
        kind: 'parent_reg',
        regId: regIdParam,
      };
    } else if (tokenParam) {
      const payload = verifyStaffToken(tokenParam);
      if (!payload) {
        res.status(401).end();
        return;
      }
      const db = loadDb();
      const account = db.staffAccounts.find(
        (a) => a.id === payload.sub && a.isActive
      );
      if (!account) {
        res.status(403).end();
        return;
      }
      subscriber = {
        id: subId,
        res,
        kind: 'staff',
        staffId: account.id,
        role: account.role,
        sectionId: account.sectionId,
      };
    } else {
      res.status(401).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);
    sseSubscribers.set(subId, subscriber);

    const heartbeat = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseSubscribers.delete(subId);
    });
  });

  // --------------------------------------------------------------------------
  // Queue Monitoring Routes (Strict Section Isolation for queue_monitor)
  // --------------------------------------------------------------------------
  app.get('/api/queue/data', requireStaffAuth, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const user = req.staffUser!;
    const requestedSectionId =
      typeof req.query.sectionId === 'string' ? req.query.sectionId : null;

    const effectiveSectionId =
      user.role === 'queue_monitor' ? user.sectionId : requestedSectionId;

    const sections =
      user.role === 'queue_monitor'
        ? db.sections.filter((s) => s.id === user.sectionId)
        : db.sections;

    const grades =
      effectiveSectionId
        ? db.grades.filter((g) => g.sectionId === effectiveSectionId)
        : db.grades;

    const classrooms =
      effectiveSectionId
        ? db.classrooms.filter((c) => c.sectionId === effectiveSectionId)
        : db.classrooms;

    const students = db.students
      .filter((s) => !s.isArchived && s.isActive)
      .filter((s) =>
        effectiveSectionId ? s.sectionId === effectiveSectionId : true
      )
      .map((s) => enrichStudent(db, s));

    const calls = db.pickupRequests
      .filter((c) =>
        effectiveSectionId ? c.sectionId === effectiveSectionId : true
      )
      .map((c) => enrichCall(db, c));

    res.json({
      ok: true,
      sections,
      grades,
      classrooms,
      students,
      calls,
    });
  });

  app.patch(
    '/api/calls/:id/status',
    requireStaffAuth,
    (req: AuthenticatedRequest, res) => {
      const db = loadDb();
      const user = req.staffUser!;
      const callId = String(req.params.id ?? '');
      const nextStatus = String(req.body?.status ?? '') as PickupStatus;

      if (!['new', 'called', 'exited', 'cancelled'].includes(nextStatus)) {
        res.status(400).json({ ok: false, error: 'حالة الطلب غير صالحة.' });
        return;
      }

      const call = db.pickupRequests.find((c) => c.id === callId);
      if (!call) {
        res.status(404).json({ ok: false, error: 'النداء غير موجود.' });
        return;
      }

      if (user.role === 'queue_monitor' && call.sectionId !== user.sectionId) {
        res.status(403).json({
          ok: false,
          error: 'لا تملكين صلاحية تعديل نداءات قسم آخر.',
        });
        return;
      }

      if (call.status === 'exited' || call.status === 'cancelled') {
        res.status(409).json({
          ok: false,
          error: 'تم إغلاق هذا الطلب مسبقاً ولا يمكن تعديل حالته.',
        });
        return;
      }

      const now = new Date().toISOString();
      call.status = nextStatus;
      call.handledById = user.sub;
      call.handledByName = user.fullName;

      if (nextStatus === 'called') {
        call.calledAt = call.calledAt ?? now;
      } else if (nextStatus === 'exited') {
        call.calledAt = call.calledAt ?? now;
        call.exitedAt = now;
      } else if (nextStatus === 'cancelled') {
        call.cancelledAt = now;
      }

      appendAuditLog(db, {
        actorId: user.sub,
        actorName: user.fullName,
        action: `UPDATE_CALL_${nextStatus.toUpperCase()}`,
        entityType: 'pickup_requests',
        entityId: call.id,
        details: { studentId: call.studentId, sectionId: call.sectionId },
      });
      saveDb(db);

      const enriched = enrichCall(db, call);
      broadcastRealtimeEvent('CALL_UPDATED', {
        sectionId: call.sectionId,
        callId: call.id,
        call: enriched,
      });

      res.json({ ok: true, call: enriched });
    }
  );

  // --------------------------------------------------------------------------
  // Super Admin Routes
  // --------------------------------------------------------------------------
  app.get('/api/admin/bootstrap', requireSuperAdmin, (_req, res) => {
    const db = loadDb();
    res.json({
      ok: true,
      sections: db.sections.sort((a, b) => a.sortOrder - b.sortOrder),
      grades: db.grades.sort((a, b) => a.sortOrder - b.sortOrder),
      classrooms: db.classrooms,
      students: db.students.map((s) => enrichStudent(db, s)),
      parentRegistrations: db.parentRegistrations.map((r) =>
        enrichRegistration(db, r)
      ),
      staffAccounts: db.staffAccounts.map((a) => enrichStaff(db, a)),
      calls: db.pickupRequests.map((c) => enrichCall(db, c)),
      auditLogs: db.auditLogs.slice(0, 200),
      academicYears: db.academicYears,
      settings: db.settings,
    });
  });

  // Parent Registrations Approval & Rejection
  app.post('/api/admin/registrations/:id/approve', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const reg = db.parentRegistrations.find((r) => r.id === req.params.id);
    if (!reg) {
      res.status(404).json({ ok: false, error: 'طلب التسجيل غير موجود.' });
      return;
    }
    if (reg.status !== 'pending') {
      res.status(409).json({ ok: false, error: 'تمت معالجة هذا الطلب مسبقاً.' });
      return;
    }

    const reqSectionId = String(req.body?.sectionId ?? reg.sectionId ?? '').trim();
    const reqGradeId = String(req.body?.gradeId ?? reg.gradeId ?? '').trim();
    const reqClassroomId = String(req.body?.classroomId ?? reg.classroomId ?? '').trim();

    const section = db.sections.find((s) => s.id === reqSectionId);
    if (!section) {
      res.status(400).json({ ok: false, error: 'يرجى تحديد القسم المرتبط بالطالبة أو الطالب.' });
      return;
    }

    if (db.students.some((s) => !s.isArchived && s.normalizedName === reg.normalizedName)) {
      res.status(409).json({ ok: false, error: 'يوجد سجل نشط مسبقاً لنفس الاسم.' });
      return;
    }

    const now = new Date().toISOString();

    let grade = reqGradeId
      ? db.grades.find((g) => g.id === reqGradeId && g.sectionId === section.id)
      : undefined;
    if (!grade) {
      const normGrade = normalizeArabicText(reg.gradeName);
      grade = db.grades.find(
        (g) => g.sectionId === section.id && normalizeArabicText(g.name) === normGrade
      );
    }
    if (!grade) {
      grade = {
        id: `grd-${crypto.randomUUID().slice(0, 8)}`,
        sectionId: section.id,
        name: reg.gradeName,
        isActive: true,
        sortOrder: db.grades.filter((g) => g.sectionId === section.id).length + 1,
        createdAt: now,
        updatedAt: now,
      };
      db.grades.push(grade);
    }

    let classroom = reqClassroomId
      ? db.classrooms.find((c) => c.id === reqClassroomId && c.gradeId === grade!.id)
      : undefined;
    if (!classroom) {
      const normClass = normalizeArabicText(reg.classroomName);
      classroom = db.classrooms.find(
        (c) => c.gradeId === grade!.id && normalizeArabicText(c.name) === normClass
      );
    }
    if (!classroom) {
      classroom = {
        id: `cls-${crypto.randomUUID().slice(0, 8)}`,
        sectionId: section.id,
        gradeId: grade.id,
        name: reg.classroomName,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      db.classrooms.push(classroom);
    }

    const studentId = `std-${crypto.randomUUID().slice(0, 8)}`;
    const newStudent: NidaaDatabase['students'][number] = {
      id: studentId,
      fullName: reg.studentName,
      normalizedName: reg.normalizedName,
      sectionId: section.id,
      gradeId: grade.id,
      classroomId: classroom.id,
      pinHash: reg.pinHash,
      isActive: true,
      isArchived: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    db.students.unshift(newStudent);

    reg.status = 'approved';
    reg.sectionId = section.id;
    reg.gradeId = grade.id;
    reg.classroomId = classroom.id;
    reg.reviewedAt = now;
    reg.reviewedById = req.staffUser!.sub;
    reg.reviewedByName = req.staffUser!.fullName;
    reg.studentId = studentId;

    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'APPROVE_PARENT_REGISTRATION',
      entityType: 'parent_registrations',
      entityId: reg.id,
      details: {
        studentName: reg.studentName,
        sectionName: section.name,
        gradeName: grade.name,
        classroomName: classroom.name,
        studentId,
      },
    });
    saveDb(db);

    const enrichedReg = enrichRegistration(db, reg);
    const enrichedStu = enrichStudent(db, newStudent);
    broadcastRealtimeEvent('REGISTRATION_UPDATED', {
      regId: reg.id,
      registration: enrichedReg,
      adminOnly: true,
    });
    broadcastRealtimeEvent('STRUCTURE_UPDATED', { sectionId: section.id });

    res.json({
      ok: true,
      registration: enrichedReg,
      student: enrichedStu,
    });
  });

  app.post('/api/admin/registrations/:id/reject', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const reg = db.parentRegistrations.find((r) => r.id === req.params.id);
    if (!reg) {
      res.status(404).json({ ok: false, error: 'طلب التسجيل غير موجود.' });
      return;
    }
    if (reg.status !== 'pending') {
      res.status(409).json({ ok: false, error: 'تمت معالجة هذا الطلب مسبقاً.' });
      return;
    }

    const reason = String(req.body?.reason ?? '').trim() || null;
    reg.status = 'rejected';
    reg.reviewedAt = new Date().toISOString();
    reg.reviewedById = req.staffUser!.sub;
    reg.reviewedByName = req.staffUser!.fullName;
    reg.rejectionReason = reason;

    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'REJECT_PARENT_REGISTRATION',
      entityType: 'parent_registrations',
      entityId: reg.id,
      details: {
        studentName: reg.studentName,
        reason,
      },
    });
    saveDb(db);

    const enrichedReg = enrichRegistration(db, reg);
    broadcastRealtimeEvent('REGISTRATION_UPDATED', {
      regId: reg.id,
      registration: enrichedReg,
      adminOnly: true,
    });

    res.json({ ok: true, registration: enrichedReg });
  });

  // Sections CRUD
  app.post('/api/admin/sections', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const name = String(req.body?.name ?? '').trim();
    const code = String(req.body?.code ?? '').trim().toLowerCase() || `sec_${crypto.randomUUID().slice(0, 8)}`;
    if (!name) {
      res.status(400).json({ ok: false, error: 'يرجى إدخال اسم القسم.' });
      return;
    }
    const normName = normalizeArabicText(name);
    if (db.sections.some((s) => normalizeArabicText(s.name) === normName)) {
      res.status(409).json({ ok: false, error: 'اسم القسم مسجل مسبقاً.' });
      return;
    }
    const now = new Date().toISOString();
    const created = {
      id: `sec-${crypto.randomUUID().slice(0, 8)}`,
      code,
      name,
      isActive: true,
      sortOrder: db.sections.length + 1,
      createdAt: now,
      updatedAt: now,
    };
    db.sections.push(created);
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'CREATE_SECTION',
      entityType: 'sections',
      entityId: created.id,
      details: { name },
    });
    saveDb(db);
    broadcastRealtimeEvent('STRUCTURE_UPDATED', {});
    res.status(201).json({ ok: true, section: created });
  });

  app.patch('/api/admin/sections/:id', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const sec = db.sections.find((s) => s.id === req.params.id);
    if (!sec) {
      res.status(404).json({ ok: false, error: 'القسم غير موجود.' });
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      const nextName = req.body.name.trim();
      const normNext = normalizeArabicText(nextName);
      if (db.sections.some((s) => s.id !== sec.id && normalizeArabicText(s.name) === normNext)) {
        res.status(409).json({ ok: false, error: 'يوجد قسم آخر بنفس الاسم.' });
        return;
      }
      sec.name = nextName;
    }
    if (typeof req.body?.isActive === 'boolean') {
      sec.isActive = req.body.isActive;
    }
    sec.updatedAt = new Date().toISOString();
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'UPDATE_SECTION',
      entityType: 'sections',
      entityId: sec.id,
      details: { name: sec.name, isActive: sec.isActive },
    });
    saveDb(db);
    broadcastRealtimeEvent('STRUCTURE_UPDATED', {});
    res.json({ ok: true, section: sec });
  });

  // Grades CRUD
  app.post('/api/admin/grades', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const sectionId = String(req.body?.sectionId ?? '');
    const name = String(req.body?.name ?? '').trim();
    if (!sectionId || !name) {
      res.status(400).json({ ok: false, error: 'يرجى تحديد القسم واسم الصف.' });
      return;
    }
    if (!db.sections.some((s) => s.id === sectionId)) {
      res.status(404).json({ ok: false, error: 'القسم غير موجود.' });
      return;
    }
    if (db.grades.some((g) => g.sectionId === sectionId && g.name === name)) {
      res.status(409).json({ ok: false, error: 'هذا الصف موجود مسبقاً في القسم.' });
      return;
    }
    const now = new Date().toISOString();
    const created = {
      id: `grd-${crypto.randomUUID().slice(0, 8)}`,
      sectionId,
      name,
      isActive: true,
      sortOrder: db.grades.filter((g) => g.sectionId === sectionId).length + 1,
      createdAt: now,
      updatedAt: now,
    };
    db.grades.push(created);
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'CREATE_GRADE',
      entityType: 'grades',
      entityId: created.id,
      details: { sectionId, name },
    });
    saveDb(db);
    broadcastRealtimeEvent('STRUCTURE_UPDATED', { sectionId });
    res.status(201).json({ ok: true, grade: created });
  });

  app.patch('/api/admin/grades/:id', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const grade = db.grades.find((g) => g.id === req.params.id);
    if (!grade) {
      res.status(404).json({ ok: false, error: 'الصف غير موجود.' });
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      const nextName = req.body.name.trim();
      const normNext = normalizeArabicText(nextName);
      if (
        db.grades.some(
          (g) => g.id !== grade.id && g.sectionId === grade.sectionId && normalizeArabicText(g.name) === normNext
        )
      ) {
        res.status(409).json({ ok: false, error: 'يوجد صف آخر بنفس الاسم في هذا القسم.' });
        return;
      }
      grade.name = nextName;
    }
    if (typeof req.body?.isActive === 'boolean') {
      grade.isActive = req.body.isActive;
    }
    grade.updatedAt = new Date().toISOString();
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'UPDATE_GRADE',
      entityType: 'grades',
      entityId: grade.id,
      details: { name: grade.name, isActive: grade.isActive },
    });
    saveDb(db);
    broadcastRealtimeEvent('STRUCTURE_UPDATED', { sectionId: grade.sectionId });
    res.json({ ok: true, grade });
  });

  // Classrooms CRUD
  app.post('/api/admin/classrooms', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const gradeId = String(req.body?.gradeId ?? '');
    const name = String(req.body?.name ?? '').trim();
    const grade = db.grades.find((g) => g.id === gradeId);
    if (!grade || !name) {
      res.status(400).json({ ok: false, error: 'يرجى تحديد الصف واسم الفصل.' });
      return;
    }
    if (db.classrooms.some((c) => c.gradeId === gradeId && c.name === name)) {
      res.status(409).json({ ok: false, error: 'الفصل مسجل مسبقاً في هذا الصف.' });
      return;
    }
    const now = new Date().toISOString();
    const created = {
      id: `cls-${crypto.randomUUID().slice(0, 8)}`,
      sectionId: grade.sectionId,
      gradeId: grade.id,
      name,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    db.classrooms.push(created);
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'CREATE_CLASSROOM',
      entityType: 'classrooms',
      entityId: created.id,
      details: { gradeId: grade.id, name },
    });
    saveDb(db);
    broadcastRealtimeEvent('STRUCTURE_UPDATED', { sectionId: grade.sectionId });
    res.status(201).json({ ok: true, classroom: created });
  });

  app.patch('/api/admin/classrooms/:id', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const cls = db.classrooms.find((c) => c.id === req.params.id);
    if (!cls) {
      res.status(404).json({ ok: false, error: 'الفصل غير موجود.' });
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      const nextName = req.body.name.trim();
      const normNext = normalizeArabicText(nextName);
      if (
        db.classrooms.some(
          (c) => c.id !== cls.id && c.gradeId === cls.gradeId && normalizeArabicText(c.name) === normNext
        )
      ) {
        res.status(409).json({ ok: false, error: 'يوجد فصل آخر بنفس الاسم في هذا الصف.' });
        return;
      }
      cls.name = nextName;
    }
    if (typeof req.body?.isActive === 'boolean') {
      cls.isActive = req.body.isActive;
    }
    cls.updatedAt = new Date().toISOString();
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'UPDATE_CLASSROOM',
      entityType: 'classrooms',
      entityId: cls.id,
      details: { name: cls.name, isActive: cls.isActive },
    });
    saveDb(db);
    broadcastRealtimeEvent('STRUCTURE_UPDATED', { sectionId: cls.sectionId });
    res.json({ ok: true, classroom: cls });
  });

  // Students CRUD, Transfer, Secure PIN Generation/Reset, Archive, Excel Import
  app.post('/api/admin/students', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const fullName = String(req.body?.fullName ?? '').trim();
    const classroomId = String(req.body?.classroomId ?? '');
    const rawPin = String(req.body?.pin ?? '').trim();
    const cls = db.classrooms.find((c) => c.id === classroomId);

    if (!fullName || !cls) {
      res.status(400).json({ ok: false, error: 'يرجى إدخال اسم الطالبة واختيار الفصل.' });
      return;
    }

    const norm = normalizeArabicText(fullName);
    if (db.students.some((s) => !s.isArchived && s.normalizedName === norm)) {
      res.status(409).json({ ok: false, error: 'يوجد سجل نشط لطالبة بنفس الاسم.' });
      return;
    }

    if (rawPin && (rawPin.length < 4 || rawPin.length > 20)) {
      res.status(400).json({
        ok: false,
        error: 'يجب أن يتكون الرقم السري من 4 أرقام أو أحرف على الأقل.',
      });
      return;
    }

    const issuedPin = rawPin || generateSecurePin();
    const now = new Date().toISOString();
    const created: NidaaDatabase['students'][number] = {
      id: `std-${crypto.randomUUID().slice(0, 8)}`,
      fullName,
      normalizedName: norm,
      sectionId: cls.sectionId,
      gradeId: cls.gradeId,
      classroomId: cls.id,
      pinHash: hashSecret(issuedPin),
      isActive: true,
      isArchived: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    db.students.unshift(created);
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'CREATE_STUDENT',
      entityType: 'students',
      entityId: created.id,
      details: { fullName, classroomId: cls.id },
    });
    saveDb(db);
    broadcastRealtimeEvent('STRUCTURE_UPDATED', { sectionId: cls.sectionId });

    res.status(201).json({
      ok: true,
      student: enrichStudent(db, created),
      issuedPin,
    });
  });

  app.patch('/api/admin/students/:id', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const student = db.students.find((s) => s.id === req.params.id);
    if (!student) {
      res.status(404).json({ ok: false, error: 'الطالبة أو الطالب غير موجود.' });
      return;
    }

    const prevActive = student.isActive;
    const prevArchived = student.isArchived;

    if (typeof req.body?.fullName === 'string' && req.body.fullName.trim()) {
      const nextName = req.body.fullName.trim();
      const nextNorm = normalizeArabicText(nextName);
      const willBeArchived =
        typeof req.body?.isArchived === 'boolean' ? req.body.isArchived : student.isArchived;
      if (
        !willBeArchived &&
        db.students.some((s) => s.id !== student.id && !s.isArchived && s.normalizedName === nextNorm)
      ) {
        res.status(409).json({ ok: false, error: 'يوجد سجل نشط لطالبة أو طالب بنفس الاسم.' });
        return;
      }
      student.fullName = nextName;
      student.normalizedName = nextNorm;
    }

    if (typeof req.body?.classroomId === 'string' && req.body.classroomId) {
      const cls = db.classrooms.find((c) => c.id === req.body.classroomId);
      if (!cls) {
        res.status(400).json({ ok: false, error: 'الفصل المحدد غير موجود.' });
        return;
      }
      student.classroomId = cls.id;
      student.gradeId = cls.gradeId;
      student.sectionId = cls.sectionId;
    }

    if (typeof req.body?.isArchived === 'boolean') {
      if (
        !req.body.isArchived &&
        db.students.some(
          (s) => s.id !== student.id && !s.isArchived && s.normalizedName === student.normalizedName
        )
      ) {
        res.status(409).json({ ok: false, error: 'لا يمكن الاستعادة لوجود سجل نشط بنفس الاسم.' });
        return;
      }
      student.isArchived = req.body.isArchived;
      student.archivedAt = req.body.isArchived ? new Date().toISOString() : null;
      if (req.body.isArchived) {
        student.isActive = false;
      }
    }

    if (typeof req.body?.isActive === 'boolean' && !student.isArchived) {
      student.isActive = req.body.isActive;
    }

    student.updatedAt = new Date().toISOString();

    let actionName = 'UPDATE_STUDENT';
    if (prevArchived !== student.isArchived) {
      actionName = student.isArchived ? 'ARCHIVE_STUDENT' : 'RESTORE_STUDENT';
    } else if (prevActive !== student.isActive) {
      actionName = student.isActive ? 'ACTIVATE_STUDENT' : 'DEACTIVATE_STUDENT';
    }

    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: actionName,
      entityType: 'students',
      entityId: student.id,
      details: {
        fullName: student.fullName,
        classroomId: student.classroomId,
        isActive: student.isActive,
        isArchived: student.isArchived,
      },
    });
    saveDb(db);
    broadcastRealtimeEvent('STRUCTURE_UPDATED', { sectionId: student.sectionId });

    res.json({ ok: true, student: enrichStudent(db, student) });
  });

  app.post('/api/admin/students/:id/reset-pin', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const student = db.students.find((s) => s.id === req.params.id);
    if (!student) {
      res.status(404).json({ ok: false, error: 'الطالبة أو الطالب غير موجود.' });
      return;
    }
    const customPin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (customPin && (customPin.length < 4 || customPin.length > 20)) {
      res.status(400).json({
        ok: false,
        error: 'يجب أن يتكون الرقم السري من 4 أرقام أو أحرف على الأقل.',
      });
      return;
    }
    const issuedPin = customPin || generateSecurePin();
    student.pinHash = hashSecret(issuedPin);
    student.updatedAt = new Date().toISOString();

    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'CHANGE_STUDENT_PIN',
      entityType: 'students',
      entityId: student.id,
      details: {
        fullName: student.fullName,
        mode: customPin ? 'manual' : 'generated',
      },
    });
    saveDb(db);

    res.json({ ok: true, studentId: student.id, fullName: student.fullName, issuedPin });
  });

  app.post('/api/admin/students/import', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      res.status(400).json({ ok: false, error: 'ملف الاستيراد لا يحتوي على صفوف صالحة.' });
      return;
    }

    const errors: { rowNumber: number; message: string }[] = [];
    const imported: { fullName: string; sectionName: string; gradeName: string; classroomName: string; issuedPin: string }[] = [];
    const seenInFile = new Set<string>();
    const now = new Date().toISOString();

    rows.forEach((rawRow: Record<string, unknown>, idx: number) => {
      const rowNumber = idx + 2;
      const fullName = String(rawRow.fullName ?? '').trim();
      const sectionName = String(rawRow.sectionName ?? '').trim();
      const gradeName = String(rawRow.gradeName ?? '').trim();
      const classroomName = String(rawRow.classroomName ?? '').trim();
      const customPin = String(rawRow.pin ?? '').trim();

      if (!fullName || !sectionName || !gradeName || !classroomName) {
        errors.push({ rowNumber, message: 'حقول الاسم والقسم والصف والفصل مطلوبة.' });
        return;
      }

      const normName = normalizeArabicText(fullName);
      if (seenInFile.has(normName)) {
        errors.push({ rowNumber, message: `اسم مكرر داخل الملف: ${fullName}` });
        return;
      }
      if (db.students.some((s) => !s.isArchived && s.normalizedName === normName)) {
        errors.push({ rowNumber, message: `الطالبة مسجلة مسبقاً في النظام: ${fullName}` });
        return;
      }

      const section = db.sections.find(
        (s) => normalizeArabicText(s.name) === normalizeArabicText(sectionName)
      );
      if (!section) {
        errors.push({ rowNumber, message: `القسم غير موجود: ${sectionName}` });
        return;
      }

      let grade = db.grades.find(
        (g) =>
          g.sectionId === section.id &&
          normalizeArabicText(g.name) === normalizeArabicText(gradeName)
      );
      if (!grade) {
        grade = {
          id: `grd-${crypto.randomUUID().slice(0, 8)}`,
          sectionId: section.id,
          name: gradeName,
          isActive: true,
          sortOrder: db.grades.filter((g) => g.sectionId === section.id).length + 1,
          createdAt: now,
          updatedAt: now,
        };
        db.grades.push(grade);
      }

      let classroom = db.classrooms.find(
        (c) =>
          c.gradeId === grade!.id &&
          normalizeArabicText(c.name) === normalizeArabicText(classroomName)
      );
      if (!classroom) {
        classroom = {
          id: `cls-${crypto.randomUUID().slice(0, 8)}`,
          sectionId: section.id,
          gradeId: grade.id,
          name: classroomName,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };
        db.classrooms.push(classroom);
      }

      if (customPin && (customPin.length < 4 || customPin.length > 20)) {
        errors.push({ rowNumber, message: `الرقم السري في الملف يجب أن يكون 4 أحرف أو أرقام فأكثر: ${fullName}` });
        return;
      }

      const issuedPin = customPin || generateSecurePin();
      seenInFile.add(normName);

      db.students.unshift({
        id: `std-${crypto.randomUUID().slice(0, 8)}`,
        fullName,
        normalizedName: normName,
        sectionId: section.id,
        gradeId: grade.id,
        classroomId: classroom.id,
        pinHash: hashSecret(issuedPin),
        isActive: true,
        isArchived: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      imported.push({
        fullName,
        sectionName: section.name,
        gradeName: grade.name,
        classroomName: classroom.name,
        issuedPin,
      });
    });

    if (imported.length > 0) {
      appendAuditLog(db, {
        actorId: req.staffUser!.sub,
        actorName: req.staffUser!.fullName,
        action: 'IMPORT_STUDENTS_EXCEL',
        entityType: 'students',
        entityId: null,
        details: { importedCount: imported.length, errorCount: errors.length },
      });
      saveDb(db);
      broadcastRealtimeEvent('STRUCTURE_UPDATED', {});
    }

    res.json({
      ok: true,
      importedCount: imported.length,
      errorCount: errors.length,
      imported,
      errors,
    });
  });

  // Staff Accounts CRUD & Secure Password Reset
  app.post('/api/admin/staff', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const fullName = String(req.body?.fullName ?? '').trim();
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const role = String(req.body?.role ?? '') as 'super_admin' | 'queue_monitor';
    const sectionId =
      role === 'super_admin' ? null : String(req.body?.sectionId ?? '') || null;
    const password = String(req.body?.password ?? '').trim();

    if (!fullName || !username || !['super_admin', 'queue_monitor'].includes(role)) {
      res.status(400).json({ ok: false, error: 'بيانات الحساب غير مكتملة.' });
      return;
    }
    if (role === 'queue_monitor' && (!sectionId || !db.sections.some((s) => s.id === sectionId))) {
      res.status(400).json({ ok: false, error: 'يجب تحديد القسم لحساب مراقبة الدور.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ ok: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' });
      return;
    }
    if (db.staffAccounts.some((a) => a.username.toLowerCase() === username)) {
      res.status(409).json({ ok: false, error: 'اسم المستخدم مسجل مسبقاً.' });
      return;
    }

    const now = new Date().toISOString();
    const created: NidaaDatabase['staffAccounts'][number] = {
      id: `stf-${crypto.randomUUID().slice(0, 8)}`,
      fullName,
      username,
      role,
      sectionId,
      passwordHash: hashSecret(password),
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.staffAccounts.push(created);
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'CREATE_STAFF_ACCOUNT',
      entityType: 'staff_accounts',
      entityId: created.id,
      details: { username, role, sectionId },
    });
    saveDb(db);

    res.status(201).json({ ok: true, account: enrichStaff(db, created) });
  });

  app.patch('/api/admin/staff/:id', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const account = db.staffAccounts.find((a) => a.id === req.params.id);
    if (!account) {
      res.status(404).json({ ok: false, error: 'الحساب غير موجود.' });
      return;
    }
    if (typeof req.body?.fullName === 'string' && req.body.fullName.trim()) {
      account.fullName = req.body.fullName.trim();
    }
    if (typeof req.body?.role === 'string' && ['super_admin', 'queue_monitor'].includes(req.body.role)) {
      const nextRole = req.body.role as 'super_admin' | 'queue_monitor';
      const nextSectionId =
        nextRole === 'super_admin'
          ? null
          : String(req.body?.sectionId ?? account.sectionId ?? '').trim() || null;
      if (nextRole === 'queue_monitor' && (!nextSectionId || !db.sections.some((s) => s.id === nextSectionId))) {
        res.status(400).json({ ok: false, error: 'يجب تحديد قسم صالح لحساب مراقبة الدور.' });
        return;
      }
      account.role = nextRole;
      account.sectionId = nextSectionId;
    } else if (typeof req.body?.sectionId === 'string' && account.role === 'queue_monitor') {
      const nextSectionId = req.body.sectionId.trim();
      if (!db.sections.some((s) => s.id === nextSectionId)) {
        res.status(400).json({ ok: false, error: 'القسم المحدد غير موجود.' });
        return;
      }
      account.sectionId = nextSectionId;
    }
    if (typeof req.body?.isActive === 'boolean') {
      if (account.id === req.staffUser!.sub && !req.body.isActive) {
        res.status(400).json({ ok: false, error: 'لا يمكن تعطيل حسابك الحالي.' });
        return;
      }
      account.isActive = req.body.isActive;
    }
    account.updatedAt = new Date().toISOString();
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'UPDATE_STAFF_ACCOUNT',
      entityType: 'staff_accounts',
      entityId: account.id,
      details: { role: account.role, sectionId: account.sectionId, isActive: account.isActive },
    });
    saveDb(db);

    res.json({ ok: true, account: enrichStaff(db, account) });
  });

  app.post('/api/admin/staff/:id/reset-password', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const account = db.staffAccounts.find((a) => a.id === req.params.id);
    if (!account) {
      res.status(404).json({ ok: false, error: 'الحساب غير موجود.' });
      return;
    }
    const newPassword = String(req.body?.password ?? '').trim();
    if (newPassword.length < 6) {
      res.status(400).json({ ok: false, error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.' });
      return;
    }
    account.passwordHash = hashSecret(newPassword);
    account.updatedAt = new Date().toISOString();
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'RESET_STAFF_PASSWORD',
      entityType: 'staff_accounts',
      entityId: account.id,
      details: { username: account.username },
    });
    saveDb(db);

    res.json({ ok: true });
  });

  // Real Server Reports (Asia/Riyadh)
  app.get('/api/admin/reports', requireSuperAdmin, (req, res) => {
    const db = loadDb();
    const period = String(req.query.period ?? 'daily');
    const fromParam = String(req.query.from ?? '');
    const toParam = String(req.query.to ?? '');
    const sectionId = String(req.query.sectionId ?? 'all');
    const statusFilter = String(req.query.status ?? 'all');

    const todayKey = getRiyadhDateKey(new Date().toISOString());
    const todayDate = new Date(`${todayKey}T00:00:00+03:00`);

    let startKey = todayKey;
    let endKey = todayKey;

    if (period === 'weekly') {
      const d = new Date(todayDate.getTime() - 6 * 86400000);
      startKey = getRiyadhDateKey(d.toISOString());
    } else if (period === 'monthly') {
      const d = new Date(todayDate.getTime() - 29 * 86400000);
      startKey = getRiyadhDateKey(d.toISOString());
    } else if (period === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      startKey = fromParam <= toParam ? fromParam : toParam;
      endKey = fromParam <= toParam ? toParam : fromParam;
    } else if (period === 'all') {
      startKey = '1970-01-01';
      endKey = '2999-12-31';
    }

    const periodCalls = db.pickupRequests.filter((c) => {
      const reqKey = getRiyadhDateKey(c.requestedAt);
      const inRange = reqKey >= startKey && reqKey <= endKey;
      const matchesSec = sectionId === 'all' || c.sectionId === sectionId;
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
      return inRange && matchesSec && matchesStatus;
    });

    const waitMinutesList: number[] = [];
    periodCalls.forEach((c) => {
      const endTs = c.exitedAt ?? c.calledAt;
      if (endTs) {
        const diffMin = Math.max(
          0,
          Math.round(
            (new Date(endTs).getTime() - new Date(c.requestedAt).getTime()) /
              60000
          )
        );
        waitMinutesList.push(diffMin);
      }
    });

    const avgWaitMinutes =
      waitMinutesList.length > 0
        ? Math.round(
            (waitMinutesList.reduce((acc, v) => acc + v, 0) /
              waitMinutesList.length) *
              10
          ) / 10
        : 0;

    const sectionStats = db.sections.map((sec) => {
      const secCalls = periodCalls.filter((c) => c.sectionId === sec.id);
      return {
        sectionId: sec.id,
        sectionName: sec.name,
        total: secCalls.length,
        newCount: secCalls.filter((c) => c.status === 'new').length,
        calledCount: secCalls.filter((c) => c.status === 'called').length,
        exitedCount: secCalls.filter((c) => c.status === 'exited').length,
        cancelledCount: secCalls.filter((c) => c.status === 'cancelled').length,
      };
    });

    res.json({
      ok: true,
      range: { startKey, endKey, period },
      summary: {
        totalCalls: periodCalls.length,
        newCalls: periodCalls.filter((c) => c.status === 'new').length,
        waitingCalls: periodCalls.filter(
          (c) => c.status === 'new' || c.status === 'called'
        ).length,
        calledCalls: periodCalls.filter((c) => c.status === 'called').length,
        exitedCalls: periodCalls.filter((c) => c.status === 'exited').length,
        cancelledCalls: periodCalls.filter((c) => c.status === 'cancelled').length,
        avgWaitMinutes,
      },
      sectionStats,
      calls: periodCalls
        .map((c) => enrichCall(db, c))
        .sort(
          (a, b) =>
            new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
        ),
    });
  });

  // Settings & Academic Years
  app.patch('/api/admin/settings', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const maxAttempts = Number(req.body?.maxParentAttempts);
    const lockoutMinutes = Number(req.body?.lockoutMinutes);

    if (Number.isFinite(maxAttempts) && maxAttempts >= 3 && maxAttempts <= 20) {
      db.settings.maxParentAttempts = maxAttempts;
    }
    if (Number.isFinite(lockoutMinutes) && lockoutMinutes >= 1 && lockoutMinutes <= 120) {
      db.settings.lockoutMinutes = lockoutMinutes;
    }
    if (typeof req.body?.activeAcademicYearId === 'string') {
      const yr = db.academicYears.find(
        (y) => y.id === req.body.activeAcademicYearId
      );
      if (yr) {
        db.academicYears.forEach((y) => {
          y.isActive = y.id === yr.id;
        });
        db.settings.activeAcademicYearId = yr.id;
      }
    }
    db.settings.updatedAt = new Date().toISOString();
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'UPDATE_SETTINGS',
      entityType: 'settings',
      entityId: '1',
      details: { ...db.settings },
    });
    saveDb(db);
    res.json({ ok: true, settings: db.settings, academicYears: db.academicYears });
  });

  app.post('/api/admin/academic-years', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
    const db = loadDb();
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ ok: false, error: 'يرجى إدخال مسمى العام الدراسي.' });
      return;
    }
    if (db.academicYears.some((y) => y.name === name)) {
      res.status(409).json({ ok: false, error: 'العام الدراسي مسجل مسبقاً.' });
      return;
    }
    const created = {
      id: crypto.randomUUID(),
      name,
      isActive: Boolean(req.body?.setActive),
      createdAt: new Date().toISOString(),
    };
    if (created.isActive) {
      db.academicYears.forEach((y) => {
        y.isActive = false;
      });
      db.settings.activeAcademicYearId = created.id;
    }
    db.academicYears.unshift(created);
    appendAuditLog(db, {
      actorId: req.staffUser!.sub,
      actorName: req.staffUser!.fullName,
      action: 'CREATE_ACADEMIC_YEAR',
      entityType: 'academic_years',
      entityId: created.id,
      details: { name },
    });
    saveDb(db);
    res.status(201).json({ ok: true, academicYears: db.academicYears, settings: db.settings });
  });

  // --------------------------------------------------------------------------
  // Vite Middleware (Dev) or Static Dist (Production)
  // --------------------------------------------------------------------------
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nidaa server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Nidaa server:', err);
  process.exit(1);
});
