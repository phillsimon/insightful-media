import { handle, json, HttpError, env_ as E } from '../../../lib/server';
export const prerender = false;
// POST { name } -> one-time Cloudflare Stream upload URL for the browser (direct creator upload)
export const POST = handle(async (req) => {
  const { name } = await req.json() as any;
  if (!E.CF_ACCOUNT_ID || !E.CF_STREAM_TOKEN || E.CF_ACCOUNT_ID.includes('CHANGE-ME')) throw new HttpError(500, 'Cloudflare Stream is not configured (CF_ACCOUNT_ID / CF_STREAM_TOKEN).');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${E.CF_ACCOUNT_ID}/stream/direct_upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${E.CF_STREAM_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ maxDurationSeconds: 3 * 3600, meta: { name: String(name || 'Website video').slice(0, 200) } }),
  });
  const j: any = await r.json();
  if (!r.ok || !j.success) throw new HttpError(502, 'Stream error: ' + (j.errors?.[0]?.message || r.status));
  return json({ uploadURL: j.result.uploadURL, uid: j.result.uid });
});
