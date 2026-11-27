// Supabase Edge Function: parent-pickup
// للتحقق من بيانات ولي الأمر على الخادم وتحديد محاولات الدخول المتكررة
// Deploy: supabase functions deploy parent-pickup

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const clientIp =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for') ||
    'unknown';

  try {
    if (req.method === 'POST') {
      const body = await req.json();
      const studentName = String(body.studentName ?? '');
      const pin = String(body.pin ?? '');
      const rateKey = `${clientIp}:${studentName.trim().slice(0, 40)}`;

      const { data, error } = await supabase.rpc('submit_parent_pickup_call', {
        p_student_name: studentName,
        p_pin: pin,
        p_client_key: rateKey,
      });

      if (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const status = data?.rate_limited ? 429 : data?.ok ? 200 : 401;
      return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const requestId = url.searchParams.get('id') ?? '';
      const token = url.searchParams.get('token') ?? '';

      const { data, error } = await supabase.rpc('get_parent_call_status', {
        p_request_id: requestId,
        p_tracking_token: token,
      });

      if (error || !data?.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: 'تعذر جلب حالة الطلب' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'حدث خطأ في الخادم' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
