import { PickupStatus } from '../types/nidaa';

const RIYADH_TIMEZONE = 'Asia/Riyadh';

export function formatTimeRiyadh(isoString?: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-US', {
    timeZone: RIYADH_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDateRiyadh(isoString?: string | Date | null): string {
  if (!isoString) return '—';
  const date = typeof isoString === 'string' ? new Date(isoString) : isoString;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ar-SA', {
    timeZone: RIYADH_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateTimeRiyadh(isoString?: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDateRiyadh(date)} · ${formatTimeRiyadh(isoString)}`;
}

export function getTodayRiyadhInputDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function calculateWaitMinutes(
  requestedAt: string,
  endAt?: string | null,
  nowMs: number = Date.now()
): number {
  const start = new Date(requestedAt).getTime();
  const end = endAt ? new Date(endAt).getTime() : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 60000));
}

export function formatWaitDurationArabic(minutes: number): string {
  if (minutes <= 0) return 'أقل من دقيقة';
  if (minutes === 1) return 'دقيقة واحدة';
  if (minutes === 2) return 'دقيقتان';
  if (minutes <= 10) return `${minutes} دقائق`;
  return `${minutes} دقيقة`;
}

export function getStatusLabel(status: PickupStatus): string {
  switch (status) {
    case 'new':
      return 'طلب جديد';
    case 'called':
      return 'تم النداء';
    case 'exited':
      return 'تم الخروج';
    case 'cancelled':
      return 'ملغي';
  }
}

export function normalizeArabicText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '');
}
