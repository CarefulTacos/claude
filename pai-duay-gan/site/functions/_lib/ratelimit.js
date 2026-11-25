import { sha256Hex } from './http.js';

/** Fixed-window counter in D1, keyed by a salted hash (raw IPs are never stored).
 *  Returns the count in the current window after adding `add`. */
export async function hit(env, bucket, rawKey, windowSec, add = 1) {
  const key = await sha256Hex(`${bucket}|${rawKey}|${env.SESSION_SECRET || 'pdg'}`);
  const win = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, key_hash, window_start, count) VALUES (?, ?, ?, ?)
     ON CONFLICT(bucket, key_hash, window_start) DO UPDATE SET count = count + excluded.count
     RETURNING count`
  ).bind(bucket, key, win, add).first();
  return row ? row.count : add;
}

export async function peek(env, bucket, rawKey, windowSec) {
  const key = await sha256Hex(`${bucket}|${rawKey}|${env.SESSION_SECRET || 'pdg'}`);
  const win = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE bucket = ? AND key_hash = ? AND window_start = ?')
    .bind(bucket, key, win).first();
  return row ? row.count : 0;
}

export async function clear(env, bucket, rawKey) {
  const key = await sha256Hex(`${bucket}|${rawKey}|${env.SESSION_SECRET || 'pdg'}`);
  await env.DB.prepare('DELETE FROM rate_limits WHERE bucket = ? AND key_hash = ?').bind(bucket, key).run();
}

export async function sweep(env) {
  const cutoff = Math.floor(Date.now() / 1000) - 2 * 86400;
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(cutoff).run();
}
