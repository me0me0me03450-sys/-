import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  MonitorCheck,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { BrandMark, UnifiedFooter } from '../components/BrandMark';
import { apiClient } from '../services/apiClient';
import { AppRoute, StaffAccount } from '../types/nidaa';

interface InternalHubViewProps {
  currentUser: StaffAccount | null;
  onAuthenticated: (user: StaffAccount) => void;
  onLogout: () => void;
  onNavigate: (route: AppRoute) => void;
}

export const InternalHubView: React.FC<InternalHubViewProps> = ({
  currentUser,
  onAuthenticated,
  onLogout,
  onNavigate,
}) => {
  const [checkingStatus, setCheckingStatus] = useState(!currentUser);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser) {
      setCheckingStatus(false);
      return;
    }
    let mounted = true;
    apiClient
      .getAuthStatus()
      .then((res) => {
        if (mounted) {
          setNeedsSetup(res.needsSetup);
        }
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (mounted) setCheckingStatus(false);
      });
    return () => {
      mounted = false;
    };
  }, [currentUser]);

  const handleLoginOrSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      if (needsSetup) {
        const res = await apiClient.setupSuperAdmin({
          fullName,
          username,
          password,
        });
        onAuthenticated(res.user);
      } else {
        const res = await apiClient.loginStaff({ username, password });
        onAuthenticated(res.user);
      }
      setPassword('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'تعذر تسجيل الدخول، يرجى التحقق.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F7F5] text-[#11181C]">
      <header className="border-b border-[#E3E5E0] bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <div>
              <h1 className="text-base font-bold text-[#11181C]">منصة نداء</h1>
              <p className="text-xs text-[#525D63]">شركة تربية الأجيال الأهلية</p>
            </div>
          </div>

          {currentUser && (
            <div className="flex items-center gap-3">
              <div className="hidden text-left sm:block">
                <p className="text-xs font-bold text-[#11181C]">
                  {currentUser.fullName}
                </p>
                <p className="text-[11px] text-[#525D63]">
                  {currentUser.role === 'super_admin'
                    ? 'مديرة النظام'
                    : `مراقبة الدور · ${currentUser.sectionName}`}
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E3E5E0] bg-white px-3 text-xs font-medium text-[#525D63] transition-colors hover:border-[#DC2626] hover:text-[#DC2626]"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>خروج</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        {checkingStatus ? (
          <Loader2 className="h-6 w-6 animate-spin text-[#0E4D3A]" />
        ) : !currentUser ? (
          <section className="w-full max-w-md overflow-hidden rounded-xl border border-[#E3E5E0] bg-white shadow-xs">
            <div className="h-1 w-full bg-[#0E4D3A]" />
            <form
              onSubmit={handleLoginOrSetup}
              className="space-y-4 p-6 sm:p-8"
              noValidate
            >
              <div className="flex items-center gap-3 border-b border-[#F1F2EE] pb-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ECF5F2] text-[#0E4D3A]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#11181C]">
                    {needsSetup
                      ? 'إعداد حساب مديرة النظام'
                      : 'دخول البوابة الداخلية'}
                  </h2>
                  <p className="text-xs text-[#525D63]">
                    {needsSetup
                      ? 'الخطوة الأولى لإنشاء صلاحية مديرة النظام'
                      : 'يرجى إدخال اسم المستخدم وكلمة المرور'}
                  </p>
                </div>
              </div>

              {needsSetup && (
                <div>
                  <label
                    htmlFor="setup-fullname"
                    className="mb-1.5 block text-xs font-semibold text-[#11181C]"
                  >
                    الاسم الكامل
                  </label>
                  <input
                    id="setup-fullname"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="الاسم الثلاثي"
                    className="h-11 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-3.5 text-sm focus:border-[#0E4D3A] focus:bg-white focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="staff-username"
                  className="mb-1.5 block text-xs font-semibold text-[#11181C]"
                >
                  اسم المستخدم
                </label>
                <input
                  id="staff-username"
                  type="text"
                  required
                  dir="ltr"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="username"
                  className="h-11 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] px-3.5 text-right font-mono text-sm focus:border-[#0E4D3A] focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="staff-password"
                  className="mb-1.5 block text-xs font-semibold text-[#11181C]"
                >
                  كلمة المرور
                </label>
                <div className="relative">
                  <input
                    id="staff-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete={
                      needsSetup ? 'new-password' : 'current-password'
                    }
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    placeholder="••••••"
                    className="h-11 w-full rounded-lg border border-[#D4D8D1] bg-[#FAFAF8] pr-3.5 pl-11 font-mono text-sm focus:border-[#0E4D3A] focus:bg-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={
                      showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
                    }
                    className="absolute inset-y-0 left-0 flex w-11 items-center justify-center text-[#525D63] hover:text-[#11181C]"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-[#DC2626]/25 bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#991B1B]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0E4D3A] text-sm font-semibold text-white transition-colors hover:bg-[#0B3D2E] disabled:opacity-70"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{needsSetup ? 'إنشاء الحساب والدخول' : 'تسجيل الدخول'}</span>
              </button>
            </form>
          </section>
        ) : (
          <div className="w-full max-w-2xl space-y-5">
            {accessNotice && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-[#D97706]/30 bg-[#FFFBEB] px-4 py-3 text-xs font-medium text-[#92400E]"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-[#D97706]" />
                <span>{accessNotice}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setAccessNotice(null);
                  onNavigate('staff_queue');
                }}
                className="group flex flex-col items-center justify-center rounded-xl border border-[#E3E5E0] bg-white px-8 py-12 text-center transition-all hover:border-[#0E4D3A] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ECF5F2] text-[#0E4D3A] transition-colors group-hover:bg-[#0E4D3A] group-hover:text-white">
                  <MonitorCheck className="h-8 w-8" strokeWidth={1.75} />
                </div>
                <span className="mt-5 text-lg font-bold text-[#11181C]">
                  مراقبة الدور
                </span>
                <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#0E4D3A] opacity-80 transition-opacity group-hover:opacity-100">
                  <span>دخول</span>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (currentUser.role !== 'super_admin') {
                    setAccessNotice(
                      'صلاحية إدارة النظام مخصصة لحساب مديرة النظام فقط.'
                    );
                    return;
                  }
                  setAccessNotice(null);
                  onNavigate('staff_admin');
                }}
                className="group flex flex-col items-center justify-center rounded-xl border border-[#E3E5E0] bg-white px-8 py-12 text-center transition-all hover:border-[#0E4D3A] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E4D3A]"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F4F1E8] text-[#8C6A28] transition-colors group-hover:bg-[#0E4D3A] group-hover:text-white">
                  <SlidersHorizontal className="h-8 w-8" strokeWidth={1.75} />
                </div>
                <span className="mt-5 text-lg font-bold text-[#11181C]">
                  إدارة النظام
                </span>
                <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#0E4D3A] opacity-80 transition-opacity group-hover:opacity-100">
                  <span>دخول</span>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </span>
              </button>
            </div>
          </div>
        )}
      </main>

      <UnifiedFooter />
    </div>
  );
};
