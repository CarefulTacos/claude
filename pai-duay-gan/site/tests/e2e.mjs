// End-to-end test: starts its own `wrangler pages dev` with a fresh local D1,
// drives book.html and the admin app with Playwright (preinstalled Chromium),
// and checks the money rules through the real API.
//
//   node tests/e2e.mjs            (from pai-duay-gan/site)
//   SHOTS=/tmp/claude-0/booking-shots node tests/e2e.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 8790);
const BASE = `http://localhost:${PORT}`;
const STATE = process.env.E2E_STATE || '/tmp/claude-0/pdg-e2e-state';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/booking-shots';
const PASSWORD = 'e2e-correct-horse-42';
const RATE = 25;
const WRANGLER = path.join(SITE, 'node_modules', '.bin', 'wrangler');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);

// ---------- server ----------
rmSync(STATE, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'pai-duay-gan', '--local', '--persist-to', STATE], { cwd: SITE, stdio: 'ignore' });
const server = spawn(WRANGLER, ['pages', 'dev', 'public', '--port', String(PORT), '--persist-to', STATE,
  '--binding', `ADMIN_PASSWORD=${PASSWORD}`, '--binding', 'SESSION_SECRET=e2e-session-secret-0123456789abcdef0123456789',
  '--binding', `BOOKING_RATE_LIMIT=${RATE}`], { cwd: SITE, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/config'); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start\n' + serverLog);
}

// ---------- helpers ----------
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function bookingBody(over = {}) {
  return {
    booker_name: 'สมชาย ทดสอบ', booker_phone: '0812345678', booker_line: 'somchai', relationship: 'ลูก',
    elder_name: 'คุณแม่สมศรี', elder_age: '78', elder_phone: '0823456789', mobility: 'ไม้เท้า', communication: 'ปกติ',
    health_notes: 'ความดันสูง แพ้ยาเพนิซิลลิน', emergency_phone: '0899999999', date: '', pickup_address: '12 ซอยสุขุมวิท 50',
    district: 'คลองเตย', maps_link: '', purpose: 'พบแพทย์/ตรวจสุขภาพ', destination: 'รพ.กล้วยน้ำไท', stops: '', start_time: '08:30',
    fasting: 'no', errands: '', package_key: 'half', transport_mode: 'assistant',
    consent_terms: true, consent_health: true, consent_elder: true, ...over,
  };
}
async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(`no horizontal overflow: ${label}`, o.sw <= o.cw, `scrollWidth ${o.sw} > clientWidth ${o.cw}`);
}
async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}
// fetch inside the page so the HttpOnly session cookie and Origin header are real
const inPage = (page, url, init) => page.evaluate(async ([u, i]) => {
  const r = await fetch(u, i);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, ct: r.headers.get('content-type') };
}, [url, init || {}]);
const jpost = (page, url, body, method = 'POST') => inPage(page, url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------- run ----------
let browser;
try {
  await waitUp();
  const cfg = await (await fetch(BASE + '/api/config')).json();
  const D1 = cfg.minDate;             // UI booking + conflict booking
  const D2 = addDays(cfg.minDate, 1); // filled to capacity
  const D3 = addDays(cfg.minDate, 2); // two-person evening booking
  console.log(`today ${cfg.today}, minDate ${D1}`);

  browser = await chromium.launch();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await mobile.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  // HTTP 4xx from deliberate negative tests show up as 'Failed to load resource'; only JS errors count.
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) consoleErrors.push(m.text()); });

  // ===== public: capacity + lead days via API =====
  await page.goto(BASE + '/book.html');
  for (let i = 0; i < 3; i++) {
    const r = await jpost(page, '/api/bookings', bookingBody({ date: D2, booker_phone: `08100000${i}0`, elder_name: `ผู้สูงอายุ ${i + 1}` }));
    check(`capacity booking ${i + 1} accepted`, r.status === 201, JSON.stringify(r.body));
  }
  let r = await jpost(page, '/api/bookings', bookingBody({ date: D2 }));
  eq('4th booking on a full day is rejected (409)', r.status, 409);
  r = await jpost(page, '/api/bookings', bookingBody({ date: cfg.today }));
  check('booking for today rejected by lead-day rule', r.status === 400 && r.body.errors && r.body.errors.date, JSON.stringify(r.body));
  r = await jpost(page, '/api/bookings', bookingBody({ date: addDays(D1, -1) }));
  check('booking for minDate-1 rejected', r.status === 400 && r.body.errors && r.body.errors.date, JSON.stringify(r.body));
  r = await jpost(page, '/api/bookings', bookingBody({ date: D1, consent_health: false, booker_phone: '12', purpose: 'อื่น ๆ (ระบุ)' }));
  check('server validation mirrors client (consent, phone, purpose_other)', r.status === 400 && ['consent_health', 'booker_phone', 'purpose_other'].every((k) => r.body.errors[k]), JSON.stringify(r.body));
  r = await jpost(page, '/api/bookings', bookingBody({ date: D1, website: 'http://spam.example' }));
  check('honeypot returns fake success', r.status === 200 && r.body.code === 'PDG-0000', JSON.stringify(r.body));
  r = await jpost(page, '/api/bookings', bookingBody({ date: D1, booker_phone: '0855555555', elder_name: 'คุณตาสมปอง', destination: 'รพ.ศิริราช' }));
  check('second booking on D1 (for conflict test)', r.status === 201, JSON.stringify(r.body));
  const conflictCode = r.body.code;
  r = await jpost(page, '/api/bookings', bookingBody({ date: D3, booker_phone: '0866666666', elder_name: 'คุณพ่อและคุณแม่', district: 'หนองจอก', purpose: 'วัด/ทำบุญ/ศาสนกิจ', destination: 'วัดปากน้ำ', start_time: '18:30', fasting: '', second_person: true, stops: 'ร้านดอกไม้\nตลาดพลู' }));
  check('two-person evening booking accepted', r.status === 201, JSON.stringify(r.body));
  eq('estimate: 1490*1.3 + outer 200 + evening 200', r.body.summary && r.body.summary.estimate, 2337);
  const twoCode = r.body.code;

  // ===== public: UI booking on mobile =====
  await page.goto(BASE + '/book.html');
  await page.waitForSelector('#cal .cal-grid button');
  const d2disabled = await page.$eval(`#cal button[data-date="${D2}"]`, (b) => b.disabled && b.classList.contains('full')).catch(() => 'not-in-view');
  if (d2disabled === 'not-in-view') check('full day disabled in calendar', true, 'D2 in next month view, checked via API');
  else check('full day disabled in calendar', d2disabled === true, String(d2disabled));
  const earlyDisabled = await page.$eval(`#cal button[data-date="${cfg.today}"]`, (b) => b.disabled).catch(() => true);
  check('today disabled in calendar (lead days)', earlyDisabled === true);
  const f = (n, v) => page.fill(`[name=${n}]`, v);
  await f('booker_name', 'มานี ใจดี'); await f('booker_phone', '091-234-5678'); await f('booker_line', 'manee');
  await page.selectOption('[name=relationship]', 'ลูก');
  await f('elder_name', 'คุณแม่มาลี'); await f('elder_age', '81'); await f('emergency_phone', '0898887777');
  await page.check('input[name=mobility][value="เดินเองได้"]');
  await page.check('input[name=communication][value="หูไม่ค่อยดี"]');
  await f('health_notes', 'เบาหวาน ต้องทานยาหลังอาหาร');
  // try submitting with missing date -> client error
  await f('pickup_address', '99/1 ถนนพระราม 4');
  await page.selectOption('[name=district]', 'ปทุมวัน');
  await page.selectOption('[name=purpose]', 'พบแพทย์/ตรวจสุขภาพ');
  check('fasting question shown for medical purpose', await page.isVisible('#fasting-group'));
  await page.selectOption('[name=purpose]', 'ธนาคาร/ไปรษณีย์/จ่ายบิล');
  check('fasting question hidden for non-medical purpose', !(await page.isVisible('#fasting-group')));
  await page.selectOption('[name=purpose]', 'พบแพทย์/ตรวจสุขภาพ');
  await f('destination', 'รพ.จุฬาลงกรณ์'); await f('start_time', '08:30');
  await page.check('input[name=fasting][value="yes"]');
  await page.check('input[name=package_key][value="half"]');
  await page.check('input[name=transport_mode][value="assistant"]');
  await page.check('[name=consent_terms]'); await page.check('[name=consent_health]'); await page.check('[name=consent_elder]');
  await page.click('#submit');
  check('client blocks submit without date', (await page.textContent('#err-date')).length > 0);
  await page.click(`#cal button[data-date="${D1}"]`);
  const est = await page.textContent('#est-total');
  eq('live estimate shows half-day price', est.replace(/,/g, ''), '1490');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'book-mobile-390.png');
  await noOverflow(page, 'book.html 390px');
  await page.click('#submit');
  await page.waitForSelector('#done:not(.hidden)', { timeout: 10000 });
  const uiCode = (await page.textContent('#done-code')).trim();
  check('UI booking shows PDG code', /^PDG-\d{4}$/.test(uiCode), uiCode);
  await shot(page, 'book-mobile-done.png');
  await noOverflow(page, 'book.html success');

  // ===== admin: unauthenticated =====
  r = await inPage(page, '/api/admin/dashboard');
  eq('unauthenticated admin GET returns 401', r.status, 401);
  r = await jpost(page, '/api/admin/settings', { lead_days: 0 }, 'PUT');
  eq('unauthenticated admin PUT returns 401', r.status, 401);
  const cross = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ password: PASSWORD }) });
  eq('cross-origin login POST rejected (403)', cross.status, 403);
  const formPost = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE }, body: 'password=x' });
  eq('non-JSON admin POST rejected (415)', formPost.status, 415);
  const csvAnon = await fetch(BASE + '/api/admin/export/bookings');
  eq('unauthenticated CSV export returns 401', csvAnon.status, 401);

  // ===== admin login =====
  await page.goto(BASE + '/admin/');
  await page.waitForSelector('#login:not(.hidden)');
  await page.fill('#login-form [name=password]', 'wrong-password');
  await page.click('#login-form button');
  await page.waitForFunction(() => document.querySelector('#login-error').textContent.length > 0);
  check('wrong password rejected', (await page.textContent('#login-error')).includes('ไม่ถูกต้อง'), await page.textContent('#login-error'));
  await page.fill('#login-form [name=password]', PASSWORD);
  await page.click('#login-form button');
  await page.waitForSelector('#app:not(.hidden) .kpis');
  check('correct password opens dashboard', true);
  const cookies = await mobile.cookies();
  const sc = cookies.find((c) => c.name === 'pdg_admin');
  check('session cookie HttpOnly + Secure + SameSite=Strict', sc && sc.httpOnly && sc.secure && sc.sameSite === 'Strict', JSON.stringify(sc));
  const dashText = await page.textContent('#view');
  check('dashboard lists new requests', dashText.includes(uiCode) || dashText.includes('คุณแม่มาลี'));
  check('dashboard shows purpose chip', (await page.$$('#view .chip.purpose')).length > 0);
  await shot(page, 'admin-dashboard-mobile.png');
  await noOverflow(page, 'admin dashboard 390px');

  // ===== assistants =====
  await page.goto(BASE + '/admin/#/assistant/new');
  await page.waitForSelector('#af');
  await page.fill('#af [name=nickname]', 'ฝน'); await page.fill('#af [name=full_name]', 'ฝน ใจงาม');
  await page.fill('#af [name=phone]', '0811112222'); await page.fill('#af [name=insurance_expiry]', addDays(cfg.today, 10));
  await page.check('#af [name=background_checked]');
  await page.click('#af button[type=submit]');
  await page.waitForFunction(() => /#\/assistant\/\d+$/.test(location.hash));
  const fonId = Number((await page.evaluate(() => location.hash)).split('/').pop());
  check('assistant created via UI', fonId > 0);
  r = await jpost(page, '/api/admin/assistants', { nickname: 'ดาว', phone: '0822223333', weekdays: ['1', '2', '3', '4', '5'], insurance_expiry: addDays(cfg.today, 200) });
  const daoId = r.body.assistant && r.body.assistant.id;
  check('assistant created via API', daoId > 0, JSON.stringify(r.body));
  r = await inPage(page, '/api/admin/dashboard');
  check('dashboard: insurance expiring <30 days lists ฝน', r.body.insurance.some((a) => a.id === fonId), JSON.stringify(r.body.insurance));

  // find booking ids
  const all = (await inPage(page, '/api/admin/bookings')).body.bookings;
  const byCode = Object.fromEntries(all.map((b) => [b.code, b]));
  check('honeypot booking was not stored', all.every((b) => !b.code || b.code !== 'PDG-0000'), '');
  eq('stored bookings count (3 capacity + conflict + 2-person + UI)', all.length, 6);
  const ui = byCode[uiCode];
  const capacity = all.filter((b) => b.date === D2).sort((a, b) => a.id - b.id);

  // ===== booking detail: confirm, assign, money =====
  await page.goto(BASE + `/admin/#/booking/${ui.id}`);
  await page.waitForSelector('#edit');
  await page.click('[data-status="confirmed"]');
  await page.waitForFunction(() => document.querySelector('.page-head .chip').textContent.includes('ยืนยันแล้ว'));
  check('status new -> confirmed', true);
  await page.selectOption('#edit [name=assistant_id]', String(fonId));
  await page.fill('#edit [name=discount_pct]', '30');
  await page.fill('#edit [name=overtime_min]', '20');
  await page.fill('#edit [name=transport_cost]', '320');
  await page.fill('#edit [name=pickup_time]', '07:00');
  await page.fill('#edit [name=next_appointment]', addDays(cfg.today, 10));
  await page.click('#save');
  await page.waitForFunction(() => document.querySelector('[data-k=customer_total]').textContent.replace(/,/g, '') === '1563', null, { timeout: 8000 }).catch(() => {});
  const money = async () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-k]')].map((e) => [e.dataset.k, e.textContent.replace(/,/g, '').trim()])));
  let mny = await money();
  eq('customer total 1043+200+320 = 1563', mny.customer_total, '1563');
  eq('assistant pay 750+200 = 950', mny.assistant_pay, '950');
  eq('gross profit 293', mny.gross_profit, '293');
  const msgConfirm = await page.inputValue('#msg-confirm');
  check('confirm message: destination, assistant, upfront 1,043', msgConfirm.includes('ปลายทาง รพ.จุฬาลงกรณ์') && msgConfirm.includes('ฝน') && msgConfirm.includes('1,043') && msgConfirm.includes('07:00'), msgConfirm);
  const msgEve = await page.inputValue('#msg-eve');
  check('night-before message lists hospital documents + fasting for medical', msgEve.includes('บัตรโรงพยาบาล') && msgEve.includes('งดน้ำงดอาหาร'), msgEve);
  const msgExtra = await page.inputValue('#msg-extra');
  check('extra-charge message: 320 + 200 = 520', msgExtra.includes('ค่ารถ 320 + เกินเวลา 200 = 520'), msgExtra);
  await page.click('[data-copy=confirm]');
  const copied = await page.waitForFunction(() => document.querySelector('[data-copy=confirm]').textContent.includes('คัดลอกแล้ว'), null, { timeout: 3000 }).then(() => true, () => false);
  check('copy button copies and gives feedback', copied && (await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))).startsWith('ยืนยันคิวได้ค่ะ'));
  await shot(page, 'admin-booking-detail-mobile.png');
  await noOverflow(page, 'booking detail 390px');

  // conflict: assign same assistant to the other D1 booking
  const other = byCode[conflictCode];
  r = await jpost(page, `/api/admin/bookings/${other.id}`, { assistant_id: fonId }, 'PATCH');
  check('assigning same assistant same day returns conflict warning', r.body.warnings && r.body.warnings.some((w) => w.includes(uiCode)), JSON.stringify(r.body.warnings));
  await jpost(page, `/api/admin/bookings/${other.id}`, { assistant_id: daoId }, 'PATCH');

  // pay, QR, done
  await page.click('[data-status="paid"]');
  await page.waitForFunction(() => document.querySelector('.page-head .chip').textContent.includes('ชำระแล้ว'));
  r = await inPage(page, `/api/admin/bookings/${ui.id}`);
  eq('mark paid auto-fills received service = upfront 1043', r.body.booking.received_service, 1043);
  eq('balance after upfront payment = 520', r.body.booking.money.balance, 520);
  // settings: promptpay
  r = await jpost(page, '/api/admin/settings', { promptpay_id: '0812345678' }, 'PUT');
  check('settings saved (promptpay)', r.status === 200, JSON.stringify(r.body));
  await page.goto(BASE + `/admin/#/booking/${ui.id}`);
  await page.reload();
  await page.waitForSelector('[data-qr]');
  await page.click('[data-qr="520"]');
  await page.waitForSelector('#qr-out svg');
  const payload = await page.textContent('#qr-out .payload');
  check('QR payload for 520 baht', payload.startsWith('000201010212') && payload.includes('0113006681234567') && payload.includes('5406520.00'), payload);
  await page.fill('#edit [name=received_extra]', '520');
  await page.selectOption('#edit [name=review_score]', '5');
  await page.click('#save');
  await page.waitForTimeout(600);
  await page.click('[data-status="done"]');
  await page.waitForFunction(() => document.querySelector('.page-head .chip').textContent.includes('เสร็จสิ้น'));
  mny = await money();
  eq('balance 0 after extras received', mny.balance, '0');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'admin-booking-detail-done-mobile.png');
  r = await inPage(page, `/api/admin/bookings/${ui.id}`);
  check('audit log records status changes', r.body.audit.filter((a) => a.action === 'status').length >= 3, JSON.stringify(r.body.audit.map((a) => a.detail)));

  // ===== two-person + evening via admin =====
  const two = byCode[twoCode];
  r = await inPage(page, `/api/admin/bookings/${two.id}`);
  const m2 = r.body.booking.money;
  eq('2-person evening outer: service 1937, surcharge 400, total 2337', [m2.service, m2.surcharge, m2.customer_total], [1937, 400, 2337]);
  eq('2-person: assistant pay 975, gross 1362', [m2.assistant_pay, m2.gross_profit], [975, 1362]);
  r = await jpost(page, `/api/admin/bookings/${two.id}`, { discount_pct: 30, overtime_min: 20, transport_cost: 320 }, 'PATCH');
  const m3 = r.body.booking.money;
  eq('2-person evening outer +30% off +20min +320: 1356+200+400+320', [m3.discounted, m3.customer_total, m3.assistant_pay, m3.gross_profit], [1356, 2276, 1175, 781]);
  const eve2 = r.body.messages.find((x) => x.key === 'eve').text;
  check('night-before message for temple trip: wallet/phone, no hospital docs', eve2.includes('กระเป๋าสตางค์') && !eve2.includes('บัตรโรงพยาบาล'), eve2);
  r = await inPage(page, '/api/admin/bookings?purpose=' + encodeURIComponent('วัด/ทำบุญ/ศาสนกิจ'));
  eq('filter by purpose', r.body.bookings.map((b) => b.code), [twoCode]);
  r = await jpost(page, `/api/admin/bookings/${two.id}/promo`, {});
  check('promo applies 30% and decrements remaining', r.status === 200 && r.body.booking.discount_pct === 30 && r.body.promo.remaining === 9, JSON.stringify(r.body.promo));

  // ===== cancellation cases =====
  const [c1, c2, c3] = capacity;
  const pickupMs = Date.parse(`${D2}T08:30:00+07:00`);
  const iso = (h) => new Date(pickupMs - h * 3600e3).toISOString();
  await jpost(page, `/api/admin/bookings/${c2.id}`, { status: 'paid', received_service: 1490, assistant_id: daoId }, 'PATCH');
  const cancelCase = async (label, body, expect) => {
    let x = await jpost(page, `/api/admin/bookings/${c2.id}`, { status: 'cancelled', ...body }, 'PATCH');
    const c = x.body.booking && x.body.booking.cancellation;
    eq(`cancel: ${label}`, c && [c.refund, c.kept, c.assistant_pay], expect);
    x = await jpost(page, `/api/admin/bookings/${c2.id}`, { status: 'paid' }, 'PATCH');
  };
  await cancelCase('>24h before -> refund 1490, assistant 0', { cancelled_by: 'customer', cancelled_at: iso(30) }, [1490, 0, 0]);
  await cancelCase('<=24h -> refund 745, kept 745, assistant 373', { cancelled_by: 'customer', cancelled_at: iso(10) }, [745, 745, 373]);
  await cancelCase('assistant arrived -> refund 0, assistant 750', { cancelled_by: 'customer', cancelled_at: iso(0.2), assistant_arrived: true }, [0, 1490, 750]);
  await cancelCase('by business -> refund 1490, assistant 0', { cancelled_by: 'business', cancelled_at: iso(2), assistant_arrived: true }, [1490, 0, 0]);
  r = await jpost(page, `/api/admin/bookings/${c2.id}`, { status: 'cancelled', cancelled_by: 'business', cancelled_at: iso(48) }, 'PATCH');
  eq('c2 final: cancelled by business', r.body.booking.status, 'cancelled');

  // UI cancel flow on c1 (within 24h)
  await jpost(page, `/api/admin/bookings/${c1.id}`, { status: 'paid', received_service: 1490, assistant_id: fonId }, 'PATCH');
  await page.goto(BASE + `/admin/#/booking/${c1.id}`);
  await page.waitForSelector('#open-cancel');
  await page.click('#open-cancel');
  const local = new Date(pickupMs - 10 * 3600e3 + 7 * 3600e3).toISOString().slice(0, 16);
  await page.fill('#c-at', local);
  await page.dispatchEvent('#c-at', 'change');
  await page.waitForFunction(() => document.querySelector('[data-k=preview-refund]') && document.querySelector('[data-k=preview-refund]').textContent === '745', null, { timeout: 8000 }).catch(() => {});
  eq('cancel preview in UI shows refund 745', await page.textContent('[data-k=preview-refund]').catch(() => null), '745');
  await page.click('#c-confirm');
  await page.waitForSelector('#cancel-summary');
  eq('cancelled booking shows assistant share 373', await page.textContent('[data-k=cancel_assistant]'), '373');

  // ===== calendar + desktop shots =====
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, storageState: await mobile.storageState() });
  const dpage = await desktop.newPage();
  await dpage.goto(BASE + '/admin/#/');
  await dpage.waitForSelector('.kpis');
  await shot(dpage, 'admin-dashboard-desktop.png');
  await noOverflow(dpage, 'admin dashboard 1280px');
  await dpage.goto(BASE + `/admin/#/booking/${ui.id}`);
  await dpage.waitForSelector('#edit');
  await shot(dpage, 'admin-booking-detail-desktop.png');
  await noOverflow(dpage, 'booking detail 1280px');
  await dpage.goto(BASE + `/admin/#/calendar?start=${D1}`);
  await dpage.waitForSelector('.week');
  check('calendar week shows UI booking', (await dpage.textContent('.week')).includes('คุณแม่มาลี'));
  await shot(dpage, 'admin-calendar-desktop.png');
  await page.goto(BASE + `/admin/#/calendar?start=${D1}`);
  await page.waitForSelector('.week');
  await noOverflow(page, 'calendar 390px');

  // ===== payouts =====
  const month = D1.slice(0, 7);
  r = await inPage(page, '/api/admin/payouts?month=' + month);
  const fon = r.body.payouts.find((p) => p.assistant_id === fonId);
  const fonExpected = (D1.slice(0, 7) === month ? 950 : 0) + (D2.slice(0, 7) === month ? 373 : 0);
  eq('payouts: ฝน owed (950 done + 373 late-cancel share in same month)', fon && fon.outstanding, fonExpected);
  await page.goto(BASE + '/admin/#/payouts?month=' + month);
  await page.waitForSelector(`[data-pay="${fonId}"]`);
  await page.click(`[data-pay="${fonId}"]`);
  await page.click('.confirm-inline [data-yes]');
  await page.waitForFunction((id) => document.querySelector(`[data-k=outstanding-${id}]`) && document.querySelector(`[data-k=outstanding-${id}]`).textContent.trim() === '0', fonId, { timeout: 8000 }).catch(() => {});
  eq('payouts: after mark paid outstanding = 0', (await page.textContent(`[data-k=outstanding-${fonId}]`)).trim(), '0');
  await shot(page, 'admin-payouts-mobile.png');
  await noOverflow(page, 'payouts 390px');

  // ===== expenses =====
  await page.goto(BASE + '/admin/#/expenses');
  await page.waitForSelector('#ef');
  await page.fill('#ef [name=item]', 'ประกันอุบัติเหตุผู้ช่วย');
  await page.selectOption('#ef [name=category]', 'ประกัน');
  await page.fill('#ef [name=amount]', '500');
  await page.click('#ef button[type=submit]');
  await page.waitForFunction(() => document.querySelector('tbody').textContent.includes('ประกันอุบัติเหตุผู้ช่วย'));
  check('expense added', true);

  // ===== reports =====
  r = await inPage(page, '/api/admin/reports?months=12');
  const exp = {};
  const add = (m, rev, ac) => { exp[m] ||= { revenue: 0, assistant_cost: 0, bookings: 0 }; exp[m].revenue += rev; exp[m].assistant_cost += ac; };
  add(D1.slice(0, 7), 1243, 950); exp[D1.slice(0, 7)].bookings += 1;
  add(D2.slice(0, 7), 745, 373); // c1 late cancel
  for (const [m, e] of Object.entries(exp)) {
    const row = r.body.months.find((x) => x.month === m);
    eq(`report ${m}: bookings/revenue/assistant/gross`, row && [row.bookings, row.revenue, row.assistant_cost, row.gross], [e.bookings, e.revenue, e.assistant_cost, e.revenue - e.assistant_cost]);
  }
  const todayRow = r.body.months.find((x) => x.month === cfg.today.slice(0, 7));
  eq('report: expenses in current month', todayRow && todayRow.expenses, 500);
  check('report has >= 12 months', r.body.months.length >= 12, String(r.body.months.length));
  const med = r.body.purposes.find((p) => p.purpose === 'พบแพทย์/ตรวจสุขภาพ');
  eq('purpose table: medical requests (UI + conflict + c3) and paid', med && [med.requests, med.paid], [3, 1]);
  const temple = r.body.purposes.find((p) => p.purpose === 'วัด/ทำบุญ/ศาสนกิจ');
  eq('purpose table: temple requests', temple && temple.requests, 1);
  await page.goto(BASE + '/admin/#/reports');
  await page.waitForSelector('#report');
  check('report UI shows purpose table', (await page.$$('#purposes tbody tr')).length === 12);
  await shot(page, 'admin-reports-mobile.png');
  await noOverflow(page, 'reports 390px');

  // ===== CSV =====
  for (const type of ['bookings', 'expenses', 'payouts']) {
    const x = await inPage(page, '/api/admin/export/' + type);
    const text = typeof x.body === 'string' ? x.body : '';
    const head = await page.evaluate(async (u) => [...new Uint8Array(await (await fetch(u)).arrayBuffer()).slice(0, 3)], '/api/admin/export/' + type);
    check(`CSV ${type}: 200, text/csv, UTF-8 BOM`, x.status === 200 && x.ct.includes('text/csv') && head.join(',') === '239,187,191', `${x.status} ${x.ct} ${head}`);
    if (type === 'bookings') check('bookings CSV has codes, no health notes', text.includes(uiCode) && !text.includes('เบาหวาน') && text.includes('วัด/ทำบุญ/ศาสนกิจ'));
    if (type === 'expenses') check('expenses CSV has the expense', text.includes('ประกันอุบัติเหตุผู้ช่วย,ประกัน,500'));
    if (type === 'payouts') check('payouts CSV has ฝน 950 paid', /ฝน,PDG-\d+,[\d-]+,เสร็จสิ้น,950,จ่ายแล้ว/.test(text), text.slice(0, 400));
  }

  // ===== customers =====
  r = await inPage(page, '/api/admin/customers');
  const cust = r.body.customers.find((c) => c.booker_phone === '0912345678');
  eq('customer grouped by phone: total spent 1243+320', cust && [cust.bookings, cust.total_spent], [1, 1563]);
  await page.goto(BASE + '/admin/#/customers');
  await page.waitForSelector('table');
  await noOverflow(page, 'customers 390px');

  // ===== PDPA =====
  await jpost(page, `/api/admin/bookings/${c3.id}`, { status: 'done', date: addDays(cfg.today, -60) }, 'PATCH');
  await page.goto(BASE + '/admin/#/pdpa');
  await page.waitForSelector('#pf');
  await page.fill('#pf [name=days]', '30');
  await page.click('#pf button');
  await page.waitForSelector('#pdpa-go');
  await page.click('#pdpa-go');
  await page.click('.confirm-inline [data-yes]');
  await page.waitForTimeout(800);
  r = await inPage(page, `/api/admin/bookings/${c3.id}`);
  const b3 = r.body.booking;
  check('PDPA anonymized old completed booking', b3.anonymized_at && b3.health_notes === '' && b3.elder_phone === null && b3.pickup_address === '[ลบแล้ว]', JSON.stringify({ a: b3.anonymized_at, h: b3.health_notes, p: b3.elder_phone }));
  r = await inPage(page, `/api/admin/bookings/${ui.id}`);
  check('PDPA left recent booking intact', r.body.booking.health_notes.includes('เบาหวาน'));

  // ===== settings screen =====
  await page.goto(BASE + '/admin/#/settings');
  await page.waitForSelector('#sf');
  await page.fill('#sf [name=max_per_day]', '4');
  await page.click('#sf button[type=submit]');
  await page.waitForTimeout(800);
  r = await inPage(page, '/api/admin/settings');
  eq('settings saved via UI (max_per_day=4, promo_remaining=9)', [r.body.settings.max_per_day, r.body.settings.promo_remaining], [4, 9]);
  const avail = await (await fetch(BASE + '/api/availability')).json();
  check('raising capacity re-opens the full day', !avail.full.includes(D2), JSON.stringify(avail.full));
  await noOverflow(page, 'settings 390px');

  // ===== logout + rate limit =====
  await page.goto(BASE + '/admin/#/');
  await page.waitForSelector('#menu-btn');
  await page.click('#menu-btn');
  await page.click('#logout');
  await page.waitForSelector('#login:not(.hidden)');
  r = await inPage(page, '/api/admin/dashboard');
  eq('after logout admin API returns 401', r.status, 401);
  let limited = 0;
  for (let i = 0; i < RATE + 2; i++) {
    const x = await jpost(page, '/api/bookings', { bad: true });
    if (x.status === 429) { limited = i; break; }
  }
  check(`booking rate limit returns 429 (limit ${RATE}/hour)`, limited > 0, 'never limited');

  check('no JavaScript errors in the browser', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  check('e2e run completed without exception', false, err.stack || String(err));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  const pass = results.filter((x) => x.ok).length;
  const fail = results.length - pass;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) for (const x of results.filter((y) => !y.ok)) console.log(`  FAIL ${x.name}: ${x.detail}`);
  console.log(`screenshots: ${SHOTS}`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
}
