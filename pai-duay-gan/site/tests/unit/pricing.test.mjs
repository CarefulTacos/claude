import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, snapshotRates, computeMoney, cancellation, ledger, estimate, pickupEpoch } from '../../public/shared/pricing.js';

const half = (extra = {}) => ({ ...snapshotRates(DEFAULT_SETTINGS, 'half'), ...extra });

test('package snapshot uses seeded prices', () => {
  assert.equal(snapshotRates(DEFAULT_SETTINGS, 'hourly3').package_price, 1170);
  assert.equal(snapshotRates(DEFAULT_SETTINGS, 'half').package_pay, 750);
  assert.equal(snapshotRates(DEFAULT_SETTINGS, 'full').package_price, 2690);
  assert.throws(() => snapshotRates(DEFAULT_SETTINGS, 'nope'));
});

test('plain half-day booking', () => {
  const m = computeMoney(half());
  assert.deepEqual([m.discounted, m.overtime_fee, m.surcharge, m.customer_total, m.assistant_pay, m.gross_profit], [1490, 0, 0, 1490, 750, 740]);
  assert.equal(m.upfront, 1490);
});

test('half day, 30% discount, 20 min overtime, transport 320 (spec example)', () => {
  const m = computeMoney(half({ discount_pct: 30, overtime_min: 20, transport_cost: 320 }));
  assert.equal(m.discounted, 1043);
  assert.equal(m.overtime_fee, 200);
  assert.equal(m.customer_total, 1563);
  assert.equal(m.assistant_pay, 950);
  assert.equal(m.gross_profit, 293);
  assert.equal(m.extra, 520);
});

test('overtime is per started 30 minutes', () => {
  const ot = (min) => computeMoney(half({ overtime_min: min })).overtime_fee;
  assert.equal(ot(0), 0);
  assert.equal(ot(1), 200);
  assert.equal(ot(30), 200);
  assert.equal(ot(31), 400);
  assert.equal(ot(60), 400);
  assert.equal(ot(-10), 0);
});

test('surcharges go to customer only; transport excluded from gross', () => {
  const m = computeMoney(snapshotRates(DEFAULT_SETTINGS, 'full') && { ...snapshotRates(DEFAULT_SETTINGS, 'full'), surcharge_count: 2, transport_cost: 500 });
  assert.equal(m.surcharge, 400);
  assert.equal(m.customer_total, 2690 + 400 + 500);
  assert.equal(m.assistant_pay, 1300);
  assert.equal(m.gross_profit, 2690 + 400 - 1300);
  assert.equal(m.upfront, 3090);
});

test('discount rounding', () => {
  assert.equal(computeMoney({ ...snapshotRates(DEFAULT_SETTINGS, 'hourly3'), discount_pct: 30 }).discounted, 819);
  assert.equal(computeMoney({ ...snapshotRates(DEFAULT_SETTINGS, 'full'), discount_pct: 30 }).discounted, 1883);
  assert.equal(computeMoney(half({ discount_pct: 150 })).discounted, 0);
});

test('balance tracks received money', () => {
  const m = computeMoney(half({ discount_pct: 30, overtime_min: 20, transport_cost: 320, received_service: 1043, received_extra: 520 }));
  assert.equal(m.balance, 0);
});

test('cancellation more than 24h before: full refund, assistant 0', () => {
  assert.deepEqual(
    pick(cancellation({ base: 1490, packagePay: 750, hoursBefore: 30, cancelledBy: 'customer' })),
    { rule: 'early', refund: 1490, kept: 0, assistant_pay: 0 });
});
test('cancellation within 24h: refund 50%, assistant half of kept', () => {
  assert.deepEqual(pick(cancellation({ base: 1490, packagePay: 750, hoursBefore: 24, cancelledBy: 'customer' })), { rule: 'late', refund: 745, kept: 745, assistant_pay: 373 });
  assert.deepEqual(pick(cancellation({ base: 1043, packagePay: 750, hoursBefore: 3, cancelledBy: 'customer' })), { rule: 'late', refund: 522, kept: 521, assistant_pay: 261 });
});
test('cancellation after assistant arrived: no refund, assistant full package pay', () => {
  assert.deepEqual(pick(cancellation({ base: 1490, packagePay: 750, hoursBefore: 0.5, cancelledBy: 'customer', assistantArrived: true })), { rule: 'arrived', refund: 0, kept: 1490, assistant_pay: 750 });
});
test('cancelled by business: full refund even late', () => {
  assert.deepEqual(pick(cancellation({ base: 1490, packagePay: 750, hoursBefore: 1, cancelledBy: 'business', assistantArrived: true })), { rule: 'business', refund: 1490, kept: 0, assistant_pay: 0 });
});

test('ledger by status', () => {
  const b = half({ discount_pct: 30, overtime_min: 20, transport_cost: 320 });
  assert.equal(ledger({ ...b, status: 'new' }).revenue, 0);
  const done = ledger({ ...b, status: 'done' });
  assert.deepEqual([done.revenue, done.assistant_cost, done.gross, done.transport, done.assistant_owed], [1243, 950, 293, 320, 950]);
  assert.equal(ledger({ ...b, status: 'paid' }).assistant_owed, 0);
  const c = ledger({ ...b, status: 'cancelled', received_service: 1490, cancel_hours_before: 10, cancelled_by: 'customer' });
  assert.deepEqual([c.revenue, c.assistant_cost, c.gross], [745, 373, 372]);
});

test('public estimate with outer district and promo', () => {
  assert.deepEqual(estimate(DEFAULT_SETTINGS, 'half', { outer: true, promo: true }), { price: 1490, surcharge: 200, total: 1690, promo_total: 1243 });
  assert.deepEqual(estimate(DEFAULT_SETTINGS, 'half', { second: true, evening: true }), { price: 1937, surcharge: 200, total: 2137, promo_total: null });
  assert.equal(estimate(DEFAULT_SETTINGS, 'x'), null);
});

test('pickup epoch is Bangkok time', () => {
  assert.equal(new Date(pickupEpoch('2026-12-01', '06:30')).toISOString(), '2026-11-30T23:30:00.000Z');
  assert.equal(new Date(pickupEpoch('2026-12-01', '')).toISOString(), '2026-12-01T01:00:00.000Z');
});

test('two people: package price and assistant pay +30% before discount', () => {
  const m = computeMoney(half({ second_person: 1 }));
  assert.deepEqual([m.service, m.discounted, m.assistant_pay, m.gross_profit], [1937, 1937, 975, 962]);
  const d = computeMoney(half({ second_person: 1, discount_pct: 30, overtime_min: 20, transport_cost: 320 }));
  // 1937 * 0.7 = 1355.9 -> 1356; +200 OT +320 transport
  assert.deepEqual([d.discounted, d.customer_total, d.assistant_pay, d.gross_profit], [1356, 1876, 1175, 381]);
  // flag off: pct snapshot ignored
  assert.equal(computeMoney(half({ second_person: 0 })).service, 1490);
});

test('evening surcharge is customer-only and stacks with early/outer items', () => {
  const m = computeMoney(half({ evening: 1, surcharge_count: 1 }));
  assert.deepEqual([m.evening_fee, m.surcharge, m.customer_total, m.assistant_pay, m.gross_profit, m.upfront], [200, 400, 1890, 750, 1140, 1890]);
  const both = computeMoney(half({ evening: 1, second_person: 1, discount_pct: 30 }));
  assert.deepEqual([both.customer_total, both.assistant_pay, both.gross_profit], [1556, 975, 581]);
});

test('arrived cancellation pays the two-person base pay', () => {
  const c = ledger({ ...half({ second_person: 1 }), status: 'cancelled', received_service: 1937, cancel_hours_before: 0, cancelled_by: 'customer', assistant_arrived: 1 });
  assert.deepEqual([c.revenue, c.assistant_cost], [1937, 975]);
});

function pick(c) { return { rule: c.rule, refund: c.refund, kept: c.kept, assistant_pay: c.assistant_pay }; }
