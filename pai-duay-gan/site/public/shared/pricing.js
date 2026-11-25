// Pricing and cancellation rules for ไปด้วยกัน.
// One module, imported by the booking page, the API (functions/) and the unit tests.
// Pure functions only: no DOM, no D1, no clock unless passed in.

export const DEFAULT_SETTINGS = Object.freeze({
  packages: [
    { key: 'hourly3', name: 'รายชั่วโมง (ขั้นต่ำ 3 ชม.)', hours: 3, price: 1170, pay: 600 },
    { key: 'half', name: 'ครึ่งวัน', hours: 4, price: 1490, pay: 750 },
    { key: 'full', name: 'เต็มวัน', hours: 8, price: 2690, pay: 1300 },
  ],
  ot_block_min: 30,        // overtime is charged per started block of this many minutes
  ot_customer: 200,        // baht per block charged to the family
  ot_assistant: 200,       // baht per block paid to the assistant
  surcharge_customer: 200, // per item (start before 06:30, outer district)
  surcharge_assistant: 0,
  second_person_surcharge_percent: 30, // two elders together: package price and assistant pay +30%
  evening_surcharge: 200,  // pickup at/after 18:00 or return after 20:00, customer only
  max_per_day: 3,
  lead_days: 2,
  promptpay_id: '',
  line_id: '@paiduaygan',
  owner_phone: '',
  promo_percent: 30,
  promo_remaining: 10,
  confirm_within: '24 ชั่วโมง',
  payment_hours: 24,
  pdpa_days: 365,
  outer_districts: ['หนองจอก', 'ลาดกระบัง', 'มีนบุรี', 'คลองสามวา', 'บางขุนเทียน', 'ทวีวัฒนา', 'หนองแขม', 'บางบอน', 'ทุ่งครุ'],
});

const int = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x) : 0;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function findPackage(settings, key) {
  return (settings.packages || []).find((p) => p.key === key) || null;
}

/** Rates copied onto a booking when it is created or its package changes,
 *  so later price edits in settings do not rewrite old bookings. */
export function snapshotRates(settings, packageKey) {
  const p = findPackage(settings, packageKey);
  if (!p) throw new Error('unknown package ' + packageKey);
  return {
    package_key: p.key,
    package_name: p.name,
    package_price: int(p.price),
    package_pay: int(p.pay),
    ot_block_min: int(settings.ot_block_min) || 30,
    ot_customer: int(settings.ot_customer),
    ot_assistant: int(settings.ot_assistant),
    surcharge_customer: int(settings.surcharge_customer),
    surcharge_assistant: int(settings.surcharge_assistant),
    second_person_pct: int(settings.second_person_surcharge_percent),
    evening_rate: int(settings.evening_surcharge),
  };
}

/** Package price and assistant base pay, including the second-person uplift. */
export function basePrices(b) {
  const pct = b.second_person ? Math.max(0, int(b.second_person_pct)) : 0;
  return {
    service: Math.round((int(b.package_price) * (100 + pct)) / 100),
    base_pay: Math.round((int(b.package_pay) * (100 + pct)) / 100),
    second_person_pct: pct,
  };
}

/** Money for a booking that goes ahead. All amounts are whole baht. */
export function computeMoney(b) {
  const { service, base_pay, second_person_pct } = basePrices(b);
  const pct = clamp(Number(b.discount_pct) || 0, 0, 100);
  const discounted = Math.round((service * (100 - pct)) / 100);
  const otMin = Math.max(0, int(b.overtime_min));
  const block = int(b.ot_block_min) || 30;
  const ot_units = otMin > 0 ? Math.ceil(otMin / block) : 0;
  const overtime_fee = ot_units * int(b.ot_customer);
  const surcharges = Math.max(0, int(b.surcharge_count));
  const evening_fee = b.evening ? int(b.evening_rate) : 0;
  const surcharge = surcharges * int(b.surcharge_customer) + evening_fee;
  const transport = Math.max(0, int(b.transport_cost));
  const customer_total = discounted + overtime_fee + surcharge + transport;
  const assistant_pay = base_pay + ot_units * int(b.ot_assistant) + surcharges * int(b.surcharge_assistant);
  const gross_profit = discounted + overtime_fee + surcharge - assistant_pay; // transport is pass-through
  const upfront = discounted + surcharge;   // asked for when confirming the booking
  const extra = overtime_fee + transport;   // collected after the appointment
  const received = Math.max(0, int(b.received_service)) + Math.max(0, int(b.received_extra));
  return {
    service, second_person_pct, base_pay, evening_fee, discount_pct: pct, discounted, ot_units, overtime_fee, surcharge, transport,
    customer_total, assistant_pay, gross_profit, upfront, extra,
    received, balance: customer_total - received,
  };
}

/** Cancellation policy.
 *  base = what the family has paid for the service (normally the upfront amount).
 *  Returns refund to the family, amount the business keeps and what the assistant earns. */
export function cancellation({ base, packagePay, hoursBefore, cancelledBy, assistantArrived }) {
  const paid = Math.max(0, int(base));
  if (cancelledBy === 'business') {
    return { rule: 'business', label: 'ธุรกิจยกเลิก คืนเงิน 100%', refund_pct: 100, refund: paid, kept: 0, assistant_pay: 0 };
  }
  if (assistantArrived) {
    return { rule: 'arrived', label: 'ผู้ช่วยถึงบ้านแล้ว ไม่คืนเงิน ผู้ช่วยได้ค่าแพ็กเกจเต็ม', refund_pct: 0, refund: 0, kept: paid, assistant_pay: Math.max(0, int(packagePay)) };
  }
  if (Number(hoursBefore) > 24) {
    return { rule: 'early', label: 'ยกเลิกก่อนนัดเกิน 24 ชม. คืนเงิน 100%', refund_pct: 100, refund: paid, kept: 0, assistant_pay: 0 };
  }
  const refund = Math.round(paid * 0.5);
  const kept = paid - refund;
  return { rule: 'late', label: 'ยกเลิกภายใน 24 ชม. คืนเงิน 50% ผู้ช่วยได้ครึ่งหนึ่งของส่วนที่เก็บไว้', refund_pct: 50, refund, kept, assistant_pay: Math.round(kept / 2) };
}

/** Pickup moment as epoch ms, Bangkok time (UTC+7, no DST). */
export function pickupEpoch(date, time) {
  const t = /^\d{2}:\d{2}$/.test(time || '') ? time : '08:00';
  return Date.parse(`${date}T${t}:00+07:00`);
}

export function cancellationFor(b) {
  return cancellation({
    base: b.received_service,
    packagePay: basePrices(b).base_pay,
    hoursBefore: b.cancel_hours_before,
    cancelledBy: b.cancelled_by,
    assistantArrived: !!b.assistant_arrived,
  });
}

/** What a booking contributes to the books (reports, KPIs, payouts). */
export function ledger(b) {
  if (b.status === 'paid' || b.status === 'done') {
    const m = computeMoney(b);
    return {
      counted: true, revenue: m.discounted + m.overtime_fee + m.surcharge, transport: m.transport,
      assistant_cost: m.assistant_pay, gross: m.gross_profit,
      assistant_owed: b.status === 'done' ? m.assistant_pay : 0,
    };
  }
  if (b.status === 'cancelled') {
    const c = cancellationFor(b);
    return { counted: false, revenue: c.kept, transport: 0, assistant_cost: c.assistant_pay, gross: c.kept - c.assistant_pay, assistant_owed: c.assistant_pay };
  }
  return { counted: false, revenue: 0, transport: 0, assistant_cost: 0, gross: 0, assistant_owed: 0 };
}

/** Public estimate shown on the booking page. */
export function estimate(settings, packageKey, { outer = false, promo = false, second = false, evening = false } = {}) {
  const p = findPackage(settings, packageKey);
  if (!p) return null;
  const pct = second ? int(settings.second_person_surcharge_percent) : 0;
  const price = Math.round((int(p.price) * (100 + pct)) / 100);
  const surcharge = (outer ? int(settings.surcharge_customer) : 0) + (evening ? int(settings.evening_surcharge) : 0);
  const promoPrice = Math.round((price * (100 - (Number(settings.promo_percent) || 0))) / 100);
  return { price, surcharge, total: price + surcharge, promo_total: promo ? promoPrice + surcharge : null };
}
