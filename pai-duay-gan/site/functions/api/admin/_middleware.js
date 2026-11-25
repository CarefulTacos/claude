import { fail, sameOrigin } from '../../_lib/http.js';
import { configured, hasSession } from '../../_lib/auth.js';

// Runs before every /api/admin/* request.
export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    if (!sameOrigin(request)) return fail(403, 'คำขอนี้ต้องมาจากหน้าเว็บของระบบเท่านั้น');
    const ct = (request.headers.get('Content-Type') || '').toLowerCase();
    if (!ct.startsWith('application/json')) return fail(415, 'ต้องส่งข้อมูลแบบ JSON');
  }
  if (!configured(env)) return fail(503, 'ระบบหลังบ้านยังไม่ได้ตั้งค่า ADMIN_PASSWORD และ SESSION_SECRET');
  if (path === '/api/admin/login') return context.next();
  if (!(await hasSession(request, env))) return fail(401, 'กรุณาเข้าสู่ระบบ');
  return context.next();
}
