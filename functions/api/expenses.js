// Cloudflare Pages Function — shared expense ledger for the trip.
// KV binding "EXPENSES" (configured in wrangler.toml). Single key "ledger".
// No auth: this is a private, unlisted trip URL shared among 3 friends.

const KEY = 'ledger';
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet(context) {
  const kv = context.env.EXPENSES;
  if (!kv) return json({ error: 'no-kv' }, 200); // frontend falls back to localStorage
  const data = await kv.get(KEY);
  if (!data) return json({}, 200); // empty ledger → frontend seeds a baseline
  return new Response(data, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPut(context) {
  const kv = context.env.EXPENSES;
  if (!kv) return json({ error: 'no-kv' }, 503);
  const body = await context.request.text();
  if (body.length > 300000) return json({ error: 'too-big' }, 413);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  if (!parsed || !Array.isArray(parsed.expenses)) return json({ error: 'bad-shape' }, 400);
  await kv.put(KEY, body);
  return json({ ok: true, saved: parsed.expenses.length }, 200);
}
