// EMVCo merchant-presented QR payload for Thai PromptPay.
// Field order follows the widely used promptpay-qr reference implementation.

const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), returned as 4 upper-case hex digits. */
export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Normalise a PromptPay target. Returns {tag, value} or null if invalid.
 *  10-digit mobile 0XXXXXXXXX -> tag 01, 0066XXXXXXXXX
 *  13-digit national/tax ID   -> tag 02
 *  15-digit e-wallet ID       -> tag 03 */
export function promptpayTarget(id) {
  const d = String(id || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) return { tag: '01', value: ('66' + d.slice(1)).padStart(13, '0') };
  if (d.length === 11 && d.startsWith('66')) return { tag: '01', value: d.padStart(13, '0') };
  if (d.length === 13) return { tag: '02', value: d };
  if (d.length === 15) return { tag: '03', value: d };
  return null;
}

export function promptpayPayload(id, amount) {
  const target = promptpayTarget(id);
  if (!target) throw new Error('PromptPay ID ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขประจำตัว 13 หลัก');
  const amt = Number(amount);
  const hasAmount = Number.isFinite(amt) && amt > 0;
  let s =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', tlv('00', 'A000000677010111') + tlv(target.tag, target.value)) +
    tlv('58', 'TH') +
    tlv('53', '764');
  if (hasAmount) s += tlv('54', amt.toFixed(2));
  s += '6304';
  return s + crc16(s);
}
