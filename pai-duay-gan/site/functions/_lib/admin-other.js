import { json, fail, readJson, HttpError, nowIso, clientIp } from './http.js';
import { configured, safeEqual, makeSessionCookie, clearCookie } from './auth.js';
import { hit, peek, clear } from './ratelimit.js';
import { loadSettings, saveSettings, validateSettings } from './settings.js';
import { STATUS, audit, withMoney, purposeLabel } from './bookings.js';
import { toCsv, csvResponse } from './csv.js';
import { ledger, computeMoney, cancellationFor } from '../../public/shared/pricing.js';
import { bkkToday, addDays, isYmd, normalizePhone, PURPOSES } from '../../public/shared/booking-rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const monthOf = (ymd) => ymd.slice(0, 7);
const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

// ---------- auth ----------
const LOGIN_WINDOW = 900;    // 15 minutes
const LOGIN_MAX_PER_IP = 5;
const LOGIN_MAX_GLOBAL = 50;

export async function login({ request, env }) {
  if (!configured(env)) return fail(503, 'ยังไม่ได้ตั้งค่ารหัสผ่าน');
  const ip = clientIp(request);
  const [mine, all] = await Promise.all([peek(env, 'login', ip, LOGIN_WINDOW), peek(env, 'login', '*', LOGIN_WINDOW)]);
  if (mine >= LOGIN_MAX_PER_IP || all >= LOGIN_MAX_GLOBAL) {
    return fail(429, 'ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
  }
  const body = await readJson(request, 2048);
  const ok = await safeEqual(String(body.password || ''), env.ADMIN_PASSWORD);
  if (!ok) {
    const n = await hit(env, 'login', ip, LOGIN_WINDOW);
    await hit(env, 'login', '*', LOGIN_WINDOW);
    await sleep(Math.min(300 * n, 2000)); // slow down guessing
    return fail(401, 'รหัสผ่านไม่ถูกต้อง', { remaining: Math.max(0, LOGIN_MAX_PER_IP - n) });
  }
  await clear(env, 'login', ip);
  return json({ ok: true }, 200, { 'Set-Cookie': await makeSessionCookie(env) });
}

export async function logout() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}

export async function session({ env }) {
  const s = await loadSettings(env.DB);
  return json({ ok: true, today: bkkToday(), line_id: s.line_id, promptpay_id: s.promptpay_id, purposes: PURPOSES });
}

// ---------- dashboard ----------
const SLIM = `b.id, b.code, b.status, b.date, b.start_time, b.pickup_time, b.booker_name, b.booker_phone, b.elder_name,
  b.district, b.purpose, b.purpose_other, b.destination, b.second_person, b.second_person_pct, b.evening, b.evening_rate, b.package_name, b.package_price, b.package_pay, b.ot_block_min, b.ot_customer,
  b.ot_assistant, b.surcharge_customer, b.surcharge_assistant, b.discount_pct, b.overtime_min, b.surcharge_count,
  b.transport_cost, b.received_service, b.received_extra, b.refund_paid, b.assistant_paid, b.cancelled_by,
  b.cancel_hours_before, b.assistant_arrived, b.next_appointment, b.review_score, b.assistant_id, b.created_at,
  a.nickname AS assistant_name`;

function sumLedger(rows) {
  const t = { bookings: 0, revenue: 0, transport: 0, assistant_cost: 0, gross: 0, reviews: 0, review_sum: 0 };
  for (const b of rows) {
    const l = ledger(b);
    if (l.counted) t.bookings++;
    t.revenue += l.revenue; t.transport += l.transport; t.assistant_cost += l.assistant_cost; t.gross += l.gross;
    if (b.review_score) { t.reviews++; t.review_sum += b.review_score; }
  }
  return t;
}

export async function dashboard({ env }) {
  const today = bkkToday();
  const week = addDays(today, 7);
  const month = monthOf(today);
  const db = env.DB;
  const q = (sql, ...args) => db.prepare(sql).bind(...args).all().then((r) => r.results);
  const [schedule, fresh, unpaid, unassigned, followups, insurance, monthRows, exp] = await Promise.all([
    q(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id WHERE b.date BETWEEN ? AND ? AND b.status != 'cancelled' ORDER BY b.date, b.start_time`, today, week),
    q(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id WHERE b.status = 'new' ORDER BY b.date`),
    q(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id WHERE b.status IN ('confirmed','done') ORDER BY b.date`),
    q(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id WHERE b.assistant_id IS NULL AND b.status IN ('new','confirmed','paid') AND b.date >= ? ORDER BY b.date`, today),
    q(`SELECT b.id, b.code, b.booker_name, b.booker_phone, b.elder_name, b.next_appointment FROM bookings b
       WHERE b.next_appointment BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM bookings x WHERE x.booker_phone = b.booker_phone AND x.id != b.id AND x.status != 'cancelled' AND x.date >= ?)
       ORDER BY b.next_appointment`, today, addDays(today, 14), today),
    q(`SELECT id, nickname, insurance_expiry FROM assistants WHERE status != 'left' AND insurance_expiry IS NOT NULL AND insurance_expiry != '' AND insurance_expiry <= ? ORDER BY insurance_expiry`, addDays(today, 30)),
    q(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id WHERE substr(b.date, 1, 7) = ?`, month),
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substr(date, 1, 7) = ?').bind(month).first(),
  ]);
  const k = sumLedger(monthRows);
  const kpi = {
    month, bookings: k.bookings, revenue: k.revenue, assistant_cost: k.assistant_cost, gross: k.gross,
    expenses: exp.total, net: k.gross - exp.total,
    pending: monthRows.filter((b) => b.status === 'new' || b.status === 'confirmed').length,
  };
  return json({
    ok: true, today, kpi,
    schedule: schedule.map(withMoney),
    new_requests: fresh.map(withMoney),
    unpaid: unpaid.map(withMoney).filter((b) => b.status === 'confirmed' || b.money.balance > 0),
    unassigned: unassigned.map(withMoney),
    followups, insurance,
  });
}

// ---------- assistants ----------
const A_STATUS = { active: 'พร้อมรับงาน', paused: 'พัก', left: 'เลิกแล้ว' };

export async function listAssistants({ env }) {
  const { results } = await env.DB.prepare(`SELECT a.*, (SELECT COUNT(*) FROM bookings b WHERE b.assistant_id = a.id AND b.status != 'cancelled') AS jobs
    FROM assistants a ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, a.nickname`).all();
  return json({ ok: true, assistants: results, statuses: A_STATUS });
}

export async function saveAssistant({ request, env, params }) {
  const body = await readJson(request);
  const t = (k, max, req = false) => {
    const s = String(body[k] ?? '').trim();
    if (req && !s) throw new HttpError(400, `กรุณากรอก ${k === 'nickname' ? 'ชื่อเล่น' : k}`);
    if (s.length > max) throw new HttpError(400, `${k} ยาวเกินไป`);
    return s;
  };
  const d = (k) => { const s = String(body[k] ?? '').trim(); if (s && !isYmd(s)) throw new HttpError(400, `${k}: วันที่ไม่ถูกต้อง`); return s || null; };
  const phone = t('phone', 20);
  if (phone && !normalizePhone(phone)) throw new HttpError(400, 'เบอร์โทรไม่ถูกต้อง');
  const weekdays = Array.isArray(body.weekdays) ? body.weekdays : String(body.weekdays ?? '').split(',');
  const wd = [...new Set(weekdays.map((x) => String(x).trim()).filter((x) => /^[0-6]$/.test(x)))].sort().join(',');
  const status = A_STATUS[body.status] ? body.status : 'active';
  const row = {
    nickname: t('nickname', 50, true), full_name: t('full_name', 120), phone: phone ? normalizePhone(phone) : '',
    line_id: t('line_id', 80), district: t('district', 60), weekdays: wd, background_checked: body.background_checked ? 1 : 0,
    trained_date: d('trained_date'), insurance_expiry: d('insurance_expiry'), status, notes: t('notes', 1000), updated_at: nowIso(),
  };
  const cols = Object.keys(row);
  let id = params.id;
  if (id) {
    const r = await env.DB.prepare(`UPDATE assistants SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE id = ?`).bind(...cols.map((c) => row[c]), id).run();
    if (!r.meta.changes) return fail(404, 'ไม่พบผู้ช่วย');
  } else {
    row.created_at = row.updated_at;
    const c2 = Object.keys(row);
    const r = await env.DB.prepare(`INSERT INTO assistants (${c2.join(', ')}) VALUES (${c2.map(() => '?').join(', ')}) RETURNING id`).bind(...c2.map((c) => row[c])).first();
    id = r.id;
  }
  const a = await env.DB.prepare('SELECT * FROM assistants WHERE id = ?').bind(id).first();
  return json({ ok: true, assistant: a });
}

export async function deleteAssistant({ env, params }) {
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings WHERE assistant_id = ?').bind(params.id).first();
  if (used.n > 0) return fail(409, 'ผู้ช่วยคนนี้มีประวัติงานแล้ว ลบไม่ได้ ให้เปลี่ยนสถานะเป็น "เลิกแล้ว" แทน');
  await env.DB.prepare('DELETE FROM assistants WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}

// ---------- payouts ----------
async function payoutRows(env, month) {
  const { results } = await env.DB.prepare(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id
    WHERE substr(b.date, 1, 7) = ? AND b.status IN ('done','cancelled') AND b.assistant_id IS NOT NULL ORDER BY b.date`).bind(month).all();
  return results.map((b) => ({ ...b, owed: ledger(b).assistant_owed })).filter((b) => b.owed > 0);
}

export async function payouts({ env, url }) {
  const month = isMonth(url.searchParams.get('month')) ? url.searchParams.get('month') : monthOf(bkkToday());
  const rows = await payoutRows(env, month);
  const by = {};
  for (const r of rows) {
    const p = (by[r.assistant_id] ||= { assistant_id: r.assistant_id, nickname: r.assistant_name, jobs: [], owed: 0, paid: 0 });
    p.jobs.push({ id: r.id, code: r.code, date: r.date, status: r.status, owed: r.owed, paid: !!r.assistant_paid });
    p.owed += r.owed;
    if (r.assistant_paid) p.paid += r.owed;
  }
  const list = Object.values(by).map((p) => ({ ...p, outstanding: p.owed - p.paid }));
  return json({ ok: true, month, payouts: list, total_owed: list.reduce((s, p) => s + p.owed, 0), total_outstanding: list.reduce((s, p) => s + p.outstanding, 0) });
}

export async function markPayout({ request, env }) {
  const body = await readJson(request);
  const aid = Number(body.assistant_id);
  if (!Number.isInteger(aid) || !isMonth(body.month)) return fail(400, 'ข้อมูลไม่ครบ');
  const rows = (await payoutRows(env, body.month)).filter((r) => r.assistant_id === aid && !r.assistant_paid);
  const now = nowIso();
  for (const r of rows) {
    await env.DB.prepare('UPDATE bookings SET assistant_paid = 1, assistant_paid_at = ?, updated_at = ? WHERE id = ?').bind(now, now, r.id).run();
    await audit(env.DB, 'admin', r.id, 'payout', `จ่ายผู้ช่วย ${r.assistant_name} ${r.owed} บาท (รอบ ${body.month})`);
  }
  return json({ ok: true, marked: rows.length, amount: rows.reduce((s, r) => s + r.owed, 0) });
}

// ---------- customers ----------
export async function customers({ env, url }) {
  const today = bkkToday();
  const { results } = await env.DB.prepare(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id ORDER BY b.date`).all();
  const term = (url.searchParams.get('q') || '').trim().toLowerCase();
  const map = new Map();
  for (const b of results) {
    const c = map.get(b.booker_phone) || { booker_phone: b.booker_phone, booker_name: b.booker_name, elders: [], bookings: 0, cancelled: 0, last_date: null, next_date: null, next_appointment: null, total_spent: 0, last_id: null };
    c.booker_name = b.booker_name;
    if (!c.elders.includes(b.elder_name)) c.elders.push(b.elder_name);
    if (b.status === 'cancelled') c.cancelled++; else c.bookings++;
    if (b.status !== 'cancelled' && b.date <= today) { c.last_date = b.date; c.last_id = b.id; }
    if (b.status !== 'cancelled' && b.date > today && (!c.next_date || b.date < c.next_date)) c.next_date = b.date;
    if (b.next_appointment && b.next_appointment >= today && (!c.next_appointment || b.next_appointment < c.next_appointment)) c.next_appointment = b.next_appointment;
    const l = ledger(b);
    c.total_spent += l.revenue + l.transport;
    map.set(b.booker_phone, c);
  }
  let list = [...map.values()];
  if (term) list = list.filter((c) => (c.booker_name + ' ' + c.booker_phone + ' ' + c.elders.join(' ')).toLowerCase().includes(term));
  list.sort((a, b) => (b.last_date || b.next_date || '').localeCompare(a.last_date || a.next_date || ''));
  return json({ ok: true, customers: list });
}

// ---------- expenses ----------
export const EXPENSE_CATEGORIES = ['ใบอนุญาต/ภาษี', 'ประกัน', 'การตลาด', 'เว็บ/ระบบ', 'อบรม', 'อุปกรณ์', 'อื่น ๆ'];

export async function listExpenses({ env, url }) {
  const month = url.searchParams.get('month');
  const stmt = isMonth(month)
    ? env.DB.prepare('SELECT * FROM expenses WHERE substr(date, 1, 7) = ? ORDER BY date DESC, id DESC').bind(month)
    : env.DB.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 500');
  const { results } = await stmt.all();
  return json({ ok: true, expenses: results, categories: EXPENSE_CATEGORIES, total: results.reduce((s, e) => s + e.amount, 0) });
}

export async function saveExpense({ request, env, params }) {
  const b = await readJson(request);
  const date = String(b.date || '');
  const item = String(b.item || '').trim();
  const amount = Number(b.amount);
  if (!isYmd(date)) return fail(400, 'วันที่ไม่ถูกต้อง');
  if (!item || item.length > 200) return fail(400, 'กรุณากรอกรายการ');
  if (!EXPENSE_CATEGORIES.includes(b.category)) return fail(400, 'กรุณาเลือกหมวด');
  if (!Number.isInteger(amount) || amount < 0 || amount > 10000000) return fail(400, 'จำนวนเงินต้องเป็นจำนวนเต็มบาท');
  if (params.id) {
    const r = await env.DB.prepare('UPDATE expenses SET date = ?, item = ?, category = ?, amount = ? WHERE id = ?').bind(date, item, b.category, amount, params.id).run();
    if (!r.meta.changes) return fail(404, 'ไม่พบรายการ');
    return json({ ok: true, id: params.id });
  }
  const r = await env.DB.prepare('INSERT INTO expenses (date, item, category, amount, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(date, item, b.category, amount, nowIso()).first();
  return json({ ok: true, id: r.id }, 201);
}

export async function deleteExpense({ env, params }) {
  await env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}

// ---------- reports ----------
function monthsBack(n) {
  const today = bkkToday();
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const out = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}

export async function reports({ env, url }) {
  const n = Math.min(36, Math.max(1, Number(url.searchParams.get('months')) || 12));
  const months = monthsBack(n);
  const start = months[0] + '-01';
  const [{ results: allRows }, { results: exps }] = await Promise.all([
    env.DB.prepare(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id WHERE b.date >= ? AND b.date <= ?`).bind(start, months[months.length - 1] + '-31').all(),
    env.DB.prepare('SELECT substr(date, 1, 7) AS month, SUM(amount) AS total FROM expenses WHERE date >= ? GROUP BY month').bind(start).all(),
  ]);
  const rows = allRows.filter((b) => ['paid', 'done', 'cancelled'].includes(b.status));
  // Which purposes sell: requests (not cancelled) and paid/done bookings per purpose over the period.
  const byPurpose = Object.fromEntries(PURPOSES.map((p) => [p, { purpose: p, requests: 0, paid: 0, revenue: 0 }]));
  for (const b of allRows) {
    const p = (byPurpose[b.purpose || '-'] ||= { purpose: b.purpose || '-', requests: 0, paid: 0, revenue: 0 });
    if (b.status !== 'cancelled') p.requests++;
    const l = ledger(b);
    if (l.counted) { p.paid++; p.revenue += l.revenue; }
  }
  const purposes = Object.values(byPurpose).sort((x, y) => y.requests - x.requests || y.paid - x.paid);
  const expBy = Object.fromEntries(exps.map((e) => [e.month, e.total]));
  const table = months.map((month) => {
    const t = sumLedger(rows.filter((b) => b.date.startsWith(month)));
    const expenses = expBy[month] || 0;
    return {
      month, bookings: t.bookings, revenue: t.revenue, transport: t.transport, assistant_cost: t.assistant_cost, gross: t.gross,
      expenses, net: t.gross - expenses, avg_review: t.reviews ? Math.round((t.review_sum / t.reviews) * 10) / 10 : null, reviews: t.reviews,
    };
  });
  const total = table.reduce((s, r) => {
    for (const k of ['bookings', 'revenue', 'transport', 'assistant_cost', 'gross', 'expenses', 'net', 'reviews']) s[k] += r[k];
    s.review_sum += (r.avg_review || 0) * r.reviews;
    return s;
  }, { bookings: 0, revenue: 0, transport: 0, assistant_cost: 0, gross: 0, expenses: 0, net: 0, reviews: 0, review_sum: 0 });
  total.avg_review = total.reviews ? Math.round((total.review_sum / total.reviews) * 10) / 10 : null;
  delete total.review_sum;
  return json({ ok: true, months: table.reverse(), total, purposes });
}

// ---------- CSV export ----------
export async function exportCsv({ env, params, url }) {
  const from = isYmd(url.searchParams.get('from')) ? url.searchParams.get('from') : '0000-01-01';
  const to = isYmd(url.searchParams.get('to')) ? url.searchParams.get('to') : '9999-12-31';
  const stamp = bkkToday();
  if (params.type === 'bookings') {
    const { results } = await env.DB.prepare(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id WHERE b.date BETWEEN ? AND ? ORDER BY b.date, b.start_time`).bind(from, to).all();
    const rows = results.map((b) => {
      const m = computeMoney(b);
      const l = ledger(b);
      const c = b.status === 'cancelled' ? cancellationFor(b) : null;
      return [b.code, STATUS[b.status], b.date, b.start_time, b.pickup_time, b.booker_name, b.booker_phone, b.elder_name, b.second_person ? 2 : 1, b.district, purposeLabel(b), b.destination,
        b.package_name, m.service, m.discount_pct, m.discounted, b.overtime_min, m.overtime_fee, m.surcharge, m.transport, m.customer_total,
        m.assistant_pay, m.gross_profit, b.received_service, b.received_extra, c ? c.refund : 0, b.refund_paid, l.revenue, l.assistant_cost, l.gross,
        b.assistant_name || '', b.assistant_paid ? 'จ่ายแล้ว' : '', b.review_score ?? '', b.next_appointment || ''];
    });
    return csvResponse(`bookings-${stamp}.csv`, toCsv(['รหัส', 'สถานะ', 'วันนัด', 'เวลาถึงปลายทาง', 'เวลารับ', 'ผู้จอง', 'โทรผู้จอง', 'ผู้สูงอายุ', 'จำนวนท่าน', 'เขต', 'ธุระ', 'ปลายทาง',
      'แพ็กเกจ', 'ราคาแพ็กเกจ(รวม 2 ท่าน)', 'ส่วนลด%', 'ค่าบริการหลังลด', 'เกินเวลา(นาที)', 'ค่าเกินเวลา', 'ค่าบวกเพิ่ม', 'ค่ารถ', 'ยอดลูกค้ารวม',
      'ค่าผู้ช่วย', 'กำไรขั้นต้น', 'รับค่าบริการ', 'รับส่วนเพิ่ม', 'ยอดคืนตามนโยบาย', 'คืนเงินแล้ว', 'รายได้ลงบัญชี', 'ต้นทุนผู้ช่วยลงบัญชี', 'กำไรขั้นต้นลงบัญชี',
      'ผู้ช่วย', 'จ่ายผู้ช่วย', 'รีวิว', 'นัดครั้งหน้า'], rows));
  }
  if (params.type === 'expenses') {
    const { results } = await env.DB.prepare('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date').bind(from, to).all();
    return csvResponse(`expenses-${stamp}.csv`, toCsv(['วันที่', 'รายการ', 'หมวด', 'จำนวนเงิน'], results.map((e) => [e.date, e.item, e.category, e.amount])));
  }
  if (params.type === 'payouts') {
    const { results } = await env.DB.prepare(`SELECT ${SLIM} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id
      WHERE b.date BETWEEN ? AND ? AND b.status IN ('done','cancelled') AND b.assistant_id IS NOT NULL ORDER BY b.date`).bind(from, to).all();
    const rows = results.map((b) => ({ b, owed: ledger(b).assistant_owed })).filter((x) => x.owed > 0)
      .map(({ b, owed }) => [monthOf(b.date), b.assistant_name, b.code, b.date, STATUS[b.status], owed, b.assistant_paid ? 'จ่ายแล้ว' : 'ค้างจ่าย']);
    return csvResponse(`payouts-${stamp}.csv`, toCsv(['เดือน', 'ผู้ช่วย', 'รหัสนัด', 'วันนัด', 'สถานะ', 'ค่าผู้ช่วย', 'การจ่าย'], rows));
  }
  return fail(404, 'ไม่พบประเภทไฟล์');
}

// ---------- settings ----------
export async function getSettings({ env }) {
  return json({ ok: true, settings: await loadSettings(env.DB) });
}
export async function putSettings({ request, env }) {
  const body = await readJson(request);
  const current = await loadSettings(env.DB);
  const { errors, value } = validateSettings(body, current);
  if (Object.keys(errors).length) return fail(400, 'กรุณาตรวจสอบค่าที่กรอก', { errors });
  await saveSettings(env.DB, value);
  await audit(env.DB, 'admin', null, 'settings', 'แก้ไขการตั้งค่า');
  return json({ ok: true, settings: value });
}

// ---------- PDPA ----------
function pdpaWhere(days) {
  return { sql: "status IN ('done','cancelled') AND date < ? AND anonymized_at IS NULL", arg: addDays(bkkToday(), -days) };
}
const daysParam = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 30 && n <= 3650 ? n : null; };

export async function pdpaPreview({ env, url }) {
  const s = await loadSettings(env.DB);
  const days = daysParam(url.searchParams.get('days')) || s.pdpa_days;
  const w = pdpaWhere(days);
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE ${w.sql}`).bind(w.arg).first();
  const done = await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings WHERE anonymized_at IS NOT NULL').first();
  return json({ ok: true, days, before: w.arg, count: r.n, already: done.n });
}

export async function pdpaAnonymize({ request, env }) {
  const body = await readJson(request);
  const days = daysParam(body.days);
  if (!days) return fail(400, 'จำนวนวันต้องอยู่ระหว่าง 30-3650');
  if (body.confirm !== true) return fail(400, 'ต้องยืนยันก่อน');
  const w = pdpaWhere(days);
  const r = await env.DB.prepare(`UPDATE bookings SET health_notes = '', elder_phone = NULL, emergency_phone = '', pickup_address = '[ลบแล้ว]',
    maps_link = '', communication_other = '', anonymized_at = ?, updated_at = ? WHERE ${w.sql}`).bind(nowIso(), nowIso(), w.arg).run();
  await audit(env.DB, 'admin', null, 'pdpa', `ลบข้อมูลสุขภาพ/เบอร์/ที่อยู่ ของนัดก่อน ${w.arg} จำนวน ${r.meta.changes} รายการ`);
  return json({ ok: true, anonymized: r.meta.changes });
}
