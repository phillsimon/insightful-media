import { handle, json, HttpError, writeFile, slugify } from '../../../lib/server';
export const prerender = false;
const TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
// POST multipart: file, name  -> commits image to public/media/uploads/YYYY/ and returns its URL
export const POST = handle(async (req, email) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file');
  const ext = TYPES[file.type];
  if (!ext) throw new HttpError(400, 'Use a JPG, PNG, WebP or GIF image.');
  if (file.size > 20 * 1024 * 1024) throw new HttpError(413, 'Image is larger than 20 MB.');
  const base = slugify(String(form.get('name') || file.name).replace(/\.[a-z0-9]+$/i, ''));
  const rand = crypto.randomUUID().slice(0, 6);
  const year = new Date().getUTCFullYear();
  const path = `public/media/uploads/${year}/${base}-${rand}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await writeFile(path, btoa(bin), `Upload ${path.replace('public/', '')} by ${email}`);
  return json({ src: '/' + path.replace(/^public\//, '') });
});
