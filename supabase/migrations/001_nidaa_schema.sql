-- ============================================================================
-- منصة نداء - شركة تربية الأجيال الأهلية
-- Migration 001: Core Relational Schema (PostgreSQL / Supabase Free)
-- Timezone: Asia/Riyadh
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. الأعوام الدراسية
CREATE TABLE IF NOT EXISTS public.academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT false,
  starts_on DATE,
  ends_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. الأقسام (الروضة، الابتدائي، المتوسط والثانوي، الدبلومة، وأي أقسام مضافة)
CREATE TABLE IF NOT EXISTS public.sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. الصفوف داخل كل قسم
CREATE TABLE IF NOT EXISTS public.grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (section_id, name)
);

-- 4. الفصول داخل كل صف
CREATE TABLE IF NOT EXISTS public.classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  grade_id UUID NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (grade_id, name)
);

-- 5. الطالبات (الرقم السري محفوظ كـ Hash فقط ولا يُحفظ كنص مكشوف)
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  grade_id UUID NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE RESTRICT,
  pin_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_normalized_name ON public.students(normalized_name);
CREATE INDEX IF NOT EXISTS idx_students_section_active ON public.students(section_id, is_active, is_archived);

-- 6. حسابات الموظفات (كلمات المرور محفوظة كـ Hash فقط)
CREATE TABLE IF NOT EXISTS public.staff_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'queue_monitor')),
  section_id UUID REFERENCES public.sections(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_queue_monitor_has_section CHECK (
    (role = 'super_admin') OR (role = 'queue_monitor' AND section_id IS NOT NULL)
  )
);

-- 7. طلبات النداء
CREATE TABLE IF NOT EXISTS public.pickup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  grade_id UUID NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE RESTRICT,
  academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'called', 'exited', 'cancelled')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  called_at TIMESTAMPTZ,
  exited_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  handled_by_id UUID REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  handled_by_name TEXT,
  tracking_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex')
);

CREATE INDEX IF NOT EXISTS idx_pickup_requests_section_status ON public.pickup_requests(section_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_student_active ON public.pickup_requests(student_id) WHERE status IN ('new', 'called');

-- منع تكرار النداء النشط لنفس الطالبة على مستوى قاعدة البيانات
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_pickup_per_student
  ON public.pickup_requests(student_id)
  WHERE status IN ('new', 'called');

-- 8. سجل التدقيق
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- 9. الإعدادات العامة
CREATE TABLE IF NOT EXISTS public.settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  school_name TEXT NOT NULL DEFAULT 'شركة تربية الأجيال الأهلية',
  platform_name TEXT NOT NULL DEFAULT 'منصة نداء',
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  max_parent_attempts INTEGER NOT NULL DEFAULT 5,
  lockout_minutes INTEGER NOT NULL DEFAULT 10,
  active_academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- جدول تحديد محاولات التحقق المتكررة لولي الأمر
CREATE TABLE IF NOT EXISTS public.parent_rate_limits (
  rate_key TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. طلبات تسجيل أولياء الأمور الجديدة (تنتظر موافقة إدارة النظام قبل التفعيل)
CREATE TABLE IF NOT EXISTS public.parent_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  grade_name TEXT NOT NULL,
  classroom_name TEXT NOT NULL,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  grade_id UUID REFERENCES public.grades(id) ON DELETE SET NULL,
  classroom_id UUID REFERENCES public.classrooms(id) ON DELETE SET NULL,
  pin_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  tracking_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_id UUID REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  reviewed_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_parent_registrations_status ON public.parent_registrations(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_parent_registrations_normalized_name ON public.parent_registrations(normalized_name);

-- تهيئة الأقسام الأساسية والإعدادات الافتراضية
INSERT INTO public.sections (code, name, sort_order)
VALUES
  ('kg', 'الروضة', 1),
  ('primary', 'الابتدائي', 2),
  ('middle_high', 'المتوسط والثانوي', 3),
  ('diploma', 'الدبلومة', 4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.academic_years (name, is_active)
VALUES ('1447-1448 هـ', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.settings (id, active_academic_year_id)
SELECT 1, id FROM public.academic_years WHERE is_active = true LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- تفعيل Supabase Realtime للجداول الحية
ALTER PUBLICATION supabase_realtime ADD TABLE public.pickup_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.parent_registrations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.grades;
ALTER PUBLICATION supabase_realtime ADD TABLE public.classrooms;
