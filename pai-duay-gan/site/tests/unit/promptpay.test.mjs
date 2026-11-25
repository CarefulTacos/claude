import test from 'node:test';
import assert from 'node:assert/strict';
import { crc16, promptpayPayload, promptpayTarget } from '../../public/shared/promptpay.js';

test('CRC-16/CCITT-FALSE check value', () => {
  assert.equal(crc16('123456789'), '29B1');
});

// Reference vectors published with the promptpay-qr library (dtinth/promptpay-qr).
test('static payload for phone 000-000-0000', () => {
  assert.equal(promptpayPayload('000-000-0000'), '00020101021129370016A000000677010111011300660000000005802TH530376463048956');
});
test('dynamic payload with amount 4.22', () => {
  assert.equal(promptpayPayload('000-000-0000', 4.22), '00020101021229370016A000000677010111011300660000000005802TH530376454044.226304E469');
});

test('phone and ID formatting', () => {
  assert.deepEqual(promptpayTarget('081-234-5678'), { tag: '01', value: '0066812345678' });
  assert.deepEqual(promptpayTarget('1-2345-67890-12-3'), { tag: '02', value: '1234567890123' });
  assert.equal(promptpayTarget('12345'), null);
  assert.throws(() => promptpayPayload('12345', 10));
});

test('booking amount payload is self-consistent', () => {
  const p = promptpayPayload('0812345678', 1563);
  assert.ok(p.includes('29370016A000000677010111011300668123456785802TH5303764'));
  assert.ok(p.includes('54071563.00'));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  const id = promptpayPayload('1234567890123', 1043);
  assert.ok(id.includes('0213' + '1234567890123'));
  assert.equal(id.slice(-4), crc16(id.slice(0, -4)));
});
