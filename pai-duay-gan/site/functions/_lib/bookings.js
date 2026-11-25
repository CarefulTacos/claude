import { computeMoney, cancellationFor, pickupEpoch } from '../../public/shared/pricing.js';
import { FASTING, OTHER_PURPOSE, DOCUMENT_PURPOSES, isMedical } from '../../public/shared/booking-rules.js';

export const STATUS = {
  new: 'ใหม่', confirmed: 'ยืนยันแล้ว-รอชำระ', paid: 'ชำระแล้ว', done: 'เสร็จสิ้น', cancelled: 'ยกเลิก',
};

export async function audit(db, actor, bookingId, action, detail = '') {
  await db.prepare('INSERT INTO audit_log (at, actor, booking_id, action, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(new Date().toISOString(), actor, bookingId, action, String(detail).slice(0, 500)).run();
}

const baht = (n) => Number(n || 0).toLocaleString('en-US');

export function thaiDate(ymd) {
  if (!ymd) return '';
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const d = new Date(ymd + 'T00:00:00Z');
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

export const purposeLabel = (b) => (b.purpose === OTHER_PURPOSE && b.purpose_other ? b.purpose_other : b.purpose);

/** Ready-to-send LINE texts for the owner (copied from the admin booking page). */
export function messages(b, assistantName, settings) {
  const m = computeMoney(b);
  const pickup = b.pickup_time || '(เวลารับ)';
  const who = assistantName || '(ชื่อผู้ช่วย)';
  const purpose = purposeLabel(b);
  const elders = b.second_person ? `คุณ${b.elder_name}และผู้ร่วมเดินทาง` : `คุณ${b.elder_name}`;
  const stops = b.stops ? `\nแวะ: ${b.stops.split('\n').join(', ')}` : '';
  let prepare;
  if (b.purpose === DOCUMENT_PURPOSES[2]) prepare = 'รบกวนเตรียมบัตรประชาชน ทะเบียนบ้าน และเอกสารที่ต้องใช้ติดต่อราชการ';
  else if (DOCUMENT_PURPOSES.includes(b.purpose)) prepare = 'รบกวนเตรียมบัตรประชาชน บัตรโรงพยาบาล ใบนัด และยาที่ทานอยู่';
  else prepare = 'รบกวนเตรียมกระเป๋าสตางค์ โทรศัพท์ และยาที่ต้องทานระหว่างวัน';
  const fastingLine = !isMedical(b.purpose) ? ''
    : b.fasting === 'yes' ? `และ${elders}ต้องงดน้ำงดอาหารตามที่แจ้งไว้นะคะ`
    : b.fasting === 'unsure' ? 'รบกวนเช็กอีกครั้งว่าต้องงดน้ำงดอาหารไหมนะคะ' : '';
  return [
    {
      key: 'confirm', title: 'ยืนยันคิว',
      text: `ยืนยันคิวได้ค่ะ\nวันนัด: ${thaiDate(b.date)} รับที่บ้าน ${pickup}\nธุระ: ${purpose} ปลายทาง ${b.destination} เวลา ${b.start_time}${stops}\nผู้ช่วย: ${who} จะโทรแนะนำตัวคืนก่อนนัด\nแพ็กเกจ: ${b.package_name}${b.second_person ? ' (2 ท่าน)' : ''} ${baht(m.upfront)} บาท\nชำระผ่าน QR พร้อมเพย์ภายใน ${settings.payment_hours || 24} ชั่วโมง แล้วส่งสลิปได้เลยค่ะ\nค่ารถและค่าเกินเวลา (ถ้ามี) เรียกเก็บหลังจบนัดพร้อมใบเสร็จค่ะ`,
    },
    {
      key: 'eve', title: 'คืนก่อนนัด',
      text: `พรุ่งนี้ ${who} จะไปถึงบ้าน ${pickup} เพื่อพา${elders}ไปปลายทาง ${b.destination} นะคะ ${prepare} ${fastingLine}`.trim(),
    },
    {
      key: 'summary', title: 'สรุปหลังนัด',
      text: `สรุปวันที่ ${thaiDate(b.date)} ของ${elders}\nธุระ: ${purpose}\nปลายทาง: ${b.destination}${stops}\nสิ่งที่ทำเสร็จ: \nเรื่องที่ครอบครัวควรรู้/ทำต่อ: \nนัดครั้งหน้า: ${b.next_appointment ? thaiDate(b.next_appointment) : ''}\nรับ ${pickup} ส่งถึงบ้าน: \nรูปเอกสาร/ใบเสร็จแนบไว้ด้านล่างค่ะ`,
    },
    {
      key: 'extra', title: 'เก็บเงินส่วนเพิ่ม + ขอรีวิว',
      text: `ขอบคุณที่ให้ไปด้วยกันดูแลวันนี้ค่ะ ยอดส่วนเพิ่ม: ค่ารถ ${baht(m.transport)} + เกินเวลา ${baht(m.overtime_fee)} = ${baht(m.extra)} บาท ชำระผ่าน QR เดิมได้เลยค่ะ ถ้าสะดวกช่วยให้คะแนน 1-5 และเล่าสั้น ๆ ว่าอะไรดีหรือควรปรับ`,
    },
  ];
}

export function hoursBefore(b, cancelledAtIso) {
  const pick = pickupEpoch(b.date, b.pickup_time || b.start_time);
  return Math.round(((pick - Date.parse(cancelledAtIso)) / 3600e3) * 100) / 100;
}

export function withMoney(b) {
  const money = computeMoney(b);
  const out = { ...b, money, status_label: STATUS[b.status] || b.status, fasting_label: FASTING[b.fasting] || '', purpose_label: purposeLabel(b) };
  if (b.status === 'cancelled') out.cancellation = cancellationFor(b);
  return out;
}
