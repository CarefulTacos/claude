import { json, fail, readJson, handleError, sameOrigin, clientIp, nowIso } from '../_lib/http.js';
import { loadSettings } from '../_lib/settings.js';
import { hit, sweep } from '../_lib/ratelimit.js';
import { notifyOwner } from '../_lib/line.js';
import { thaiDate } from '../_lib/bookings.js';
import { validateBooking, bkkToday, addDays, isEveningStart, CONSENT_VERSION } from '../../public/shared/booking-rules.js';
import { snapshotRates, computeMoney } from '../../public/shared/pricing.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!sameOrigin(request)) return fail(403, 'ไม่อนุญาต');
    const body = await readJson(request);

    // Honeypot: real people never see this field. Pretend success, store nothing.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return json({ ok: true, code: 'PDG-0000', received: true });
    }

    const limit = Number(env.BOOKING_RATE_LIMIT) > 0 ? Number(env.BOOKING_RATE_LIMIT) : 5;
    const count = await hit(env, 'booking', clientIp(request), 3600);
    if (count > limit) return fail(429, 'ส่งคำขอจองบ่อยเกินไป กรุณาลองใหม่ภายหลัง หรือติดต่อทาง LINE');

    const s = await loadSettings(env.DB);
    const today = bkkToday();
    const { errors, value: v } = validateBooking(body, {
      minDate: addDays(today, s.lead_days), maxDate: addDays(today, 183), packageKeys: s.packages.map((p) => p.key),
    });
    if (Object.keys(errors).length) return fail(400, 'กรุณาตรวจสอบข้อมูล', { errors });

    const now = nowIso();
    const rates = snapshotRates(s, v.package_key);
    const row = {
      status: 'new',
      booker_name: v.booker_name, booker_phone: v.booker_phone, booker_line: v.booker_line, relationship: v.relationship,
      elder_name: v.elder_name, elder_age: v.elder_age, elder_phone: v.elder_phone || null, mobility: v.mobility,
      communication: v.communication, communication_other: v.communication_other, health_notes: v.health_notes,
      emergency_phone: v.emergency_phone, date: v.date, pickup_address: v.pickup_address, district: v.district,
      maps_link: v.maps_link, purpose: v.purpose, purpose_other: v.purpose_other, destination: v.destination, stops: v.stops,
      start_time: v.start_time, fasting: v.fasting, second_person: v.second_person ? 1 : 0, evening: isEveningStart(v.start_time) ? 1 : 0,
      errands: v.errands, transport_mode: v.transport_mode,
      consent_terms: 1, consent_health: 1, consent_elder: 1, consent_photo: v.consent_photo ? 1 : 0,
      consent_version: CONSENT_VERSION, consent_at: now, heard_from: v.heard_from,
      ...rates,
      surcharge_count: (s.outer_districts || []).includes(v.district) ? 1 : 0,
      created_at: now, updated_at: now,
    };
    const cols = Object.keys(row);
    // Insert only while the day is below capacity (single atomic statement).
    const inserted = await env.DB.prepare(
      `INSERT INTO bookings (${cols.join(', ')})
       SELECT ${cols.map(() => '?').join(', ')}
       WHERE (SELECT COUNT(*) FROM bookings WHERE date = ? AND status != 'cancelled') < ?
       RETURNING id`
    ).bind(...cols.map((c) => row[c]), v.date, s.max_per_day).first();
    if (!inserted) return fail(409, 'วันนี้คิวเต็มแล้ว กรุณาเลือกวันอื่น', { errors: { date: 'วันนี้คิวเต็มแล้ว' } });

    const code = 'PDG-' + String(inserted.id).padStart(4, '0');
    await env.DB.batch([
      env.DB.prepare('UPDATE bookings SET code = ? WHERE id = ?').bind(code, inserted.id),
      env.DB.prepare('INSERT INTO audit_log (at, actor, booking_id, action, detail) VALUES (?, ?, ?, ?, ?)')
        .bind(now, 'public', inserted.id, 'create', 'จองผ่านเว็บ'),
    ]);

    const text = `มีคำขอจองใหม่ ${code}\nวันนัด: ${thaiDate(v.date)} ${v.start_time}\nธุระ: ${v.purpose}\nเขต: ${v.district}\nปลายทาง: ${v.destination}`;
    context.waitUntil(notifyOwner(env, text).catch(() => {}));
    context.waitUntil(sweep(env).catch(() => {}));

    const m = computeMoney(row);
    return json({
      ok: true, code,
      summary: {
        date: v.date, date_label: thaiDate(v.date), start_time: v.start_time, purpose: v.purpose_other || v.purpose, destination: v.destination,
        stops: v.stops, second_person: !!v.second_person,
        district: v.district, elder_name: v.elder_name, package_name: rates.package_name,
        estimate: m.upfront, surcharge: m.surcharge, promo_percent: s.promo_remaining > 0 ? s.promo_percent : 0,
      },
      line_id: s.line_id, confirm_within: s.confirm_within,
    }, 201);
  } catch (err) { return handleError(err); }
}
