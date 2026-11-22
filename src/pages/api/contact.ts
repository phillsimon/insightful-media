import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
export const prerender = false;
const E = env as unknown as Record<string, string>;
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const POST: APIRoute = async ({ request }) => {
  const f = await request.formData();
  const name = String(f.get('name') || '').trim().slice(0, 120);
  const email = String(f.get('email') || '').trim().slice(0, 200);
  const message = String(f.get('message') || '').trim().slice(0, 5000);
  if (String(f.get('website') || '')) return reply({ ok: true }); // honeypot: pretend success
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Please fill in your name, a valid email, and a message.' }, 400);

  if (E.TURNSTILE_SECRET) {
    const body = new FormData();
    body.append('secret', E.TURNSTILE_SECRET);
    body.append('response', String(f.get('cf-turnstile-response') || ''));
    body.append('remoteip', request.headers.get('cf-connecting-ip') || '');
    const v: any = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })).json();
    if (!v.success) return reply({ error: 'Spam check failed. Please try again.' }, 400);
  }

  if (!E.RESEND_API_KEY) return reply({ error: 'The contact form is not set up yet. Please email phillip@insightful.media.' }, 503);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${E.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: E.CONTACT_FROM, to: [E.CONTACT_TO], reply_to: email,
      subject: `Website message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      html: `<p><strong>Name:</strong> ${esc(name)}<br><strong>Email:</strong> ${esc(email)}</p><p>${esc(message).replace(/\n/g, '<br>')}</p>`,
    }),
  });
  if (!r.ok) { console.error('Resend error', r.status, await r.text()); return reply({ error: 'Sorry, the message could not be sent. Please email phillip@insightful.media.' }, 502); }
  return reply({ ok: true });
};
