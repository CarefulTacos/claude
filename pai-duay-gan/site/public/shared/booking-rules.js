// Booking form options and validation, shared by book.html and POST /api/bookings.

export const CONSENT_VERSION = 'terms-privacy-draft-2026-11-25';

export const DISTRICTS = [
  'พระนคร', 'ดุสิต', 'หนองจอก', 'บางรัก', 'บางเขน', 'บางกะปิ', 'ปทุมวัน', 'ป้อมปราบศัตรูพ่าย', 'พระโขนง', 'มีนบุรี',
  'ลาดกระบัง', 'ยานนาวา', 'สัมพันธวงศ์', 'พญาไท', 'ธนบุรี', 'บางกอกใหญ่', 'ห้วยขวาง', 'คลองสาน', 'ตลิ่งชัน', 'บางกอกน้อย',
  'บางขุนเทียน', 'ภาษีเจริญ', 'หนองแขม', 'ราษฎร์บูรณะ', 'บางพลัด', 'ดินแดง', 'บึงกุ่ม', 'สาทร', 'บางซื่อ', 'จตุจักร',
  'บางคอแหลม', 'ประเวศ', 'คลองเตย', 'สวนหลวง', 'จอมทอง', 'ดอนเมือง', 'ราชเทวี', 'ลาดพร้าว', 'วัฒนา', 'บางแค',
  'หลักสี่', 'สายไหม', 'คันนายาว', 'สะพานสูง', 'วังทองหลาง', 'คลองสามวา', 'บางนา', 'ทวีวัฒนา', 'ทุ่งครุ', 'บางบอน',
].sort((a, b) => a.localeCompare(b, 'th'));

export const PURPOSES = [
  'พบแพทย์/ตรวจสุขภาพ', 'ทันตกรรม/กายภาพ/ตรวจตา', 'ธนาคาร/ไปรษณีย์/จ่ายบิล',
  'ติดต่อราชการ (บัตร/ทะเบียน/เบี้ยผู้สูงอายุ)', 'ซื้อของ/ตลาด/ห้าง', 'ทำผม/ทำเล็บ/สปา', 'วัด/ทำบุญ/ศาสนกิจ',
  'งานครอบครัว/งานแต่ง/งานศพ', 'เยี่ยมเพื่อน/ญาติ', 'เดินเล่น/คาเฟ่/ออกกำลังกาย', 'ส่ง-รับสนามบิน/สถานีรถ', 'อื่น ๆ (ระบุ)',
];
export const OTHER_PURPOSE = 'อื่น ๆ (ระบุ)';
/** Purposes where the fasting question applies. */
export const MEDICAL_PURPOSES = PURPOSES.slice(0, 2);
/** Purposes where the night-before reminder lists documents to bring. */
export const DOCUMENT_PURPOSES = [PURPOSES[0], PURPOSES[1], PURPOSES[3]];
export const isMedical = (p) => MEDICAL_PURPOSES.includes(p);
/** Evening surcharge applies to pickups at/after 18:00 (returns after 20:00 are flagged by the owner). */
export const isEveningStart = (t) => typeof t === 'string' && t >= '18:00';

export const RELATIONSHIPS = ['ลูก', 'หลาน', 'คู่สมรส', 'ญาติ', 'เพื่อน/เพื่อนบ้าน', 'ผู้สูงอายุจองเอง', 'อื่น ๆ'];
export const MOBILITY = ['เดินเองได้', 'ไม้เท้า', 'วีลแชร์ของตัวเอง', 'วีลแชร์ของโรงพยาบาล'];
export const COMMUNICATION = ['ปกติ', 'หูไม่ค่อยดี', 'หลงลืมบางครั้ง', 'อื่น ๆ'];
export const FASTING = { yes: 'ต้องงดน้ำงดอาหาร', no: 'ไม่ต้องงด', unsure: 'ไม่แน่ใจ' };
export const TRANSPORT = { assistant: 'ผู้ช่วยเรียกแท็กซี่/แอป (ค่ารถตามจริง)', family: 'ครอบครัวมีคนขับ' };
export const HEARD_FROM = ['Facebook', 'Instagram', 'LINE', 'Google', 'เพื่อนหรือคนรู้จักแนะนำ', 'ใบปลิว', 'โรงพยาบาล', 'อื่น ๆ'];

// ---- Bangkok calendar helpers (UTC+7, no daylight saving) ----
export function bkkToday(nowMs = Date.now()) {
  return new Date(nowMs + 7 * 3600e3).toISOString().slice(0, 10);
}
export function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function normalizePhone(s) {
  const d = String(s || '').replace(/[^\d+]/g, '').replace(/^\+66/, '0').replace(/\D/g, '');
  return /^0\d{8,9}$/.test(d) ? d : null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/**
 * Validate a booking request. Returns { errors: {field: message}, value }.
 * ctx: { minDate, maxDate, packageKeys }
 */
export function validateBooking(input, ctx) {
  const e = {};
  const v = {};
  const text = (field, max, { required = false, label = 'ข้อมูลนี้' } = {}) => {
    const s = str(input[field]);
    if (required && !s) e[field] = `กรุณากรอก${label}`;
    else if (s.length > max) e[field] = `${label}ยาวเกิน ${max} ตัวอักษร`;
    v[field] = s;
  };
  const oneOf = (field, list, label, required = true) => {
    const s = str(input[field]);
    if (!s && !required) { v[field] = ''; return; }
    if (!list.includes(s)) e[field] = `กรุณาเลือก${label}`;
    v[field] = s;
  };
  const phone = (field, label, required) => {
    const raw = str(input[field]);
    if (!raw && !required) { v[field] = ''; return; }
    const p = normalizePhone(raw);
    if (!p) e[field] = `${label}ไม่ถูกต้อง (เช่น 0812345678)`;
    v[field] = p || raw;
  };

  // ผู้จอง
  text('booker_name', 100, { required: true, label: 'ชื่อผู้จอง' });
  phone('booker_phone', 'เบอร์โทรผู้จอง', true);
  text('booker_line', 100, { required: true, label: 'ชื่อ LINE' });
  oneOf('relationship', RELATIONSHIPS, 'ความเกี่ยวข้องกับผู้สูงอายุ');

  // ผู้สูงอายุ
  text('elder_name', 100, { required: true, label: 'ชื่อที่ให้ผู้ช่วยเรียก' });
  const age = Number(str(input.elder_age));
  if (!Number.isInteger(age) || age < 18 || age > 120) e.elder_age = 'กรุณากรอกอายุเป็นตัวเลข';
  v.elder_age = Number.isInteger(age) ? age : null;
  phone('elder_phone', 'เบอร์โทรผู้สูงอายุ', false);
  oneOf('mobility', MOBILITY, 'การเดิน');
  oneOf('communication', COMMUNICATION, 'การสื่อสาร');
  text('communication_other', 200, { label: 'รายละเอียดการสื่อสาร' });
  if (v.communication === 'อื่น ๆ' && !v.communication_other) e.communication_other = 'กรุณาอธิบายสั้น ๆ';
  text('health_notes', 1000, { label: 'ข้อมูลสุขภาพ' });
  phone('emergency_phone', 'เบอร์ติดต่อฉุกเฉิน', true);

  // นัดหมาย
  const date = str(input.date);
  if (!isYmd(date)) e.date = 'กรุณาเลือกวันนัด';
  else if (ctx.minDate && date < ctx.minDate) e.date = 'วันนี้จองไม่ทันแล้ว กรุณาเลือกวันที่ใหม่';
  else if (ctx.maxDate && date > ctx.maxDate) e.date = 'รับจองล่วงหน้าไม่เกิน 6 เดือน';
  v.date = date;
  text('pickup_address', 400, { required: true, label: 'ที่อยู่รับ' });
  oneOf('district', DISTRICTS, 'เขต');
  const maps = str(input.maps_link);
  if (maps && (!/^https:\/\/[^\s<>"']+$/i.test(maps) || maps.length > 500)) e.maps_link = 'ลิงก์ต้องขึ้นต้นด้วย https://';
  v.maps_link = maps;
  oneOf('purpose', PURPOSES, 'ประเภทธุระ');
  text('purpose_other', 200, { label: 'รายละเอียดธุระ' });
  if (v.purpose === OTHER_PURPOSE && !v.purpose_other) e.purpose_other = 'กรุณาระบุธุระ';
  if (v.purpose !== OTHER_PURPOSE) v.purpose_other = '';
  text('destination', 200, { required: true, label: 'สถานที่ปลายทาง' });
  text('stops', 600, { label: 'จุดแวะเพิ่มเติม' });
  if (v.stops && v.stops.split(/\r?\n/).filter((l) => l.trim()).length > 3) e.stops = 'จุดแวะได้ไม่เกิน 3 บรรทัด';
  v.stops = v.stops.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n');
  const t = str(input.start_time);
  if (!isTime(t)) e.start_time = 'กรุณาระบุเวลาที่ต้องถึงปลายทาง';
  v.start_time = t;
  if (isMedical(v.purpose)) oneOf('fasting', Object.keys(FASTING), 'เรื่องงดน้ำงดอาหาร');
  else v.fasting = '';
  v.second_person = input.second_person === true || input.second_person === 'on' || input.second_person === '1' || input.second_person === 1;
  text('errands', 500, { label: 'ธุระอื่น' });
  oneOf('package_key', ctx.packageKeys || [], 'แพ็กเกจ');
  oneOf('transport_mode', Object.keys(TRANSPORT), 'การเดินทาง');

  // ยินยอม
  const yes = (k) => input[k] === true || input[k] === 'on' || input[k] === '1' || input[k] === 1;
  v.consent_terms = yes('consent_terms');
  v.consent_health = yes('consent_health');
  v.consent_elder = yes('consent_elder');
  v.consent_photo = yes('consent_photo');
  if (!v.consent_terms) e.consent_terms = 'กรุณายอมรับเงื่อนไขบริการ';
  if (!v.consent_health) e.consent_health = 'กรุณายินยอมให้ใช้ข้อมูลสุขภาพ';
  if (!v.consent_elder) e.consent_elder = 'กรุณายืนยันว่าผู้สูงอายุตกลงแล้ว';
  oneOf('heard_from', HEARD_FROM, 'ช่องทาง', false);

  return { errors: e, value: v };
}
