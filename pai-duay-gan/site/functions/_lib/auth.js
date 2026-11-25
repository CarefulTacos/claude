// Single-owner admin session: HMAC-SHA256 signed expiry in an HttpOnly cookie.

export const COOKIE = 'pdg_admin';
export const SESSION_HOURS = 12;

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

/** Constant-time comparison of two strings (compares SHA-256 digests so length does not leak). */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

export function configured(env) {
  return !!(env.ADMIN_PASSWORD && env.SESSION_SECRET && String(env.SESSION_SECRET).length >= 32);
}

export async function makeSessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const payload = `v1.${exp}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function hasSession(request, env) {
  if (!configured(env)) return false;
  const v = readCookie(request, COOKIE);
  if (!v) return false;
  const m = /^(v1\.(\d{1,12}))\.([A-Za-z0-9_-]{20,})$/.exec(v);
  if (!m) return false;
  if (Number(m[2]) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(await hmac(env.SESSION_SECRET, m[1]), m[3]);
}
