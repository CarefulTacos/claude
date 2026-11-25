import { json, fail, readJson, HttpError, nowIso } from './http.js';
import { loadSettings, saveSettings } from './settings.js';
import { STATUS, audit, messages, hoursBefore, withMoney } from './bookings.js';
import { snapshotRates, computeMoney, cancellation, basePrices } from '../../public/shared/pricing.js';
import { DISTRICTS, PURPOSES, FASTING, isYmd, isTime } from '../../public/shared/booking-rules.js';

const LIST_COLS = `b.id, b.code, b.status, b.date, b.start_time, b.pickup_time, b.booker_name, b.booker_phone, b.elder_name,
  b.district, b.purpose, b.purpose_other, b.destination, b.stops, b.second_person, b.second_person_pct, b.evening, b.evening_rate, b.package_key, b.package_name, b.package_price, b.package_pay, b.ot_block_min,
  b.ot_customer, b.ot_assistant, b.surcharge_customer, b.surcharge_assistant, b.discount_pct, b.overtime_min,
  b.surcharge_count, b.transport_cost, b.received_service, b.received_extra, b.refund_paid, b.assistant_paid,
  b.cancelled_by, b.cancel_hours_before, b.assistant_arrived, b.next_appointment, b.review_score, b.assistant_id,
  b.created_at, a.nickname AS assistant_name`;

export async function list({ env, url }) {
  const q = url.searchParams;
  const where = [];
  const args = [];
  const status = q.get('status');
  if (status && STATUS[status]) { where.push('b.status = ?'); args.push(status); }
  if (q.get('from') && isYmd(q.get('from'))) { where.push('b.date >= ?'); args.push(q.get('from')); }
  if (q.get('to') && isYmd(q.get('to'))) { where.push('b.date <= ?'); args.push(q.get('to')); }
  const purpose = q.get('purpose');
  if (purpose && PURPOSES.includes(purpose)) { where.push('b.purpose = ?'); args.push(purpose); }
  const asg = q.get('assistant');
  if (asg === 'none') where.push('b.assistant_id IS NULL');
  else if (asg && /^\d+$/.test(asg)) { where.push('b.assistant_id = ?'); args.push(Number(asg)); }
  const term = (q.get('q') || '').trim().slice(0, 60);
  if (term) {
    where.push("(b.code LIKE ? ESCAPE '\\' OR b.booker_name LIKE ? ESCAPE '\\' OR b.elder_name LIKE ? ESCAPE '\\' OR b.booker_phone LIKE ? ESCAPE '\\')");
    const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const phoneLike = '%' + term.replace(/\D/g, '') + '%';
    args.push(like, like, like, term.replace(/\D/g, '') ? phoneLike : like);
  }
  const order = q.get('order') === 'asc' ? 'ASC' : 'DESC';
  const sql = `SELECT ${LIST_COLS} FROM bookings b LEFT JOIN assistants a ON a.id = b.assistant_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.date ${order}, b.start_time ${order}, b.id ${order} LIMIT 500`;
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return json({ ok: true, bookings: results.map(withMoney) });
}

async function loadBooking(env, id) {
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
  if (!b) throw new HttpError(404, 'ไม่พบนัดนี้');
  return b;
}

async function conflictsFor(env, b) {
  if (!b.assistant_id) return [];
  const { results } = await env.DB.prepare(
    "SELECT id, code, start_time, destination FROM bookings WHERE assistant_id = ? AND date = ? AND id != ? AND status != 'cancelled'"
  ).bind(b.assistant_id, b.date, b.id).all();
  return results;
}

export async function get({ env, params }) {
  const b = await loadBooking(env, params.id);
  const settings = await loadSettings(env.DB);
  const assistant = b.assistant_id ? await env.DB.prepare('SELECT id, nickname, full_name, phone, weekdays, status FROM assistants WHERE id = ?').bind(b.assistant_id).first() : null;
  const [conflicts, auditRows, assistants, sameDay] = await Promise.all([
    conflictsFor(env, b),
    env.DB.prepare('SELECT at, actor, action, detail FROM audit_log WHERE booking_id = ? ORDER BY id DESC LIMIT 50').bind(b.id).all(),
    env.DB.prepare("SELECT id, nickname, status, weekdays FROM assistants WHERE status != 'left' OR id = ? ORDER BY nickname").bind(b.assistant_id || 0).all(),
    env.DB.prepare("SELECT assistant_id, code FROM bookings WHERE date = ? AND id != ? AND status != 'cancelled' AND assistant_id IS NOT NULL").bind(b.date, b.id).all(),
  ]);
  const warnings = [];
  if (assistant) {
    const wd = new Date(b.date + 'T00:00:00Z').getUTCDay();
    if (assistant.status !== 'active') warnings.push(`ผู้ช่วย ${assistant.nickname} ไม่อยู่ในสถานะพร้อมรับงาน`);
    if (!String(assistant.weekdays || '').split(',').includes(String(wd))) warnings.push(`ผู้ช่วย ${assistant.nickname} ไม่ได้ระบุว่าว่างวันนี้ของสัปดาห์`);
  }
  for (const c of conflicts) warnings.push(`ผู้ช่วยคนนี้มีนัด ${c.code} วันเดียวกันแล้ว (${c.start_time} ${c.destination})`);
  const busy = {};
  for (const r of sameDay.results) (busy[r.assistant_id] ||= []).push(r.code);
  return json({
    ok: true,
    booking: withMoney(b),
    assistant,
    assistants: assistants.results.map((a) => ({ ...a, busy: busy[a.id] || [] })),
    conflicts, warnings,
    audit: auditRows.results,
    messages: messages(b, assistant && assistant.nickname, settings),
    promptpay_id: settings.promptpay_id,
    promo: { percent: settings.promo_percent, remaining: settings.promo_remaining },
    packages: settings.packages.map(({ key, name }) => ({ key, name })),
    districts: DISTRICTS,
    purposes: PURPOSES,
  });
}

// ---- PATCH ----
const intIn = (lo, hi) => (v, k) => {
  const n = Number(v);
  if (v === '' || v === null || !Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, `${k}: ต้องเป็นจำนวนเต็ม ${lo}-${hi}`);
  return n;
};
const textMax = (max, required = false) => (v, k) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new HttpError(400, `${k}: ต้องไม่ว่าง`);
  if (s.length > max) throw new HttpError(400, `${k}: ยาวเกินไป`);
  return s;
};
const FIELDS = {
  discount_pct: (v, k) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, `${k}: 0-100`); return n; },
  overtime_min: intIn(0, 1440),
  surcharge_count: intIn(0, 10),
  transport_cost: intIn(0, 100000),
  received_service: intIn(0, 1000000),
  received_extra: intIn(0, 1000000),
  refund_paid: intIn(0, 1000000),
  assistant_paid: (v) => (v ? 1 : 0),
  next_appointment: (v, k) => { if (v === '' || v == null) return null; if (!isYmd(v)) throw new HttpError(400, `${k}: วันที่ไม่ถูกต้อง`); return v; },
  review_score: (v, k) => { if (v === '' || v == null) return null; return intIn(1, 5)(v, k); },
  internal_notes: textMax(2000),
  pickup_time: (v, k) => { if (v === '' || v == null) return ''; if (!isTime(v)) throw new HttpError(400, `${k}: เวลาไม่ถูกต้อง`); return v; },
  start_time: (v, k) => { if (!isTime(v)) throw new HttpError(400, `${k}: เวลาไม่ถูกต้อง`); return v; },
  purpose: (v, k) => { if (!PURPOSES.includes(v)) throw new HttpError(400, `${k}: ประเภทธุระไม่ถูกต้อง`); return v; },
  purpose_other: textMax(200),
  stops: (v, k) => { const s = textMax(600)(v, k); const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (lines.length > 3) throw new HttpError(400, 'จุดแวะได้ไม่เกิน 3 บรรทัด'); return lines.join('\n'); },
  fasting: (v, k) => { if (v === '' || v == null) return ''; if (!FASTING[v]) throw new HttpError(400, `${k}: ไม่ถูกต้อง`); return v; },
  second_person: (v) => (v ? 1 : 0),
  evening: (v) => (v ? 1 : 0),
  date: (v, k) => { if (!isYmd(v)) throw new HttpError(400, `${k}: วันที่ไม่ถูกต้อง`); return v; },
  pickup_address: textMax(400, true),
  district: (v, k) => { if (!DISTRICTS.includes(v)) throw new HttpError(400, `${k}: เขตไม่ถูกต้อง`); return v; },
  destination: textMax(200, true),
  errands: textMax(500),
};

const LABELS = {
  discount_pct: 'ส่วนลด%', overtime_min: 'เกินเวลา(นาที)', surcharge_count: 'ค่าบวกเพิ่ม(รายการ)', transport_cost: 'ค่ารถ',
  received_service: 'รับค่าบริการ', received_extra: 'รับส่วนเพิ่ม', refund_paid: 'คืนเงิน', assistant_paid: 'จ่ายผู้ช่วยแล้ว',
  next_appointment: 'นัดครั้งหน้า', review_score: 'คะแนนรีวิว', internal_notes: 'บันทึกภายใน', pickup_time: 'เวลารับ',
  start_time: 'เวลาถึงปลายทาง', purpose: 'ธุระ', purpose_other: 'ธุระ(ระบุ)', stops: 'จุดแวะ', fasting: 'งดอาหาร', second_person: '2 ท่าน', evening: 'ค่าช่วงเย็น', date: 'วันนัด', pickup_address: 'ที่อยู่รับ', district: 'เขต', destination: 'ปลายทาง', errands: 'ธุระอื่น',
};

export async function patch({ request, env, params }) {
  const body = await readJson(request);
  const b = await loadBooking(env, params.id);
  const set = {};
  const notes = [];
  const settings = await loadSettings(env.DB);

  for (const [k, fn] of Object.entries(FIELDS)) {
    if (body[k] === undefined) continue;
    const v = fn(body[k], k);
    if (v !== b[k]) set[k] = v;
  }
  if (set.assistant_paid !== undefined) set.assistant_paid_at = set.assistant_paid ? nowIso() : null;

  if (body.assistant_id !== undefined) {
    const aid = body.assistant_id === null || body.assistant_id === '' ? null : Number(body.assistant_id);
    if (aid !== null) {
      if (!Number.isInteger(aid)) throw new HttpError(400, 'assistant_id ไม่ถูกต้อง');
      const a = await env.DB.prepare('SELECT nickname FROM assistants WHERE id = ?').bind(aid).first();
      if (!a) throw new HttpError(400, 'ไม่พบผู้ช่วย');
      if (aid !== b.assistant_id) notes.push(`มอบหมายผู้ช่วย: ${a.nickname}`);
    } else if (b.assistant_id) notes.push('ยกเลิกการมอบหมายผู้ช่วย');
    if (aid !== b.assistant_id) set.assistant_id = aid;
  }

  if (body.package_key !== undefined && body.package_key !== b.package_key) {
    let rates;
    try { rates = snapshotRates(settings, String(body.package_key)); } catch { throw new HttpError(400, 'ไม่พบแพ็กเกจ'); }
    Object.assign(set, rates);
    notes.push(`เปลี่ยนแพ็กเกจเป็น ${rates.package_name}`);
  }

  if (body.status !== undefined && body.status !== b.status) {
    const to = String(body.status);
    if (!STATUS[to]) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
    set.status = to;
    notes.push(`สถานะ: ${STATUS[b.status]} → ${STATUS[to]}`);
    const merged = { ...b, ...set };
    if (to === 'paid' && !merged.received_service) {
      set.received_service = computeMoney(merged).upfront;
    }
    if (to === 'cancelled') {
      const by = body.cancelled_by === 'business' ? 'business' : body.cancelled_by === 'customer' ? 'customer' : null;
      if (!by) throw new HttpError(400, 'กรุณาเลือกว่าใครเป็นผู้ยกเลิก');
      let at = body.cancelled_at ? new Date(body.cancelled_at) : new Date();
      if (isNaN(at)) throw new HttpError(400, 'เวลายกเลิกไม่ถูกต้อง');
      set.cancelled_by = by;
      set.cancelled_at = at.toISOString();
      set.assistant_arrived = body.assistant_arrived ? 1 : 0;
      set.cancel_hours_before = hoursBefore(merged, set.cancelled_at);
      notes.push(`ยกเลิกโดย${by === 'business' ? 'ธุรกิจ' : 'ลูกค้า'}${set.assistant_arrived ? ' (ผู้ช่วยถึงบ้านแล้ว)' : ''} ก่อนเวลารับ ${set.cancel_hours_before} ชม.`);
    } else if (b.status === 'cancelled') {
      Object.assign(set, { cancelled_by: null, cancelled_at: null, cancel_hours_before: null, assistant_arrived: 0 });
    }
  }

  const changed = Object.keys(set).filter((k) => k in FIELDS);
  if (changed.length) notes.push('แก้ไข: ' + changed.map((k) => k === 'internal_notes' || k === 'pickup_address' ? LABELS[k] : `${LABELS[k] || k} = ${set[k] ?? '-'}`).join(', ').slice(0, 450));

  if (Object.keys(set).length) {
    set.updated_at = nowIso();
    const cols = Object.keys(set);
    await env.DB.prepare(`UPDATE bookings SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .bind(...cols.map((c) => set[c]), b.id).run();
    for (const n of notes) await audit(env.DB, 'admin', b.id, n.startsWith('สถานะ') ? 'status' : 'update', n);
  }
  return get({ env, params });
}

export async function cancelPreview({ env, params, url }) {
  const b = await loadBooking(env, params.id);
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  if (isNaN(at)) return fail(400, 'เวลาไม่ถูกต้อง');
  const hrs = hoursBefore(b, at.toISOString());
  const c = cancellation({
    base: b.received_service, packagePay: basePrices(b).base_pay, hoursBefore: hrs,
    cancelledBy: url.searchParams.get('by') === 'business' ? 'business' : 'customer',
    assistantArrived: url.searchParams.get('arrived') === '1',
  });
  return json({ ok: true, hours_before: hrs, base: b.received_service, ...c });
}

export async function applyPromo({ env, params }) {
  const b = await loadBooking(env, params.id);
  const s = await loadSettings(env.DB);
  if (b.promo_applied) return fail(409, 'นัดนี้ใช้โปรเปิดตัวแล้ว');
  if (!(s.promo_remaining > 0)) return fail(409, 'สิทธิ์โปรเปิดตัวหมดแล้ว');
  await env.DB.prepare('UPDATE bookings SET discount_pct = ?, promo_applied = 1, updated_at = ? WHERE id = ?').bind(s.promo_percent, nowIso(), b.id).run();
  s.promo_remaining -= 1;
  await saveSettings(env.DB, s);
  await audit(env.DB, 'admin', b.id, 'promo', `ใช้โปรเปิดตัว ลด ${s.promo_percent}% (เหลือ ${s.promo_remaining} สิทธิ์)`);
  return get({ env, params });
}

