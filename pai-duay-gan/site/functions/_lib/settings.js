import { DEFAULT_SETTINGS } from '../../public/shared/pricing.js';

export async function loadSettings(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'app'").first();
  let saved = {};
  if (row) { try { saved = JSON.parse(row.value) || {}; } catch { saved = {}; } }
  return { ...structuredClone(DEFAULT_SETTINGS), ...saved };
}

export async function saveSettings(db, s) {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(s)).run();
}

const int = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.round(n) !== n || n < lo || n > hi) return null;
  return n;
};

/** Validate settings posted from the admin screen. Returns {errors, value}. */
export function validateSettings(input, current) {
  const e = {};
  const v = { ...current };
  const numFields = {
    ot_block_min: [5, 240], ot_customer: [0, 100000], ot_assistant: [0, 100000],
    surcharge_customer: [0, 100000], surcharge_assistant: [0, 100000], second_person_surcharge_percent: [0, 200], evening_surcharge: [0, 100000], max_per_day: [1, 50],
    lead_days: [0, 60], promo_percent: [0, 100], promo_remaining: [0, 100000], payment_hours: [1, 240], pdpa_days: [30, 3650],
  };
  for (const [k, [lo, hi]] of Object.entries(numFields)) {
    if (input[k] === undefined) continue;
    const n = int(input[k], lo, hi);
    if (n === null) e[k] = `ต้องเป็นจำนวนเต็ม ${lo}-${hi}`; else v[k] = n;
  }
  for (const k of ['promptpay_id', 'line_id', 'owner_phone', 'confirm_within']) {
    if (input[k] === undefined) continue;
    const s = String(input[k] ?? '').trim();
    if (s.length > 100) e[k] = 'ยาวเกินไป'; else v[k] = s;
  }
  if (v.promptpay_id && !/^[\d-]{10,20}$/.test(v.promptpay_id)) e.promptpay_id = 'ใส่เบอร์มือถือหรือเลขประจำตัว 13 หลัก';
  if (input.outer_districts !== undefined) {
    const list = Array.isArray(input.outer_districts) ? input.outer_districts : String(input.outer_districts).split(/[,\n]/);
    v.outer_districts = list.map((s) => String(s).trim()).filter(Boolean).slice(0, 50);
  }
  if (input.packages !== undefined) {
    if (!Array.isArray(input.packages) || input.packages.length < 1 || input.packages.length > 10) e.packages = 'ต้องมีแพ็กเกจ 1-10 รายการ';
    else {
      const keys = new Set();
      v.packages = input.packages.map((p, i) => {
        const key = String(p.key || '').trim();
        const out = { key, name: String(p.name || '').trim().slice(0, 80), hours: int(p.hours, 1, 24), price: int(p.price, 0, 1e6), pay: int(p.pay, 0, 1e6) };
        if (!/^[a-z0-9_]{1,20}$/.test(key) || keys.has(key)) e[`packages.${i}.key`] = 'รหัสแพ็กเกจต้องเป็น a-z 0-9 และไม่ซ้ำ';
        if (!out.name) e[`packages.${i}.name`] = 'ต้องมีชื่อ';
        if (out.hours === null || out.price === null || out.pay === null) e[`packages.${i}.price`] = 'ชั่วโมง ราคา ค่าผู้ช่วย ต้องเป็นจำนวนเต็ม';
        keys.add(key);
        return out;
      });
    }
  }
  return { errors: e, value: v };
}
