import { handle, json, HttpError, checkPath, readFile, writeJson, deleteFile, sanitize, setPath, slugify, COLLECTIONS } from '../../../lib/server';
export const prerender = false;

// GET ?path=...  -> current JSON from GitHub
export const GET = handle(async (req) => {
  const path = new URL(req.url).searchParams.get('path') || '';
  checkPath(path);
  const f = await readFile(path);
  if (!f) throw new HttpError(404, 'Not found');
  return json({ data: JSON.parse(f.text) });
});

// PATCH { path, set: { "dot.key": value } }  -> read, change keys, commit
export const PATCH = handle(async (req, email) => {
  const { path, set } = await req.json() as any;
  checkPath(path);
  if (!set || typeof set !== 'object') throw new HttpError(400, 'Nothing to save');
  for (let attempt = 0; attempt < 2; attempt++) {
    const f = await readFile(path);
    if (!f) throw new HttpError(404, 'Not found');
    const data = JSON.parse(f.text);
    for (const [k, v] of Object.entries(set)) setPath(data, k, v);
    const clean = sanitize(data);
    try {
      await writeJson(path, clean, `Edit ${path.replace('src/content/', '')} (${Object.keys(set).join(', ')}) by ${email}`, f.sha);
      return json({ ok: true, data: clean });
    } catch (e: any) { if (e.status !== 409 || attempt === 1) throw e; }
  }
  throw new HttpError(409, 'Could not save');
});

// PUT { path?, collection?, data, create? }  -> replace whole file, or create a new item
export const PUT = handle(async (req, email) => {
  const body = await req.json() as any;
  let path: string = body.path;
  if (body.create) {
    const dir = COLLECTIONS[body.collection];
    if (!dir) throw new HttpError(400, 'Unknown collection');
    const base = slugify((body.collection === 'testimonial' ? body.data?.name : body.data?.title) || 'item');
    path = `${dir}/${base}.json`;
    for (let n = 2; await readFile(path); n++) path = `${dir}/${base}-${n}.json`;
  }
  checkPath(path);
  const existing = body.create ? null : await readFile(path);
  if (!body.create && !existing) throw new HttpError(404, 'Not found');
  const clean = sanitize(body.data);
  await writeJson(path, clean, `${body.create ? 'Add' : 'Update'} ${path.replace('src/content/', '')} by ${email}`, existing?.sha);
  return json({ ok: true, path, data: clean });
});

// DELETE ?path=...
export const DELETE = handle(async (req, email) => {
  const path = new URL(req.url).searchParams.get('path') || '';
  checkPath(path, true);
  await deleteFile(path, `Delete ${path.replace('src/content/', '')} by ${email}`);
  return json({ ok: true });
});
