import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Menu,
  MonitorCheck,
  Pencil,
  Plus,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { BrandMark, UnifiedFooter } from '../components/BrandMark';
import { apiClient } from '../services/apiClient';
import {
  downloadStudentImportTemplate,
  exportCallsToExcel,
  exportCallsToWord,
  exportGeneratedPinsToExcel,
  parseStudentsExcel,
} from '../services/reportExportService';
import {
  AcademicYear,
  AppRoute,
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
import {
  calculateWaitMinutes,
  formatDateTimeRiyadh,
  formatTimeRiyadh,
  formatWaitDurationArabic,
  getStatusLabel,
  getTodayRiyadhInputDate,
  normalizeArabicText,
} from '../utils/formatters';

type AdminSection =
  | 'overview'
  | 'live'
  | 'registrations'
  | 'structure'
  | 'students'
  | 'accounts'
  | 'reports'
  | 'archive'
  | 'settings';

interface SystemAdminViewProps {
  currentUser: StaffAccount;
  onNavigate: (route: AppRoute) => void;
}

const SECTION_ITEMS: {
  id: AdminSection;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'لوحة الإحصائيات', icon: BarChart3 },
  { id: 'live', label: 'النداءات المباشرة', icon: Radio },
  { id: 'registrations', label: 'طلبات التسجيل', icon: ClipboardCheck },
  { id: 'structure', label: 'الأقسام والصفوف والفصول', icon: Layers },
  { id: 'students', label: 'إدارة الطالبات والطلاب', icon: Users },
  { id: 'accounts', label: 'الحسابات والصلاحيات', icon: ShieldCheck },
  { id: 'reports', label: 'التقارير والإحصائيات', icon: FileSpreadsheet },
  { id: 'archive', label: 'الأرشيف', icon: Archive },
  { id: 'settings', label: 'الإعدادات وسجل التدقيق', icon: Settings },
];

function getAuditActionLabel(action: string): string {
  switch (action) {
    case 'SUBMIT_PARENT_REGISTRATION':
      return 'طلب تسجيل جديد (ولي أمر)';
    case 'APPROVE_PARENT_REGISTRATION':
      return 'تفعيل طلب تسجيل ولي أمر';
    case 'REJECT_PARENT_REGISTRATION':
      return 'رفض طلب تسجيل ولي أمر';
    case 'ACTIVATE_STUDENT':
      return 'إعادة تفعيل الحساب والرقم السري';
    case 'DEACTIVATE_STUDENT':
      return 'تعطيل الحساب والرقم السري';
    case 'CHANGE_STUDENT_PIN':
      return 'تغيير الرقم السري';
    case 'RESET_STUDENT_PIN':
      return 'إعادة تعيين الرقم السري';
    case 'CREATE_STUDENT':
      return 'إضافة طالبة / طالب';
    case 'UPDATE_STUDENT':
      return 'تعديل بيانات طالبة / طالب';
    case 'ARCHIVE_STUDENT':
      return 'أرشفة سجل';
    case 'RESTORE_STUDENT':
      return 'استعادة من الأرشيف';
    case 'UPDATE_CALL_CALLED':
      return 'تأكيد النداء';
    case 'UPDATE_CALL_EXITED':
      return 'تأكيد الخروج';
    case 'UPDATE_CALL_CANCELLED':
      return 'إلغاء نداء';
    default:
      return action;
  }
}

export const SystemAdminView: React.FC<SystemAdminViewProps> = ({
  currentUser,
  onNavigate,
}) => {
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Core DB State
  const [sections, setSections] = useState<Section[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [parentRegistrations, setParentRegistrations] = useState<
    ParentRegistration[]
  >([]);
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);
  const [calls, setCalls] = useState<PickupRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  // Registrations review state
  const [regFilter, setRegFilter] = useState<
    'pending' | 'approved' | 'rejected' | 'all'
  >('pending');
  const [approvingReg, setApprovingReg] = useState<ParentRegistration | null>(
    null
  );
  const [approveSectionId, setApproveSectionId] = useState<string>('');
  const [approveGradeId, setApproveGradeId] = useState<string>('');
  const [approveClassroomId, setApproveClassroomId] = useState<string>('');
  const [rejectingReg, setRejectingReg] = useState<ParentRegistration | null>(
    null
  );
  const [rejectReason, setRejectReason] = useState<string>('');

  // Change / reset student PIN modal
  const [changePinStudent, setChangePinStudent] = useState<Student | null>(null);
  const [customStudentPin, setCustomStudentPin] = useState<string>('');

  // Overview & Reports state
  const [reportPeriod, setReportPeriod] = useState<
    'daily' | 'weekly' | 'monthly' | 'custom' | 'all'
  >('daily');
  const [reportFrom, setReportFrom] = useState<string>(() =>
    getTodayRiyadhInputDate()
  );
  const [reportTo, setReportTo] = useState<string>(() =>
    getTodayRiyadhInputDate()
  );
  const [reportSectionFilter, setReportSectionFilter] = useState<string>('all');
  const [reportStatusFilter, setReportStatusFilter] = useState<string>('all');
  const [reportSummary, setReportSummary] = useState<ReportSummary>({
    totalCalls: 0,
    newCalls: 0,
    waitingCalls: 0,
    calledCalls: 0,
    exitedCalls: 0,
    cancelledCalls: 0,
    avgWaitMinutes: 0,
  });
  const [reportSectionStats, setReportSectionStats] = useState<
    SectionReportRow[]
  >([]);
  const [reportCalls, setReportCalls] = useState<PickupRequest[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Structure state
  const [selectedSecId, setSelectedSecId] = useState<string>('');
  const [selectedGradeId, setSelectedGradeId] = useState<string>('');
  const [newSectionName, setNewSectionName] = useState('');
  const [newGradeName, setNewGradeName] = useState('');
  const [newClassroomName, setNewClassroomName] = useState('');
  const [renamingItem, setRenamingItem] = useState<{
    kind: 'section' | 'grade' | 'classroom';
    id: string;
    name: string;
  } | null>(null);

  // Students & Excel Import state
  const [studentSearch, setStudentSearch] = useState('');
  const [stuFilterSec, setStuFilterSec] = useState<string>('all');
  const [stuFilterGrade, setStuFilterGrade] = useState<string>('all');
  const [stuFilterClass, setStuFilterClass] = useState<string>('all');
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [studentForm, setStudentForm] = useState({
    fullName: '',
    sectionId: '',
    gradeId: '',
    classroomId: '',
    pin: '',
  });
  const [issuedPinBanner, setIssuedPinBanner] = useState<{
    title: string;
    pin: string;
  } | null>(null);
  const [importResult, setImportResult] = useState<{
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
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Staff Accounts state
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<StaffAccount | null>(null);
  const [accountForm, setAccountForm] = useState({
    fullName: '',
    username: '',
    role: 'queue_monitor' as StaffRole,
    sectionId: '',
    password: '',
  });
  const [resetPwdModal, setResetPwdModal] = useState<StaffAccount | null>(null);
  const [newStaffPassword, setNewStaffPassword] = useState('');

  // Live calls filter
  const [liveSecFilter, setLiveSecFilter] = useState<string>('all');

  // Settings form
  const [newYearName, setNewYearName] = useState('');
  const [maxAttemptsInput, setMaxAttemptsInput] = useState(5);
  const [lockoutMinsInput, setLockoutMinsInput] = useState(10);

  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback(
    (type: 'success' | 'error', text: string) => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      setNotice({ type, text });
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice(null);
        noticeTimerRef.current = null;
      }, 4500);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const res = await apiClient.fetchAdminBootstrap();
      setSections(res.sections);
      setGrades(res.grades);
      setClassrooms(res.classrooms);
      setStudents(res.students);
      setParentRegistrations(res.parentRegistrations ?? []);
      setStaffAccounts(res.staffAccounts);
      setCalls(res.calls);
      setAuditLogs(res.auditLogs);
      setAcademicYears(res.academicYears);
      setSettings(res.settings);
      setMaxAttemptsInput(res.settings.maxParentAttempts);
      setLockoutMinsInput(res.settings.lockoutMinutes);

      if (!selectedSecId && res.sections.length > 0) {
        setSelectedSecId(res.sections[0].id);
      }
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل بيانات لوحة التحكم.'
      );
    } finally {
      setLoading(false);
    }
  }, [selectedSecId, showNotice]);

  const loadReports = useCallback(async () => {
    try {
      const res = await apiClient.fetchReports({
        period: reportPeriod,
        from: reportPeriod === 'custom' ? reportFrom : undefined,
        to: reportPeriod === 'custom' ? reportTo : undefined,
        sectionId: reportSectionFilter,
        status: reportStatusFilter,
      });
      setReportSummary(res.summary);
      setReportSectionStats(res.sectionStats);
      setReportCalls(res.calls);
    } catch {
      // ignore
    }
  }, [
    reportPeriod,
    reportFrom,
    reportTo,
    reportSectionFilter,
    reportStatusFilter,
  ]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    const unsubscribe = apiClient.subscribeStaffRealtime(() => {
      loadBootstrap();
      loadReports();
    });
    const ticker = window.setInterval(() => setNowMs(Date.now()), 15000);
    return () => {
      unsubscribe();
      window.clearInterval(ticker);
    };
  }, [loadBootstrap, loadReports]);

  // Derived collections
  const activeStudents = useMemo(
    () => students.filter((s) => !s.isArchived),
    [students]
  );
  const archivedStudents = useMemo(
    () => students.filter((s) => s.isArchived),
    [students]
  );

  const pendingRegistrationsCount = useMemo(
    () => parentRegistrations.filter((r) => r.status === 'pending').length,
    [parentRegistrations]
  );

  const filteredRegistrations = useMemo(() => {
    if (regFilter === 'all') return parentRegistrations;
    return parentRegistrations.filter((r) => r.status === regFilter);
  }, [parentRegistrations, regFilter]);

  const structureGrades = useMemo(
    () => grades.filter((g) => g.sectionId === selectedSecId),
    [grades, selectedSecId]
  );

  useEffect(() => {
    if (
      structureGrades.length > 0 &&
      !structureGrades.some((g) => g.id === selectedGradeId)
    ) {
      setSelectedGradeId(structureGrades[0].id);
    } else if (structureGrades.length === 0) {
      setSelectedGradeId('');
    }
  }, [structureGrades, selectedGradeId]);

  const structureClassrooms = useMemo(
    () => classrooms.filter((c) => c.gradeId === selectedGradeId),
    [classrooms, selectedGradeId]
  );

  const filteredActiveStudents = useMemo(() => {
    const q = normalizeArabicText(studentSearch);
    return activeStudents.filter((s) => {
      if (stuFilterSec !== 'all' && s.sectionId !== stuFilterSec) return false;
      if (stuFilterGrade !== 'all' && s.gradeId !== stuFilterGrade) return false;
      if (stuFilterClass !== 'all' && s.classroomId !== stuFilterClass)
        return false;
      if (
        q &&
        !normalizeArabicText(s.fullName).includes(q) &&
        !normalizeArabicText(s.classroomName).includes(q) &&
        !normalizeArabicText(s.gradeName).includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [
    activeStudents,
    stuFilterSec,
    stuFilterGrade,
    stuFilterClass,
    studentSearch,
  ]);

  const liveCalls = useMemo(() => {
    return calls
      .filter((c) => c.status === 'new' || c.status === 'called')
      .filter((c) => liveSecFilter === 'all' || c.sectionId === liveSecFilter)
      .sort(
        (a, b) =>
          new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
      );
  }, [calls, liveSecFilter]);

  // --------------------------------------------------------------------------
  // Action Handlers
  // --------------------------------------------------------------------------
  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    try {
      const res = await apiClient.createSection(newSectionName);
      setNewSectionName('');
      setSelectedSecId(res.section.id);
      await loadBootstrap();
      showNotice('success', 'تم إضافة القسم بنجاح.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'تعذر إضافة القسم.');
    }
  };

  const handleCreateGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSecId || !newGradeName.trim()) return;
    try {
      const res = await apiClient.createGrade(selectedSecId, newGradeName);
      setNewGradeName('');
      setSelectedGradeId(res.grade.id);
      await loadBootstrap();
      showNotice('success', 'تم إضافة الصف بنجاح.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'تعذر إضافة الصف.');
    }
  };

  const handleCreateClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGradeId || !newClassroomName.trim()) return;
    try {
      await apiClient.createClassroom(selectedGradeId, newClassroomName);
      setNewClassroomName('');
      await loadBootstrap();
      showNotice('success', 'تم إضافة الفصل بنجاح.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'تعذر إضافة الفصل.');
    }
  };

  const handleSaveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingItem || !renamingItem.name.trim()) return;
    try {
      if (renamingItem.kind === 'section') {
        await apiClient.updateSection(renamingItem.id, {
          name: renamingItem.name,
        });
      } else if (renamingItem.kind === 'grade') {
        await apiClient.updateGrade(renamingItem.id, {
          name: renamingItem.name,
        });
      } else {
        await apiClient.updateClassroom(renamingItem.id, {
          name: renamingItem.name,
        });
      }
      setRenamingItem(null);
      await loadBootstrap();
      showNotice('success', 'تم تحديث المسمى بنجاح.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const openCreateStudentModal = () => {
    const firstSec = sections[0]?.id ?? '';
    const firstGrade = grades.find((g) => g.sectionId === firstSec)?.id ?? '';
    const firstClass = classrooms.find((c) => c.gradeId === firstGrade)?.id ?? '';
    setEditingStudent(null);
    setStudentForm({
      fullName: '',
      sectionId: firstSec,
      gradeId: firstGrade,
      classroomId: firstClass,
      pin: '',
    });
    setStudentModalOpen(true);
  };

  const openEditStudentModal = (student: Student) => {
    setEditingStudent(student);
    setStudentForm({
      fullName: student.fullName,
      sectionId: student.sectionId,
      gradeId: student.gradeId,
      classroomId: student.classroomId,
      pin: '',
    });
    setStudentModalOpen(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentForm.fullName.trim() || !studentForm.classroomId) {
      showNotice('error', 'يرجى إدخال الاسم واختيار الصف والفصل أولاً.');
      return;
    }
    const cleanPin = studentForm.pin.trim();
    if (!editingStudent && cleanPin && (cleanPin.length < 4 || cleanPin.length > 20)) {
      showNotice('error', 'الرقم السري المخصص يجب أن يتكون من 4 أرقام أو أحرف على الأقل.');
      return;
    }
    try {
      if (editingStudent) {
        await apiClient.updateStudent(editingStudent.id, {
          fullName: studentForm.fullName.trim(),
          classroomId: studentForm.classroomId,
        });
        showNotice('success', 'تم تحديث بيانات الطالبة.');
      } else {
        const res = await apiClient.createStudent({
          fullName: studentForm.fullName.trim(),
          classroomId: studentForm.classroomId,
          pin: cleanPin || undefined,
        });
        setIssuedPinBanner({
          title: `الرقم السري الصادر للطالبة: ${res.student.fullName}`,
          pin: res.issuedPin,
        });
        showNotice('success', 'تمت إضافة الطالبة وإصدار الرقم السري المشفر.');
      }
      setStudentModalOpen(false);
      await loadBootstrap();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'تعذر الحفظ.');
    }
  };

  const handleOpenChangePinModal = (student: Student) => {
    setChangePinStudent(student);
    setCustomStudentPin('');
  };

  const handleConfirmChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changePinStudent) return;
    try {
      const res = await apiClient.resetStudentPin(
        changePinStudent.id,
        customStudentPin.trim() || undefined
      );
      setIssuedPinBanner({
        title: `تم تحديث الرقم السري للطالبة/الطالب: ${res.fullName}`,
        pin: res.issuedPin,
      });
      setChangePinStudent(null);
      setCustomStudentPin('');
      await loadBootstrap();
      showNotice('success', 'تم تحديث الرقم السري وتسجيل العملية في سجل التدقيق.');
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'تعذر تحديث الرقم السري.'
      );
    }
  };

  const openApproveModal = (reg: ParentRegistration) => {
    const defaultSecId =
      reg.sectionId ?? sections.find((s) => s.isActive)?.id ?? sections[0]?.id ?? '';
    setApprovingReg(reg);
    setApproveSectionId(defaultSecId);
    setApproveGradeId(reg.gradeId ?? '');
    setApproveClassroomId(reg.classroomId ?? '');
  };

  const handleConfirmApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingReg || !approveSectionId) return;
    try {
      await apiClient.approveParentRegistration(approvingReg.id, {
        sectionId: approveSectionId,
        gradeId: approveGradeId || undefined,
        classroomId: approveClassroomId || undefined,
      });
      setApprovingReg(null);
      await loadBootstrap();
      showNotice(
        'success',
        'تم تفعيل طلب التسجيل وإتاحة الرقم السري لإرسال النداءات.'
      );
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'تعذر تفعيل الطلب.'
      );
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReg) return;
    try {
      await apiClient.rejectParentRegistration(
        rejectingReg.id,
        rejectReason.trim() || undefined
      );
      setRejectingReg(null);
      setRejectReason('');
      await loadBootstrap();
      showNotice('success', 'تم رفض طلب التسجيل.');
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'تعذر رفض الطلب.'
      );
    }
  };

  const handleExcelFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const rows = await parseStudentsExcel(file);
      if (rows.length === 0) {
        showNotice('error', 'الملف فارغ أو لا يطابق أعمدة القالب.');
        return;
      }
      const res = await apiClient.importStudentsExcel(rows);
      setImportResult(res);
      await loadBootstrap();
      showNotice(
        'success',
        `تم استيراد ${res.importedCount} طالبة بنجاح (أخطاء: ${res.errorCount}).`
      );
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'تعذر قراءة ملف Excel.'
      );
    }
  };

  const openCreateAccountModal = () => {
    setEditingAccount(null);
    setAccountForm({
      fullName: '',
      username: '',
      role: 'queue_monitor',
      sectionId: sections[0]?.id ?? '',
      password: '',
    });
    setAccountModalOpen(true);
  };

  const openEditAccountModal = (acc: StaffAccount) => {
    setEditingAccount(acc);
    setAccountForm({
      fullName: acc.fullName,
      username: acc.username,
      role: acc.role,
      sectionId: acc.sectionId ?? sections[0]?.id ?? '',
      password: '',
    });
    setAccountModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingAccount) {
        await apiClient.updateStaffAccount(editingAccount.id, {
          fullName: accountForm.fullName,
          role: accountForm.role,
          sectionId:
            accountForm.role === 'super_admin' ? null : accountForm.sectionId,
        });
        showNotice('success', 'تم تحديث الحساب بنجاح.');
      } else {
        await apiClient.createStaffAccount({
          fullName: accountForm.fullName,
          username: accountForm.username,
          role: accountForm.role,
          sectionId:
            accountForm.role === 'super_admin' ? null : accountForm.sectionId,
          password: accountForm.password,
        });
        showNotice('success', 'تم إنشاء حساب الموظفة بنجاح.');
      }
      setAccountModalOpen(false);
      await loadBootstrap();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'تعذر حفظ الحساب.');
    }
  };

  const handleResetStaffPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwdModal || !newStaffPassword.trim()) return;
    try {
      await apiClient.resetStaffPassword(resetPwdModal.id, newStaffPassword);
      setResetPwdModal(null);
      setNewStaffPassword('');
      showNotice('success', 'تم تحديث كلمة المرور بنجاح.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const handleUpdateCallStatus = async (
    callId: string,
    status: PickupStatus
  ) => {
    try {
      await apiClient.updateCallStatus(callId, status);
      await Promise.all([loadBootstrap(), loadReports()]);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'تعذر تحديث الحالة.');
    }
  };

  const getRangeLabel = () => {
    if (reportPeriod === 'daily') return 'تقرير اليوم';
    if (reportPeriod === 'weekly') return 'التقرير الأسبوعي (آخر 7 أيام)';
    if (reportPeriod === 'monthly') return 'التقرير الشهري (آخر 30 يوماً)';
    if (reportPeriod === 'custom') return `من ${reportFrom} إلى ${reportTo}`;
    return 'كامل السجلات';
  };

  const modalGrades = grades.filter((g) => g.sectionId === studentForm.sectionId);
  const modalClassrooms = classrooms.filter(
    (c) => c.gradeId === studentForm.gradeId
  );

  const filterGrades =
    stuFilterSec === 'all'
      ? grades
      : grades.filter((g) => g.sectionId === stuFilterSec);
  const filterClasses =
    stuFilterGrade === 'all'
      ? filterGrades.length > 0 && stuFilterSec !== 'all'
        ? classrooms.filter((c) => c.sectionId === stuFilterSec)
        : classrooms
      : classrooms.filter((c) => c.gradeId === stuFilterGrade);

  const currentSectionTitle =
    SECTION_ITEMS.find((s) => s.id === activeSection)?.label ?? '';

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F7F5] text-[#11181C]">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-[#E3E5E0] bg-white px-4 py-3.5 sm:px-6">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="فتح القائمة"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E3E5E0] text-[#11181C] lg:hidden"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('staff_hub')}
              className="hidden h-10 items-center gap-1.5 rounded-lg border border-[#E3E5E0] bg-[#FAFAF8] px-3 text-xs font-medium text-[#11181C] transition-colors hover:bg-[#F1F2EE] sm:inline-flex whitespace-nowrap shrink-0"
            >
              <ArrowRight className="h-4 w-4" />
              <span>البوابة الداخلية</span>
            </button>

            <BrandMark size="sm" />
            <div>
              <h1 className="text-base font-bold text-[#11181C]">
                إدارة النظام
              </h1>
              <p className="text-xs text-[#525D63]">
                {currentUser.fullName} · {currentSectionTitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('staff_queue')}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0E4D3A] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#0B3D2E] whitespace-nowrap shrink-0"
            >
              <MonitorCheck className="h-4 w-4" />
              <span>مراقبة الدور</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1440px] flex-1">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 border-l border-[#E3E5E0] bg-white p-4 lg:block">
          <nav aria-label="أقسام الإدارة" className="space-y-1">
            {SECTION_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`flex h-11 w-full items-center justify-between gap-2 rounded-lg px-3.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#0E4D3A] text-white'
                      : 'text-[#525D63] hover:bg-[#F7F7F5] hover:text-[#11181C]'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {item.id === 'registrations' && pendingRegistrationsCount > 0 && (
                    <span
                      className={`font-mono text-[11px] font-bold tabular-nums ${
                        isActive ? 'text-white' : 'text-[#B45309]'
                      }`}
                    >
                      {pendingRegistrationsCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div
              className="fixed inset-0 bg-black/30"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside className="relative z-50 flex w-72 flex-col bg-white p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between border-b border-[#E3E5E0] pb-3">
                <span className="text-sm font-bold text-[#11181C]">
                  القائمة الإدارية
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-[#525D63]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="space-y-1">
                {SECTION_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveSection(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`flex h-11 w-full items-center justify-between gap-2 rounded-lg px-3.5 text-xs font-semibold transition-colors ${
                        isActive
                          ? 'bg-[#0E4D3A] text-white'
                          : 'text-[#525D63] hover:bg-[#F7F7F5] hover:text-[#11181C]'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.label}</span>
                      </span>
                      {item.id === 'registrations' && pendingRegistrationsCount > 0 && (
                        <span
                          className={`font-mono text-[11px] font-bold tabular-nums ${
                            isActive ? 'text-white' : 'text-[#B45309]'
                          }`}
                        >
                          {pendingRegistrationsCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}

        {/* Main Workspace */}
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {notice && (
            <div
              role="status"
              className={`mb-5 flex items-center justify-between rounded-lg border px-4 py-3 text-xs font-medium ${
                notice.type === 'success'
                  ? 'border-[#0E4D3A]/25 bg-[#ECF5F2] text-[#0E4D3A]'
                  : 'border-[#DC2626]/25 bg-[#FEF2F2] text-[#991B1B]'
              }`}
            >
              <span>{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {issuedPinBanner && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0E4D3A] bg-[#ECF5F2] px-5 py-4">
              <div>
                <p className="text-xs font-bold text-[#0E4D3A]">
                  {issuedPinBanner.title}
                </p>
                <p className="mt-1 text-[11px] text-[#525D63]">
                  يُعرض الرقم السري مرة واحدة فقط لحماية الخصوصية ويُحفظ مشفراً في قاعدة البيانات.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-lg border border-[#0E4D3A]/30 bg-white px-4 py-2 font-mono text-lg font-bold tracking-widest text-[#0E4D3A] tabular-nums">
                  {issuedPinBanner.pin}
                </span>
                <button
                  type="button"
                  onClick={() => setIssuedPinBanner(null)}
                  className="text-xs font-semibold text-[#525D63] hover:text-[#11181C]"
                >
                  إغلاق
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-[#0E4D3A]" />
            </div>
          ) : (
            <>
              {/* 1. OVERVIEW */}
              {activeSection === 'overview' && (
                <div className="space-y-6">
                  {pendingRegistrationsCount > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D97706]/35 bg-[#FFFBEB] px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Clock className="h-5 w-5 shrink-0 text-[#D97706]" />
                        <div>
                          <p className="text-xs font-bold text-[#92400E]">
                            يوجد {pendingRegistrationsCount} طلب تسجيل ولي أمر بانتظار موافقة إدارة النظام
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#92400E]/80">
                            لا يمكن إرسال النداء لهذه الطلبات قبل مراجعتها وتفعيلها.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveSection('registrations')}
                        className="h-9 rounded-lg bg-[#0E4D3A] px-4 text-xs font-semibold text-white hover:bg-[#0B3D2E] whitespace-nowrap"
                      >
                        مراجعة طلبات التسجيل
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
                    <div className="rounded-xl border border-[#E3E5E0] bg-white p-4">
                      <p className="text-xs text-[#525D63]">إجمالي النداءات</p>
                      <p className="mt-2 font-mono text-2xl font-bold text-[#11181C] tabular-nums">
                        {reportSummary.totalCalls}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#E3E5E0] bg-white p-4">
                      <p className="text-xs text-[#525D63]">الطلبات الجديدة</p>
                      <p className="mt-2 font-mono text-2xl font-bold text-[#B45309] tabular-nums">
                        {reportSummary.newCalls}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#E3E5E0] bg-white p-4">
                      <p className="text-xs text-[#525D63]">قيد الانتظار</p>
                      <p className="mt-2 font-mono text-2xl font-bold text-[#11181C] tabular-nums">
                        {reportSummary.waitingCalls}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#E3E5E0] bg-white p-4">
                      <p className="text-xs text-[#525D63]">المنصرفات</p>
                      <p className="mt-2 font-mono text-2xl font-bold text-[#0E4D3A] tabular-nums">
                        {reportSummary.exitedCalls}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#E3E5E0] bg-white p-4">
                      <p className="text-xs text-[#525D63]">الملغاة</p>
                      <p className="mt-2 font-mono text-2xl font-bold text-[#DC2626] tabular-nums">
                        {reportSummary.cancelledCalls}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#E3E5E0] bg-white p-4">
                      <p className="text-xs text-[#525D63]">متوسط الانتظار</p>
                      <p className="mt-2 font-mono text-xl font-bold text-[#11181C] tabular-nums">
                        {reportSummary.avgWaitMinutes} د
                      </p>
                    </div>
                  </div>

                  {/* Per-Section Overview */}
                  <section className="rounded-xl border border-[#E3E5E0] bg-white">
                    <div className="flex items-center justify-between border-b border-[#E3E5E0] px-5 py-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-[#0E4D3A]" />
                        <h2 className="text-sm font-bold text-[#11181C]">
                          ملخص الأقسام (بتوقيت الرياض)
                        </h2>
                      </div>
                      <span className="text-xs text-[#525D63]">
                        الطالبات النشطات:{' '}
                        <strong className="font-mono text-[#11181C] tabular-nums">
                          {activeStudents.length}
                        </strong>
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]">
                          <tr>
                            <th className="px-5 py-3 font-semibold">القسم</th>
                            <th className="px-5 py-3 font-semibold">الصفوف</th>
                            <th className="px-5 py-3 font-semibold">الفصول</th>
                            <th className="px-5 py-3 font-semibold">الطالبات</th>
                            <th className="px-5 py-3 font-semibold">النداءات</th>
                            <th className="px-5 py-3 font-semibold">المنصرفات</th>
                            <th className="px-5 py-3 font-semibold">الحالة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F1F2EE]">
                          {sections.map((sec) => {
                            const secStats = reportSectionStats.find(
                              (r) => r.sectionId === sec.id
                            );
                            const gCount = grades.filter(
                              (g) => g.sectionId === sec.id
                            ).length;
                            const cCount = classrooms.filter(
                              (c) => c.sectionId === sec.id
                            ).length;
                            const sCount = activeStudents.filter(
                              (s) => s.sectionId === sec.id
                            ).length;
                            return (
                              <tr key={sec.id} className="hover:bg-[#FAFAF8]">
                                <td className="px-5 py-3.5 font-bold text-[#11181C]">
                                  {sec.name}
                                </td>
                                <td className="px-5 py-3.5 font-mono tabular-nums">
                                  {gCount}
                                </td>
                                <td className="px-5 py-3.5 font-mono tabular-nums">
                                  {cCount}
                                </td>
                                <td className="px-5 py-3.5 font-mono tabular-nums">
                                  {sCount}
                                </td>
                                <td className="px-5 py-3.5 font-mono font-semibold tabular-nums">
                                  {secStats?.total ?? 0}
                                </td>
                                <td className="px-5 py-3.5 font-mono text-[#0E4D3A] tabular-nums">
                                  {secStats?.exitedCount ?? 0}
                                </td>
                                <td className="px-5 py-3.5">
                                  <span
                                    className={
                                      sec.isActive
                                        ? 'font-semibold text-[#0E4D3A]'
                                        : 'text-[#8A949A]'
                                    }
                                  >
                                    {sec.isActive ? 'نشط' : 'معطل'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}

              {/* 2. LIVE CALLS ACROSS ALL SECTIONS */}
              {activeSection === 'live' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#E3E5E0] bg-white p-1">
                      <button
                        type="button"
                        onClick={() => setLiveSecFilter('all')}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                          liveSecFilter === 'all'
                            ? 'bg-[#0E4D3A] text-white'
                            : 'text-[#525D63]'
                        }`}
                      >
                        جميع الأقسام ({liveCalls.length})
                      </button>
                      {sections.map((sec) => (
                        <button
                          key={sec.id}
                          type="button"
                          onClick={() => setLiveSecFilter(sec.id)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                            liveSecFilter === sec.id
                              ? 'bg-[#0E4D3A] text-white'
                              : 'text-[#525D63]'
                          }`}
                        >
                          {sec.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {liveCalls.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#D4D8D1] bg-white py-16 text-center text-xs text-[#525D63]">
                      لا توجد نداءات نشطة حالياً.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {liveCalls.map((call) => {
                        const waitMins = calculateWaitMinutes(
                          call.requestedAt,
                          null,
                          nowMs
                        );
                        return (
                          <article
                            key={call.id}
                            className={`rounded-xl border p-5 ${
                              call.status === 'new'
                                ? 'border-[#D97706] bg-[#FFFDF7]'
                                : 'border-[#E3E5E0] bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h3 className="text-sm font-bold text-[#11181C]">
                                  {call.studentName}
                                </h3>
                                <p className="mt-1 text-xs text-[#525D63]">
                                  {call.sectionName} · {call.gradeName} -{' '}
                                  {call.classroomName}
                                </p>
                              </div>
                              <div className="text-left">
                                <span className="block font-mono text-xs text-[#11181C] tabular-nums">
                                  {formatTimeRiyadh(call.requestedAt)}
                                </span>
                                <span className="text-[11px] text-[#525D63]">
                                  {formatWaitDurationArabic(waitMins)}
                                </span>
                              </div>
                            </div>

                            <div className="mt-4 flex items-center justify-between border-t border-[#F1F2EE] pt-3">
                              <span
                                className={`text-xs font-bold ${
                                  call.status === 'new'
                                    ? 'text-[#B45309]'
                                    : 'text-[#0E4D3A]'
                                }`}
                              >
                                {getStatusLabel(call.status)}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {call.status === 'new' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateCallStatus(call.id, 'called')
                                    }
                                    className="rounded-md bg-[#0E4D3A] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                                  >
                                    تم النداء
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateCallStatus(call.id, 'exited')
                                  }
                                  className="rounded-md border border-[#11181C] px-2.5 py-1.5 text-[11px] font-semibold text-[#11181C]"
                                >
                                  تم الخروج
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateCallStatus(call.id, 'cancelled')
                                  }
                                  className="rounded-md border border-[#E3E5E0] px-2 py-1.5 text-[11px] text-[#DC2626]"
                                >
                                  إلغاء
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 2.5 PARENT REGISTRATIONS APPROVAL */}
              {activeSection === 'registrations' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-[#11181C]">
                        طلبات تسجيل أولياء الأمور
                      </h2>
                      <p className="mt-0.5 text-xs text-[#525D63]">
                        مراجعة طلبات التسجيل الجديدة وتفعيلها لتمكين إرسال النداءات
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#E3E5E0] bg-white p-1">
                      {(
                        [
                          {
                            id: 'pending',
                            label: `بانتظار الموافقة (${pendingRegistrationsCount})`,
                          },
                          { id: 'approved', label: 'المفعّلة' },
                          { id: 'rejected', label: 'المرفوضة' },
                          { id: 'all', label: 'الكل' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setRegFilter(tab.id)}
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                            regFilter === tab.id
                              ? 'bg-[#0E4D3A] text-white'
                              : 'text-[#525D63] hover:text-[#11181C]'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <section className="rounded-xl border border-[#E3E5E0] bg-white">
                    {filteredRegistrations.length === 0 ? (
                      <div className="px-6 py-14 text-center text-xs text-[#525D63]">
                        {regFilter === 'pending'
                          ? 'لا توجد طلبات تسجيل معلقة بانتظار الموافقة حالياً.'
                          : 'لا توجد طلبات مطابقة للتصفية المحددة.'}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                          <thead className="border-b border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]">
                            <tr>
                              <th className="px-5 py-3 font-semibold">
                                اسم الطالبة أو الطالب
                              </th>
                              <th className="px-5 py-3 font-semibold">الصف</th>
                              <th className="px-5 py-3 font-semibold">الفصل</th>
                              <th className="px-5 py-3 font-semibold">القسم</th>
                              <th className="px-5 py-3 font-semibold">
                                تاريخ الطلب (الرياض)
                              </th>
                              <th className="px-5 py-3 font-semibold">الحالة</th>
                              <th className="px-5 py-3 font-semibold">
                                الإجراءات
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F1F2EE]">
                            {filteredRegistrations.map((reg) => {
                              const linkedStudent = reg.studentId
                                ? students.find((s) => s.id === reg.studentId)
                                : null;

                              return (
                                <tr key={reg.id} className="hover:bg-[#FAFAF8]">
                                  <td className="px-5 py-3.5 font-bold text-[#11181C]">
                                    {reg.studentName}
                                  </td>
                                  <td className="px-5 py-3.5 text-[#525D63]">
                                    {reg.gradeName}
                                  </td>
                                  <td className="px-5 py-3.5 text-[#525D63]">
                                    {reg.classroomName}
                                  </td>
                                  <td className="px-5 py-3.5 text-[#525D63]">
                                    {reg.sectionName || 'يُحدد عند التفعيل'}
                                  </td>
                                  <td className="px-5 py-3.5 font-mono text-[11px] text-[#525D63] tabular-nums">
                                    {formatDateTimeRiyadh(reg.requestedAt)}
                                  </td>
                                  <td className="px-5 py-3.5">
                                    {reg.status === 'pending' && (
                                      <span className="font-semibold text-[#B45309]">
                                        بانتظار موافقة إدارة النظام
                                      </span>
                                    )}
                                    {reg.status === 'approved' && (
                                      <span className="font-semibold text-[#0E4D3A]">
                                        {linkedStudent && !linkedStudent.isActive
                                          ? 'مفعّل (الحساب معطّل حالياً)'
                                          : 'مفعّل'}
                                      </span>
                                    )}
                                    {reg.status === 'rejected' && (
                                      <span className="font-semibold text-[#DC2626]">
                                        مرفوض
                                        {reg.rejectionReason
                                          ? ` · ${reg.rejectionReason}`
                                          : ''}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-5 py-3.5">
                                    {reg.status === 'pending' ? (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => openApproveModal(reg)}
                                          className="inline-flex h-8 items-center gap-1 rounded-md bg-[#0E4D3A] px-3 text-[11px] font-semibold text-white hover:bg-[#0B3D2E] whitespace-nowrap"
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                          <span>تفعيل</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRejectingReg(reg);
                                            setRejectReason('');
                                          }}
                                          className="inline-flex h-8 items-center gap-1 rounded-md border border-[#E3E5E0] bg-white px-2.5 text-[11px] font-medium text-[#DC2626] hover:border-[#DC2626] hover:bg-[#FEF2F2] whitespace-nowrap"
                                        >
                                          <XCircle className="h-3.5 w-3.5" />
                                          <span>رفض</span>
                                        </button>
                                      </div>
                                    ) : reg.status === 'approved' && linkedStudent ? (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleOpenChangePinModal(linkedStudent)
                                          }
                                          className="inline-flex h-8 items-center gap-1 rounded-md border border-[#E3E5E0] bg-white px-2.5 text-[11px] font-medium text-[#11181C] hover:border-[#0E4D3A] hover:text-[#0E4D3A] whitespace-nowrap"
                                        >
                                          <KeyRound className="h-3 w-3" />
                                          <span>تغيير الرقم السري</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            try {
                                              await apiClient.updateStudent(
                                                linkedStudent.id,
                                                { isActive: !linkedStudent.isActive }
                                              );
                                              await loadBootstrap();
                                              showNotice(
                                                'success',
                                                linkedStudent.isActive
                                                  ? 'تم تعطيل الحساب والرقم السري.'
                                                  : 'تم إعادة تفعيل الحساب والرقم السري.'
                                              );
                                            } catch (err) {
                                              showNotice(
                                                'error',
                                                err instanceof Error
                                                  ? err.message
                                                  : 'تعذر تحديث الحالة.'
                                              );
                                            }
                                          }}
                                          className={`inline-flex h-8 items-center rounded-md px-2.5 text-[11px] font-semibold whitespace-nowrap ${
                                            linkedStudent.isActive
                                              ? 'border border-[#E3E5E0] text-[#DC2626] hover:bg-[#FEF2F2]'
                                              : 'bg-[#0E4D3A] text-white'
                                          }`}
                                        >
                                          {linkedStudent.isActive
                                            ? 'تعطيل'
                                            : 'إعادة تفعيل'}
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[#8A949A]">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* 3. STRUCTURE: SECTIONS, GRADES, CLASSROOMS */}
              {activeSection === 'structure' && (
                <div className="space-y-6">
                  {/* Sections Management */}
                  <section className="rounded-xl border border-[#E3E5E0] bg-white p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <h2 className="text-sm font-bold text-[#11181C]">
                        إدارة الأقسام
                      </h2>
                      <form
                        onSubmit={handleCreateSection}
                        className="flex gap-2"
                      >
                        <input
                          type="text"
                          value={newSectionName}
                          onChange={(e) => setNewSectionName(e.target.value)}
                          placeholder="اسم القسم الجديد"
                          className="h-9 rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-3 text-xs focus:border-[#0E4D3A] focus:bg-white focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#0E4D3A] px-3.5 text-xs font-semibold text-white"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>إضافة قسم</span>
                        </button>
                      </form>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {sections.map((sec) => {
                        const isSelected = sec.id === selectedSecId;
                        return (
                          <div
                            key={sec.id}
                            onClick={() => setSelectedSecId(sec.id)}
                            className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                              isSelected
                                ? 'border-[#0E4D3A] bg-[#ECF5F2]/50'
                                : 'border-[#E3E5E0] bg-[#FAFAF8]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-[#11181C]">
                                {sec.name}
                              </span>
                              <div
                                className="flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRenamingItem({
                                      kind: 'section',
                                      id: sec.id,
                                      name: sec.name,
                                    })
                                  }
                                  className="rounded p-1 text-[#525D63] hover:bg-white"
                                  aria-label={`تعديل ${sec.name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await apiClient.updateSection(sec.id, {
                                        isActive: !sec.isActive,
                                      });
                                      await loadBootstrap();
                                    } catch (err) {
                                      showNotice(
                                        'error',
                                        err instanceof Error
                                          ? err.message
                                          : 'تعذر تحديث القسم.'
                                      );
                                    }
                                  }}
                                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                    sec.isActive
                                      ? 'bg-[#ECF5F2] text-[#0E4D3A]'
                                      : 'bg-[#E3E5E0] text-[#525D63]'
                                  }`}
                                >
                                  {sec.isActive ? 'نشط' : 'معطل'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Grades & Classrooms inside selected section */}
                  {selectedSecId && (
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                      {/* Grades */}
                      <section className="rounded-xl border border-[#E3E5E0] bg-white p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h2 className="text-sm font-bold text-[#11181C]">
                            الصفوف —{' '}
                            {
                              sections.find((s) => s.id === selectedSecId)
                                ?.name
                            }
                          </h2>
                          <form
                            onSubmit={handleCreateGrade}
                            className="flex gap-2"
                          >
                            <input
                              type="text"
                              value={newGradeName}
                              onChange={(e) => setNewGradeName(e.target.value)}
                              placeholder="اسم الصف (مثال: الأول)"
                              className="h-9 rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-3 text-xs focus:border-[#0E4D3A] focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#0E4D3A] px-3 text-xs font-semibold text-[#0E4D3A] hover:bg-[#0E4D3A] hover:text-white"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>إضافة صف</span>
                            </button>
                          </form>
                        </div>

                        <div className="mt-4 space-y-2">
                          {structureGrades.length === 0 ? (
                            <p className="py-6 text-center text-xs text-[#525D63]">
                              لا توجد صفوف مضافة في هذا القسم بعد.
                            </p>
                          ) : (
                            structureGrades.map((gr) => (
                              <div
                                key={gr.id}
                                onClick={() => setSelectedGradeId(gr.id)}
                                className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 ${
                                  gr.id === selectedGradeId
                                    ? 'border-[#0E4D3A] bg-[#ECF5F2]/50'
                                    : 'border-[#E3E5E0] bg-[#FAFAF8]'
                                }`}
                              >
                                <span className="text-xs font-bold text-[#11181C]">
                                  {gr.name}
                                </span>
                                <div
                                  className="flex items-center gap-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRenamingItem({
                                        kind: 'grade',
                                        id: gr.id,
                                        name: gr.name,
                                      })
                                    }
                                    className="rounded p-1 text-[#525D63] hover:bg-white"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await apiClient.updateGrade(gr.id, {
                                          isActive: !gr.isActive,
                                        });
                                        await loadBootstrap();
                                      } catch (err) {
                                        showNotice(
                                          'error',
                                          err instanceof Error
                                            ? err.message
                                            : 'تعذر تحديث الصف.'
                                        );
                                      }
                                    }}
                                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                      gr.isActive
                                        ? 'bg-[#ECF5F2] text-[#0E4D3A]'
                                        : 'bg-[#E3E5E0] text-[#525D63]'
                                    }`}
                                  >
                                    {gr.isActive ? 'نشط' : 'معطل'}
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </section>

                      {/* Classrooms */}
                      <section className="rounded-xl border border-[#E3E5E0] bg-white p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h2 className="text-sm font-bold text-[#11181C]">
                            الفصول{' '}
                            {selectedGradeId
                              ? `— ${
                                  grades.find((g) => g.id === selectedGradeId)
                                    ?.name ?? ''
                                }`
                              : ''}
                          </h2>
                          {selectedGradeId && (
                            <form
                              onSubmit={handleCreateClassroom}
                              className="flex gap-2"
                            >
                              <input
                                type="text"
                                value={newClassroomName}
                                onChange={(e) =>
                                  setNewClassroomName(e.target.value)
                                }
                                placeholder="اسم الفصل (مثال: أ)"
                                className="h-9 rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-3 text-xs focus:border-[#0E4D3A] focus:outline-none"
                              />
                              <button
                                type="submit"
                                className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#0E4D3A] px-3 text-xs font-semibold text-[#0E4D3A] hover:bg-[#0E4D3A] hover:text-white"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                <span>إضافة فصل</span>
                              </button>
                            </form>
                          )}
                        </div>

                        <div className="mt-4 space-y-2">
                          {!selectedGradeId ? (
                            <p className="py-6 text-center text-xs text-[#525D63]">
                              أضف صفاً أو اختر صفاً لعرض فصوله وإدارتها.
                            </p>
                          ) : structureClassrooms.length === 0 ? (
                            <p className="py-6 text-center text-xs text-[#525D63]">
                              لا توجد فصول مضافة في هذا الصف بعد.
                            </p>
                          ) : (
                            structureClassrooms.map((cls) => (
                              <div
                                key={cls.id}
                                className="flex items-center justify-between rounded-lg border border-[#E3E5E0] bg-[#FAFAF8] px-4 py-3"
                              >
                                <div>
                                  <span className="text-xs font-bold text-[#11181C]">
                                    {cls.name}
                                  </span>
                                  <span className="mr-2 font-mono text-[11px] text-[#525D63] tabular-nums">
                                    (
                                    {
                                      activeStudents.filter(
                                        (s) => s.classroomId === cls.id
                                      ).length
                                    }{' '}
                                    طالبة)
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRenamingItem({
                                        kind: 'classroom',
                                        id: cls.id,
                                        name: cls.name,
                                      })
                                    }
                                    className="rounded p-1 text-[#525D63] hover:bg-white"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await apiClient.updateClassroom(cls.id, {
                                          isActive: !cls.isActive,
                                        });
                                        await loadBootstrap();
                                      } catch (err) {
                                        showNotice(
                                          'error',
                                          err instanceof Error
                                            ? err.message
                                            : 'تعذر تحديث الفصل.'
                                        );
                                      }
                                    }}
                                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                      cls.isActive
                                        ? 'bg-[#ECF5F2] text-[#0E4D3A]'
                                        : 'bg-[#E3E5E0] text-[#525D63]'
                                    }`}
                                  >
                                    {cls.isActive ? 'نشط' : 'معطل'}
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </section>
                    </div>
                  )}
                </div>
              )}

              {/* 4. STUDENTS & EXCEL IMPORT */}
              {activeSection === 'students' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E3E5E0] bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={openCreateStudentModal}
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#0E4D3A] px-4 text-xs font-semibold text-white hover:bg-[#0B3D2E]"
                      >
                        <Plus className="h-4 w-4" />
                        <span>إضافة طالبة</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await downloadStudentImportTemplate(
                              sections,
                              grades,
                              classrooms
                            );
                          } catch {
                            showNotice('error', 'تعذر تحميل قالب Excel.');
                          }
                        }}
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E3E5E0] bg-white px-3.5 text-xs font-semibold text-[#11181C] hover:border-[#0E4D3A]"
                      >
                        <Download className="h-4 w-4 text-[#0E4D3A]" />
                        <span>تحميل قالب Excel</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#0E4D3A] bg-[#ECF5F2] px-3.5 text-xs font-semibold text-[#0E4D3A] hover:bg-[#0E4D3A] hover:text-white"
                      >
                        <Upload className="h-4 w-4" />
                        <span>استيراد طالبات من Excel</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleExcelFileSelected}
                        className="hidden"
                      />
                    </div>

                    <div className="relative w-full sm:w-64">
                      <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[#8A949A]" />
                      <input
                        type="search"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="بحث بالاسم أو الصف أو الفصل"
                        className="h-10 w-full rounded-lg border border-[#E3E5E0] bg-[#FAFAF8] pr-9 pl-3 text-xs focus:border-[#0E4D3A] focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Import Results */}
                  {importResult && (
                    <section className="rounded-xl border border-[#E3E5E0] bg-white p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-[#11181C]">
                            نتائج استيراد Excel
                          </h3>
                          <p className="mt-0.5 text-xs text-[#525D63]">
                            تم استيراد {importResult.importedCount} طالبة ·
                            تخطي {importResult.errorCount} صف
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {importResult.imported.length > 0 && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await exportGeneratedPinsToExcel(
                                    importResult.imported
                                  );
                                } catch {
                                  showNotice('error', 'تعذر تصدير الأرقام السرية.');
                                }
                              }}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0E4D3A] px-3.5 text-xs font-semibold text-white"
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span>تحميل الأرقام السرية الصادرة (.xlsx)</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setImportResult(null)}
                            className="text-xs text-[#525D63]"
                          >
                            إغلاق
                          </button>
                        </div>
                      </div>
                      {importResult.errors.length > 0 && (
                        <ul className="mt-3 space-y-1 border-t border-[#F1F2EE] pt-3 text-xs text-[#991B1B]">
                          {importResult.errors.map((e, i) => (
                            <li key={i}>
                              صف {e.rowNumber}: {e.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={stuFilterSec}
                      onChange={(e) => {
                        setStuFilterSec(e.target.value);
                        setStuFilterGrade('all');
                        setStuFilterClass('all');
                      }}
                      className="h-9 rounded-lg border border-[#E3E5E0] bg-white px-3 text-xs"
                    >
                      <option value="all">جميع الأقسام</option>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={stuFilterGrade}
                      onChange={(e) => {
                        setStuFilterGrade(e.target.value);
                        setStuFilterClass('all');
                      }}
                      className="h-9 rounded-lg border border-[#E3E5E0] bg-white px-3 text-xs"
                    >
                      <option value="all">جميع الصفوف</option>
                      {filterGrades.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={stuFilterClass}
                      onChange={(e) => setStuFilterClass(e.target.value)}
                      className="h-9 rounded-lg border border-[#E3E5E0] bg-white px-3 text-xs"
                    >
                      <option value="all">جميع الفصول</option>
                      {filterClasses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Students Table */}
                  <section className="rounded-xl border border-[#E3E5E0] bg-white">
                    {filteredActiveStudents.length === 0 ? (
                      <div className="px-6 py-12 text-center text-xs text-[#525D63]">
                        لا توجد طالبات مسجلات. أضيفي طالبة أو استوردي ملف Excel.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                          <thead className="border-b border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]">
                            <tr>
                              <th className="px-5 py-3 font-semibold">
                                الاسم الكامل
                              </th>
                              <th className="px-5 py-3 font-semibold">القسم</th>
                              <th className="px-5 py-3 font-semibold">الصف</th>
                              <th className="px-5 py-3 font-semibold">الفصل</th>
                              <th className="px-5 py-3 font-semibold">الحالة</th>
                              <th className="px-5 py-3 font-semibold">
                                الإجراءات
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F1F2EE]">
                            {filteredActiveStudents.map((stu) => (
                              <tr key={stu.id} className="hover:bg-[#FAFAF8]">
                                <td className="px-5 py-3 font-semibold text-[#11181C]">
                                  {stu.fullName}
                                </td>
                                <td className="px-5 py-3 text-[#525D63]">
                                  {stu.sectionName}
                                </td>
                                <td className="px-5 py-3 text-[#525D63]">
                                  {stu.gradeName}
                                </td>
                                <td className="px-5 py-3 text-[#525D63]">
                                  {stu.classroomName}
                                </td>
                                <td className="px-5 py-3">
                                  <button
                                    type="button"
                                    title={
                                      stu.isActive
                                        ? 'تعطيل الحساب والرقم السري'
                                        : 'إعادة تفعيل الحساب والرقم السري'
                                    }
                                    onClick={async () => {
                                      try {
                                        await apiClient.updateStudent(stu.id, {
                                          isActive: !stu.isActive,
                                        });
                                        await loadBootstrap();
                                        showNotice(
                                          'success',
                                          stu.isActive
                                            ? 'تم تعطيل الحساب والرقم السري وتسجيل العملية في سجل التدقيق.'
                                            : 'تم إعادة تفعيل الحساب والرقم السري وتسجيل العملية في سجل التدقيق.'
                                        );
                                      } catch (err) {
                                        showNotice(
                                          'error',
                                          err instanceof Error
                                            ? err.message
                                            : 'تعذر تحديث الحالة.'
                                        );
                                      }
                                    }}
                                    className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                                      stu.isActive
                                        ? 'bg-[#ECF5F2] text-[#0E4D3A]'
                                        : 'bg-[#E3E5E0] text-[#525D63]'
                                    }`}
                                  >
                                    {stu.isActive ? 'نشط' : 'معطّل'}
                                  </button>
                                </td>
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openEditStudentModal(stu)}
                                      title="تعديل / نقل"
                                      className="rounded border border-[#E3E5E0] p-1.5 text-[#525D63] hover:border-[#0E4D3A] hover:text-[#0E4D3A]"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenChangePinModal(stu)}
                                      title="تغيير / إعادة تعيين الرقم السري"
                                      className="rounded border border-[#E3E5E0] p-1.5 text-[#525D63] hover:border-[#0E4D3A] hover:text-[#0E4D3A]"
                                    >
                                      <KeyRound className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await apiClient.updateStudent(stu.id, {
                                            isArchived: true,
                                          });
                                          await loadBootstrap();
                                          showNotice(
                                            'success',
                                            'تمت أرشفة الطالبة مع الحفاظ على سجل نداءاتها.'
                                          );
                                        } catch (err) {
                                          showNotice(
                                            'error',
                                            err instanceof Error
                                              ? err.message
                                              : 'تعذر أرشفة السجل.'
                                          );
                                        }
                                      }}
                                      title="أرشفة"
                                      className="rounded border border-[#E3E5E0] p-1.5 text-[#525D63] hover:border-[#D97706] hover:text-[#B45309]"
                                    >
                                      <Archive className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* 5. ACCOUNTS & PERMISSIONS */}
              {activeSection === 'accounts' && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-[#11181C]">
                      حسابات الموظفات والصلاحيات
                    </h2>
                    <button
                      type="button"
                      onClick={openCreateAccountModal}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0E4D3A] px-4 text-xs font-semibold text-white hover:bg-[#0B3D2E]"
                    >
                      <UserPlus className="h-4 w-4" />
                      <span>إضافة حساب</span>
                    </button>
                  </div>

                  <section className="rounded-xl border border-[#E3E5E0] bg-white">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]">
                          <tr>
                            <th className="px-5 py-3 font-semibold">الاسم</th>
                            <th className="px-5 py-3 font-semibold">
                              اسم المستخدم
                            </th>
                            <th className="px-5 py-3 font-semibold">الدور</th>
                            <th className="px-5 py-3 font-semibold">القسم</th>
                            <th className="px-5 py-3 font-semibold">الحالة</th>
                            <th className="px-5 py-3 font-semibold">
                              الإجراءات
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F1F2EE]">
                          {staffAccounts.map((acc) => (
                            <tr key={acc.id} className="hover:bg-[#FAFAF8]">
                              <td className="px-5 py-3.5 font-bold text-[#11181C]">
                                {acc.fullName}
                              </td>
                              <td
                                dir="ltr"
                                className="px-5 py-3.5 text-right font-mono text-[#525D63]"
                              >
                                {acc.username}
                              </td>
                              <td className="px-5 py-3.5 font-medium">
                                {acc.role === 'super_admin'
                                  ? 'مديرة النظام (Super Admin)'
                                  : 'مراقبة دور'}
                              </td>
                              <td className="px-5 py-3.5 text-[#525D63]">
                                {acc.sectionName}
                              </td>
                              <td className="px-5 py-3.5">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await apiClient.updateStaffAccount(acc.id, {
                                        isActive: !acc.isActive,
                                      });
                                      await loadBootstrap();
                                    } catch (err) {
                                      showNotice(
                                        'error',
                                        err instanceof Error
                                          ? err.message
                                          : 'تعذر التعديل'
                                      );
                                    }
                                  }}
                                  className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                                    acc.isActive
                                      ? 'bg-[#ECF5F2] text-[#0E4D3A]'
                                      : 'bg-[#E3E5E0] text-[#525D63]'
                                  }`}
                                >
                                  {acc.isActive ? 'نشط' : 'معطل'}
                                </button>
                              </td>
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openEditAccountModal(acc)}
                                    title="تعديل"
                                    className="rounded border border-[#E3E5E0] p-1.5 text-[#525D63] hover:border-[#0E4D3A] hover:text-[#0E4D3A]"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setResetPwdModal(acc);
                                      setNewStaffPassword('');
                                    }}
                                    title="إعادة تعيين كلمة المرور"
                                    className="rounded border border-[#E3E5E0] p-1.5 text-[#525D63] hover:border-[#0E4D3A] hover:text-[#0E4D3A]"
                                  >
                                    <KeyRound className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}

              {/* 6. REPORTS & EXPORTS */}
              {activeSection === 'reports' && (
                <div className="space-y-5">
                  <div className="flex flex-col gap-4 rounded-xl border border-[#E3E5E0] bg-white p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      {(
                        [
                          { id: 'daily', label: 'يومي' },
                          { id: 'weekly', label: 'أسبوعي' },
                          { id: 'monthly', label: 'شهري' },
                          { id: 'custom', label: 'فترة مخصصة' },
                          { id: 'all', label: 'الكل' },
                        ] as const
                      ).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setReportPeriod(p.id)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                            reportPeriod === p.id
                              ? 'bg-[#0E4D3A] text-white'
                              : 'border border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await exportCallsToExcel(
                              reportCalls,
                              reportSectionStats,
                              reportSummary,
                              getRangeLabel()
                            );
                          } catch {
                            showNotice('error', 'تعذر تصدير ملف Excel.');
                          }
                        }}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0E4D3A] px-4 text-xs font-semibold text-white hover:bg-[#0B3D2E]"
                      >
                        <Download className="h-4 w-4" />
                        <span>تصدير Excel (.xlsx)</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await exportCallsToWord(
                              reportCalls,
                              reportSectionStats,
                              reportSummary,
                              getRangeLabel()
                            );
                          } catch {
                            showNotice('error', 'تعذر تصدير ملف Word.');
                          }
                        }}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#11181C] bg-white px-4 text-xs font-semibold text-[#11181C] hover:bg-[#11181C] hover:text-white"
                      >
                        <FileText className="h-4 w-4" />
                        <span>تصدير Word (.docx)</span>
                      </button>
                    </div>
                  </div>

                  {/* Custom Date & Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    {reportPeriod === 'custom' && (
                      <>
                        <input
                          type="date"
                          value={reportFrom}
                          onChange={(e) => setReportFrom(e.target.value)}
                          className="h-9 rounded-lg border border-[#E3E5E0] bg-white px-3 font-mono text-xs"
                        />
                        <span className="text-xs text-[#525D63]">إلى</span>
                        <input
                          type="date"
                          value={reportTo}
                          onChange={(e) => setReportTo(e.target.value)}
                          className="h-9 rounded-lg border border-[#E3E5E0] bg-white px-3 font-mono text-xs"
                        />
                      </>
                    )}

                    <select
                      value={reportSectionFilter}
                      onChange={(e) => setReportSectionFilter(e.target.value)}
                      className="h-9 rounded-lg border border-[#E3E5E0] bg-white px-3 text-xs"
                    >
                      <option value="all">جميع الأقسام</option>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={reportStatusFilter}
                      onChange={(e) => setReportStatusFilter(e.target.value)}
                      className="h-9 rounded-lg border border-[#E3E5E0] bg-white px-3 text-xs"
                    >
                      <option value="all">جميع الحالات</option>
                      <option value="new">طلب جديد</option>
                      <option value="called">تم النداء</option>
                      <option value="exited">تم الخروج</option>
                      <option value="cancelled">ملغي</option>
                    </select>
                  </div>

                  {/* Detailed Calls Table */}
                  <section className="rounded-xl border border-[#E3E5E0] bg-white">
                    {reportCalls.length === 0 ? (
                      <div className="px-6 py-12 text-center text-xs text-[#525D63]">
                        لا توجد سجلات نداءات في الفترة المحددة.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                          <thead className="border-b border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]">
                            <tr>
                              <th className="px-5 py-3 font-semibold">الطالبة</th>
                              <th className="px-5 py-3 font-semibold">القسم</th>
                              <th className="px-5 py-3 font-semibold">الصف والفصل</th>
                              <th className="px-5 py-3 font-semibold">وقت الوصول</th>
                              <th className="px-5 py-3 font-semibold">وقت الخروج</th>
                              <th className="px-5 py-3 font-semibold">الانتظار</th>
                              <th className="px-5 py-3 font-semibold">الحالة</th>
                              <th className="px-5 py-3 font-semibold">المسؤولة</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F1F2EE]">
                            {reportCalls.map((call) => {
                              const waitMins = calculateWaitMinutes(
                                call.requestedAt,
                                call.exitedAt ?? call.calledAt ?? call.cancelledAt
                              );
                              return (
                                <tr key={call.id} className="hover:bg-[#FAFAF8]">
                                  <td className="px-5 py-3 font-semibold text-[#11181C]">
                                    {call.studentName}
                                  </td>
                                  <td className="px-5 py-3 text-[#525D63]">
                                    {call.sectionName}
                                  </td>
                                  <td className="px-5 py-3 text-[#525D63]">
                                    {call.gradeName} - {call.classroomName}
                                  </td>
                                  <td className="px-5 py-3 font-mono text-[#525D63] tabular-nums">
                                    {formatTimeRiyadh(call.requestedAt)}
                                  </td>
                                  <td className="px-5 py-3 font-mono text-[#525D63] tabular-nums">
                                    {formatTimeRiyadh(call.exitedAt)}
                                  </td>
                                  <td className="px-5 py-3 text-[#525D63]">
                                    {formatWaitDurationArabic(waitMins)}
                                  </td>
                                  <td className="px-5 py-3 font-semibold">
                                    {getStatusLabel(call.status)}
                                  </td>
                                  <td className="px-5 py-3 text-[#525D63]">
                                    {call.handledByName ?? '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* 7. ARCHIVE */}
              {activeSection === 'archive' && (
                <section className="rounded-xl border border-[#E3E5E0] bg-white">
                  <div className="border-b border-[#E3E5E0] px-5 py-4">
                    <h2 className="text-sm font-bold text-[#11181C]">
                      أرشيف الطالبات ({archivedStudents.length})
                    </h2>
                  </div>
                  {archivedStudents.length === 0 ? (
                    <div className="px-6 py-12 text-center text-xs text-[#525D63]">
                      الأرشيف فارغ حالياً.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]">
                          <tr>
                            <th className="px-5 py-3 font-semibold">الاسم</th>
                            <th className="px-5 py-3 font-semibold">القسم</th>
                            <th className="px-5 py-3 font-semibold">الصف والفصل</th>
                            <th className="px-5 py-3 font-semibold">تاريخ الأرشفة</th>
                            <th className="px-5 py-3 font-semibold">استعادة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F1F2EE]">
                          {archivedStudents.map((stu) => (
                            <tr key={stu.id} className="hover:bg-[#FAFAF8]">
                              <td className="px-5 py-3 font-semibold">
                                {stu.fullName}
                              </td>
                              <td className="px-5 py-3 text-[#525D63]">
                                {stu.sectionName}
                              </td>
                              <td className="px-5 py-3 text-[#525D63]">
                                {stu.gradeName} - {stu.classroomName}
                              </td>
                              <td className="px-5 py-3 text-[#525D63]">
                                {formatDateTimeRiyadh(stu.archivedAt)}
                              </td>
                              <td className="px-5 py-3">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await apiClient.updateStudent(stu.id, {
                                        isArchived: false,
                                        isActive: true,
                                      });
                                      await loadBootstrap();
                                      showNotice('success', 'تمت استعادة الطالبة.');
                                    } catch (err) {
                                      showNotice(
                                        'error',
                                        err instanceof Error
                                          ? err.message
                                          : 'تعذر استعادة السجل.'
                                      );
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-[#0E4D3A] px-2.5 py-1 text-[11px] font-semibold text-[#0E4D3A]"
                                >
                                  <ArchiveRestore className="h-3.5 w-3.5" />
                                  <span>استعادة</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {/* 8. SETTINGS & AUDIT LOGS */}
              {activeSection === 'settings' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Academic Years */}
                    <section className="rounded-xl border border-[#E3E5E0] bg-white p-5">
                      <h2 className="text-sm font-bold text-[#11181C]">
                        الأعوام الدراسية
                      </h2>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!newYearName.trim()) return;
                          try {
                            await apiClient.createAcademicYear(newYearName, true);
                            setNewYearName('');
                            await loadBootstrap();
                            showNotice('success', 'تمت إضافة وتفعيل العام الدراسي.');
                          } catch (err) {
                            showNotice(
                              'error',
                              err instanceof Error ? err.message : 'تعذر الحفظ'
                            );
                          }
                        }}
                        className="mt-3 flex gap-2"
                      >
                        <input
                          type="text"
                          value={newYearName}
                          onChange={(e) => setNewYearName(e.target.value)}
                          placeholder="مثال: 1448-1449 هـ"
                          className="h-9 flex-1 rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-3 text-xs"
                        />
                        <button
                          type="submit"
                          className="h-9 rounded-lg bg-[#0E4D3A] px-4 text-xs font-semibold text-white"
                        >
                          إضافة وتفعيل
                        </button>
                      </form>
                      <div className="mt-4 space-y-2">
                        {academicYears.map((yr) => (
                          <div
                            key={yr.id}
                            className="flex items-center justify-between rounded-lg border border-[#E3E5E0] px-3.5 py-2.5 text-xs"
                          >
                            <span className="font-bold">{yr.name}</span>
                            {yr.isActive ? (
                              <span className="font-semibold text-[#0E4D3A]">
                                العام النشط
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await apiClient.updateSettings({
                                      activeAcademicYearId: yr.id,
                                    });
                                    await loadBootstrap();
                                  } catch (err) {
                                    showNotice(
                                      'error',
                                      err instanceof Error
                                        ? err.message
                                        : 'تعذر تفعيل العام الدراسي.'
                                    );
                                  }
                                }}
                                className="text-[#0E4D3A] hover:underline"
                              >
                                تفعيل
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* Security & Timezone Settings */}
                    <section className="rounded-xl border border-[#E3E5E0] bg-white p-5">
                      <h2 className="text-sm font-bold text-[#11181C]">
                        إعدادات الأمان والتوقيت
                      </h2>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          try {
                            await apiClient.updateSettings({
                              maxParentAttempts: maxAttemptsInput,
                              lockoutMinutes: lockoutMinsInput,
                            });
                            await loadBootstrap();
                            showNotice('success', 'تم حفظ الإعدادات.');
                          } catch (err) {
                            showNotice(
                              'error',
                              err instanceof Error
                                ? err.message
                                : 'تعذر حفظ الإعدادات.'
                            );
                          }
                        }}
                        className="mt-3 space-y-3 text-xs"
                      >
                        <div>
                          <label className="mb-1 block font-semibold">
                            المنطقة الزمنية المعتمدة
                          </label>
                          <input
                            type="text"
                            disabled
                            value={settings?.timezone ?? 'Asia/Riyadh'}
                            className="h-9 w-full rounded-lg border border-[#E3E5E0] bg-[#F7F7F5] px-3 font-mono text-[#525D63]"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block font-semibold">
                              حد محاولات ولي الأمر
                            </label>
                            <input
                              type="number"
                              min={3}
                              max={20}
                              value={maxAttemptsInput}
                              onChange={(e) =>
                                setMaxAttemptsInput(Number(e.target.value))
                              }
                              className="h-9 w-full rounded-lg border border-[#D4D8D1] px-3 font-mono tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block font-semibold">
                              مدة الحظر المؤقت (دقائق)
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={120}
                              value={lockoutMinsInput}
                              onChange={(e) =>
                                setLockoutMinsInput(Number(e.target.value))
                              }
                              className="h-9 w-full rounded-lg border border-[#D4D8D1] px-3 font-mono tabular-nums"
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          className="h-9 rounded-lg bg-[#0E4D3A] px-4 font-semibold text-white"
                        >
                          حفظ الإعدادات
                        </button>
                      </form>
                    </section>
                  </div>

                  {/* Audit Logs */}
                  <section className="rounded-xl border border-[#E3E5E0] bg-white">
                    <div className="border-b border-[#E3E5E0] px-5 py-4">
                      <h2 className="text-sm font-bold text-[#11181C]">
                        سجل التدقيق ({auditLogs.length})
                      </h2>
                    </div>
                    <div className="max-h-96 overflow-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="border-b border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]">
                          <tr>
                            <th className="px-5 py-3 font-semibold">المنفّذ</th>
                            <th className="px-5 py-3 font-semibold">العملية</th>
                            <th className="px-5 py-3 font-semibold">التفاصيل</th>
                            <th className="px-5 py-3 font-semibold">التوقيت (الرياض)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F1F2EE]">
                          {auditLogs.map((log) => {
                            const targetName =
                              typeof log.details?.studentName === 'string'
                                ? log.details.studentName
                                : typeof log.details?.fullName === 'string'
                                ? log.details.fullName
                                : log.entityType;
                            return (
                              <tr key={log.id} className="hover:bg-[#FAFAF8]">
                                <td className="px-5 py-2.5 font-semibold">
                                  {log.actorName}
                                </td>
                                <td className="px-5 py-2.5 font-medium text-[#11181C]">
                                  {getAuditActionLabel(log.action)}
                                </td>
                                <td className="px-5 py-2.5 text-[#525D63]">
                                  {targetName}
                                </td>
                                <td className="px-5 py-2.5 text-[#525D63]">
                                  {formatDateTimeRiyadh(log.createdAt)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Rename Modal */}
      {renamingItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-[#E3E5E0] bg-white p-6 shadow-lg">
            <h3 className="text-sm font-bold text-[#11181C]">تعديل المسمى</h3>
            <form onSubmit={handleSaveRename} className="mt-4 space-y-4">
              <input
                type="text"
                required
                value={renamingItem.name}
                onChange={(e) =>
                  setRenamingItem((prev) =>
                    prev ? { ...prev, name: e.target.value } : null
                  )
                }
                className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3 text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenamingItem(null)}
                  className="h-9 rounded-lg border border-[#E3E5E0] px-4 text-xs"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-lg bg-[#0E4D3A] px-4 text-xs font-semibold text-white"
                >
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit / Transfer Student Modal */}
      {studentModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-[#E3E5E0] bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#E3E5E0] pb-3">
              <h3 className="text-sm font-bold text-[#11181C]">
                {editingStudent ? 'تعديل / نقل طالبة' : 'إضافة طالبة جديدة'}
              </h3>
              <button
                type="button"
                onClick={() => setStudentModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveStudent} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="mb-1 block font-semibold">الاسم الكامل</label>
                <input
                  type="text"
                  required
                  value={studentForm.fullName}
                  onChange={(e) =>
                    setStudentForm((p) => ({ ...p, fullName: e.target.value }))
                  }
                  className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3"
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold">القسم</label>
                <select
                  value={studentForm.sectionId}
                  onChange={(e) => {
                    const secId = e.target.value;
                    const firstG =
                      grades.find((g) => g.sectionId === secId)?.id ?? '';
                    const firstC =
                      classrooms.find((c) => c.gradeId === firstG)?.id ?? '';
                    setStudentForm((p) => ({
                      ...p,
                      sectionId: secId,
                      gradeId: firstG,
                      classroomId: firstC,
                    }));
                  }}
                  className="h-10 w-full rounded-lg border border-[#D4D8D1] bg-white px-2.5"
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold">الصف</label>
                  <select
                    value={studentForm.gradeId}
                    onChange={(e) => {
                      const gId = e.target.value;
                      const firstC =
                        classrooms.find((c) => c.gradeId === gId)?.id ?? '';
                      setStudentForm((p) => ({
                        ...p,
                        gradeId: gId,
                        classroomId: firstC,
                      }));
                    }}
                    className="h-10 w-full rounded-lg border border-[#D4D8D1] bg-white px-2.5"
                  >
                    {modalGrades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">الفصل</label>
                  <select
                    required
                    value={studentForm.classroomId}
                    onChange={(e) =>
                      setStudentForm((p) => ({
                        ...p,
                        classroomId: e.target.value,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-[#D4D8D1] bg-white px-2.5"
                  >
                    {modalClassrooms.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!editingStudent && (
                <div>
                  <label className="mb-1 block font-semibold">
                    الرقم السري (اختياري — يُولّد آلياً إذا تُرك فارغاً)
                  </label>
                  <input
                    type="text"
                    value={studentForm.pin}
                    onChange={(e) =>
                      setStudentForm((p) => ({ ...p, pin: e.target.value }))
                    }
                    placeholder="توليد تلقائي آمن"
                    className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3 font-mono"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStudentModalOpen(false)}
                  className="h-9 rounded-lg border border-[#E3E5E0] px-4"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-lg bg-[#0E4D3A] px-5 font-semibold text-white"
                >
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Staff Account Modal */}
      {accountModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-[#E3E5E0] bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#E3E5E0] pb-3">
              <h3 className="text-sm font-bold text-[#11181C]">
                {editingAccount ? 'تعديل حساب موظفة' : 'إضافة حساب موظفة'}
              </h3>
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveAccount} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="mb-1 block font-semibold">الاسم الكامل</label>
                <input
                  type="text"
                  required
                  value={accountForm.fullName}
                  onChange={(e) =>
                    setAccountForm((p) => ({ ...p, fullName: e.target.value }))
                  }
                  className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3"
                />
              </div>

              {!editingAccount && (
                <div>
                  <label className="mb-1 block font-semibold">
                    اسم المستخدم
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={accountForm.username}
                    onChange={(e) =>
                      setAccountForm((p) => ({ ...p, username: e.target.value }))
                    }
                    className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3 text-right font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold">الصلاحية</label>
                  <select
                    value={accountForm.role}
                    onChange={(e) =>
                      setAccountForm((p) => ({
                        ...p,
                        role: e.target.value as StaffRole,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-[#D4D8D1] bg-white px-2.5"
                  >
                    <option value="queue_monitor">مراقبة دور</option>
                    <option value="super_admin">مديرة النظام</option>
                  </select>
                </div>

                {accountForm.role === 'queue_monitor' && (
                  <div>
                    <label className="mb-1 block font-semibold">القسم</label>
                    <select
                      value={accountForm.sectionId}
                      onChange={(e) =>
                        setAccountForm((p) => ({
                          ...p,
                          sectionId: e.target.value,
                        }))
                      }
                      className="h-10 w-full rounded-lg border border-[#D4D8D1] bg-white px-2.5"
                    >
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {!editingAccount && (
                <div>
                  <label className="mb-1 block font-semibold">
                    كلمة المرور (6 أحرف على الأقل)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={accountForm.password}
                    onChange={(e) =>
                      setAccountForm((p) => ({ ...p, password: e.target.value }))
                    }
                    className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3 font-mono"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAccountModalOpen(false)}
                  className="h-9 rounded-lg border border-[#E3E5E0] px-4"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-lg bg-[#0E4D3A] px-5 font-semibold text-white"
                >
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve Parent Registration Modal */}
      {approvingReg && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-[#E3E5E0] bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#E3E5E0] pb-3">
              <h3 className="text-sm font-bold text-[#11181C]">
                تفعيل طلب تسجيل ولي أمر
              </h3>
              <button type="button" onClick={() => setApprovingReg(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmApprove} className="mt-4 space-y-3.5 text-xs">
              <div className="rounded-lg border border-[#E3E5E0] bg-[#FAFAF8] p-3">
                <p className="font-bold text-[#11181C]">{approvingReg.studentName}</p>
                <p className="mt-1 text-[#525D63]">
                  البيانات المدخلة: الصف ({approvingReg.gradeName}) · الفصل ({approvingReg.classroomName})
                </p>
              </div>

              <div>
                <label className="mb-1 block font-semibold">القسم المرتبط (لمراقبة الدور)</label>
                <select
                  required
                  value={approveSectionId}
                  onChange={(e) => {
                    setApproveSectionId(e.target.value);
                    setApproveGradeId('');
                    setApproveClassroomId('');
                  }}
                  className="h-10 w-full rounded-lg border border-[#D4D8D1] bg-white px-2.5"
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold">الصف</label>
                  <select
                    value={approveGradeId}
                    onChange={(e) => {
                      setApproveGradeId(e.target.value);
                      setApproveClassroomId('');
                    }}
                    className="h-10 w-full rounded-lg border border-[#D4D8D1] bg-white px-2.5"
                  >
                    <option value="">اعتماد/إنشاء: {approvingReg.gradeName}</option>
                    {grades
                      .filter((g) => g.sectionId === approveSectionId)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">الفصل</label>
                  <select
                    value={approveClassroomId}
                    onChange={(e) => {
                      const clsId = e.target.value;
                      setApproveClassroomId(clsId);
                      if (clsId && !approveGradeId) {
                        const clsObj = classrooms.find((c) => c.id === clsId);
                        if (clsObj) setApproveGradeId(clsObj.gradeId);
                      }
                    }}
                    className="h-10 w-full rounded-lg border border-[#D4D8D1] bg-white px-2.5"
                  >
                    <option value="">اعتماد/إنشاء: {approvingReg.classroomName}</option>
                    {classrooms
                      .filter((c) => {
                        if (approveGradeId) return c.gradeId === approveGradeId;
                        const matchedGrade = grades.find(
                          (g) =>
                            g.sectionId === approveSectionId &&
                            normalizeArabicText(g.name) ===
                              normalizeArabicText(approvingReg.gradeName)
                        );
                        return matchedGrade ? c.gradeId === matchedGrade.id : false;
                      })
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setApprovingReg(null)}
                  className="h-9 rounded-lg border border-[#E3E5E0] px-4"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-lg bg-[#0E4D3A] px-5 font-semibold text-white"
                >
                  تفعيل الطلب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Parent Registration Modal */}
      {rejectingReg && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-[#E3E5E0] bg-white p-6 shadow-lg">
            <h3 className="text-sm font-bold text-[#11181C]">
              رفض طلب تسجيل: {rejectingReg.studentName}
            </h3>
            <form onSubmit={handleConfirmReject} className="mt-4 space-y-4 text-xs">
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="سبب الرفض (اختياري)"
                className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingReg(null)}
                  className="h-9 rounded-lg border border-[#E3E5E0] px-4"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-lg bg-[#DC2626] px-4 font-semibold text-white"
                >
                  تأكيد الرفض
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change / Reset Student PIN Modal */}
      {changePinStudent && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-[#E3E5E0] bg-white p-6 shadow-lg">
            <h3 className="text-sm font-bold text-[#11181C]">
              تغيير الرقم السري: {changePinStudent.fullName}
            </h3>
            <p className="mt-1 text-[11px] text-[#525D63]">
              أدخلي رقماً سرياً جديداً (4 أرقام أو أحرف فأكثر)، أو اتركي الحقل فارغاً لتوليد رقم سري آلياً.
            </p>
            <form onSubmit={handleConfirmChangePin} className="mt-4 space-y-4 text-xs">
              <input
                type="text"
                value={customStudentPin}
                onChange={(e) => setCustomStudentPin(e.target.value)}
                placeholder="رقم سري جديد (اختياري)"
                className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3 font-mono"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setChangePinStudent(null)}
                  className="h-9 rounded-lg border border-[#E3E5E0] px-4"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-lg bg-[#0E4D3A] px-4 font-semibold text-white"
                >
                  حفظ الرقم السري
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Staff Password Modal */}
      {resetPwdModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-[#E3E5E0] bg-white p-6 shadow-lg">
            <h3 className="text-sm font-bold text-[#11181C]">
              إعادة تعيين كلمة مرور: {resetPwdModal.fullName}
            </h3>
            <form onSubmit={handleResetStaffPassword} className="mt-4 space-y-4">
              <input
                type="password"
                required
                minLength={6}
                value={newStaffPassword}
                onChange={(e) => setNewStaffPassword(e.target.value)}
                placeholder="كلمة المرور الجديدة"
                className="h-10 w-full rounded-lg border border-[#D4D8D1] px-3 font-mono text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetPwdModal(null)}
                  className="h-9 rounded-lg border border-[#E3E5E0] px-4 text-xs"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="h-9 rounded-lg bg-[#0E4D3A] px-4 text-xs font-semibold text-white"
                >
                  تحديث
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <UnifiedFooter />
    </div>
  );
};
