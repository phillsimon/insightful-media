import { handle, json, HttpError, listDir, readFile, COLLECTIONS } from '../../../lib/server';
export const prerender = false;
// GET ?collection=caseStudy|testimonial|post -> all items including unpublished
export const GET = handle(async (req) => {
  const c = new URL(req.url).searchParams.get('collection') || '';
  const dir = COLLECTIONS[c];
  if (!dir) throw new HttpError(400, 'Unknown collection');
  const paths = await listDir(dir);
  const items = await Promise.all(paths.map(async (path) => {
    const f = await readFile(path);
    return f ? { path, data: JSON.parse(f.text) } : null;
  }));
  return json({ items: items.filter(Boolean) });
});
