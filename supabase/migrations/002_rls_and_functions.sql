-- ============================================================================
-- منصة نداء - شركة تربية الأجيال الأهلية
-- Migration 002: Row Level Security (RLS) & Server-Side Secure Functions
-- ============================================================================

-- دالة توحيد النص العربي للمطابقة الدقيقة عند نداء ولي الأمر
CREATE OR REPLACE FUNCTION public.normalize_arabic_text(input_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT trim(
    regexp_replace(
      translate(
        regexp_replace(coalesce(input_text, ''), E'[\u064B-\u065F]', '', 'g'),
        'أإآةى',
        'ااهي'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

-- تفعيل Row Level Security على كافة الجداول
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_registrations ENABLE ROW LEVEL SECURITY;

-- دوال مساعدة لقراءة صلاحية المستخدم الحالي من جدول staff_accounts
CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.staff_accounts
  WHERE auth_user_id = auth.uid() AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_staff_section_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT section_id
  FROM public.staff_accounts
  WHERE auth_user_id = auth.uid() AND is_active = true
  LIMIT 1;
$$;

-- سياسات الأقسام والصفوف والفصول
CREATE POLICY "super_admin_all_sections" ON public.sections
  FOR ALL USING (public.current_staff_role() = 'super_admin');

CREATE POLICY "monitor_read_own_section" ON public.sections
  FOR SELECT USING (
    public.current_staff_role() = 'queue_monitor'
    AND id = public.current_staff_section_id()
  );

CREATE POLICY "super_admin_all_grades" ON public.grades
  FOR ALL USING (public.current_staff_role() = 'super_admin');

CREATE POLICY "monitor_read_own_grades" ON public.grades
  FOR SELECT USING (
    public.current_staff_role() = 'queue_monitor'
    AND section_id = public.current_staff_section_id()
  );

CREATE POLICY "super_admin_all_classrooms" ON public.classrooms
  FOR ALL USING (public.current_staff_role() = 'super_admin');

CREATE POLICY "monitor_read_own_classrooms" ON public.classrooms
  FOR SELECT USING (
    public.current_staff_role() = 'queue_monitor'
    AND section_id = public.current_staff_section_id()
  );

-- سياسات الطالبات (عزل الأقسام + منع القراءة العامة)
CREATE POLICY "super_admin_all_students" ON public.students
  FOR ALL USING (public.current_staff_role() = 'super_admin');

CREATE POLICY "monitor_read_own_students" ON public.students
  FOR SELECT USING (
    public.current_staff_role() = 'queue_monitor'
    AND section_id = public.current_staff_section_id()
    AND is_archived = false
  );

-- سياسات حسابات الموظفات وسجل التدقيق والإعدادات والأعوام
CREATE POLICY "super_admin_all_staff" ON public.staff_accounts
  FOR ALL USING (public.current_staff_role() = 'super_admin');

CREATE POLICY "staff_read_self" ON public.staff_accounts
  FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "super_admin_all_audit" ON public.audit_logs
  FOR ALL USING (public.current_staff_role() = 'super_admin');

CREATE POLICY "super_admin_all_years" ON public.academic_years
  FOR ALL USING (public.current_staff_role() = 'super_admin');

CREATE POLICY "super_admin_all_settings" ON public.settings
  FOR ALL USING (public.current_staff_role() = 'super_admin');

-- سياسات طلبات النداء
CREATE POLICY "super_admin_all_pickups" ON public.pickup_requests
  FOR ALL USING (public.current_staff_role() = 'super_admin');

CREATE POLICY "monitor_read_own_pickups" ON public.pickup_requests
  FOR SELECT USING (
    public.current_staff_role() = 'queue_monitor'
    AND section_id = public.current_staff_section_id()
  );

CREATE POLICY "monitor_update_own_pickups" ON public.pickup_requests
  FOR UPDATE USING (
    public.current_staff_role() = 'queue_monitor'
    AND section_id = public.current_staff_section_id()
  )
  WITH CHECK (
    public.current_staff_role() = 'queue_monitor'
    AND section_id = public.current_staff_section_id()
  );

-- سياسات طلبات تسجيل أولياء الأمور (مديرة النظام فقط)
CREATE POLICY "super_admin_all_registrations" ON public.parent_registrations
  FOR ALL USING (public.current_staff_role() = 'super_admin');

-- ============================================================================
-- RPC آمن لولي الأمر: التحقق من اسم الطالبة والرقم السري مع Rate Limiting
-- ============================================================================
CREATE OR REPLACE FUNCTION public.submit_parent_pickup_call(
  p_student_name TEXT,
  p_pin TEXT,
  p_client_key TEXT DEFAULT 'web'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_name TEXT;
  v_rate_row public.parent_rate_limits%ROWTYPE;
  v_settings public.settings%ROWTYPE;
  v_student public.students%ROWTYPE;
  v_existing public.pickup_requests%ROWTYPE;
  v_created public.pickup_requests%ROWTYPE;
  v_section_name TEXT;
  v_grade_name TEXT;
  v_classroom_name TEXT;
BEGIN
  SELECT * INTO v_settings FROM public.settings WHERE id = 1;
  v_norm_name := public.normalize_arabic_text(p_student_name);

  IF v_norm_name = '' OR trim(coalesce(p_pin, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يرجى إدخال اسم الطالبة والرقم السري.');
  END IF;

  -- فحص محاولات الدخول المتكررة
  SELECT * INTO v_rate_row FROM public.parent_rate_limits WHERE rate_key = p_client_key;
  IF FOUND AND v_rate_row.locked_until IS NOT NULL AND v_rate_row.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'rate_limited', true,
      'error', 'تم تجاوز عدد المحاولات المسموح بها مؤقتاً. يرجى المحاولة بعد قليل.'
    );
  END IF;

  -- التحقق من الطالبة النشطة والرقم السري المشفّر
  SELECT s.* INTO v_student
  FROM public.students s
  JOIN public.sections sec ON sec.id = s.section_id AND sec.is_active = true
  JOIN public.grades gr ON gr.id = s.grade_id AND gr.is_active = true
  JOIN public.classrooms cls ON cls.id = s.classroom_id AND cls.is_active = true
  WHERE s.normalized_name = v_norm_name
    AND s.is_active = true
    AND s.is_archived = false
    AND s.pin_hash = crypt(trim(p_pin), s.pin_hash)
  LIMIT 1;

  IF NOT FOUND THEN
    -- فحص ما إذا كان لدى ولي الأمر طلب تسجيل معلق أو مرفوض أو حساب معطل بنفس الاسم والرقم السري
    IF EXISTS (
      SELECT 1 FROM public.parent_registrations pr
      WHERE pr.normalized_name = v_norm_name
        AND pr.status = 'pending'
        AND pr.pin_hash = crypt(trim(p_pin), pr.pin_hash)
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'طلب التسجيل لا يزال بانتظار موافقة إدارة النظام ولا يمكن إرسال النداء قبل التفعيل.'
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.students s
      JOIN public.sections sec ON sec.id = s.section_id
      JOIN public.grades gr ON gr.id = s.grade_id
      JOIN public.classrooms cls ON cls.id = s.classroom_id
      WHERE s.normalized_name = v_norm_name
        AND (s.is_active = false OR s.is_archived = true OR sec.is_active = false OR gr.is_active = false OR cls.is_active = false)
        AND s.pin_hash = crypt(trim(p_pin), s.pin_hash)
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'تم تعطيل الرقم السري أو حساب الطالبة/الطالب أو القسم التابع له من إدارة النظام.'
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.parent_registrations pr
      WHERE pr.normalized_name = v_norm_name
        AND pr.status = 'rejected'
        AND pr.pin_hash = crypt(trim(p_pin), pr.pin_hash)
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'تم رفض طلب التسجيل السابق. يرجى مراجعة إدارة النظام.'
      );
    END IF;

    INSERT INTO public.parent_rate_limits (rate_key, failed_attempts, locked_until, updated_at)
    VALUES (
      p_client_key,
      1,
      CASE WHEN 1 >= coalesce(v_settings.max_parent_attempts, 5)
        THEN now() + make_interval(mins => coalesce(v_settings.lockout_minutes, 10))
        ELSE NULL END,
      now()
    )
    ON CONFLICT (rate_key) DO UPDATE SET
      failed_attempts = CASE
        WHEN parent_rate_limits.locked_until IS NOT NULL AND parent_rate_limits.locked_until <= now() THEN 1
        ELSE parent_rate_limits.failed_attempts + 1
      END,
      locked_until = CASE
        WHEN (CASE WHEN parent_rate_limits.locked_until IS NOT NULL AND parent_rate_limits.locked_until <= now() THEN 1 ELSE parent_rate_limits.failed_attempts + 1 END) >= coalesce(v_settings.max_parent_attempts, 5)
        THEN now() + make_interval(mins => coalesce(v_settings.lockout_minutes, 10))
        ELSE NULL
      END,
      updated_at = now();

    RETURN jsonb_build_object('ok', false, 'error', 'تعذر التحقق من اسم الطالبة أو الطالب أو الرقم السري.');
  END IF;

  -- تصفير عداد المحاولات عند نجاح التحقق
  DELETE FROM public.parent_rate_limits WHERE rate_key = p_client_key;

  SELECT name INTO v_section_name FROM public.sections WHERE id = v_student.section_id;
  SELECT name INTO v_grade_name FROM public.grades WHERE id = v_student.grade_id;
  SELECT name INTO v_classroom_name FROM public.classrooms WHERE id = v_student.classroom_id;

  -- منع تكرار النداء أثناء وجود طلب نشط
  SELECT * INTO v_existing
  FROM public.pickup_requests
  WHERE student_id = v_student.id AND status IN ('new', 'called')
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'tracking_token', v_existing.tracking_token,
      'call', jsonb_build_object(
        'id', v_existing.id,
        'student_name', v_student.full_name,
        'section_name', v_section_name,
        'grade_name', v_grade_name,
        'classroom_name', v_classroom_name,
        'status', v_existing.status,
        'requested_at', v_existing.requested_at,
        'called_at', v_existing.called_at,
        'exited_at', v_existing.exited_at,
        'cancelled_at', v_existing.cancelled_at
      )
    );
  END IF;

  INSERT INTO public.pickup_requests (
    student_id, section_id, grade_id, classroom_id, academic_year_id, status, requested_at
  )
  VALUES (
    v_student.id, v_student.section_id, v_student.grade_id, v_student.classroom_id,
    v_settings.active_academic_year_id, 'new', now()
  )
  RETURNING * INTO v_created;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'tracking_token', v_created.tracking_token,
    'call', jsonb_build_object(
      'id', v_created.id,
      'student_name', v_student.full_name,
      'section_name', v_section_name,
      'grade_name', v_grade_name,
      'classroom_name', v_classroom_name,
      'status', v_created.status,
      'requested_at', v_created.requested_at,
      'called_at', v_created.called_at,
      'exited_at', v_created.exited_at,
      'cancelled_at', v_created.cancelled_at
    )
  );
END;
$$;

-- دالة متابعة حالة طلب واحد فقط لولي الأمر باستخدام رمز التتبع
CREATE OR REPLACE FUNCTION public.get_parent_call_status(
  p_request_id UUID,
  p_tracking_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.pickup_requests%ROWTYPE;
  v_student_name TEXT;
  v_section_name TEXT;
  v_grade_name TEXT;
  v_classroom_name TEXT;
BEGIN
  SELECT * INTO v_req
  FROM public.pickup_requests
  WHERE id = p_request_id AND tracking_token = p_tracking_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الطلب غير موجود');
  END IF;

  SELECT full_name INTO v_student_name FROM public.students WHERE id = v_req.student_id;
  SELECT name INTO v_section_name FROM public.sections WHERE id = v_req.section_id;
  SELECT name INTO v_grade_name FROM public.grades WHERE id = v_req.grade_id;
  SELECT name INTO v_classroom_name FROM public.classrooms WHERE id = v_req.classroom_id;

  RETURN jsonb_build_object(
    'ok', true,
    'call', jsonb_build_object(
      'id', v_req.id,
      'student_name', v_student_name,
      'section_name', v_section_name,
      'grade_name', v_grade_name,
      'classroom_name', v_classroom_name,
      'status', v_req.status,
      'requested_at', v_req.requested_at,
      'called_at', v_req.called_at,
      'exited_at', v_req.exited_at,
      'cancelled_at', v_req.cancelled_at
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_parent_pickup_call(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_call_status(UUID, TEXT) TO anon, authenticated;

-- ============================================================================
-- RPC: تسجيل ولي أمر جديد (بدون جوال أو رمز نصي) بانتظار موافقة إدارة النظام
-- ============================================================================
CREATE OR REPLACE FUNCTION public.register_parent_request(
  p_student_name TEXT,
  p_grade_name TEXT,
  p_classroom_name TEXT,
  p_pin TEXT,
  p_client_key TEXT DEFAULT 'web_reg'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_name TEXT;
  v_clean_pin TEXT;
  v_rate_row public.parent_rate_limits%ROWTYPE;
  v_settings public.settings%ROWTYPE;
  v_created public.parent_registrations%ROWTYPE;
  v_matched_grade_id UUID;
  v_matched_section_id UUID;
  v_matched_classroom_id UUID;
BEGIN
  SELECT * INTO v_settings FROM public.settings WHERE id = 1;
  v_norm_name := public.normalize_arabic_text(p_student_name);
  v_clean_pin := trim(coalesce(p_pin, ''));

  IF v_norm_name = '' OR trim(coalesce(p_grade_name, '')) = '' OR trim(coalesce(p_classroom_name, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يرجى إدخال اسم الطالبة أو الطالب، والصف، والفصل، والرقم السري.');
  END IF;

  IF length(v_clean_pin) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب أن يتكون الرقم السري من 4 أحرف أو أرقام على الأقل.');
  END IF;

  SELECT * INTO v_rate_row FROM public.parent_rate_limits WHERE rate_key = p_client_key;
  IF FOUND AND v_rate_row.locked_until IS NOT NULL AND v_rate_row.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'rate_limited', true,
      'error', 'تم تجاوز عدد محاولات التسجيل المسموح بها مؤقتاً. يرجى المحاولة بعد قليل.'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE normalized_name = v_norm_name AND is_archived = false
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'هذا الاسم مسجل مسبقاً في النظام. يرجى استخدام خيار إرسال النداء أو مراجعة إدارة النظام.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.parent_registrations
    WHERE normalized_name = v_norm_name AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يوجد طلب تسجيل معلق بالفعل لهذا الاسم بانتظار موافقة إدارة النظام.');
  END IF;

  -- محاولة مطابقة الصف والفصل تلقائياً إذا كان مسمى الصف فريداً ونشطاً ضمن قسم نشط
  SELECT g.id, g.section_id INTO v_matched_grade_id, v_matched_section_id
  FROM public.grades g
  JOIN public.sections sec ON sec.id = g.section_id AND sec.is_active = true
  WHERE g.is_active = true
    AND public.normalize_arabic_text(g.name) = public.normalize_arabic_text(p_grade_name)
  LIMIT 1;

  IF v_matched_grade_id IS NOT NULL THEN
    SELECT c.id INTO v_matched_classroom_id
    FROM public.classrooms c
    WHERE c.grade_id = v_matched_grade_id
      AND c.is_active = true
      AND public.normalize_arabic_text(c.name) = public.normalize_arabic_text(p_classroom_name)
    LIMIT 1;
  END IF;

  INSERT INTO public.parent_registrations (
    student_name, normalized_name, grade_name, classroom_name,
    section_id, grade_id, classroom_id, pin_hash, status
  )
  VALUES (
    trim(p_student_name), v_norm_name, trim(p_grade_name), trim(p_classroom_name),
    v_matched_section_id, v_matched_grade_id, v_matched_classroom_id,
    crypt(v_clean_pin, gen_salt('bf')), 'pending'
  )
  RETURNING * INTO v_created;

  INSERT INTO public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
  VALUES (
    NULL,
    'ولي أمر (تسجيل ذاتي)',
    'SUBMIT_PARENT_REGISTRATION',
    'parent_registration',
    v_created.id::text,
    jsonb_build_object('studentName', v_created.student_name, 'gradeName', v_created.grade_name, 'classroomName', v_created.classroom_name)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'tracking_token', v_created.tracking_token,
    'registration', jsonb_build_object(
      'id', v_created.id,
      'student_name', v_created.student_name,
      'grade_name', v_created.grade_name,
      'classroom_name', v_created.classroom_name,
      'status', v_created.status,
      'requested_at', v_created.requested_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_parent_registration_status(
  p_registration_id UUID,
  p_tracking_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg public.parent_registrations%ROWTYPE;
BEGIN
  SELECT * INTO v_reg
  FROM public.parent_registrations
  WHERE id = p_registration_id AND tracking_token = p_tracking_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'طلب التسجيل غير موجود.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'registration', jsonb_build_object(
      'id', v_reg.id,
      'student_name', v_reg.student_name,
      'grade_name', v_reg.grade_name,
      'classroom_name', v_reg.classroom_name,
      'status', v_reg.status,
      'rejection_reason', v_reg.rejection_reason,
      'requested_at', v_reg.requested_at,
      'reviewed_at', v_reg.reviewed_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_parent_registration(
  p_registration_id UUID,
  p_section_id UUID,
  p_grade_id UUID DEFAULT NULL,
  p_classroom_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.staff_accounts%ROWTYPE;
  v_reg public.parent_registrations%ROWTYPE;
  v_grade_id UUID;
  v_classroom_id UUID;
  v_student public.students%ROWTYPE;
BEGIN
  SELECT * INTO v_actor
  FROM public.staff_accounts
  WHERE auth_user_id = auth.uid() AND role = 'super_admin' AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'غير مصرح بهذا الإجراء.');
  END IF;

  SELECT * INTO v_reg FROM public.parent_registrations WHERE id = p_registration_id;
  IF NOT FOUND OR v_reg.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'طلب التسجيل غير موجود أو تمت معالجته مسبقاً.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sections WHERE id = p_section_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يرجى تحديد قسم صحيح.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE normalized_name = v_reg.normalized_name AND is_archived = false
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يوجد سجل نشط مسبقاً لنفس الاسم.');
  END IF;

  v_grade_id := p_grade_id;
  IF v_grade_id IS NULL THEN
    SELECT id INTO v_grade_id
    FROM public.grades
    WHERE section_id = p_section_id
      AND public.normalize_arabic_text(name) = public.normalize_arabic_text(v_reg.grade_name)
    LIMIT 1;

    IF v_grade_id IS NULL THEN
      INSERT INTO public.grades (section_id, name, is_active, sort_order)
      VALUES (p_section_id, v_reg.grade_name, true, 1)
      RETURNING id INTO v_grade_id;
    END IF;
  END IF;

  v_classroom_id := p_classroom_id;
  IF v_classroom_id IS NULL THEN
    SELECT id INTO v_classroom_id
    FROM public.classrooms
    WHERE grade_id = v_grade_id
      AND public.normalize_arabic_text(name) = public.normalize_arabic_text(v_reg.classroom_name)
    LIMIT 1;

    IF v_classroom_id IS NULL THEN
      INSERT INTO public.classrooms (section_id, grade_id, name, is_active)
      VALUES (p_section_id, v_grade_id, v_reg.classroom_name, true)
      RETURNING id INTO v_classroom_id;
    END IF;
  END IF;

  INSERT INTO public.students (
    full_name, normalized_name, section_id, grade_id, classroom_id, pin_hash, is_active, is_archived
  )
  VALUES (
    v_reg.student_name, v_reg.normalized_name, p_section_id, v_grade_id, v_classroom_id, v_reg.pin_hash, true, false
  )
  RETURNING * INTO v_student;

  UPDATE public.parent_registrations
  SET status = 'approved',
      section_id = p_section_id,
      grade_id = v_grade_id,
      classroom_id = v_classroom_id,
      student_id = v_student.id,
      reviewed_at = now(),
      reviewed_by_id = v_actor.id,
      reviewed_by_name = v_actor.full_name
  WHERE id = v_reg.id;

  INSERT INTO public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
  VALUES (
    v_actor.id,
    v_actor.full_name,
    'APPROVE_PARENT_REGISTRATION',
    'parent_registration',
    v_reg.id::text,
    jsonb_build_object('studentId', v_student.id, 'studentName', v_student.full_name, 'sectionId', p_section_id)
  );

  RETURN jsonb_build_object('ok', true, 'student_id', v_student.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_parent_request(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_registration_status(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_parent_registration(UUID, UUID, UUID, UUID) TO authenticated;
