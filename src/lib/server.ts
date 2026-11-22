// Server-side helpers for the editor API: Cloudflare Access auth, GitHub commits, sanitizing.
import { env } from 'cloudflare:workers';
import sanitizeHtml from 'sanitize-html';

const E = env as unknown as Record<string, string>;

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export function handle(fn: (req: Request, email: string) => Promise<Response>) {
  return async ({ request }: { request: Request }) => {
    try {
      const email = await requireEditor(request);
      return await fn(request, email);
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: e.message || 'Server error' }, status);
    }
  };
}

/* ---------------- Cloudflare Access ---------------- */
let jwks: { keys: JsonWebKey[]; at: number } | null = null;
const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function verifyAccessJwt(token: string): Promise<string> {
  const team = E.ACCESS_TEAM_DOMAIN, aud = E.ACCESS_AUD;
  if (!team || !aud || team.includes('CHANGE-ME')) throw new HttpError(500, 'Cloudflare Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD).');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new HttpError(401, 'Bad token');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  if (!jwks || Date.now() - jwks.at > 3600_000) {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
    jwks = { keys: (await r.json() as any).keys, at: Date.now() };
  }
  const jwk = jwks.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new HttpError(401, 'Bad signature');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new HttpError(401, 'Wrong audience');
  if (payload.exp * 1000 < Date.now()) throw new HttpError(401, 'Session expired. Reload /admin/ to log in again.');
  if (payload.iss !== `https://${team}`) throw new HttpError(401, 'Wrong issuer');
  return String(payload.email || '').toLowerCase();
}

export async function requireEditor(req: Request): Promise<string> {
  const url = new URL(req.url);
  // Same-origin check for writes
  if (req.method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Cross-origin request blocked');
  }
  // Local development only: set DEV_EDITOR_EMAIL in .dev.vars
  if (E.DEV_EDITOR_EMAIL && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return E.DEV_EDITOR_EMAIL;
  const cookie = (req.headers.get('cookie') || '').match(/CF_Authorization=([^;]+)/)?.[1];
  const token = req.headers.get('cf-access-jwt-assertion') || cookie;
  if (!token) throw new HttpError(401, 'Not logged in. Open /admin/ to log in.');
  const email = await verifyAccessJwt(token);
  const allowed = (E.EDITOR_EMAILS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  if (!allowed.includes(email)) throw new HttpError(403, `${email} is not allowed to edit.`);
  return email;
}

/* ---------------- GitHub ---------------- */
async function gh(path: string, init: RequestInit = {}) {
  if (!E.GITHUB_TOKEN) throw new HttpError(500, 'GITHUB_TOKEN secret is not set.');
  const r = await fetch(`${E.GITHUB_API || 'https://api.github.com'}/repos/${E.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${E.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'insightful-media-editor',
      'cache-control': 'no-cache',
      ...(init.headers || {}),
    },
  });
  return r;
}
const branch = () => E.GITHUB_BRANCH || 'main';
const toB64 = (s: string) => { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(x); };
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

export async function readFile(path: string): Promise<{ text: string; sha: string } | null> {
  const r = await gh(`/contents/${encodeURI(path)}?ref=${branch()}&t=${Date.now()}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, `GitHub read failed (${r.status})`);
  const j: any = await r.json();
  return { text: fromB64(j.content), sha: j.sha };
}

export async function writeFile(path: string, base64: string, message: string, sha?: string) {
  const r = await gh(`/contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify({ message, content: base64, branch: branch(), ...(sha ? { sha } : {}) }) });
  if (r.status === 409 || r.status === 422) throw new HttpError(409, 'That file changed or already exists. Reload and try again.');
  if (!r.ok) throw new HttpError(502, `GitHub write failed (${r.status}): ${await r.text()}`);
  return ((await r.json()) as any).content.sha as string;
}
export const writeJson = (path: string, data: unknown, message: string, sha?: string) =>
  writeFile(path, toB64(JSON.stringify(data, null, 2) + '\n'), message, sha);

export async function deleteFile(path: string, message: string) {
  const f = await readFile(path);
  if (!f) throw new HttpError(404, 'Not found');
  const r = await gh(`/contents/${encodeURI(path)}`, { method: 'DELETE', body: JSON.stringify({ message, sha: f.sha, branch: branch() }) });
  if (!r.ok) throw new HttpError(502, `GitHub delete failed (${r.status})`);
}

export async function listDir(dir: string): Promise<string[]> {
  const r = await gh(`/contents/${encodeURI(dir)}?ref=${branch()}&t=${Date.now()}`);
  if (r.status === 404) return [];
  if (!r.ok) throw new HttpError(502, `GitHub list failed (${r.status})`);
  return ((await r.json()) as any[]).filter((x) => x.type === 'file' && x.name.endsWith('.json')).map((x) => x.path);
}

/* ---------------- Paths & sanitizing ---------------- */
export const COLLECTIONS: Record<string, string> = {
  caseStudy: 'src/content/case-studies',
  testimonial: 'src/content/testimonials',
  post: 'src/content/posts',
};
const EDITABLE = /^src\/content\/((pages|case-studies|testimonials|posts)\/[a-z0-9][a-z0-9-]{0,80}\.json|settings\.json)$/;
const DELETABLE = /^src\/content\/(case-studies|testimonials|posts)\/[a-z0-9][a-z0-9-]{0,80}\.json$/;
export function checkPath(path: string, forDelete = false) {
  if (!(forDelete ? DELETABLE : EDITABLE).test(path || '')) throw new HttpError(400, 'That file cannot be edited.');
}

const HTML_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: { b: 'strong', i: 'em', div: 'p', h1: 'h2' },
  exclusiveFilter: (f) => f.tag === 'p' && !f.text.trim(),
};
export const cleanHtml = (h: string) => sanitizeHtml(h, HTML_OPTS).replace(/(<br\s*\/?>\s*)+(<\/p>)/g, '$2').trim();

const SAFE_SRC = /^(\/media\/[\w./-]+|https:\/\/[^\s"'<>]+)$/;
/** Recursively sanitize content before it is committed. */
export function sanitize(value: any, key = ''): any {
  if (typeof value === 'string') {
    if (/Html$/.test(key)) return cleanHtml(value);
    if (key === 'src' || key === 'poster') { if (value && !SAFE_SRC.test(value)) throw new HttpError(400, `Unsafe URL: ${value}`); return value; }
    return value.replace(/<[^>]*>/g, '').slice(0, 20000);
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  return value;
}

/** Set a dot-path key like "services.0.bodyHtml" on an object. */
export function setPath(obj: any, path: string, value: any) {
  const parts = path.split('.');
  if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) throw new HttpError(400, 'Bad key');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    if (o[k] == null) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[k];
  }
  const last = parts[parts.length - 1];
  o[/^\d+$/.test(last) ? Number(last) : last] = value;
}

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'item';
export const env_ = E;
