import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBooking, DISTRICTS, PURPOSES, bkkToday, addDays, normalizePhone } from '../../public/shared/booking-rules.js';

const good = {
  booker_name: 'สมชาย', booker_phone: '081-234-5678', booker_line: 'somchai', relationship: 'ลูก',
  elder_name: 'คุณแม่สมศรี', elder_age: '78', elder_phone: '', mobility: 'ไม้เท้า', communication: 'ปกติ',
  health_notes: 'ความดันสูง', emergency_phone: '0899999999', date: '2026-12-10', pickup_address: '1 ถนนสุขุมวิท',
  district: 'วัฒนา', maps_link: '', purpose: 'พบแพทย์/ตรวจสุขภาพ', destination: 'รพ.จุฬา', stops: 'ร้านขายยา\nไปรษณีย์', start_time: '08:30', fasting: 'yes',
  errands: '', package_key: 'half', transport_mode: 'assistant', consent_terms: true, consent_health: true, consent_elder: true,
};
const ctx = { minDate: '2026-11-27', maxDate: '2027-05-25', packageKeys: ['hourly3', 'half', 'full'] };

test('50 Bangkok districts', () => {
  assert.equal(DISTRICTS.length, 50);
  assert.equal(new Set(DISTRICTS).size, 50);
});
test('valid booking passes and phone is normalised', () => {
  const r = validateBooking(good, ctx);
  assert.deepEqual(r.errors, {});
  assert.equal(r.value.booker_phone, '0812345678');
});
test('lead time, consents, bad fields are rejected', () => {
  const r = validateBooking({ ...good, date: '2026-11-26', consent_health: false, booker_phone: '123', maps_link: 'javascript:alert(1)', package_key: 'x' }, ctx);
  assert.deepEqual(Object.keys(r.errors).sort(), ['booker_phone', 'consent_health', 'date', 'maps_link', 'package_key']);
});
test('bangkok date helpers', () => {
  assert.equal(bkkToday(Date.parse('2026-11-25T17:30:00Z')), '2026-11-26');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(normalizePhone('+66 81 234 5678'), '0812345678');
});

test('purpose rules: 12 purposes, other needs detail, fasting only for medical, max 3 stops', () => {
  assert.equal(PURPOSES.length, 12);
  let r = validateBooking({ ...good, purpose: 'อื่น ๆ (ระบุ)' }, ctx);
  assert.deepEqual(Object.keys(r.errors), ['purpose_other']);
  r = validateBooking({ ...good, purpose: 'วัด/ทำบุญ/ศาสนกิจ', fasting: '' }, ctx);
  assert.deepEqual(r.errors, {});
  assert.equal(r.value.fasting, '');
  r = validateBooking({ ...good, fasting: '' }, ctx);
  assert.deepEqual(Object.keys(r.errors), ['fasting']);
  r = validateBooking({ ...good, stops: 'a\nb\nc\nd' }, ctx);
  assert.deepEqual(Object.keys(r.errors), ['stops']);
  r = validateBooking({ ...good, destination: '', start_time: '25:00', purpose: 'x' }, ctx);
  assert.deepEqual(Object.keys(r.errors).sort(), ['destination', 'purpose', 'start_time']);
  assert.equal(validateBooking({ ...good, second_person: true }, ctx).value.second_person, true);
});
