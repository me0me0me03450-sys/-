import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  LogOut,
  Search,
  Sparkles,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { BrandMark, UnifiedFooter } from '../components/BrandMark';
import { apiClient } from '../services/apiClient';
import {
  AppRoute,
  Classroom,
  PickupRequest,
  PickupStatus,
  Section,
  StaffAccount,
  Student,
} from '../types/nidaa';
import {
  calculateWaitMinutes,
  formatTimeRiyadh,
  formatWaitDurationArabic,
  getStatusLabel,
  normalizeArabicText,
} from '../utils/formatters';

interface QueueMonitorViewProps {
  currentUser: StaffAccount;
  onNavigate: (route: AppRoute) => void;
}

export const QueueMonitorView: React.FC<QueueMonitorViewProps> = ({
  currentUser,
  onNavigate,
}) => {
  const isSuperAdmin = currentUser.role === 'super_admin';

  const [sections, setSections] = useState<Section[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [calls, setCalls] = useState<PickupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    currentUser.sectionId
  );

  const [viewTab, setViewTab] = useState<'active' | 'history' | 'students'>(
    'active'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>('all');
  const [updatingCallId, setUpdatingCallId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const loadQueueData = useCallback(async () => {
    try {
      const targetSection = isSuperAdmin
        ? selectedSectionId
        : currentUser.sectionId;
      const res = await apiClient.fetchQueueData(targetSection);
      setSections(res.sections);
      setClassrooms(res.classrooms);
      setStudents(res.students);
      setCalls(res.calls);
      if (isSuperAdmin && !selectedSectionId && res.sections.length > 0) {
        setSelectedSectionId(res.sections[0].id);
      }
    } catch {
      // ignore transient error
    } finally {
      setLoading(false);
    }
  }, [currentUser.sectionId, isSuperAdmin, selectedSectionId]);

  useEffect(() => {
    loadQueueData();
  }, [loadQueueData]);

  // Silent real-time updates via SSE / Supabase Realtime (no audio alerts)
  useEffect(() => {
    const unsubscribe = apiClient.subscribeStaffRealtime(() => {
      loadQueueData();
    });
    const waitTicker = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15000);
    return () => {
      unsubscribe();
      window.clearInterval(waitTicker);
    };
  }, [loadQueueData]);

  const activeSection = useMemo(() => {
    const targetId = isSuperAdmin ? selectedSectionId : currentUser.sectionId;
    return sections.find((s) => s.id === targetId) ?? sections[0] ?? null;
  }, [sections, isSuperAdmin, selectedSectionId, currentUser.sectionId]);

  const scopedCalls = useMemo(() => {
    if (!activeSection) return calls;
    return calls.filter((c) => c.sectionId === activeSection.id);
  }, [calls, activeSection]);

  const scopedStudents = useMemo(() => {
    if (!activeSection) return students;
    return students.filter((s) => s.sectionId === activeSection.id);
  }, [students, activeSection]);

  const scopedClassrooms = useMemo(() => {
    if (!activeSection) return classrooms;
    return classrooms.filter((c) => c.sectionId === activeSection.id);
  }, [classrooms, activeSection]);

  const activeCallsCount = useMemo(
    () =>
      scopedCalls.filter((c) => c.status === 'new' || c.status === 'called')
        .length,
    [scopedCalls]
  );

  const newCallsCount = useMemo(
    () => scopedCalls.filter((c) => c.status === 'new').length,
    [scopedCalls]
  );

  const historyCallsCount = useMemo(
    () =>
      scopedCalls.filter(
        (c) => c.status === 'exited' || c.status === 'cancelled'
      ).length,
    [scopedCalls]
  );

  const filteredCalls = useMemo(() => {
    const q = normalizeArabicText(searchQuery);
    return scopedCalls
      .filter((call) => {
        const matchesTab =
          viewTab === 'active'
            ? call.status === 'new' || call.status === 'called'
            : call.status === 'exited' || call.status === 'cancelled';
        const matchesQuery =
          !q ||
          normalizeArabicText(call.studentName).includes(q) ||
          normalizeArabicText(call.classroomName).includes(q) ||
          normalizeArabicText(call.gradeName).includes(q);
        return matchesTab && matchesQuery;
      })
      .sort((a, b) => {
        // Active calls: oldest waiting first (requestedAt ascending), prioritizing 'new' visually
        if (viewTab === 'active') {
          return (
            new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
          );
        }
        return (
          new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
        );
      });
  }, [scopedCalls, viewTab, searchQuery]);

  const filteredStudents = useMemo(() => {
    const q = normalizeArabicText(searchQuery);
    return scopedStudents.filter((student) => {
      const matchesClass =
        selectedClassroomId === 'all' ||
        student.classroomId === selectedClassroomId;
      const matchesQ =
        !q ||
        normalizeArabicText(student.fullName).includes(q) ||
        normalizeArabicText(student.classroomName).includes(q) ||
        normalizeArabicText(student.gradeName).includes(q);
      return matchesClass && matchesQ;
    });
  }, [scopedStudents, selectedClassroomId, searchQuery]);

  const handleStatusChange = async (callId: string, status: PickupStatus) => {
    setUpdatingCallId(callId);
    setActionError(null);
    try {
      await apiClient.updateCallStatus(callId, status);
      await loadQueueData();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'تعذر تحديث حالة النداء.'
      );
    } finally {
      setUpdatingCallId(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F7F5] text-[#11181C]">
      <header className="sticky top-0 z-20 border-b border-[#E3E5E0] bg-white px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('staff_hub')}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E3E5E0] bg-[#FAFAF8] px-3 text-xs font-medium text-[#11181C] transition-colors hover:bg-[#F1F2EE] whitespace-nowrap shrink-0"
            >
              <ArrowRight className="h-4 w-4" />
              <span>البوابة الداخلية</span>
            </button>
            <BrandMark size="sm" />
            <div>
              <h1 className="text-base font-bold text-[#11181C]">
                مراقبة الدور — {activeSection?.name ?? currentUser.sectionName}
              </h1>
              <p className="text-xs text-[#525D63]">
                {currentUser.fullName} · استقبال لحظي صامت (توقيت الرياض)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-3 text-xs text-[#525D63] sm:flex">
              <span>
                طلبات جديدة:{' '}
                <strong className="font-mono text-[#B45309] tabular-nums">
                  {newCallsCount}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                النشطة:{' '}
                <strong className="font-mono text-[#0E4D3A] tabular-nums">
                  {activeCallsCount}
                </strong>
              </span>
            </div>

            {isSuperAdmin && sections.length > 1 && (
              <select
                value={activeSection?.id ?? ''}
                onChange={(e) => {
                  setSelectedSectionId(e.target.value);
                  setSelectedClassroomId('all');
                }}
                aria-label="اختيار القسم"
                className="h-10 rounded-lg border border-[#E3E5E0] bg-white px-3 text-xs font-semibold text-[#11181C] focus:border-[#0E4D3A] focus:outline-none"
              >
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    قسم {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {actionError && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3 text-xs text-[#991B1B]"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#DC2626]" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="إغلاق التنبيه"
              className="text-[#991B1B] hover:opacity-75"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex flex-col gap-4 border-b border-[#E3E5E0] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-[#E3E5E0] bg-white p-1">
              <button
                type="button"
                onClick={() => setViewTab('active')}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  viewTab === 'active'
                    ? 'bg-[#0E4D3A] text-white'
                    : 'text-[#525D63] hover:text-[#11181C]'
                }`}
              >
                النداءات النشطة ({activeCallsCount})
              </button>
              <button
                type="button"
                onClick={() => setViewTab('history')}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  viewTab === 'history'
                    ? 'bg-[#0E4D3A] text-white'
                    : 'text-[#525D63] hover:text-[#11181C]'
                }`}
              >
                المنتهية والملغاة ({historyCallsCount})
              </button>
              <button
                type="button"
                onClick={() => setViewTab('students')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  viewTab === 'students'
                    ? 'bg-[#0E4D3A] text-white'
                    : 'text-[#525D63] hover:text-[#11181C]'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>طالبات القسم ({scopedStudents.length})</span>
              </button>
            </div>

            {viewTab === 'students' && scopedClassrooms.length > 0 && (
              <select
                value={selectedClassroomId}
                onChange={(e) => setSelectedClassroomId(e.target.value)}
                aria-label="تصفية حسب الفصل"
                className="h-10 rounded-lg border border-[#E3E5E0] bg-white px-3 text-xs font-medium text-[#11181C] focus:border-[#0E4D3A] focus:outline-none"
              >
                <option value="all">جميع فصول القسم</option>
                {scopedClassrooms.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="relative w-full lg:w-64">
            <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[#8A949A]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم الطالبة أو الفصل"
              className="h-10 w-full rounded-lg border border-[#E3E5E0] bg-white pr-9 pl-3 text-xs text-[#11181C] placeholder:text-[#8A949A] focus:border-[#0E4D3A] focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-[#0E4D3A]" />
          </div>
        ) : viewTab !== 'students' ? (
          filteredCalls.length === 0 ? (
            <div className="mt-10 rounded-xl border border-dashed border-[#D4D8D1] bg-white px-6 py-16 text-center">
              <p className="text-sm font-semibold text-[#11181C]">
                لا توجد نداءات في هذا القسم حالياً
              </p>
              <p className="mt-1 text-xs text-[#525D63]">
                تصل الطلبات الجديدة هنا لحظياً فور إرسالها من ولي الأمر
              </p>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredCalls.map((call) => {
                const isNew = call.status === 'new';
                const isCalled = call.status === 'called';
                const isDone =
                  call.status === 'exited' || call.status === 'cancelled';
                const waitMinutes = calculateWaitMinutes(
                  call.requestedAt,
                  call.exitedAt ?? call.cancelledAt ?? null,
                  nowMs
                );
                const busy = updatingCallId === call.id;

                return (
                  <article
                    key={call.id}
                    className={`flex flex-col justify-between rounded-xl border p-5 transition-colors ${
                      isNew
                        ? 'border-[#D97706] bg-[#FFFDF7]'
                        : 'border-[#E3E5E0] bg-white hover:border-[#C8CDC4]'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-[#11181C]">
                              {call.studentName}
                            </h2>
                            {isNew && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#B45309]">
                                <Sparkles className="h-3 w-3" />
                                <span>جديد</span>
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#525D63]">
                            <span>{call.gradeName}</span>
                            <span aria-hidden="true">·</span>
                            <span>{call.classroomName}</span>
                          </div>
                        </div>

                        <div className="text-left shrink-0">
                          <span className="block font-mono text-xs font-medium text-[#11181C] tabular-nums">
                            {formatTimeRiyadh(call.requestedAt)}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-[#525D63]">
                            الانتظار: {formatWaitDurationArabic(waitMinutes)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-[#F1F2EE] pt-3 text-xs">
                        {isNew && (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#B45309]">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{getStatusLabel(call.status)}</span>
                          </span>
                        )}
                        {isCalled && (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#0E4D3A]">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>{getStatusLabel(call.status)}</span>
                          </span>
                        )}
                        {call.status === 'exited' && (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#475569]">
                            <LogOut className="h-3.5 w-3.5" />
                            <span>
                              {getStatusLabel(call.status)} ·{' '}
                              <span className="font-mono tabular-nums">
                                {formatTimeRiyadh(call.exitedAt)}
                              </span>
                            </span>
                          </span>
                        )}
                        {call.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#DC2626]">
                            <XCircle className="h-3.5 w-3.5" />
                            <span>
                              {getStatusLabel(call.status)} ·{' '}
                              <span className="font-mono tabular-nums">
                                {formatTimeRiyadh(call.cancelledAt)}
                              </span>
                            </span>
                          </span>
                        )}

                        {call.handledByName && (
                          <span className="text-[11px] text-[#525D63]">
                            {call.handledByName}
                          </span>
                        )}
                      </div>
                    </div>

                    {!isDone && (
                      <div className="mt-5 grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={!isNew || busy}
                          onClick={() => handleStatusChange(call.id, 'called')}
                          className={`flex h-10 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                            isNew
                              ? 'bg-[#0E4D3A] text-white hover:bg-[#0B3D2E]'
                              : 'cursor-not-allowed border border-[#E3E5E0] bg-[#F7F7F5] text-[#8A949A]'
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>تم النداء</span>
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleStatusChange(call.id, 'exited')}
                          className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[#11181C] bg-white px-2 text-xs font-semibold text-[#11181C] transition-colors hover:bg-[#11181C] hover:text-white whitespace-nowrap"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          <span>تم الخروج</span>
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleStatusChange(call.id, 'cancelled')
                          }
                          className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[#E3E5E0] bg-white px-2 text-xs font-medium text-[#DC2626] transition-colors hover:border-[#DC2626] hover:bg-[#FEF2F2] whitespace-nowrap"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>إلغاء</span>
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )
        ) : (
          <section className="mt-6 rounded-xl border border-[#E3E5E0] bg-white">
            {filteredStudents.length === 0 ? (
              <div className="px-6 py-12 text-center text-xs text-[#525D63]">
                لا توجد طالبات مسجلات في هذا القسم.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-[#E3E5E0] bg-[#FAFAF8] text-[#525D63]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">اسم الطالبة</th>
                      <th className="px-5 py-3 font-semibold">الصف</th>
                      <th className="px-5 py-3 font-semibold">الفصل</th>
                      <th className="px-5 py-3 font-semibold">حالة آخر نداء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F2EE]">
                    {filteredStudents.map((student) => {
                      const latestCall = scopedCalls.find(
                        (c) => c.studentId === student.id
                      );
                      return (
                        <tr key={student.id} className="hover:bg-[#FAFAF8]">
                          <td className="px-5 py-3.5 font-semibold text-[#11181C]">
                            {student.fullName}
                          </td>
                          <td className="px-5 py-3.5 text-[#525D63]">
                            {student.gradeName}
                          </td>
                          <td className="px-5 py-3.5 text-[#525D63]">
                            {student.classroomName}
                          </td>
                          <td className="px-5 py-3.5 font-medium">
                            {latestCall ? (
                              <span
                                className={
                                  latestCall.status === 'new'
                                    ? 'text-[#B45309]'
                                    : latestCall.status === 'called'
                                    ? 'text-[#0E4D3A]'
                                    : latestCall.status === 'cancelled'
                                    ? 'text-[#DC2626]'
                                    : 'text-[#475569]'
                                }
                              >
                                {getStatusLabel(latestCall.status)}
                              </span>
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
        )}
      </main>

      <UnifiedFooter />
    </div>
  );
};
