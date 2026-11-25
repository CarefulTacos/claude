import { json, handleError } from '../_lib/http.js';
import { loadSettings } from '../_lib/settings.js';
import { bkkToday, addDays, CONSENT_VERSION } from '../../public/shared/booking-rules.js';

export async function onRequestGet({ env }) {
  try {
    const s = await loadSettings(env.DB);
    const today = bkkToday();
    return json({
      ok: true,
      today,
      minDate: addDays(today, s.lead_days),
      maxDate: addDays(today, 183),
      packages: s.packages.map(({ key, name, hours, price }) => ({ key, name, hours, price })),
      ot_block_min: s.ot_block_min, ot_customer: s.ot_customer, surcharge_customer: s.surcharge_customer,
      second_person_surcharge_percent: s.second_person_surcharge_percent, evening_surcharge: s.evening_surcharge,
      promo_percent: s.promo_percent, promo_remaining: s.promo_remaining,
      line_id: s.line_id, confirm_within: s.confirm_within, outer_districts: s.outer_districts,
      lead_days: s.lead_days, consent_version: CONSENT_VERSION,
    });
  } catch (err) { return handleError(err); }
}
