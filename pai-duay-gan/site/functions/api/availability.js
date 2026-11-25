import { json, handleError } from '../_lib/http.js';
import { loadSettings } from '../_lib/settings.js';
import { bkkToday, addDays } from '../../public/shared/booking-rules.js';

export async function onRequestGet({ env }) {
  try {
    const s = await loadSettings(env.DB);
    const today = bkkToday();
    const minDate = addDays(today, s.lead_days);
    const maxDate = addDays(today, 183);
    const { results } = await env.DB.prepare(
      "SELECT date, COUNT(*) AS n FROM bookings WHERE status != 'cancelled' AND date BETWEEN ? AND ? GROUP BY date HAVING COUNT(*) >= ?"
    ).bind(minDate, maxDate, s.max_per_day).all();
    return json({ ok: true, today, minDate, maxDate, full: results.map((r) => r.date) }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) { return handleError(err); }
}
