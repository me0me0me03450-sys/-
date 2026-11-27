import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  RotateCcw,
  Send,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { BrandMark, UnifiedFooter } from '../components/BrandMark';
import { apiClient } from '../services/apiClient';
import {
  Classroom,
  Grade,
  ParentRegistration,
  PickupRequest,
  Section,
} from '../types/nidaa';
import {
  formatDateTimeRiyadh,
  formatTimeRiyadh,
  getStatusLabel,
  normalizeArabicText,
} from '../utils/formatters';

type ParentMode = 'call' | 'register';

export const ParentPortalView: React.FC = () => {
  const [mode, setMode] = useState<ParentMode>('call');

  // Call form state
  const [studentName, setStudentName] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active call tracking state
  const [activeCall, setActiveCall] = useState<PickupRequest | null>(null);
  const [isDuplicateCall, setIsDuplicateCall] = useState(false);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);

  // Registration form state
  const [regStudentName, setRegStudentName] = useState('');
  const [regGradeName, setRegGradeName] = useState('');
  const [regClassroomName, setRegClassroomName] = useState('');
  const [regPin, setRegPin] = useState('');
  const [showRegPin, setShowRegPin] = useState(false);
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // Optional structure suggestions (grades & classrooms only - zero student data)
  const [structureSections, setStructureSections] = useState<Section[]>([]);
  const [structureGrades, setStructureGrades] = useState<Grade[]>([]);
  const [structureClassrooms, setStructureClassrooms] = useState<Classroom[]>([]);

  // Active registration tracking state
  const [activeRegistration, setActiveRegistration] =
    useState<ParentRegistration | null>(null);
  const [regTrackingToken, setRegTrackingToken] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'register') return;
    let mounted = true;
    apiClient
      .fetchParentStructure()
      .then((res) => {
        if (!mounted) return;
        setStructureSections(res.sections);
        setStructureGrades(res.grades);
        setStructureClassrooms(res.classrooms);
      })
      .catch(() => {
        // ignore; parent can still type grade & classroom freely
      });
    return () => {
      mounted = false;
    };
  }, [mode]);

  const gradeSuggestions = useMemo(() => {
    return structureGrades.map((g) => {
      const sec = structureSections.find((s) => s.id === g.sectionId);
      return {
        id: g.id,
        name: g.name,
        sectionName: sec?.name ?? '',
      };
    });
  }, [structureGrades, structureSections]);

  const classroomSuggestions = useMemo(() => {
    const normGrade = normalizeArabicText(regGradeName);
    const matchedGrade = normGrade
      ? structureGrades.find((g) => normalizeArabicText(g.name) === normGrade)
      : undefined;
    const list = matchedGrade
      ? structureClassrooms.filter((c) => c.gradeId === matchedGrade.id)
      : structureClassrooms;
    const seen = new Set<string>();
    return list.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
  }, [regGradeName, structureGrades, structureClassrooms]);

  // Live call status subscription
  useEffect(() => {
    if (!activeCall || !trackingToken) return;
    if (activeCall.status === 'exited' || activeCall.status === 'cancelled') {
      return;
    }

    const unsubscribe = apiClient.subscribeParentCallRealtime(
      activeCall.id,
      trackingToken,
      (updatedCall) => {
        setActiveCall(updatedCall);
      }
    );

    const pollTimer = window.setInterval(async () => {
      try {
        const res = await apiClient.fetchParentCallStatus(
          activeCall.id,
          trackingToken
        );
        setActiveCall(res.call);
      } catch {
        // ignore transient poll failure
      }
    }, 10000);

    return () => {
      unsubscribe();
      window.clearInterval(pollTimer);
    };
  }, [activeCall?.id, activeCall?.status, trackingToken]);

  // Live registration approval subscription
  useEffect(() => {
    if (!activeRegistration || !regTrackingToken) return;
    if (activeRegistration.status !== 'pending') return;

    const unsubscribe = apiClient.subscribeParentRegistrationRealtime(
      activeRegistration.id,
      regTrackingToken,
      (updatedReg) => {
        setActiveRegistration(updatedReg);
      }
    );

    const pollTimer = window.setInterval(async () => {
      try {
        const res = await apiClient.fetchParentRegistrationStatus(
          activeRegistration.id,
          regTrackingToken
        );
        setActiveRegistration(res.registration);
      } catch {
        // ignore transient poll failure
      }
    }, 8000);

    return () => {
      unsubscribe();
      window.clearInterval(pollTimer);
    };
  }, [activeRegistration?.id, activeRegistration?.status, regTrackingToken]);

  const handleSubmitCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!studentName.trim() || !pin.trim()) {
      setErrorMessage('يرجى إدخال اسم الطالبة أو الطالب والرقم السري.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.submitParentCall(studentName, pin);
      setActiveCall(res.call);
      setIsDuplicateCall(Boolean(res.duplicate));
      setTrackingToken(res.trackingToken);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'تعذر التحقق من البيانات المدخلة.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    if (
      !regStudentName.trim() ||
      !regGradeName.trim() ||
      !regClassroomName.trim() ||
      !regPin.trim()
    ) {
      setRegError(
        'يرجى إدخال اسم الطالبة أو الطالب والصف والفصل واختيار الرقم السري.'
      );
      return;
    }
    if (regPin.trim().length < 4) {
      setRegError('يجب أن يتكون الرقم السري من 4 أرقام أو أحرف على الأقل.');
      return;
    }

    setRegSubmitting(true);
    try {
      const res = await apiClient.submitParentRegistration({
        studentName: regStudentName.trim(),
        gradeName: regGradeName.trim(),
        classroomName: regClassroomName.trim(),
        pin: regPin.trim(),
      });
      setActiveRegistration(res.registration);
      setRegTrackingToken(res.trackingToken);
      setRegPin('');
    } catch (err) {
      setRegError(
        err instanceof Error ? err.message : 'تعذر إرسال طلب التسجيل.'
      );
    } finally {
      setRegSubmitting(false);
    }
  };

  const handleNewRequest = () => {
    setActiveCall(null);
    setIsDuplicateCall(false);
    setTrackingToken(null);
    setStudentName('');
    setPin('');
    setErrorMessage(null);
  };

  const handleResetRegistrationView = (goToCall = false) => {
    const approvedName =
      goToCall && activeRegistration ? activeRegistration.studentName : '';
    setActiveRegistration(null);
    setRegTrackingToken(null);
    setRegStudentName('');
    setRegGradeName('');
    setRegClassroomName('');
    setRegPin('');
    setRegError(null);
    if (goToCall) {
      setMode('call');
      setStudentName(approvedName);
      setPin('');
      setErrorMessage(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F7F5] text-[#11181C]">
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          {/* Brand Lockup: Company Logo & Nidaa Platform Name */}
          <div className="mb-7 flex flex-col items-center text-center">
            <BrandMark size="lg" />
            <p className="mt-4 text-xs font-medium text-[#525D63]">
              شركة تربية الأجيال الأهلية
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#11181C]">
              منصة نداء
            </h1>
          </div>

          {/* Main Card */}
          <section
            aria-label="بوابة ولي الأمر"
            className="overflow-hidden rounded-xl border border-[#E3E5E0] bg-white shadow-xs"
          >
            <div className="h-1 w-full bg-[#0E4D3A]" />

            {activeCall ? (
              <div className="p-6 sm:p-8">
                {/* Student Summary */}
                <div className="border-b border-[#E3E5E0] pb-4">
                  <p className="text-xs font-medium text-[#525D63]">حالة الطلب</p>
                  <h2 className="mt-1 text-xl font-bold text-[#11181C]">
                    {activeCall.studentName}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#525D63]">
                    <span>{activeCall.sectionName}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {activeCall.gradeName} - {activeCall.classroomName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatTimeRiyadh(activeCall.requestedAt)}
                    </span>
                  </div>
                </div>

                {isDuplicateCall && (
                  <div className="mt-4 rounded-lg border border-[#D97706]/30 bg-[#FFFBEB] px-3.5 py-2.5 text-xs text-[#92400E]">
                    يوجد طلب نداء نشط حالياً — يتم عرض حالة الطلب الحالي دون تكراره.
                  </div>
                )}

                {/* Live Status Banner */}
                <div
                  className={`mt-5 flex items-center gap-3 rounded-lg border px-4 py-3.5 ${
                    activeCall.status === 'new'
                      ? 'border-[#D97706]/30 bg-[#FFFBEB] text-[#92400E]'
                      : activeCall.status === 'called'
                      ? 'border-[#0E4D3A]/30 bg-[#ECF5F2] text-[#0E4D3A]'
                      : activeCall.status === 'cancelled'
                      ? 'border-[#DC2626]/25 bg-[#FEF2F2] text-[#991B1B]'
                      : 'border-[#334155]/25 bg-[#F1F5F9] text-[#1E293B]'
                  }`}
                >
                  {activeCall.status === 'new' && (
                    <Clock className="h-5 w-5 shrink-0 text-[#D97706]" />
                  )}
                  {activeCall.status === 'called' && (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-[#0E4D3A]" />
                  )}
                  {activeCall.status === 'exited' && (
                    <LogOut className="h-5 w-5 shrink-0 text-[#334155]" />
                  )}
                  {activeCall.status === 'cancelled' && (
                    <XCircle className="h-5 w-5 shrink-0 text-[#DC2626]" />
                  )}
                  <div>
                    <p className="text-sm font-bold">
                      {getStatusLabel(activeCall.status)}
                    </p>
                    <p className="mt-0.5 text-xs opacity-85">
                      {activeCall.status === 'new' &&
                        'تم إرسال النداء لمراقبة الدور'}
                      {activeCall.status === 'called' &&
                        'تم النداء وجاري تجهيز الطالبة أو الطالب للخروج'}
                      {activeCall.status === 'exited' &&
                        'تم تأكيد الخروج بنجاح'}
                      {activeCall.status === 'cancelled' &&
                        'تم إلغاء الطلب من قِبل الإدارة'}
                    </p>
                  </div>
                </div>

                {/* Timeline Steps (Asia/Riyadh) */}
                <ol className="mt-5 space-y-3 border-t border-[#E3E5E0] pt-5 text-xs">
                  <li className="flex items-center justify-between">
                    <span className="font-medium text-[#11181C]">
                      1. إرسال النداء
                    </span>
                    <span className="font-mono text-[#525D63] tabular-nums">
                      {formatTimeRiyadh(activeCall.requestedAt)}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span
                      className={
                        activeCall.calledAt
                          ? 'font-medium text-[#11181C]'
                          : 'text-[#8A949A]'
                      }
                    >
                      2. تم النداء
                    </span>
                    <span className="font-mono text-[#525D63] tabular-nums">
                      {formatTimeRiyadh(activeCall.calledAt)}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span
                      className={
                        activeCall.exitedAt || activeCall.cancelledAt
                          ? 'font-medium text-[#11181C]'
                          : 'text-[#8A949A]'
                      }
                    >
                      {activeCall.status === 'cancelled'
                        ? '3. إلغاء الطلب'
                        : '3. تأكيد الخروج'}
                    </span>
                    <span className="font-mono text-[#525D63] tabular-nums">
                      {formatTimeRiyadh(
                        activeCall.cancelledAt ?? activeCall.exitedAt
                      )}
                    </span>
                  </li>
                </ol>

                <button
                  type="button"
                  onClick={handleNewRequest}
                  className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#D4D8D1] bg-white px-4 text-sm font-medium text-[#11181C] transition-colors hover:bg-[#F7F7F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]/30"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>نداء جديد</span>
                </button>
              </div>
            ) : activeRegistration ? (
              <div className="p-6 sm:p-8">
                <div className="border-b border-[#E3E5E0] pb-4">
                  <p className="text-xs font-medium text-[#525D63]">
                    حالة طلب التسجيل
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-[#11181C]">
                    {activeRegistration.studentName}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#525D63]">
                    <span>{activeRegistration.gradeName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeRegistration.classroomName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatDateTimeRiyadh(activeRegistration.requestedAt)}
                    </span>
                  </div>
                </div>

                <div
                  className={`mt-5 flex items-start gap-3 rounded-lg border px-4 py-3.5 ${
                    activeRegistration.status === 'pending'
                      ? 'border-[#D97706]/30 bg-[#FFFBEB] text-[#92400E]'
                      : activeRegistration.status === 'approved'
                      ? 'border-[#0E4D3A]/30 bg-[#ECF5F2] text-[#0E4D3A]'
                      : 'border-[#DC2626]/25 bg-[#FEF2F2] text-[#991B1B]'
                  }`}
                >
                  {activeRegistration.status === 'pending' && (
                    <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[#D97706]" />
                  )}
                  {activeRegistration.status === 'approved' && (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#0E4D3A]" />
                  )}
                  {activeRegistration.status === 'rejected' && (
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#DC2626]" />
                  )}
                  <div>
                    <p className="text-sm font-bold">
                      {activeRegistration.status === 'pending' &&
                        'بانتظار موافقة إدارة النظام'}
                      {activeRegistration.status === 'approved' &&
                        'تم تفعيل الطلب بنجاح'}
                      {activeRegistration.status === 'rejected' &&
                        'تم رفض طلب التسجيل'}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed opacity-90">
                      {activeRegistration.status === 'pending' &&
                        'تم استلام طلب التسجيل وحفظ الرقم السري بشكل آمن. لا يُسمح بإرسال النداء قبل موافقة وتفعيل الطلب من إدارة النظام.'}
                      {activeRegistration.status === 'approved' &&
                        'تم اعتماد التسجيل وتفعيله. أصبح الرقم السري صالحاً الآن لإرسال النداءات.'}
                      {activeRegistration.status === 'rejected' &&
                        (activeRegistration.rejectionReason
                          ? `السبب: ${activeRegistration.rejectionReason}`
                          : 'يرجى مراجعة إدارة النظام أو إعادة تقديم الطلب بالبيانات الصحيحة.')}
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-2.5">
                  {activeRegistration.status === 'approved' && (
                    <button
                      type="button"
                      onClick={() => handleResetRegistrationView(true)}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0E4D3A] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0B3D2E]"
                    >
                      <Send className="h-4 w-4" />
                      <span>الانتقال لإرسال النداء</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleResetRegistrationView(false)}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#D4D8D1] bg-white px-4 text-sm font-medium text-[#11181C] transition-colors hover:bg-[#F7F7F5]"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span>العودة</span>
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Segmented Mode Selector: إرسال النداء | تسجيل جديد */}
                <div className="border-b border-[#E3E5E0] bg-[#FAFAF8] px-6 pt-4 pb-3 sm:px-8">
                  <div
                    role="tablist"
                    aria-label="خيارات ولي الأمر"
                    className="grid grid-cols-2 gap-1 rounded-lg border border-[#E3E5E0] bg-white p-1"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'call'}
                      onClick={() => {
                        setMode('call');
                        setRegError(null);
                      }}
                      className={`flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                        mode === 'call'
                          ? 'bg-[#0E4D3A] text-white'
                          : 'text-[#525D63] hover:text-[#11181C]'
                      }`}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>إرسال النداء</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'register'}
                      onClick={() => {
                        setMode('register');
                        setErrorMessage(null);
                      }}
                      className={`flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                        mode === 'register'
                          ? 'bg-[#0E4D3A] text-white'
                          : 'text-[#525D63] hover:text-[#11181C]'
                      }`}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>تسجيل جديد</span>
                    </button>
                  </div>
                </div>

                {mode === 'call' ? (
                  <form
                    onSubmit={handleSubmitCall}
                    className="space-y-5 p-6 sm:p-8"
                    noValidate
                  >
                    <div>
                      <label
                        htmlFor="student-name"
                        className="mb-2 block text-sm font-semibold text-[#11181C]"
                      >
                        اسم الطالبة أو الطالب
                      </label>
                      <input
                        id="student-name"
                        type="text"
                        required
                        autoComplete="off"
                        value={studentName}
                        onChange={(e) => {
                          setStudentName(e.target.value);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        placeholder="أدخل الاسم الكامل للطالبة أو الطالب"
                        className="h-12 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-4 text-sm text-[#11181C] placeholder:text-[#8A949A] transition-colors focus:border-[#0E4D3A] focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]/20"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="student-pin"
                        className="mb-2 block text-sm font-semibold text-[#11181C]"
                      >
                        الرقم السري
                      </label>
                      <div className="relative">
                        <input
                          id="student-pin"
                          type={showPin ? 'text' : 'password'}
                          required
                          autoComplete="off"
                          value={pin}
                          onChange={(e) => {
                            setPin(e.target.value);
                            if (errorMessage) setErrorMessage(null);
                          }}
                          placeholder="••••"
                          className="h-12 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] pr-4 pl-12 font-mono text-base tracking-widest text-[#11181C] placeholder:tracking-normal placeholder:text-[#8A949A] tabular-nums transition-colors focus:border-[#0E4D3A] focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPin((prev) => !prev)}
                          aria-label={
                            showPin ? 'إخفاء الرقم السري' : 'إظهار الرقم السري'
                          }
                          className="absolute inset-y-0 left-0 flex w-12 items-center justify-center text-[#525D63] transition-colors hover:text-[#11181C]"
                        >
                          {showPin ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {errorMessage && (
                      <div
                        role="alert"
                        className="flex items-start gap-2.5 rounded-lg border border-[#DC2626]/25 bg-[#FEF2F2] px-3.5 py-3 text-xs leading-relaxed text-[#991B1B]"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                        <span>{errorMessage}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-[#0E4D3A] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0B3D2E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A] focus-visible:ring-offset-2 disabled:opacity-70 active:scale-[0.99]"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      <span>
                        {submitting ? 'جاري الإرسال...' : 'إرسال النداء'}
                      </span>
                    </button>
                  </form>
                ) : (
                  <form
                    onSubmit={handleSubmitRegistration}
                    className="space-y-4 p-6 sm:p-8"
                    noValidate
                  >
                    <div>
                      <label
                        htmlFor="reg-student-name"
                        className="mb-1.5 block text-sm font-semibold text-[#11181C]"
                      >
                        اسم الطالبة أو الطالب
                      </label>
                      <input
                        id="reg-student-name"
                        type="text"
                        required
                        autoComplete="off"
                        value={regStudentName}
                        onChange={(e) => {
                          setRegStudentName(e.target.value);
                          if (regError) setRegError(null);
                        }}
                        placeholder="الاسم الكامل للطالبة أو الطالب"
                        className="h-11 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-4 text-sm text-[#11181C] placeholder:text-[#8A949A] transition-colors focus:border-[#0E4D3A] focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]/20"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="reg-grade"
                          className="mb-1.5 block text-sm font-semibold text-[#11181C]"
                        >
                          الصف
                        </label>
                        <input
                          id="reg-grade"
                          type="text"
                          required
                          list="nidaa-grades-list"
                          autoComplete="off"
                          value={regGradeName}
                          onChange={(e) => {
                            setRegGradeName(e.target.value);
                            if (regError) setRegError(null);
                          }}
                          placeholder="مثال: الأول الابتدائي"
                          className="h-11 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-3.5 text-sm text-[#11181C] placeholder:text-[#8A949A] transition-colors focus:border-[#0E4D3A] focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]/20"
                        />
                        {gradeSuggestions.length > 0 && (
                          <datalist id="nidaa-grades-list">
                            {gradeSuggestions.map((g) => (
                              <option
                                key={g.id}
                                value={g.name}
                                label={g.sectionName}
                              />
                            ))}
                          </datalist>
                        )}
                      </div>

                      <div>
                        <label
                          htmlFor="reg-classroom"
                          className="mb-1.5 block text-sm font-semibold text-[#11181C]"
                        >
                          الفصل
                        </label>
                        <input
                          id="reg-classroom"
                          type="text"
                          required
                          list="nidaa-classrooms-list"
                          autoComplete="off"
                          value={regClassroomName}
                          onChange={(e) => {
                            setRegClassroomName(e.target.value);
                            if (regError) setRegError(null);
                          }}
                          placeholder="مثال: أ"
                          className="h-11 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-3.5 text-sm text-[#11181C] placeholder:text-[#8A949A] transition-colors focus:border-[#0E4D3A] focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]/20"
                        />
                        {classroomSuggestions.length > 0 && (
                          <datalist id="nidaa-classrooms-list">
                            {classroomSuggestions.map((c) => (
                              <option key={c.id} value={c.name} />
                            ))}
                          </datalist>
                        )}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-pin"
                        className="mb-1.5 block text-sm font-semibold text-[#11181C]"
                      >
                        اختيار الرقم السري
                      </label>
                      <div className="relative">
                        <input
                          id="reg-pin"
                          type={showRegPin ? 'text' : 'password'}
                          required
                          autoComplete="new-password"
                          value={regPin}
                          onChange={(e) => {
                            setRegPin(e.target.value);
                            if (regError) setRegError(null);
                          }}
                          placeholder="4 أرقام أو أحرف فأكثر"
                          className="h-11 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] pr-4 pl-12 font-mono text-base tracking-widest text-[#11181C] placeholder:text-xs placeholder:tracking-normal placeholder:text-[#8A949A] tabular-nums transition-colors focus:border-[#0E4D3A] focus:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegPin((prev) => !prev)}
                          aria-label={
                            showRegPin ? 'إخفاء الرقم السري' : 'إظهار الرقم السري'
                          }
                          className="absolute inset-y-0 left-0 flex w-12 items-center justify-center text-[#525D63] transition-colors hover:text-[#11181C]"
                        >
                          {showRegPin ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {regError && (
                      <div
                        role="alert"
                        className="flex items-start gap-2.5 rounded-lg border border-[#DC2626]/25 bg-[#FEF2F2] px-3.5 py-3 text-xs leading-relaxed text-[#991B1B]"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                        <span>{regError}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={regSubmitting}
                      className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-[#0E4D3A] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0B3D2E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A] focus-visible:ring-offset-2 disabled:opacity-70 active:scale-[0.99]"
                    >
                      {regSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      <span>
                        {regSubmitting
                          ? 'جاري إرسال الطلب...'
                          : 'إرسال طلب التسجيل'}
                      </span>
                    </button>
                  </form>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      <UnifiedFooter />
    </div>
  );
};
