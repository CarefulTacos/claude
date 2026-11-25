// ไปด้วยกัน back office: vanilla JS single-page app with hash routes.
// Every value from the server is escaped through html`` before it reaches the DOM.
import { promptpayPayload } from '../shared/promptpay.js';

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
function val(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? val(vals[i]) : ''); });
  return raw(out);
}
const baht = (n) => Number(n || 0).toLocaleString('th-TH');
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
function thDate(ymd, withDow = true) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00Z');
  return `${withDow ? TH_DOW[d.getUTCDay()] + ' ' : ''}${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear() + 543).slice(2)}`;
}
const thMonth = (ym) => `${TH_MONTHS[Number(ym.slice(5, 7)) - 1]} ${Number(ym.slice(0, 4)) + 543}`;
const bkkNow = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM' Bangkok
const today = () => bkkNow().slice(0, 10);
function addDays(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const fmtTs = (iso) => { if (!iso) return ''; const b = new Date(Date.parse(iso) + 7 * 3600e3).toISOString(); return `${thDate(b.slice(0, 10), false)} ${b.slice(11, 16)}`; };
const STATUS = { new: 'ใหม่', confirmed: 'ยืนยันแล้ว-รอชำระ', paid: 'ชำระแล้ว', done: 'เสร็จสิ้น', cancelled: 'ยกเลิก' };
const purposeChip = (b) => html`<span class="chip purpose">${b.purpose_label || b.purpose}</span>`;
const chip = (s) => html`<span class="chip ${s}">${STATUS[s] || s}</span>`;

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

class ApiError extends Error { constructor(msg, errors, status) { super(msg); this.errors = errors; this.status = status; } }
async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
  let r;
  try { r = await fetch('/api/admin/' + path, opts); } catch { throw new ApiError('เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง'); }
  if (r.status === 401 && path !== 'login') { showLogin(); throw new ApiError('กรุณาเข้าสู่ระบบ', null, 401); }
  const data = await r.json().catch(() => ({ ok: false, error: 'อ่านผลลัพธ์ไม่ได้' }));
  if (!r.ok || !data.ok) {
    const detail = data.errors ? ' (' + Object.values(data.errors).join(', ') + ')' : '';
    throw new ApiError((data.error || 'เกิดข้อผิดพลาด') + detail, data.errors, r.status);
  }
  return data;
}

function mount(h) {
  const v = $('#view');
  v.innerHTML = h instanceof Raw ? h.s : val(h);
}
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}
function guard(fn) {
  return async (...args) => {
    try { await fn(...args); } catch (e) { if (e.status !== 401) toast(e.message || 'เกิดข้อผิดพลาด'); }
  };
}
/** In-page confirmation: swaps the button for a confirm box (no window.confirm). */
function confirmInline(btn, text, onYes, yesLabel = 'ยืนยัน') {
  const box = document.createElement('span');
  box.className = 'confirm-inline';
  box.innerHTML = html`<span>${text}</span><button type="button" class="btn danger sm" data-yes>${yesLabel}</button><button type="button" class="btn ghost sm" data-no>ไม่ใช่</button>`.s;
  btn.replaceWith(box);
  box.querySelector('[data-no]').onclick = () => box.replaceWith(btn);
  box.querySelector('[data-yes]').onclick = guard(async () => { box.querySelector('[data-yes]').disabled = true; await onYes(); });
  box.querySelector('[data-yes]').focus();
}
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  if (btn) { const t = btn.textContent; btn.textContent = 'คัดลอกแล้ว'; setTimeout(() => { btn.textContent = t; }, 1600); }
}
function qrSvg(payload) {
  /* global qrcode */
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true, alt: 'QR พร้อมเพย์' });
}

// ---------- shared pieces ----------
function bookingItem(b, { showMoney = false } = {}) {
  return html`<a class="item" href="#/booking/${b.id}">
    <span class="when">${thDate(b.date)} ${b.start_time}</span>
    <span class="main">${purposeChip(b)} <b>${b.elder_name}</b>${b.second_person ? ' (+1)' : ''} · ${b.destination}<br>
      <span class="small muted">${b.code} · เขต${b.district} · ผู้จอง ${b.booker_name}</span></span>
    <span class="side-info">${chip(b.status)}
      <span class="small ${b.assistant_name ? 'muted' : ''}">${b.assistant_name ? 'ผู้ช่วย ' + b.assistant_name : raw('<span style="color:var(--marigold)">ยังไม่มีผู้ช่วย</span>')}</span>
      ${showMoney ? html`<span class="small num">${b.money.balance > 0 ? 'ค้าง ' + baht(b.money.balance) : baht(b.money.customer_total)} บาท</span>` : ''}
    </span></a>`;
}
const listOr = (rows, render, empty = 'ไม่มีรายการ') => (rows.length ? html`<div class="items">${rows.map(render)}</div>` : html`<p class="empty">${empty}</p>`);

// ---------- auth ----------
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  setTimeout(() => $('#login-form').password.focus(), 0);
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}
$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const btn = f.querySelector('button');
  btn.disabled = true;
  $('#login-error').textContent = '';
  try {
    await api('login', { method: 'POST', body: { password: f.password.value } });
    f.password.value = '';
    showApp();
    route();
  } catch (e) {
    $('#login-error').textContent = e.message;
  } finally { btn.disabled = false; }
});
$('#logout').addEventListener('click', guard(async () => {
  await api('logout', { method: 'POST' });
  showLogin();
}));
$('#menu-btn').addEventListener('click', () => {
  const n = $('#nav');
  const open = n.classList.toggle('open');
  $('#menu-btn').setAttribute('aria-expanded', String(open));
});

// ---------- dashboard ----------
async function dashboard() {
  const d = await api('dashboard');
  const k = d.kpi;
  mount(html`
    <div class="page-head"><h1>แดชบอร์ด</h1><span class="muted">วันนี้ ${thDate(d.today)}</span></div>
    <section class="stack"><h2>เดือนนี้ (${thMonth(k.month)})</h2>
      <div class="kpis">
        <div class="kpi"><span>นัดที่ชำระแล้ว</span><b>${k.bookings}</b></div>
        <div class="kpi"><span>รายได้</span><b>${baht(k.revenue)}</b></div>
        <div class="kpi"><span>ค่าผู้ช่วย</span><b>${baht(k.assistant_cost)}</b></div>
        <div class="kpi"><span>กำไรขั้นต้น</span><b>${baht(k.gross)}</b></div>
        <div class="kpi"><span>ค่าใช้จ่าย</span><b>${baht(k.expenses)}</b></div>
        <div class="kpi ${k.net < 0 ? 'neg' : ''}"><span>กำไรสุทธิ</span><b>${baht(k.net)}</b></div>
      </div>
      ${k.pending ? html`<p class="small muted">มีอีก ${k.pending} นัดในเดือนนี้ที่ยังไม่ชำระ</p>` : ''}
    </section>
    <section class="stack"><h2>คำขอใหม่รอยืนยัน (${d.new_requests.length})</h2>${listOr(d.new_requests, (b) => bookingItem(b), 'ไม่มีคำขอใหม่')}</section>
    <section class="stack"><h2>นัดวันนี้และ 7 วันข้างหน้า</h2>${listOr(d.schedule, (b) => bookingItem(b), 'ยังไม่มีนัด')}</section>
    <div class="two">
      <section class="stack"><h2>รอชำระ / ค้างชำระ (${d.unpaid.length})</h2>${listOr(d.unpaid, (b) => bookingItem(b, { showMoney: true }), 'ไม่มียอดค้าง')}</section>
      <section class="stack"><h2>ยังไม่มีผู้ช่วย (${d.unassigned.length})</h2>${listOr(d.unassigned, (b) => bookingItem(b), 'ทุกนัดมีผู้ช่วยแล้ว')}</section>
    </div>
    <div class="two">
      <section class="stack"><h2>ติดตามนัดครั้งหน้า (14 วัน)</h2>
        ${listOr(d.followups, (f) => html`<a class="item" href="#/booking/${f.id}"><span class="when">${thDate(f.next_appointment)}</span>
          <span class="main"><b>${f.elder_name}</b><br><span class="small muted">ผู้จอง ${f.booker_name} · ${f.booker_phone}</span></span>
          <span class="side-info small">ยังไม่ได้จอง</span></a>`, 'ไม่มีนัดที่ต้องตาม')}
      </section>
      <section class="stack"><h2>ประกันผู้ช่วยใกล้หมด (30 วัน)</h2>
        ${listOr(d.insurance, (a) => html`<a class="item" href="#/assistant/${a.id}"><span class="when">${thDate(a.insurance_expiry)}</span>
          <span class="main"><b>${a.nickname}</b></span><span class="side-info small">${a.insurance_expiry < d.today ? 'หมดแล้ว' : 'ใกล้หมด'}</span></a>`, 'ไม่มี')}
      </section>
    </div>`);
}

// ---------- bookings list ----------
async function bookings(params) {
  const qs = new URLSearchParams();
  for (const k of ['status', 'purpose', 'from', 'to', 'assistant', 'q']) if (params.get(k)) qs.set(k, params.get(k));
  const [data, asg, cfg] = await Promise.all([api('bookings?' + qs), api('assistants'), api('session')]);
  mount(html`
    <div class="page-head"><h1>นัดทั้งหมด</h1><span class="muted">${data.bookings.length} รายการ</span></div>
    <form id="filters" class="card stack">
      <div class="grid3">
        <label>สถานะ <select name="status"><option value="">ทั้งหมด</option>${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${params.get('status') === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label>ผู้ช่วย <select name="assistant"><option value="">ทั้งหมด</option><option value="none" ${params.get('assistant') === 'none' ? 'selected' : ''}>ยังไม่มีผู้ช่วย</option>
          ${asg.assistants.map((a) => html`<option value="${a.id}" ${params.get('assistant') === String(a.id) ? 'selected' : ''}>${a.nickname}</option>`)}</select></label>
        <label>ธุระ <select name="purpose"><option value="">ทั้งหมด</option>${cfg.purposes.map((p) => html`<option ${params.get('purpose') === p ? 'selected' : ''}>${p}</option>`)}</select></label>
        <label>ค้นหา <input type="search" name="q" value="${params.get('q') || ''}" placeholder="ชื่อ เบอร์ หรือรหัส PDG-"></label>
        <label>ตั้งแต่วันที่ <input type="date" name="from" value="${params.get('from') || ''}"></label>
        <label>ถึงวันที่ <input type="date" name="to" value="${params.get('to') || ''}"></label>
        <div class="label"><span>&nbsp;</span><div class="row"><button class="btn sm" type="submit">กรอง</button><a class="btn ghost sm" href="#/bookings">ล้าง</a></div></div>
      </div>
    </form>
    ${listOr(data.bookings, (b) => bookingItem(b, { showMoney: true }), 'ไม่พบนัดตามเงื่อนไข')}`);
  $('#filters').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const o = formData(ev.target);
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
    location.hash = '#/bookings' + (p.toString() ? '?' + p : '');
  });
}

// ---------- booking detail ----------
const NEXT = {
  new: ['confirmed', 'ยืนยันคิว'],
  confirmed: ['paid', 'บันทึกว่าชำระแล้ว'],
  paid: ['done', 'ปิดงาน (เสร็จสิ้น)'],
};

async function bookingDetail(id) {
  const d = await api('bookings/' + id);
  renderBooking(d);
}

function renderBooking(d) {
  const b = d.booking;
  const m = b.money;
  const c = b.cancellation;
  const next = NEXT[b.status];
  const opt = (v, cur, label) => html`<option value="${v}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${label}</option>`;
  mount(html`
    <p><a href="#/bookings">‹ นัดทั้งหมด</a></p>
    <div class="page-head">
      <div><h1 class="mono">${b.code}</h1><p class="muted small">จองเมื่อ ${fmtTs(b.created_at)}</p></div>
      ${chip(b.status)}
    </div>
    <div class="actions" id="status-actions">
      ${next ? html`<button class="btn" type="button" data-status="${next[0]}">${next[1]}</button>` : ''}
      ${b.status !== 'cancelled' ? html`<button class="btn ghost" type="button" id="open-cancel">ยกเลิกนัด…</button>` : html`<button class="btn ghost" type="button" data-status="new">เปิดนัดนี้ใหม่</button>`}
      <label class="small" style="display:flex;gap:6px;align-items:center;font-weight:400">เปลี่ยนสถานะเอง
        <select id="manual-status" style="min-height:36px;padding:4px 8px;width:auto">${Object.entries(STATUS).filter(([k]) => k !== 'cancelled').map(([k, v]) => opt(k, b.status === 'cancelled' ? '' : b.status, v))}</select></label>
    </div>
    ${d.warnings.length ? html`<div class="alert" role="alert">${d.warnings.map((w) => html`<p>⚠ ${w}</p>`)}</div>` : ''}

    <section id="cancel-panel" class="card stack hidden">
      <h2>ยกเลิกนัด</h2>
      <div class="choices"><label><input type="radio" name="cby" value="customer" checked> ลูกค้ายกเลิก</label><label><input type="radio" name="cby" value="business"> ธุรกิจยกเลิก</label></div>
      <label class="check"><input type="checkbox" id="c-arrived"> ผู้ช่วยไปถึงบ้านแล้ว</label>
      <label>เวลาที่แจ้งยกเลิก (เวลาไทย) <input type="datetime-local" id="c-at" value="${bkkNow()}"></label>
      <div id="c-preview" class="note">กำลังคำนวณ…</div>
      <div class="row"><button class="btn danger" type="button" id="c-confirm">ยืนยันยกเลิกนัด</button><button class="btn ghost" type="button" id="c-close">ปิด</button></div>
    </section>

    <div class="two">
      <section class="card">
        <h2>สรุปเงิน</h2>
        <dl class="money">
          <dt>${b.package_name}${m.second_person_pct ? ` 2 ท่าน (+${m.second_person_pct}%)` : ''} (ราคาเต็ม)</dt><dd>${baht(m.service)}</dd>
          ${m.discount_pct ? html`<dt>ส่วนลด ${m.discount_pct}%</dt><dd>-${baht(m.service - m.discounted)}</dd>` : ''}
          <dt>ค่าบริการหลังลด</dt><dd>${baht(m.discounted)}</dd>
          <dt>ค่าเกินเวลา (${m.ot_units} ช่วง)</dt><dd>${baht(m.overtime_fee)}</dd>
          <dt>ค่าบวกเพิ่ม (${b.surcharge_count} รายการ${m.evening_fee ? ' + ช่วงเย็น' : ''})</dt><dd>${baht(m.surcharge)}</dd>
          <dt>ค่ารถ (ตามจริง)</dt><dd>${baht(m.transport)}</dd>
          <hr>
          <dt class="total">ยอดลูกค้ารวม</dt><dd class="total" data-k="customer_total">${baht(m.customer_total)}</dd>
          <dt>ชำระล่วงหน้า (ตอนยืนยัน)</dt><dd>${baht(m.upfront)}</dd>
          <dt>ส่วนเพิ่มหลังนัด</dt><dd>${baht(m.extra)}</dd>
          <dt>รับเงินแล้ว</dt><dd>${baht(m.received)}</dd>
          <dt class="total">ค้างชำระ</dt><dd class="total" data-k="balance">${baht(b.status === 'cancelled' ? 0 : m.balance)}</dd>
          <hr>
          <dt>ค่าผู้ช่วย</dt><dd data-k="assistant_pay">${baht(m.assistant_pay)}</dd>
          <dt class="total">กำไรขั้นต้น (ไม่รวมค่ารถ)</dt><dd class="total" data-k="gross_profit">${baht(m.gross_profit)}</dd>
        </dl>
        ${c ? html`<div class="note stack" style="margin-top:12px" id="cancel-summary"><b>ยกเลิกแล้ว: ${c.label}</b>
          <dl class="money"><dt>ยอดที่ชำระมา</dt><dd>${baht(b.received_service)}</dd><dt>ต้องคืนลูกค้า</dt><dd data-k="refund">${baht(c.refund)}</dd>
          <dt>ธุรกิจเก็บไว้</dt><dd>${baht(c.kept)}</dd><dt>ค่าผู้ช่วย</dt><dd data-k="cancel_assistant">${baht(c.assistant_pay)}</dd>
          <dt>คืนเงินแล้ว</dt><dd>${baht(b.refund_paid)}</dd></dl>
          <p class="small muted">ยกเลิกโดย${b.cancelled_by === 'business' ? 'ธุรกิจ' : 'ลูกค้า'} เมื่อ ${fmtTs(b.cancelled_at)} (ก่อนเวลารับ ${b.cancel_hours_before} ชม.)</p></div>` : ''}
      </section>

      <section class="card stack">
        <h2>QR พร้อมเพย์</h2>
        ${d.promptpay_id ? html`<div class="row">
            <button class="btn ghost sm" type="button" data-qr="${m.upfront}">ชำระล่วงหน้า ${baht(m.upfront)}</button>
            ${m.extra ? html`<button class="btn ghost sm" type="button" data-qr="${m.extra}">ส่วนเพิ่ม ${baht(m.extra)}</button>` : ''}
            ${m.balance > 0 && b.status !== 'cancelled' ? html`<button class="btn ghost sm" type="button" data-qr="${m.balance}">ค้างชำระ ${baht(m.balance)}</button>` : ''}
          </div><div id="qr-out"></div>`
        : html`<p class="muted">ยังไม่ได้ใส่หมายเลขพร้อมเพย์ <a href="#/settings">ไปที่ตั้งค่า</a></p>`}
      </section>
    </div>

    <form id="edit" class="stack">
      <fieldset>
        <legend>งานและเงิน</legend>
        <div class="grid2">
          <label>ผู้ช่วย <select name="assistant_id"><option value="">— ยังไม่มอบหมาย —</option>
            ${d.assistants.map((a) => html`<option value="${a.id}" ${a.id === b.assistant_id ? 'selected' : ''}>${a.nickname}${a.status !== 'active' ? ' (ไม่พร้อม)' : ''}${a.busy.length ? ' · มีนัดวันนี้แล้ว ' + a.busy.join(', ') : ''}</option>`)}</select></label>
          <label>แพ็กเกจ <select name="package_key">${d.packages.map((p) => opt(p.key, b.package_key, p.name))}</select></label>
          <label>ส่วนลด (%) <input type="number" name="discount_pct" min="0" max="100" step="1" value="${b.discount_pct}"></label>
          <div class="label"><span>โปรเปิดตัว</span>${b.promo_applied ? html`<span class="chip">ใช้โปรแล้ว</span>` : html`<button type="button" class="btn ghost sm" id="promo" ${d.promo.remaining > 0 ? '' : 'disabled'}>ใช้โปรลด ${d.promo.percent}% (เหลือ ${d.promo.remaining})</button>`}</div>
          <label>เวลารับที่บ้าน <input type="time" name="pickup_time" value="${b.pickup_time}"></label>
          <label class="check" style="align-self:end"><input type="checkbox" name="second_person" ${b.second_person ? 'checked' : ''}> ไปด้วยกัน 2 ท่าน (+${b.second_person_pct}%)</label>
          <label class="check" style="align-self:end"><input type="checkbox" name="evening" ${b.evening ? 'checked' : ''}> ค่าช่วงเย็น ${baht(b.evening_rate)} บาท <span class="hint">รับหลัง 18:00 หรือกลับหลัง 20:00</span></label>
          <label>เกินเวลา (นาที) <input type="number" name="overtime_min" min="0" step="1" value="${b.overtime_min}"></label>
          <label>ค่าบวกเพิ่ม (จำนวนรายการ) <span class="hint">เริ่มก่อน 06:30 / เขตชานเมือง รายการละ ${baht(b.surcharge_customer)}</span><input type="number" name="surcharge_count" min="0" max="10" step="1" value="${b.surcharge_count}"></label>
          <label>ค่ารถตามจริง (บาท) <input type="number" name="transport_cost" min="0" step="1" value="${b.transport_cost}"></label>
          <label>รับค่าบริการแล้ว (บาท) <input type="number" name="received_service" min="0" step="1" value="${b.received_service}"></label>
          <label>รับส่วนเพิ่มแล้ว (บาท) <input type="number" name="received_extra" min="0" step="1" value="${b.received_extra}"></label>
          <label>คืนเงินลูกค้าแล้ว (บาท) <input type="number" name="refund_paid" min="0" step="1" value="${b.refund_paid}"></label>
          <label class="check" style="align-self:end"><input type="checkbox" name="assistant_paid" ${b.assistant_paid ? 'checked' : ''}> จ่ายค่าผู้ช่วยแล้ว</label>
          <label>นัดครั้งหน้าของผู้สูงอายุ <input type="date" name="next_appointment" value="${b.next_appointment || ''}"></label>
          <label>คะแนนรีวิว <select name="review_score">${opt('', b.review_score, '—')}${[5, 4, 3, 2, 1].map((n) => opt(n, b.review_score, n + ' ดาว'))}</select></label>
        </div>
        <label>บันทึกภายใน <textarea name="internal_notes" maxlength="2000">${b.internal_notes}</textarea></label>
      </fieldset>
      <fieldset>
        <legend>รายละเอียดนัด</legend>
        <div class="grid2">
          <label>วันนัด <input type="date" name="date" value="${b.date}"></label>
          <label>เวลาถึงปลายทาง <input type="time" name="start_time" value="${b.start_time}"></label>
          <label>ธุระ <select name="purpose">${d.purposes.map((x) => opt(x, b.purpose, x))}</select></label>
          <label>ระบุธุระ (ถ้าเลือกอื่น ๆ) <input type="text" name="purpose_other" value="${b.purpose_other}"></label>
          <label>ปลายทาง <input type="text" name="destination" value="${b.destination}"></label>
          <label>งดน้ำงดอาหาร <select name="fasting">${opt('', b.fasting, '— ไม่เกี่ยว —')}${opt('yes', b.fasting, 'ต้องงด')}${opt('no', b.fasting, 'ไม่ต้องงด')}${opt('unsure', b.fasting, 'ไม่แน่ใจ')}</select></label>
          <label>เขต <select name="district">${d.districts.map((x) => opt(x, b.district, x))}</select></label>
          <label>รายละเอียดอื่น <input type="text" name="errands" value="${b.errands}"></label>
        </div>
        <label>จุดแวะ (ไม่เกิน 3 บรรทัด) <textarea name="stops" style="min-height:70px">${b.stops}</textarea></label>
        <label>ที่อยู่รับ <textarea name="pickup_address" style="min-height:70px">${b.pickup_address}</textarea></label>
      </fieldset>
      <div class="savebar"><button class="btn" type="submit" id="save">บันทึก</button><span class="small muted">ระบบคำนวณเงินใหม่ทุกครั้งที่บันทึก</span></div>
    </form>

    <div class="two">
      <section class="card"><h2>ธุระ</h2>
      <dl class="facts"><dt>ประเภท</dt><dd>${purposeChip(b)}</dd><dt>ปลายทาง</dt><dd>${b.destination} เวลา ${b.start_time}</dd>
        <dt>จุดแวะ</dt><dd style="white-space:pre-line">${b.stops || '-'}</dd><dt>อื่น ๆ</dt><dd>${b.errands || '-'}</dd>
        <dt>ผู้เดินทาง</dt><dd>${b.second_person ? '2 ท่าน' : '1 ท่าน'}</dd></dl>
    </section>
    <section class="card"><h2>ผู้จอง</h2>
        <dl class="facts">
          <dt>ชื่อ</dt><dd>${b.booker_name} (${b.relationship})</dd>
          <dt>โทร</dt><dd><a href="tel:${b.booker_phone}">${b.booker_phone}</a></dd>
          <dt>LINE</dt><dd>${b.booker_line}</dd>
          <dt>รู้จักจาก</dt><dd>${b.heard_from || '-'}</dd>
          <dt>ยินยอม</dt><dd class="small">เงื่อนไข ✓ ข้อมูลสุขภาพ ✓ ผู้สูงอายุตกลง ✓ · รูป ${b.consent_photo ? '✓' : '✗'}<br><span class="muted">${b.consent_version} · ${fmtTs(b.consent_at)}</span></dd>
        </dl>
      </section>
      <section class="card"><h2>ผู้สูงอายุ</h2>
        ${b.anonymized_at ? html`<p class="note small">ลบข้อมูลส่วนบุคคลตาม PDPA แล้วเมื่อ ${fmtTs(b.anonymized_at)}</p>` : ''}
        <dl class="facts">
          <dt>เรียกว่า</dt><dd>${b.elder_name} อายุ ${b.elder_age}</dd>
          <dt>โทร</dt><dd>${b.elder_phone ? html`<a href="tel:${b.elder_phone}">${b.elder_phone}</a>` : '-'}</dd>
          <dt>การเดิน</dt><dd>${b.mobility}</dd>
          <dt>การสื่อสาร</dt><dd>${b.communication}${b.communication_other ? ' · ' + b.communication_other : ''}</dd>
          <dt>สุขภาพ</dt><dd>${b.health_notes || '-'}</dd>
          <dt>ฉุกเฉิน</dt><dd>${b.emergency_phone ? html`<a href="tel:${b.emergency_phone}">${b.emergency_phone}</a>` : '-'}</dd>
          <dt>งดอาหาร</dt><dd>${b.fasting_label || '-'}</dd>
          <dt>เดินทาง</dt><dd>${b.transport_mode === 'family' ? 'ครอบครัวมีคนขับ' : 'ผู้ช่วยเรียกแท็กซี่/แอป'}</dd>
          <dt>แผนที่</dt><dd>${/^https:\/\//.test(b.maps_link) ? html`<a href="${b.maps_link}" target="_blank" rel="noopener noreferrer">เปิดแผนที่</a>` : '-'}</dd>
        </dl>
      </section>
    </div>

    <section class="stack"><h2>ข้อความสำเร็จรูป</h2>
      <div class="two">${d.messages.map((msg) => html`<div class="card stack msg"><div class="row" style="justify-content:space-between"><h3>${msg.title}</h3>
        <button type="button" class="btn sm" data-copy="${msg.key}">คัดลอก</button></div><textarea readonly id="msg-${msg.key}" aria-label="${msg.title}">${msg.text}</textarea></div>`)}</div>
    </section>

    <section class="card"><h2>ประวัติการเปลี่ยนแปลง</h2>
      ${d.audit.length ? html`<ul class="small" style="margin:0;padding-left:1.2em">${d.audit.map((a) => html`<li><span class="muted">${fmtTs(a.at)} · ${a.actor === 'admin' ? 'เจ้าของ' : 'ลูกค้า (เว็บ)'}</span> — ${a.detail}</li>`)}</ul>` : html`<p class="empty">ไม่มี</p>`}
    </section>`);

  const patch = guard(async (body, msg = 'บันทึกแล้ว') => {
    const nd = await api('bookings/' + b.id, { method: 'PATCH', body });
    renderBooking(nd);
    toast(msg);
  });
  for (const btn of $$('[data-status]')) btn.onclick = () => patch({ status: btn.dataset.status }, 'เปลี่ยนสถานะแล้ว');
  $('#manual-status').onchange = (ev) => {
    const sel = ev.target;
    if (sel.value === b.status) return;
    confirmInline(sel.parentElement, `เปลี่ยนเป็น "${STATUS[sel.value]}"?`, () => patch({ status: sel.value }, 'เปลี่ยนสถานะแล้ว'), 'เปลี่ยน');
  };
  $('#edit').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const o = formData(ev.target);
    o.assistant_id = o.assistant_id ? Number(o.assistant_id) : null;
    patch(o);
  });
  const promo = $('#promo');
  if (promo) promo.onclick = () => confirmInline(promo, `ใช้สิทธิ์โปรเปิดตัวกับนัดนี้?`, guard(async () => {
    renderBooking(await api(`bookings/${b.id}/promo`, { method: 'POST' }));
    toast('ใช้โปรแล้ว');
  }), 'ใช้โปร');
  for (const btn of $$('[data-copy]')) btn.onclick = () => copyText($('#msg-' + btn.dataset.copy).value, btn);
  for (const btn of $$('[data-qr]')) {
    btn.onclick = () => {
      const amount = Number(btn.dataset.qr);
      try {
        const payload = promptpayPayload(d.promptpay_id, amount);
        $('#qr-out').innerHTML = html`<div class="stack"><p><b>${baht(amount)} บาท</b> · พร้อมเพย์ ${d.promptpay_id}</p><div class="qr">${raw(qrSvg(payload))}</div><p class="payload">${payload}</p></div>`.s;
      } catch (e) { toast(e.message); }
    };
  }
  const cp = $('#cancel-panel');
  if ($('#open-cancel')) {
    const preview = guard(async () => {
      const by = $('input[name=cby]:checked', cp).value;
      const at = $('#c-at').value ? new Date($('#c-at').value + ':00+07:00').toISOString() : new Date().toISOString();
      const r = await api(`bookings/${b.id}/cancel-preview?by=${by}&arrived=${$('#c-arrived').checked ? 1 : 0}&at=${encodeURIComponent(at)}`);
      $('#c-preview').innerHTML = html`<b>${r.label}</b><br>ก่อนเวลารับ ${r.hours_before} ชม. · ยอดที่ชำระมา ${baht(r.base)} บาท<br>
        คืนลูกค้า <b data-k="preview-refund">${baht(r.refund)}</b> บาท · ธุรกิจเก็บ ${baht(r.kept)} บาท · ค่าผู้ช่วย <b data-k="preview-assistant">${baht(r.assistant_pay)}</b> บาท`.s;
    });
    $('#open-cancel').onclick = () => { cp.classList.remove('hidden'); cp.scrollIntoView({ block: 'start' }); preview(); };
    $('#c-close').onclick = () => cp.classList.add('hidden');
    cp.addEventListener('change', preview);
    $('#c-confirm').onclick = () => patch({
      status: 'cancelled',
      cancelled_by: $('input[name=cby]:checked', cp).value,
      assistant_arrived: $('#c-arrived').checked,
      cancelled_at: $('#c-at').value ? new Date($('#c-at').value + ':00+07:00').toISOString() : undefined,
    }, 'ยกเลิกนัดแล้ว');
  }
}

// ---------- calendar ----------
function mondayOf(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  return addDays(ymd, -((d.getUTCDay() + 6) % 7));
}
async function calendar(params) {
  const start = mondayOf(params.get('start') || today());
  const end = addDays(start, 6);
  const data = await api(`bookings?from=${start}&to=${end}&order=asc`);
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const t = today();
  mount(html`
    <div class="page-head"><h1>ปฏิทิน</h1>
      <div class="row"><a class="btn ghost sm" href="#/calendar?start=${addDays(start, -7)}">‹ สัปดาห์ก่อน</a>
      <a class="btn ghost sm" href="#/calendar">สัปดาห์นี้</a>
      <a class="btn ghost sm" href="#/calendar?start=${addDays(start, 7)}">สัปดาห์ถัดไป ›</a></div></div>
    <p class="muted">${thDate(start)} – ${thDate(end)}</p>
    <div class="week">${days.map((day) => {
      const list = data.bookings.filter((b) => b.date === day);
      return html`<div class="day ${day === t ? 'today' : ''}"><h3>${thDate(day)}</h3>
        ${list.length ? list.map((b) => html`<a href="#/booking/${b.id}" class="${b.status === 'cancelled' ? 'cancelled' : !b.assistant_name ? 'unassigned' : ''}">
          <b class="mono">${b.start_time}</b> ${b.elder_name}${b.second_person ? ' (+1)' : ''}<br>${purposeChip(b)} ${b.destination}<br><span class="small">${b.assistant_name ? 'ผู้ช่วย ' + b.assistant_name : 'ยังไม่มีผู้ช่วย'} · ${STATUS[b.status]}</span></a>`)
        : html`<span class="small muted">ว่าง</span>`}</div>`;
    })}</div>`);
}

// ---------- assistants ----------
const A_STATUS = { active: 'พร้อมรับงาน', paused: 'พัก', left: 'เลิกแล้ว' };
const WD = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
async function assistants() {
  const d = await api('assistants');
  const soon = addDays(today(), 30);
  mount(html`
    <div class="page-head"><h1>ผู้ช่วย</h1><a class="btn sm" href="#/assistant/new">+ เพิ่มผู้ช่วย</a></div>
    ${listOr(d.assistants, (a) => html`<a class="item" href="#/assistant/${a.id}">
      <span class="when">${A_STATUS[a.status]}</span>
      <span class="main"><b>${a.nickname}</b> ${a.full_name ? '· ' + a.full_name : ''}<br>
        <span class="small muted">${a.phone || '-'} · เขต${a.district || '-'} · ว่าง ${String(a.weekdays || '').split(',').filter(Boolean).map((x) => WD[x]).join(' ')}</span></span>
      <span class="side-info small">${a.jobs} งาน
        ${a.insurance_expiry ? html`<span style="${a.insurance_expiry <= soon ? 'color:var(--danger)' : ''}">ประกันถึง ${thDate(a.insurance_expiry, false)}</span>` : html`<span style="color:var(--danger)">ไม่มีข้อมูลประกัน</span>`}
        ${a.background_checked ? 'ตรวจประวัติแล้ว' : html`<span style="color:var(--marigold)">ยังไม่ตรวจประวัติ</span>`}</span></a>`, 'ยังไม่มีผู้ช่วย')}`);
}
async function assistantForm(id) {
  let a = { nickname: '', full_name: '', phone: '', line_id: '', district: '', weekdays: '0,1,2,3,4,5,6', background_checked: 0, trained_date: '', insurance_expiry: '', status: 'active', notes: '' };
  if (id !== 'new') {
    const d = await api('assistants');
    a = d.assistants.find((x) => String(x.id) === String(id));
    if (!a) return mount(html`<p>ไม่พบผู้ช่วย</p>`);
  }
  const wd = String(a.weekdays || '').split(',');
  mount(html`
    <p><a href="#/assistants">‹ ผู้ช่วย</a></p>
    <h1>${id === 'new' ? 'เพิ่มผู้ช่วย' : a.nickname}</h1>
    <form id="af" class="stack"><fieldset><legend>ข้อมูลผู้ช่วย</legend>
      <div class="grid2">
        <label>ชื่อเล่น <input type="text" name="nickname" required value="${a.nickname}"></label>
        <label>ชื่อ-นามสกุล <input type="text" name="full_name" value="${a.full_name}"></label>
        <label>เบอร์โทร <input type="tel" name="phone" value="${a.phone}"></label>
        <label>LINE <input type="text" name="line_id" value="${a.line_id}"></label>
        <label>เขตที่อยู่ <input type="text" name="district" value="${a.district}"></label>
        <label>สถานะ <select name="status">${Object.entries(A_STATUS).map(([k, v]) => html`<option value="${k}" ${a.status === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label>วันที่อบรม <input type="date" name="trained_date" value="${a.trained_date || ''}"></label>
        <label>ประกันหมดอายุ <input type="date" name="insurance_expiry" value="${a.insurance_expiry || ''}"></label>
      </div>
      <div class="label"><span>วันที่รับงานได้</span><div class="weekday-checks">${WD.map((n, i) => html`<label class="check"><input type="checkbox" name="wd${i}" ${wd.includes(String(i)) ? 'checked' : ''}> ${n}</label>`)}</div></div>
      <label class="check"><input type="checkbox" name="background_checked" ${a.background_checked ? 'checked' : ''}> ตรวจประวัติอาชญากรรมแล้ว</label>
      <label>บันทึก <textarea name="notes">${a.notes}</textarea></label>
    </fieldset>
    <div class="savebar"><button class="btn" type="submit">บันทึก</button>${id !== 'new' ? html`<button class="btn ghost" type="button" id="del">ลบ</button>` : ''}</div></form>`);
  $('#af').addEventListener('submit', guard(async (ev) => {
    ev.preventDefault();
    const o = formData(ev.target);
    o.weekdays = WD.map((_, i) => (o['wd' + i] ? String(i) : null)).filter(Boolean);
    for (let i = 0; i < 7; i++) delete o['wd' + i];
    const r = await api(id === 'new' ? 'assistants' : 'assistants/' + id, { method: id === 'new' ? 'POST' : 'PATCH', body: o });
    toast('บันทึกแล้ว');
    location.hash = '#/assistant/' + r.assistant.id;
    if (id !== 'new') assistantForm(id);
  }));
  const del = $('#del');
  if (del) del.onclick = () => confirmInline(del, 'ลบผู้ช่วยคนนี้?', async () => {
    await api('assistants/' + id, { method: 'DELETE' });
    toast('ลบแล้ว');
    location.hash = '#/assistants';
  }, 'ลบ');
}

// ---------- payouts ----------
async function payouts(params) {
  const month = params.get('month') || today().slice(0, 7);
  const d = await api('payouts?month=' + month);
  mount(html`
    <div class="page-head"><h1>ค่าผู้ช่วย</h1>
      <form id="pm" class="row"><input type="month" name="month" value="${d.month}" style="width:auto"><button class="btn sm" type="submit">ดู</button></form></div>
    <p class="muted">รอบ ${thMonth(d.month)} · นับเฉพาะงานที่เสร็จสิ้นหรือยกเลิกที่ผู้ช่วยได้เงิน</p>
    <div class="table-wrap"><table>
      <thead><tr><th>ผู้ช่วย</th><th class="num">งาน</th><th class="num">ค่าจ้าง</th><th class="num">จ่ายแล้ว</th><th class="num">ค้างจ่าย</th><th></th></tr></thead>
      <tbody>${d.payouts.length ? d.payouts.map((p) => html`<tr>
        <td><b>${p.nickname}</b><br><span class="small muted">${p.jobs.map((j) => `${j.code} ${baht(j.owed)}${j.paid ? ' ✓' : ''}`).join(' · ')}</span></td>
        <td class="num">${p.jobs.length}</td><td class="num">${baht(p.owed)}</td><td class="num">${baht(p.paid)}</td><td class="num" data-k="outstanding-${p.assistant_id}"><b>${baht(p.outstanding)}</b></td>
        <td>${p.outstanding > 0 ? html`<button class="btn sm" type="button" data-pay="${p.assistant_id}" data-amt="${p.outstanding}">บันทึกว่าจ่ายแล้ว</button>` : html`<span class="chip">จ่ายครบ</span>`}</td></tr>`)
        : html`<tr><td colspan="6" class="empty">ไม่มีค่าจ้างในเดือนนี้</td></tr>`}</tbody>
      <tfoot><tr><td>รวม</td><td></td><td class="num">${baht(d.total_owed)}</td><td></td><td class="num">${baht(d.total_outstanding)}</td><td></td></tr></tfoot>
    </table></div>`);
  $('#pm').addEventListener('submit', (ev) => { ev.preventDefault(); location.hash = '#/payouts?month=' + ev.target.month.value; });
  for (const btn of $$('[data-pay]')) {
    btn.onclick = () => confirmInline(btn, `จ่าย ${baht(btn.dataset.amt)} บาทแล้ว?`, async () => {
      await api('payouts/mark', { method: 'POST', body: { assistant_id: Number(btn.dataset.pay), month: d.month } });
      toast('บันทึกการจ่ายแล้ว');
      payouts(params);
    }, 'จ่ายแล้ว');
  }
}

// ---------- customers ----------
async function customers(params) {
  const q = params.get('q') || '';
  const d = await api('customers' + (q ? '?q=' + encodeURIComponent(q) : ''));
  mount(html`
    <div class="page-head"><h1>ลูกค้า</h1><span class="muted">${d.customers.length} ครอบครัว</span></div>
    <form id="cq" class="row"><input type="search" name="q" value="${q}" placeholder="ค้นหาชื่อหรือเบอร์" style="flex:1 1 200px"><button class="btn sm" type="submit">ค้นหา</button></form>
    <div class="table-wrap"><table>
      <thead><tr><th>ผู้จอง</th><th>ผู้สูงอายุ</th><th class="num">นัด</th><th>ล่าสุด</th><th>นัดหมอครั้งหน้า</th><th class="num">ยอดใช้จ่าย</th></tr></thead>
      <tbody>${d.customers.length ? d.customers.map((c) => html`<tr>
        <td><a href="#/bookings?q=${encodeURIComponent(c.booker_phone)}">${c.booker_name}</a><br><span class="small muted">${c.booker_phone}</span></td>
        <td>${c.elders.join(', ')}</td><td class="num">${c.bookings}${c.cancelled ? html`<br><span class="small muted">ยกเลิก ${c.cancelled}</span>` : ''}</td>
        <td>${c.last_date ? thDate(c.last_date, false) : '-'}${c.next_date ? html`<br><span class="small">จองไว้ ${thDate(c.next_date, false)}</span>` : ''}</td>
        <td>${c.next_appointment ? thDate(c.next_appointment, false) : '-'}</td><td class="num">${baht(c.total_spent)}</td></tr>`)
        : html`<tr><td colspan="6" class="empty">ยังไม่มีลูกค้า</td></tr>`}</tbody></table></div>`);
  $('#cq').addEventListener('submit', (ev) => { ev.preventDefault(); location.hash = '#/customers' + (ev.target.q.value ? '?q=' + encodeURIComponent(ev.target.q.value) : ''); });
}

// ---------- expenses ----------
async function expenses(params) {
  const month = params.get('month') || '';
  const d = await api('expenses' + (month ? '?month=' + month : ''));
  mount(html`
    <div class="page-head"><h1>ค่าใช้จ่าย</h1>
      <form id="em" class="row"><input type="month" name="month" value="${month}" style="width:auto"><button class="btn sm" type="submit">ดูเดือน</button>${month ? html`<a class="btn ghost sm" href="#/expenses">ทั้งหมด</a>` : ''}</form></div>
    <form id="ef" class="card stack"><h2 id="ef-title">เพิ่มรายการ</h2><input type="hidden" name="id">
      <div class="grid2">
        <label>วันที่ <input type="date" name="date" value="${today()}" required></label>
        <label>หมวด <select name="category">${d.categories.map((c) => html`<option>${c}</option>`)}</select></label>
        <label>รายการ <input type="text" name="item" maxlength="200" required></label>
        <label>จำนวนเงิน (บาท) <input type="number" name="amount" min="0" step="1" required></label>
      </div>
      <div class="row"><button class="btn" type="submit">บันทึก</button><button class="btn ghost hidden" type="button" id="ef-cancel">ยกเลิกการแก้ไข</button></div>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>วันที่</th><th>รายการ</th><th>หมวด</th><th class="num">บาท</th><th></th></tr></thead>
      <tbody>${d.expenses.length ? d.expenses.map((e) => html`<tr><td>${thDate(e.date, false)}</td><td>${e.item}</td><td>${e.category}</td><td class="num">${baht(e.amount)}</td>
        <td><div class="actions"><button class="btn ghost sm" type="button" data-edit="${e.id}">แก้ไข</button><button class="btn ghost sm" type="button" data-del="${e.id}">ลบ</button></div></td></tr>`)
        : html`<tr><td colspan="5" class="empty">ยังไม่มีรายการ</td></tr>`}</tbody>
      <tfoot><tr><td colspan="3">รวม</td><td class="num">${baht(d.total)}</td><td></td></tr></tfoot></table></div>`);
  const f = $('#ef');
  $('#em').addEventListener('submit', (ev) => { ev.preventDefault(); location.hash = '#/expenses' + (ev.target.month.value ? '?month=' + ev.target.month.value : ''); });
  f.addEventListener('submit', guard(async (ev) => {
    ev.preventDefault();
    const o = formData(f);
    o.amount = Number(o.amount);
    const id = o.id; delete o.id;
    await api(id ? 'expenses/' + id : 'expenses', { method: id ? 'PATCH' : 'POST', body: o });
    toast('บันทึกแล้ว');
    expenses(params);
  }));
  for (const btn of $$('[data-edit]')) btn.onclick = () => {
    const e = d.expenses.find((x) => String(x.id) === btn.dataset.edit);
    f.id.value = e.id; f.date.value = e.date; f.category.value = e.category; f.item.value = e.item; f.amount.value = e.amount;
    $('#ef-title').textContent = 'แก้ไขรายการ';
    $('#ef-cancel').classList.remove('hidden');
    f.scrollIntoView({ block: 'start' });
  };
  $('#ef-cancel').onclick = () => expenses(params);
  for (const btn of $$('[data-del]')) btn.onclick = () => confirmInline(btn, 'ลบรายการนี้?', async () => {
    await api('expenses/' + btn.dataset.del, { method: 'DELETE' });
    toast('ลบแล้ว');
    expenses(params);
  }, 'ลบ');
}

// ---------- reports ----------
async function reports(params) {
  const months = params.get('months') || '12';
  const d = await api('reports?months=' + months);
  const t = d.total;
  const row = (r, label) => html`<td>${label}</td><td class="num">${r.bookings}</td><td class="num">${baht(r.revenue)}</td><td class="num">${baht(r.assistant_cost)}</td>
    <td class="num">${baht(r.gross)}</td><td class="num">${baht(r.expenses)}</td><td class="num" style="${r.net < 0 ? 'color:var(--danger)' : ''}">${baht(r.net)}</td><td class="num">${r.avg_review ?? '-'}</td>`;
  mount(html`
    <div class="page-head"><h1>รายงานรายเดือน</h1>
      <form id="rm" class="row"><select name="months" style="width:auto">${['12', '24', '36'].map((n) => html`<option value="${n}" ${n === months ? 'selected' : ''}>${n} เดือน</option>`)}</select><button class="btn sm" type="submit">ดู</button></form></div>
    <p class="small muted">รายได้ = ค่าบริการหลังลด + เกินเวลา + ค่าบวกเพิ่ม (ไม่รวมค่ารถ) ของนัดที่ชำระแล้ว/เสร็จสิ้น รวมส่วนที่เก็บไว้จากการยกเลิก</p>
    <div class="table-wrap"><table id="report">
      <thead><tr><th>เดือน</th><th class="num">นัด</th><th class="num">รายได้</th><th class="num">ค่าผู้ช่วย</th><th class="num">กำไรขั้นต้น</th><th class="num">ค่าใช้จ่าย</th><th class="num">กำไรสุทธิ</th><th class="num">รีวิวเฉลี่ย</th></tr></thead>
      <tbody>${d.months.map((r) => html`<tr data-month="${r.month}">${row(r, thMonth(r.month))}</tr>`)}</tbody>
      <tfoot><tr>${row(t, 'รวม')}</tr></tfoot></table></div>
    <section class="stack"><h2>ธุระไหนขายได้ (${months} เดือน)</h2>
      <div class="table-wrap"><table id="purposes"><thead><tr><th>ธุระ</th><th class="num">คำขอ (ไม่นับยกเลิก)</th><th class="num">ชำระแล้ว/เสร็จ</th><th class="num">รายได้</th></tr></thead>
        <tbody>${d.purposes.map((p) => html`<tr data-purpose="${p.purpose}"><td>${p.purpose}</td><td class="num">${p.requests}</td><td class="num">${p.paid}</td><td class="num">${baht(p.revenue)}</td></tr>`)}</tbody></table></div>
    </section>
    <section class="card stack"><h2>ดาวน์โหลด CSV (เปิดใน Excel ได้)</h2>
      <div class="grid2"><label>ตั้งแต่ <input type="date" id="x-from"></label><label>ถึง <input type="date" id="x-to"></label></div>
      <div class="row">
        <a class="btn ghost sm" data-csv="bookings" href="/api/admin/export/bookings">นัดทั้งหมด</a>
        <a class="btn ghost sm" data-csv="expenses" href="/api/admin/export/expenses">ค่าใช้จ่าย</a>
        <a class="btn ghost sm" data-csv="payouts" href="/api/admin/export/payouts">ค่าผู้ช่วย</a>
      </div>
      <p class="small muted">ไฟล์นัดไม่มีข้อมูลสุขภาพและที่อยู่ ควรเก็บไฟล์ไว้ในที่ปลอดภัย</p>
    </section>`);
  $('#rm').addEventListener('submit', (ev) => { ev.preventDefault(); location.hash = '#/reports?months=' + ev.target.months.value; });
  const upd = () => {
    const p = new URLSearchParams();
    if ($('#x-from').value) p.set('from', $('#x-from').value);
    if ($('#x-to').value) p.set('to', $('#x-to').value);
    for (const a of $$('[data-csv]')) a.href = '/api/admin/export/' + a.dataset.csv + (p.toString() ? '?' + p : '');
  };
  $('#x-from').onchange = upd; $('#x-to').onchange = upd;
}

// ---------- QR ----------
async function qrPage() {
  const s = await api('session');
  mount(html`
    <h1>QR พร้อมเพย์</h1>
    ${s.promptpay_id ? html`<form id="qf" class="card stack"><p class="muted">พร้อมเพย์ ${s.promptpay_id}</p>
      <label>จำนวนเงิน (บาท) <input type="number" name="amount" min="1" step="0.01" required inputmode="decimal"></label>
      <button class="btn" type="submit">สร้าง QR</button><div id="qr-out"></div></form>`
    : html`<p class="note">ยังไม่ได้ใส่หมายเลขพร้อมเพย์ <a href="#/settings">ไปที่ตั้งค่า</a></p>`}`);
  const f = $('#qf');
  if (f) f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const amount = Number(f.amount.value);
      const payload = promptpayPayload(s.promptpay_id, amount);
      $('#qr-out').innerHTML = html`<div class="stack"><p><b>${baht(amount)} บาท</b></p><div class="qr">${raw(qrSvg(payload))}</div><p class="payload">${payload}</p></div>`.s;
    } catch (e) { toast(e.message); }
  });
}

// ---------- settings ----------
async function settings() {
  const { settings: s } = await api('settings');
  const num = (k, label, hint = '') => html`<label>${label}${hint ? html` <span class="hint">${hint}</span>` : ''}<input type="number" name="${k}" value="${s[k]}" step="1"></label>`;
  const txt = (k, label, hint = '') => html`<label>${label}${hint ? html` <span class="hint">${hint}</span>` : ''}<input type="text" name="${k}" value="${s[k]}"></label>`;
  const pkgRow = (p, i) => html`<div class="pkg-row" data-pkg="${i}">
    <label>รหัส <input type="text" name="key" value="${p.key}" ${p.key ? 'readonly' : ''}></label>
    <label>ชื่อ <input type="text" name="name" value="${p.name}"></label>
    <label>ชั่วโมง <input type="number" name="hours" value="${p.hours}"></label>
    <label>ราคา <input type="number" name="price" value="${p.price}"></label>
    <label>ค่าผู้ช่วย <input type="number" name="pay" value="${p.pay}"></label></div>`;
  mount(html`
    <h1>ตั้งค่า</h1>
    <form id="sf" class="stack">
      <fieldset><legend>แพ็กเกจ</legend><div id="pkgs" class="stack">${s.packages.map(pkgRow)}</div>
        <button type="button" class="btn ghost sm" id="add-pkg" style="justify-self:start">+ เพิ่มแพ็กเกจ</button>
        <p class="small muted">แก้ราคาแล้วมีผลกับนัดใหม่ นัดเดิมใช้ราคาตอนจอง (เปลี่ยนแพ็กเกจในหน้านัดเพื่อใช้ราคาใหม่)</p></fieldset>
      <fieldset><legend>ค่าเกินเวลาและค่าบวกเพิ่ม</legend><div class="grid2">
        ${num('ot_block_min', 'คิดเกินเวลาทุก (นาที)')}${num('ot_customer', 'ค่าเกินเวลา ลูกค้าจ่าย (บาท/ช่วง)')}
        ${num('ot_assistant', 'ค่าเกินเวลา ผู้ช่วยได้ (บาท/ช่วง)')}${num('surcharge_customer', 'ค่าบวกเพิ่ม ลูกค้าจ่าย (บาท/รายการ)', 'เริ่มก่อน 06:30 / ชานเมือง')}
        ${num('surcharge_assistant', 'ค่าบวกเพิ่ม ผู้ช่วยได้ (บาท/รายการ)')}
        ${num('evening_surcharge', 'ค่าช่วงเย็น ลูกค้าจ่าย (บาท)', 'รับหลัง 18:00 หรือกลับหลัง 20:00')}
        ${num('second_person_surcharge_percent', 'ไปด้วยกัน 2 ท่าน บวกเพิ่ม (%)', 'ทั้งราคาและค่าผู้ช่วย')}</div>
        <label>เขตชานเมือง (บวกเพิ่มอัตโนมัติตอนจอง) <span class="hint">คั่นด้วยจุลภาค</span><textarea name="outer_districts" style="min-height:70px">${s.outer_districts.join(', ')}</textarea></label></fieldset>
      <fieldset><legend>การรับจอง</legend><div class="grid2">
        ${num('max_per_day', 'รับนัดสูงสุดต่อวัน')}${num('lead_days', 'จองล่วงหน้าอย่างน้อย (วัน)')}
        ${txt('confirm_within', 'แจ้งลูกค้าว่าจะยืนยันภายใน', 'เช่น 24 ชั่วโมง')}${num('payment_hours', 'ให้ชำระภายใน (ชั่วโมง)')}
        ${num('promo_percent', 'โปรเปิดตัว ลด (%)')}${num('promo_remaining', 'โปรเปิดตัว เหลือ (ครอบครัว)')}</div></fieldset>
      <fieldset><legend>ติดต่อและรับเงิน</legend><div class="grid2">
        ${txt('promptpay_id', 'พร้อมเพย์', 'เบอร์มือถือหรือเลขประจำตัว 13 หลัก')}${txt('line_id', 'LINE OA', 'เช่น @paiduaygan')}
        ${txt('owner_phone', 'เบอร์เจ้าของ')}${num('pdpa_days', 'PDPA: ลบข้อมูลอ่อนไหวหลัง (วัน)')}</div></fieldset>
      <div class="savebar"><button class="btn" type="submit">บันทึกการตั้งค่า</button><span class="err" id="sf-err"></span></div>
    </form>`);
  $('#add-pkg').onclick = () => {
    const div = document.createElement('div');
    div.innerHTML = pkgRow({ key: '', name: '', hours: 4, price: 0, pay: 0 }, $$('[data-pkg]').length).s;
    $('#pkgs').append(div.firstElementChild);
  };
  $('#sf').addEventListener('submit', guard(async (ev) => {
    ev.preventDefault();
    $('#sf-err').textContent = '';
    const o = formData(ev.target);
    for (const k of ['key', 'name', 'hours', 'price', 'pay']) delete o[k];
    o.packages = $$('[data-pkg]').map((row) => ({
      key: $('[name=key]', row).value.trim(), name: $('[name=name]', row).value.trim(),
      hours: Number($('[name=hours]', row).value), price: Number($('[name=price]', row).value), pay: Number($('[name=pay]', row).value),
    })).filter((p) => p.key || p.name);
    for (const k of Object.keys(o)) if (typeof s[k] === 'number') o[k] = Number(o[k]);
    try {
      await api('settings', { method: 'PUT', body: o });
      toast('บันทึกการตั้งค่าแล้ว');
      settings();
    } catch (e) { $('#sf-err').textContent = e.message; throw e; }
  }));
}

// ---------- PDPA ----------
async function pdpa() {
  const p = await api('pdpa');
  mount(html`
    <h1>PDPA: ลบข้อมูลอ่อนไหว</h1>
    <div class="card stack">
      <p>ลบ <b>ข้อมูลสุขภาพ เบอร์ผู้สูงอายุ เบอร์ฉุกเฉิน ที่อยู่ และลิงก์แผนที่</b> ของนัดที่ <b>เสร็จสิ้นหรือยกเลิกแล้ว</b> และวันนัดเก่ากว่าจำนวนวันที่กำหนด ข้อมูลเงินและชื่อยังเก็บไว้สำหรับบัญชี ลบแล้วกู้คืนไม่ได้</p>
      <form id="pf" class="row"><label style="flex:1 1 200px">เก่ากว่า (วัน) <input type="number" name="days" min="30" max="3650" value="${p.days}"></label>
        <button class="btn ghost" type="submit" style="align-self:end">ตรวจสอบ</button></form>
      <div id="pdpa-result" class="note">นัดก่อน ${thDate(p.before)} ที่ยังไม่ได้ลบ: <b>${p.count}</b> รายการ · ลบไปแล้วทั้งหมด ${p.already} รายการ</div>
      <div id="pdpa-confirm"></div>
    </div>`);
  const render = (r) => {
    $('#pdpa-result').innerHTML = html`นัดก่อน ${thDate(r.before)} ที่ยังไม่ได้ลบ: <b>${r.count}</b> รายการ · ลบไปแล้วทั้งหมด ${r.already} รายการ`.s;
    const box = $('#pdpa-confirm');
    box.innerHTML = r.count ? html`<button class="btn danger" type="button" id="pdpa-go">ลบข้อมูล ${r.count} รายการ…</button>`.s : '';
    const go = $('#pdpa-go');
    if (go) go.onclick = () => confirmInline(go, `ลบข้อมูลอ่อนไหวของ ${r.count} นัดถาวร?`, async () => {
      const res = await api('pdpa/anonymize', { method: 'POST', body: { days: r.days, confirm: true } });
      toast(`ลบข้อมูลแล้ว ${res.anonymized} รายการ`);
      pdpa();
    }, 'ลบถาวร');
  };
  render(p);
  $('#pf').addEventListener('submit', guard(async (ev) => { ev.preventDefault(); render(await api('pdpa?days=' + ev.target.days.value)); }));
}

// ---------- router ----------
const ROUTES = [
  [/^\/?$/, dashboard],
  [/^\/bookings$/, (m, p) => bookings(p)],
  [/^\/booking\/(\d+)$/, (m) => bookingDetail(m[1])],
  [/^\/calendar$/, (m, p) => calendar(p)],
  [/^\/assistants$/, assistants],
  [/^\/assistant\/(new|\d+)$/, (m) => assistantForm(m[1])],
  [/^\/payouts$/, (m, p) => payouts(p)],
  [/^\/customers$/, (m, p) => customers(p)],
  [/^\/expenses$/, (m, p) => expenses(p)],
  [/^\/reports$/, (m, p) => reports(p)],
  [/^\/qr$/, qrPage],
  [/^\/settings$/, settings],
  [/^\/pdpa$/, pdpa],
];
async function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query] = h.split('?');
  const params = new URLSearchParams(query || '');
  const section = '#/' + (path.split('/')[1] || '');
  for (const a of $$('#nav a')) {
    const href = a.getAttribute('href');
    const on = href === section || (section === '#/booking' && href === '#/bookings') || (section === '#/assistant' && href === '#/assistants');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  $('#nav').classList.remove('open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
  for (const [re, fn] of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    try {
      await fn(m, params);
      document.title = ($('#view h1')?.textContent || 'หลังบ้าน') + ' · ไปด้วยกัน';
      $('#view').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.status !== 401) mount(html`<div class="alert">${e.message || 'โหลดไม่สำเร็จ'}</div>`);
    }
    return;
  }
  mount(html`<p>ไม่พบหน้านี้ <a href="#/">กลับแดชบอร์ด</a></p>`);
}
window.addEventListener('hashchange', route);

(async function init() {
  try {
    await api('session');
    showApp();
    route();
  } catch (e) {
    if (e.status !== 401) { showLogin(); $('#login-error').textContent = e.message; }
  }
})();
