import {
  AcademicYear,
  AuditLog,
  Classroom,
  Grade,
  ParentRegistration,
  PickupRequest,
  PickupStatus,
  ReportSummary,
  Section,
  SectionReportRow,
  StaffAccount,
  StaffRole,
  Student,
  SystemSettings,
} from '../types/nidaa';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

let inMemoryAuthToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  inMemoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryAuthToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const hadStaffToken = Boolean(inMemoryAuthToken);
  if (inMemoryAuthToken) {
    headers.set('Authorization', `Bearer ${inMemoryAuthToken}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = (await response.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
  };

  if (!response.ok) {
    if (
      response.status === 401 &&
      hadStaffToken &&
      !url.startsWith('/api/auth/login') &&
      !url.startsWith('/api/parent/')
    ) {
      inMemoryAuthToken = null;
      unauthorizedHandler?.();
    }
    throw new Error(data.error || 'تعذر تنفيذ العملية على الخادم.');
  }
  return data;
}

export const apiClient = {
  // --------------------------------------------------------------------------
  // Auth
  // --------------------------------------------------------------------------
  getAuthStatus: () =>
    apiRequest<{ ok: true; needsSetup: boolean; envAdminConfigured: boolean }>(
      '/api/auth/status'
    ),

  setupSuperAdmin: async (payload: {
    fullName: string;
    username: string;
    password: string;
  }) => {
    const res = await apiRequest<{
      ok: true;
      token: string;
      user: StaffAccount;
    }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthToken(res.token);
    return res;
  },

  loginStaff: async (payload: { username: string; password: string }) => {
    const res = await apiRequest<{
      ok: true;
      token: string;
      user: StaffAccount;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthToken(res.token);
    return res;
  },

  getMe: () => apiRequest<{ ok: true; user: StaffAccount }>('/api/auth/me'),

  logout: () => {
    setAuthToken(null);
  },

  // --------------------------------------------------------------------------
  // Parent Public API
  // --------------------------------------------------------------------------
  fetchParentStructure: () =>
    apiRequest<{
      ok: true;
      sections: Section[];
      grades: Grade[];
      classrooms: Classroom[];
    }>('/api/parent/structure'),

  submitParentRegistration: (payload: {
    studentName: string;
    gradeName: string;
    classroomName: string;
    pin: string;
    sectionId?: string | null;
  }) =>
    apiRequest<{
      ok: true;
      registration: ParentRegistration;
      trackingToken: string;
    }>('/api/parent/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  fetchParentRegistrationStatus: (regId: string, trackingToken: string) =>
    apiRequest<{ ok: true; registration: ParentRegistration }>(
      `/api/parent/register/${encodeURIComponent(
        regId
      )}?token=${encodeURIComponent(trackingToken)}`
    ),

  subscribeParentRegistrationRealtime: (
    regId: string,
    trackingToken: string,
    onUpdate: (registration: ParentRegistration) => void
  ) => {
    const url = `/api/realtime?regId=${encodeURIComponent(
      regId
    )}&regToken=${encodeURIComponent(trackingToken)}`;
    const es = new EventSource(url);
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed?.registration) {
          onUpdate(parsed.registration as ParentRegistration);
        }
      } catch {
        // ignore keepalive
      }
    };
    return () => {
      es.close();
    };
  },

  submitParentCall: (studentName: string, pin: string) =>
    apiRequest<{
      ok: true;
      duplicate: boolean;
      call: PickupRequest;
      trackingToken: string;
    }>('/api/parent/call', {
      method: 'POST',
      body: JSON.stringify({ studentName, pin }),
    }),

  fetchParentCallStatus: (callId: string, trackingToken: string) =>
    apiRequest<{ ok: true; call: PickupRequest }>(
      `/api/parent/call/${encodeURIComponent(callId)}?token=${encodeURIComponent(
        trackingToken
      )}`
    ),

  subscribeParentCallRealtime: (
    callId: string,
    trackingToken: string,
    onCallUpdate: (call: PickupRequest) => void
  ) => {
    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient();
      if (supabase) {
        const channel = supabase
          .channel(`parent-call-${callId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'pickup_requests',
              filter: `id=eq.${callId}`,
            },
            async () => {
              try {
                const res = await apiClient.fetchParentCallStatus(
                  callId,
                  trackingToken
                );
                onCallUpdate(res.call);
              } catch {
                // ignore transient fetch errors
              }
            }
          )
          .subscribe();
        return () => {
          supabase.removeChannel(channel);
        };
      }
    }

    const url = `/api/realtime?callId=${encodeURIComponent(
      callId
    )}&trackingToken=${encodeURIComponent(trackingToken)}`;
    const es = new EventSource(url);
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed?.call) {
          onCallUpdate(parsed.call as PickupRequest);
        }
      } catch {
        // ignore keepalive
      }
    };
    return () => {
      es.close();
    };
  },

  // --------------------------------------------------------------------------
  // Staff Realtime Subscription
  // --------------------------------------------------------------------------
  subscribeStaffRealtime: (onEvent: () => void) => {
    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient();
      if (supabase) {
        const channel = supabase
          .channel('nidaa-staff-realtime')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'pickup_requests' },
            () => onEvent()
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'sections' },
            () => onEvent()
          )
          .subscribe();
        return () => {
          supabase.removeChannel(channel);
        };
      }
    }

    if (!inMemoryAuthToken) return () => {};
    const url = `/api/realtime?token=${encodeURIComponent(inMemoryAuthToken)}`;
    const es = new EventSource(url);
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed?.type && parsed.type !== 'CONNECTED') {
          onEvent();
        }
      } catch {
        // ignore
      }
    };
    return () => {
      es.close();
    };
  },

  // --------------------------------------------------------------------------
  // Queue Monitor
  // --------------------------------------------------------------------------
  fetchQueueData: (sectionId?: string | null) => {
    const query = sectionId
      ? `?sectionId=${encodeURIComponent(sectionId)}`
      : '';
    return apiRequest<{
      ok: true;
      sections: Section[];
      grades: Grade[];
      classrooms: Classroom[];
      students: Student[];
      calls: PickupRequest[];
    }>(`/api/queue/data${query}`);
  },

  updateCallStatus: (callId: string, status: PickupStatus) =>
    apiRequest<{ ok: true; call: PickupRequest }>(
      `/api/calls/${encodeURIComponent(callId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }
    ),

  // --------------------------------------------------------------------------
  // Super Admin
  // --------------------------------------------------------------------------
  fetchAdminBootstrap: () =>
    apiRequest<{
      ok: true;
      sections: Section[];
      grades: Grade[];
      classrooms: Classroom[];
      students: Student[];
      parentRegistrations: ParentRegistration[];
      staffAccounts: StaffAccount[];
      calls: PickupRequest[];
      auditLogs: AuditLog[];
      academicYears: AcademicYear[];
      settings: SystemSettings;
    }>('/api/admin/bootstrap'),

  approveParentRegistration: (
    id: string,
    payload: { sectionId: string; gradeId?: string; classroomId?: string }
  ) =>
    apiRequest<{
      ok: true;
      registration: ParentRegistration;
      student: Student;
    }>(`/api/admin/registrations/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  rejectParentRegistration: (id: string, reason?: string) =>
    apiRequest<{ ok: true; registration: ParentRegistration }>(
      `/api/admin/registrations/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),

  createSection: (name: string) =>
    apiRequest<{ ok: true; section: Section }>('/api/admin/sections', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  updateSection: (id: string, data: { name?: string; isActive?: boolean }) =>
    apiRequest<{ ok: true; section: Section }>(
      `/api/admin/sections/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    ),

  createGrade: (sectionId: string, name: string) =>
    apiRequest<{ ok: true; grade: Grade }>('/api/admin/grades', {
      method: 'POST',
      body: JSON.stringify({ sectionId, name }),
    }),

  updateGrade: (id: string, data: { name?: string; isActive?: boolean }) =>
    apiRequest<{ ok: true; grade: Grade }>(
      `/api/admin/grades/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    ),

  createClassroom: (gradeId: string, name: string) =>
    apiRequest<{ ok: true; classroom: Classroom }>('/api/admin/classrooms', {
      method: 'POST',
      body: JSON.stringify({ gradeId, name }),
    }),

  updateClassroom: (id: string, data: { name?: string; isActive?: boolean }) =>
    apiRequest<{ ok: true; classroom: Classroom }>(
      `/api/admin/classrooms/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    ),

  createStudent: (payload: {
    fullName: string;
    classroomId: string;
    pin?: string;
  }) =>
    apiRequest<{ ok: true; student: Student; issuedPin: string }>(
      '/api/admin/students',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateStudent: (
    id: string,
    payload: {
      fullName?: string;
      classroomId?: string;
      isActive?: boolean;
      isArchived?: boolean;
    }
  ) =>
    apiRequest<{ ok: true; student: Student }>(
      `/api/admin/students/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  resetStudentPin: (id: string, pin?: string) =>
    apiRequest<{
      ok: true;
      studentId: string;
      fullName: string;
      issuedPin: string;
    }>(`/api/admin/students/${encodeURIComponent(id)}/reset-pin`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  importStudentsExcel: (
    rows: {
      fullName: string;
      sectionName: string;
      gradeName: string;
      classroomName: string;
      pin?: string;
    }[]
  ) =>
    apiRequest<{
      ok: true;
      importedCount: number;
      errorCount: number;
      imported: {
        fullName: string;
        sectionName: string;
        gradeName: string;
        classroomName: string;
        issuedPin: string;
      }[];
      errors: { rowNumber: number; message: string }[];
    }>('/api/admin/students/import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),

  createStaffAccount: (payload: {
    fullName: string;
    username: string;
    role: StaffRole;
    sectionId: string | null;
    password: string;
  }) =>
    apiRequest<{ ok: true; account: StaffAccount }>('/api/admin/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateStaffAccount: (
    id: string,
    payload: {
      fullName?: string;
      role?: StaffRole;
      sectionId?: string | null;
      isActive?: boolean;
    }
  ) =>
    apiRequest<{ ok: true; account: StaffAccount }>(
      `/api/admin/staff/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  resetStaffPassword: (id: string, password: string) =>
    apiRequest<{ ok: true }>(
      `/api/admin/staff/${encodeURIComponent(id)}/reset-password`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      }
    ),

  fetchReports: (params: {
    period: 'daily' | 'weekly' | 'monthly' | 'custom' | 'all';
    from?: string;
    to?: string;
    sectionId?: string;
    status?: string;
  }) => {
    const sp = new URLSearchParams({ period: params.period });
    if (params.from) sp.set('from', params.from);
    if (params.to) sp.set('to', params.to);
    if (params.sectionId) sp.set('sectionId', params.sectionId);
    if (params.status) sp.set('status', params.status);
    return apiRequest<{
      ok: true;
      range: { startKey: string; endKey: string; period: string };
      summary: ReportSummary;
      sectionStats: SectionReportRow[];
      calls: PickupRequest[];
    }>(`/api/admin/reports?${sp.toString()}`);
  },

  updateSettings: (payload: {
    maxParentAttempts?: number;
    lockoutMinutes?: number;
    activeAcademicYearId?: string;
  }) =>
    apiRequest<{
      ok: true;
      settings: SystemSettings;
      academicYears: AcademicYear[];
    }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createAcademicYear: (name: string, setActive: boolean) =>
    apiRequest<{
      ok: true;
      academicYears: AcademicYear[];
      settings: SystemSettings;
    }>('/api/admin/academic-years', {
      method: 'POST',
      body: JSON.stringify({ name, setActive }),
    }),
};
