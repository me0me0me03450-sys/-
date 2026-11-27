export type StaffRole = 'super_admin' | 'queue_monitor';
export type PickupStatus = 'new' | 'called' | 'exited' | 'cancelled';
export type RegistrationStatus = 'pending' | 'approved' | 'rejected';
export type AppRoute = 'parent' | 'staff_hub' | 'staff_queue' | 'staff_admin';

export interface AcademicYear {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface ParentRegistration {
  id: string;
  studentName: string;
  gradeName: string;
  classroomName: string;
  sectionId: string | null;
  sectionName: string;
  gradeId: string | null;
  classroomId: string | null;
  status: RegistrationStatus;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  rejectionReason: string | null;
  studentId: string | null;
}

export interface Section {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface Grade {
  id: string;
  sectionId: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface Classroom {
  id: string;
  sectionId: string;
  gradeId: string;
  name: string;
  isActive: boolean;
}

export interface Student {
  id: string;
  fullName: string;
  sectionId: string;
  sectionName: string;
  gradeId: string;
  gradeName: string;
  classroomId: string;
  classroomName: string;
  isActive: boolean;
  isArchived: boolean;
  archivedAt: string | null;
}

export interface PickupRequest {
  id: string;
  studentId: string;
  studentName: string;
  sectionId: string;
  sectionName: string;
  gradeId: string;
  gradeName: string;
  classroomId: string;
  classroomName: string;
  academicYearId: string | null;
  status: PickupStatus;
  requestedAt: string;
  calledAt: string | null;
  exitedAt: string | null;
  cancelledAt: string | null;
  handledByName: string | null;
}

export interface StaffAccount {
  id: string;
  fullName: string;
  username: string;
  role: StaffRole;
  sectionId: string | null;
  sectionName: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface SystemSettings {
  schoolName: string;
  platformName: string;
  timezone: 'Asia/Riyadh';
  maxParentAttempts: number;
  lockoutMinutes: number;
  activeAcademicYearId: string | null;
  updatedAt: string;
}

export interface ReportSummary {
  totalCalls: number;
  newCalls: number;
  waitingCalls: number;
  calledCalls: number;
  exitedCalls: number;
  cancelledCalls: number;
  avgWaitMinutes: number;
}

export interface SectionReportRow {
  sectionId: string;
  sectionName: string;
  total: number;
  newCount: number;
  calledCount: number;
  exitedCount: number;
  cancelledCount: number;
}
