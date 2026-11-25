import { validateBooking, DISTRICTS, RELATIONSHIPS, MOBILITY, COMMUNICATION, FASTING, TRANSPORT, HEARD_FROM, PURPOSES, OTHER_PURPOSE, isMedical, isEveningStart } from '../shared/booking-rules.js';
import { estimate } from '../shared/pricing.js';

const $ = (s, el = document) => el.querySelector(s);
const form = $('#book');
const baht = (n) => Number(n).toLocaleString('th-TH');
let config = null;
let full = new Set();
let viewMonth = null; // 'YYYY-MM'

function option(sel, values) {
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.append(o);
  }
}
function radios(container, name, entries) {
  for (const [value, label] of entries) {
    const l = document.createElement('label');
    const i = document.createElement('input');
    i.type = 'radio'; i.name = name; i.value = value;
    l.append(i, document.createTextNode(label));
    container.append(l);
  }
}

function setLineId(id) {
  const url = 'https://line.me/R/ti/p/' + encodeURIComponent(id);
  for (const a of document.querySelectorAll('#line-link, #done-line')) a.href = url;
  for (const s of document.querySelectorAll('.line-id')) s.textContent = id;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function loadAvailability() {
  const a = await getJson('/api/availability');
  full = new Set(a.full);
  config.minDate = a.minDate; config.maxDate = a.maxDate;
}

// ---------- calendar ----------
const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function shiftMonth(ym, n) {
  const d = new Date(ym + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
function renderCalendar() {
  const cal = $('#cal');
  const selected = form.date.value;
  const ym = viewMonth;
  const first = new Date(ym + '-01T00:00:00Z');
  const startDow = first.getUTCDay();
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const minM = config.minDate.slice(0, 7), maxM = config.maxDate.slice(0, 7);
  cal.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'cal-head';
  const prev = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost sm', textContent: '‹', disabled: ym <= minM });
  prev.setAttribute('aria-label', 'เดือนก่อน');
  const next = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost sm', textContent: '›', disabled: ym >= maxM });
  next.setAttribute('aria-label', 'เดือนถัดไป');
  prev.onclick = () => { viewMonth = shiftMonth(ym, -1); renderCalendar(); };
  next.onclick = () => { viewMonth = shiftMonth(ym, 1); renderCalendar(); };
  const title = document.createElement('b');
  title.textContent = `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear() + 543}`;
  head.append(prev, title, next);
  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const d of DOW) grid.append(Object.assign(document.createElement('span'), { className: 'dow', textContent: d }));
  for (let i = 0; i < startDow; i++) grid.append(document.createElement('span'));
  for (let day = 1; day <= days; day++) {
    const ymd = `${ym}-${String(day).padStart(2, '0')}`;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = day;
    b.dataset.date = ymd;
    const tooEarly = ymd < config.minDate || ymd > config.maxDate;
    const isFull = full.has(ymd);
    b.disabled = tooEarly || isFull;
    if (isFull && !tooEarly) { b.classList.add('full'); b.title = 'คิวเต็ม'; b.setAttribute('aria-label', `${day} คิวเต็ม`); }
    b.setAttribute('aria-pressed', String(ymd === selected));
    b.onclick = () => { form.date.value = ymd; clearError('date'); renderCalendar(); };
    grid.append(b);
  }
  cal.append(head, grid);
  const sel = selected ? `เลือกแล้ว: ${selected.slice(8)} ${MONTHS[Number(selected.slice(5, 7)) - 1]} ${Number(selected.slice(0, 4)) + 543}` : 'ยังไม่ได้เลือกวัน';
  cal.append(Object.assign(document.createElement('p'), { className: 'small muted', textContent: sel }));
}

// ---------- estimate ----------
function updateEstimate() {
  const key = form.package_key.value;
  const outer = (config.outer_districts || []).includes(form.district.value);
  const promo = config.promo_remaining > 0 && config.promo_percent > 0;
  const second = form.second_person.checked;
  const evening = isEveningStart(form.start_time.value);
  const e = key ? estimate(config, key, { outer, promo, second, evening }) : null;
  if (!e) { $('#est-total').textContent = '-'; $('#est-note').textContent = 'เลือกแพ็กเกจเพื่อดูราคา'; return; }
  $('#est-total').textContent = baht(e.total);
  const notes = [];
  if (second) notes.push(`รวมค่าท่านที่ 2 (+${config.second_person_surcharge_percent}%)`);
  if (outer) notes.push(`รวมค่าเขตชานเมือง ${baht(config.surcharge_customer)} บาท`);
  if (evening) notes.push(`รวมค่าช่วงเย็น ${baht(config.evening_surcharge)} บาท`);
  if (promo) notes.push(`โปรเปิดตัว ลด ${config.promo_percent}% สำหรับ ${config.promo_remaining} ครอบครัวแรกที่เหลือ ถ้าได้สิทธิ์จ่าย ${baht(e.promo_total)} บาท`);
  notes.push(`ไม่รวมค่ารถตามจริง เกินเวลา ${baht(config.ot_customer)} บาท/${config.ot_block_min} นาที เริ่มก่อน 06:30 บวก ${baht(config.surcharge_customer)} บาท และกลับบ้านหลัง 20:00 บวก ${baht(config.evening_surcharge)} บาท`);
  $('#est-note').textContent = notes.join(' · ');
}

// ---------- errors ----------
function clearError(field) {
  const e = $('#err-' + field);
  if (e) e.textContent = '';
  const el = form.elements[field];
  if (el && el.setAttribute) el.removeAttribute('aria-invalid');
}
function showErrors(errors) {
  for (const el of form.querySelectorAll('.err')) el.textContent = '';
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  let first = null;
  for (const [field, msg] of Object.entries(errors)) {
    const e = $('#err-' + field);
    if (e) e.textContent = msg;
    const el = form.elements[field];
    const target = el && (el.length && !el.tagName ? el[0] : el);
    if (target && target.setAttribute && target.type !== 'hidden') target.setAttribute('aria-invalid', 'true');
    const anchor = field === 'date' ? $('#cal') : target && target.type !== 'hidden' ? target : e;
    if (!first && anchor) first = anchor;
  }
  if (first) {
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (first.focus) first.focus({ preventScroll: true });
  }
}

function syncPurpose() {
  const p = form.purpose.value;
  $('#purpose-other').classList.toggle('hidden', p !== OTHER_PURPOSE);
  const med = isMedical(p);
  $('#fasting-group').classList.toggle('hidden', !med);
  if (!med) for (const r of form.querySelectorAll('input[name=fasting]')) r.checked = false;
}

function collect() {
  const fd = new FormData(form);
  const o = {};
  for (const [k, v] of fd.entries()) o[k] = typeof v === 'string' ? v : '';
  for (const k of ['consent_terms', 'consent_health', 'consent_elder', 'consent_photo']) o[k] = form.elements[k].checked;
  return o;
}

form.addEventListener('input', (ev) => { if (ev.target.name) clearError(ev.target.name); });
form.addEventListener('change', (ev) => {
  if (ev.target.name) clearError(ev.target.name);
  if (ev.target.name === 'communication') $('#comm-other').classList.toggle('hidden', ev.target.value !== 'อื่น ๆ');
  if (ev.target.name === 'purpose') syncPurpose();
  updateEstimate();
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#form-error').classList.add('hidden');
  const data = collect();
  const { errors } = validateBooking(data, { minDate: config.minDate, maxDate: config.maxDate, packageKeys: config.packages.map((p) => p.key) });
  if (form.date.value && full.has(form.date.value)) errors.date = 'วันนี้คิวเต็มแล้ว กรุณาเลือกวันอื่น';
  if (Object.keys(errors).length) { showErrors(errors); return; }
  const btn = $('#submit');
  btn.disabled = true; btn.textContent = 'กำลังส่ง...';
  try {
    const r = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const res = await r.json().catch(() => ({}));
    if (r.ok && res.ok) return showDone(res);
    if (r.status === 409) { await loadAvailability().catch(() => {}); renderCalendar(); }
    if (res.errors) showErrors(res.errors);
    const box = $('#form-error');
    box.textContent = res.error || 'ส่งไม่สำเร็จ กรุณาลองใหม่ หรือทักทาง LINE';
    box.classList.remove('hidden');
  } catch {
    const box = $('#form-error');
    box.textContent = 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่';
    box.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'ส่งคำขอจอง';
  }
});

function showDone(res) {
  const s = res.summary;
  $('#form-area').classList.add('hidden');
  const done = $('#done');
  done.classList.remove('hidden');
  $('#done-code').textContent = res.code;
  const dl = $('#done-summary');
  dl.innerHTML = '';
  const rows = [
    ['วันนัด', `${s.date_label} ถึงปลายทาง ${s.start_time}`],
    ['ธุระ', s.purpose],
    ['ปลายทาง', s.destination + (s.stops ? ` (แวะ ${s.stops.split('\n').join(', ')})` : '')],
    ['ผู้สูงอายุ', s.elder_name + (s.second_person ? ' และผู้ร่วมเดินทางอีก 1 ท่าน' : '')],
    ['เขต', s.district],
    ['แพ็กเกจ', s.package_name],
    ['ราคาประมาณ', `${baht(s.estimate)} บาท` + (s.promo_percent ? ` (ถ้าได้สิทธิ์โปรเปิดตัว ลด ${s.promo_percent}%)` : '') + ' ไม่รวมค่ารถและค่าเกินเวลา'],
  ];
  for (const [k, v] of rows) {
    dl.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
  }
  $('#done-confirm').textContent = `เราจะยืนยันคิวทาง LINE ภายใน ${res.confirm_within} (ตอบกลับก่อน 08:30 และหลัง 18:00) ถ้ายังไม่ได้เพิ่มเพื่อน กดปุ่มด้านล่างแล้วส่งรหัส ${res.code} มาได้เลยค่ะ`;
  setLineId(res.line_id);
  window.scrollTo(0, 0);
  done.focus();
}

async function init() {
  try {
    config = await getJson('/api/config');
    await loadAvailability();
  } catch {
    const e = $('#load-error');
    e.textContent = 'โหลดข้อมูลการจองไม่สำเร็จ กรุณารีเฟรชหน้า หรือจองทาง LINE';
    e.classList.remove('hidden');
    $('#submit').disabled = true;
    return;
  }
  setLineId(config.line_id);
  option(form.relationship, RELATIONSHIPS);
  option(form.district, DISTRICTS);
  option(form.heard_from, HEARD_FROM);
  option(form.purpose, PURPOSES);
  $('#second-hint').textContent = `ค่าบริการและค่าผู้ช่วย +${config.second_person_surcharge_percent}%`;
  radios($('#mobility'), 'mobility', MOBILITY.map((v) => [v, v]));
  radios($('#communication'), 'communication', COMMUNICATION.map((v) => [v, v]));
  radios($('#fasting'), 'fasting', Object.entries(FASTING));
  radios($('#transport'), 'transport_mode', Object.entries(TRANSPORT));
  const pk = $('#packages');
  for (const p of config.packages) {
    const l = document.createElement('label');
    const i = Object.assign(document.createElement('input'), { type: 'radio', name: 'package_key', value: p.key });
    const t = document.createElement('span');
    t.textContent = `${p.name} · สูงสุด ${p.hours} ชม.`;
    const pr = Object.assign(document.createElement('span'), { className: 'p', textContent: `${baht(p.price)} บาท` });
    l.append(i, t, pr);
    pk.append(l);
  }
  $('#date-hint').textContent = `จองล่วงหน้าอย่างน้อย ${config.lead_days} วัน วันที่กดไม่ได้คือคิวเต็มหรือจองไม่ทันแล้ว`;
  viewMonth = config.minDate.slice(0, 7);
  renderCalendar();
  updateEstimate();
}
init();


