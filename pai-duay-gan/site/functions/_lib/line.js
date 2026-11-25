// Optional LINE Messaging API push to the owner. Never throws.
export async function notifyOwner(env, text) {
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_OWNER_USER_ID) return false;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` },
      body: JSON.stringify({ to: env.LINE_OWNER_USER_ID, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    });
    if (!res.ok) console.warn('LINE push failed', res.status);
    return res.ok;
  } catch (err) {
    console.warn('LINE push error', err && err.message);
    return false;
  }
}
