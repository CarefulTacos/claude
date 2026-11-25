// Small HTTP helpers shared by all Pages Functions.

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra },
  });
}

export const fail = (status, message, extra = {}) => json({ ok: false, error: message, ...extra }, status);

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export async function readJson(request, maxBytes = 32 * 1024) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'ต้องส่งข้อมูลแบบ JSON');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'ข้อมูลใหญ่เกินไป');
  try {
    const v = JSON.parse(text || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'อ่านข้อมูลไม่ได้');
  }
}

/** Reject cross-site writes: Origin (or Sec-Fetch-Site) must match this site. */
export function sameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin) return origin === url.origin;
  const site = request.headers.get('Sec-Fetch-Site');
  return site === 'same-origin';
}

export const nowIso = () => new Date().toISOString();

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'local';
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function handleError(err) {
  if (err instanceof HttpError) return fail(err.status, err.message, err.extra || {});
  console.error(err && err.stack ? err.stack : err);
  return fail(500, 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง');
}
