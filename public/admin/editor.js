/* Insightful Media pencil editor.
 * Loaded only when edit mode is on (set by visiting /admin/, which Cloudflare Access protects).
 * Every save goes to /api/admin/*, which verifies your Access login, then commits to GitHub.
 * Cloudflare rebuilds the site from GitHub in about a minute.
 */
(() => {
  if (window.IMEditor) return;
  const API = '/api/admin';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(k));
    return el;
  };

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body instanceof FormData) init.body = opts.body;
    else if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
    const r = await fetch(API + path, init);
    const ct = r.headers.get('content-type') || '';
    const out = ct.includes('json') ? await r.json() : { error: r.status === 401 || r.redirected ? 'Not logged in' : `Error ${r.status}` };
    if (!r.ok) throw new Error(out.error || `Error ${r.status}`);
    return out;
  }
  const getFile = (path) => api('/content/?path=' + encodeURIComponent(path)).then((r) => r.data);
  const patch = (path, set) => api('/content/', { method: 'PATCH', body: { path, set } });
  const putFile = (path, data) => api('/content/', { method: 'PUT', body: { path, data } });
  const createItem = (collection, data) => api('/content/', { method: 'PUT', body: { collection, data, create: true } });
  const delFile = (path) => api('/content/?path=' + encodeURIComponent(path), { method: 'DELETE' });

  /* ---------------- UI chrome ---------------- */
  let toastTimer;
  function toast(msg, kind = 'ok', ms = 5000) {
    let t = $('#im-toast');
    if (!t) { t = h('div', { id: 'im-toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
    t.className = 'im-toast im-' + kind; t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
  }
  const saved = () => toast('Saved. The live site updates in about a minute.');
  const fail = (e) => toast(e.message || String(e), 'err', 9000);

  function bar(email) {
    const b = h('div', { id: 'im-bar' },
      h('strong', {}, '✎ Edit mode'),
      h('span', {}, email ? ` · ${email}` : ' · not logged in'),
      h('span', { class: 'im-spacer' }),
      email ? h('a', { href: '/admin/' }, 'Dashboard') : h('a', { href: '/admin/' }, 'Log in'),
      h('button', { type: 'button', onclick: () => { document.body.classList.toggle('im-preview'); } }, 'Preview'),
      h('button', { type: 'button', onclick: () => { localStorage.removeItem('im-edit'); location.reload(); } }, 'Exit edit mode'),
    );
    document.body.prepend(b);
    document.body.classList.add('im-editing');
  }

  /* ---------------- Modal helper ---------------- */
  function modal(title, body, { saveLabel = 'Save', onSave, wide = false } = {}) {
    const dlg = h('dialog', { class: 'im-modal' + (wide ? ' im-wide' : '') });
    const status = h('p', { class: 'im-status', role: 'status' });
    const close = () => { dlg.close(); dlg.remove(); };
    const save = h('button', { type: 'submit', class: 'im-primary' }, saveLabel);
    const form = h('form', { method: 'dialog' },
      h('h2', {}, title), body, status,
      h('div', { class: 'im-actions' }, h('button', { type: 'button', onclick: close }, 'Cancel'), onSave && save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSave) return close();
      save.disabled = true; status.textContent = 'Saving…';
      try { await onSave(); close(); } catch (err) { status.textContent = err.message; save.disabled = false; }
    });
    dlg.append(form); document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    return { dlg, status, close };
  }

  /* ---------------- Images ---------------- */
  async function pickFiles(accept, multiple = false) {
    return new Promise((resolve) => {
      const i = h('input', { type: 'file', accept, multiple });
      i.addEventListener('change', () => resolve([...i.files]));
      i.click();
    });
  }
  async function resizeImage(file, max = 2000) {
    if (file.type === 'image/gif') return file; // keep animation
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = h('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' });
  }
  async function uploadImage(file, onStatus = () => {}) {
    onStatus('Preparing image…');
    const small = await resizeImage(file);
    onStatus(`Uploading ${Math.round(small.size / 1024)} KB…`);
    const fd = new FormData(); fd.append('file', small); fd.append('name', file.name);
    const { src } = await api('/upload/', { method: 'POST', body: fd });
    return { src, preview: URL.createObjectURL(small) };
  }
  const previews = new Map(); // src -> local preview URL (new images aren't live until the rebuild)
  const imgSrc = (src) => previews.get(src) || src;

  function imageField(value = { src: '', alt: '' }, label = 'Image') {
    let v = { src: value?.src || '', alt: value?.alt || '' };
    const img = h('img', { class: 'im-thumb', alt: '', src: v.src ? imgSrc(v.src) : null, hidden: !v.src });
    const msg = h('span', { class: 'im-hint' });
    const alt = h('input', { type: 'text', value: v.alt, placeholder: 'Describe the image for screen readers' });
    alt.addEventListener('input', () => (v.alt = alt.value));
    const choose = h('button', { type: 'button', onclick: async () => {
      const [f] = await pickFiles('image/*'); if (!f) return;
      try { const up = await uploadImage(f, (s) => (msg.textContent = s)); v.src = up.src; previews.set(up.src, up.preview); img.src = up.preview; img.hidden = false; msg.textContent = 'Uploaded.'; }
      catch (e) { msg.textContent = e.message; }
    } }, v.src ? 'Replace image' : 'Choose image');
    const remove = h('button', { type: 'button', onclick: () => { v.src = ''; img.hidden = true; } }, 'Remove');
    const el = h('fieldset', { class: 'im-field' }, h('legend', {}, label), img, h('div', {}, choose, ' ', remove, ' ', msg), h('label', {}, 'Alt text', alt));
    return { el, get: () => (v.src ? { ...v } : null) };
  }

  /* ---------------- Video ---------------- */
  function parseVideo(s) {
    s = (s || '').trim(); if (!s) return null;
    let m;
    if ((m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/))) return { provider: 'youtube', id: m[1] };
    if ((m = s.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/(\w+))?(?:\?h=(\w+))?/))) { const hash = m[3] || m[2]; return { provider: 'vimeo', id: m[1] + (hash ? '?h=' + hash : '') }; }
    if ((m = s.match(/([a-f0-9]{32})/))) return { provider: 'stream', id: m[1] };
    throw new Error('Paste a YouTube or Vimeo link, or a Cloudflare Stream video ID.');
  }
  const videoLabel = (v) => !v ? 'No video' : v.provider === 'stream' ? `Cloudflare Stream: ${v.id}` : v.provider === 'youtube' ? `YouTube: https://youtu.be/${v.id}` : `Vimeo: https://vimeo.com/${v.id.replace('?h=', '/')}`;
  function uploadToStream(file, onProgress) {
    return api('/stream/', { method: 'POST', body: { name: file.name } }).then(({ uploadURL, uid }) => new Promise((resolve, reject) => {
      if (file.size > 200 * 1024 * 1024) return reject(new Error('Files over 200 MB: upload in the Cloudflare dashboard (Stream), then paste the video ID here.'));
      const xhr = new XMLHttpRequest(); const fd = new FormData(); fd.append('file', file);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => (xhr.status < 300 ? resolve({ provider: 'stream', id: uid }) : reject(new Error('Upload failed: ' + xhr.status)));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.open('POST', uploadURL); xhr.send(fd);
    }));
  }
  function videoField(value, label = 'Video') {
    let v = value ? { ...value } : null;
    const cur = h('p', { class: 'im-hint' }, videoLabel(v));
    const url = h('input', { type: 'text', placeholder: 'Paste YouTube / Vimeo link or Stream video ID' });
    url.addEventListener('change', () => { try { v = parseVideo(url.value); cur.textContent = videoLabel(v); } catch (e) { cur.textContent = e.message; } });
    const prog = h('progress', { max: 100, value: 0, hidden: true });
    const up = h('button', { type: 'button', onclick: async () => {
      const [f] = await pickFiles('video/*'); if (!f) return;
      prog.hidden = false; cur.textContent = 'Uploading to Cloudflare Stream…';
      try { v = await uploadToStream(f, (p) => (prog.value = p)); cur.textContent = videoLabel(v) + ' (processing can take a few minutes)'; }
      catch (e) { cur.textContent = e.message; }
      prog.hidden = true;
    } }, 'Upload video file to Stream');
    const clear = h('button', { type: 'button', onclick: () => { v = null; cur.textContent = videoLabel(v); } }, 'Remove');
    const el = h('fieldset', { class: 'im-field' }, h('legend', {}, label), cur, h('div', {}, up, ' ', clear), prog, h('label', {}, 'Or link an existing video', url));
    return { el, get: () => v };
  }

  /* ---------------- Rich text ---------------- */
  function toolbarFor(target) {
    const cmd = (c, val) => () => { target.focus(); document.execCommand(c, false, val); };
    return h('div', { class: 'im-rt-bar', onmousedown: (e) => e.preventDefault() },
      h('button', { type: 'button', title: 'Bold', onclick: cmd('bold') }, h('b', {}, 'B')),
      h('button', { type: 'button', title: 'Italic', onclick: cmd('italic') }, h('i', {}, 'I')),
      h('button', { type: 'button', title: 'Heading', onclick: cmd('formatBlock', 'h3') }, 'H'),
      h('button', { type: 'button', title: 'Paragraph', onclick: cmd('formatBlock', 'p') }, '¶'),
      h('button', { type: 'button', title: 'Bulleted list', onclick: cmd('insertUnorderedList') }, '•'),
      h('button', { type: 'button', title: 'Numbered list', onclick: cmd('insertOrderedList') }, '1.'),
      h('button', { type: 'button', title: 'Link', onclick: () => { const u = prompt('Link address (https://… or /page/)'); if (u) cmd('createLink', u)(); } }, '🔗'),
      h('button', { type: 'button', title: 'Remove link', onclick: cmd('unlink') }, '⛓̸'),
      h('button', { type: 'button', title: 'Clear formatting', onclick: cmd('removeFormat') }, '⨯'),
    );
  }
  function richField(html = '', label = 'Text') {
    const box = h('div', { class: 'im-rich', contenteditable: 'true', html: html || '<p></p>' });
    pasteAsCleanText(box);
    return { el: h('div', { class: 'im-field' }, h('span', { class: 'im-label' }, label), toolbarFor(box), box), get: () => box.innerHTML };
  }
  function pasteAsCleanText(el) {
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }

  /* ---------------- Inline (pencil) editing ---------------- */
  const pencil = h('button', { type: 'button', class: 'im-pencil', 'aria-label': 'Edit this', title: 'Edit' }, '✎');
  let hoverEl = null;
  function placePencil(el) {
    hoverEl = el;
    const r = el.getBoundingClientRect();
    pencil.style.top = `${Math.max(r.top + scrollY - 6, scrollY + 40)}px`;
    pencil.style.left = `${Math.min(r.right + scrollX - 24, scrollX + innerWidth - 40)}px`;
    pencil.hidden = false;
  }
  pencil.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (hoverEl) startEdit(hoverEl); });

  const parseRef = (el) => { const [file, key] = el.dataset.edit.split('#'); return { file, key }; };

  function inlineControls(el, onSave, onCancel, extra) {
    const wrap = h('div', { class: 'im-inline-actions' },
      extra || null,
      h('button', { type: 'button', class: 'im-primary', onclick: onSave }, 'Save'),
      h('button', { type: 'button', onclick: onCancel }, 'Cancel'));
    el.after(wrap);
    return wrap;
  }

  async function startEdit(el) {
    if (el.classList.contains('im-active')) return;
    pencil.hidden = true;
    const { file, key } = parseRef(el);
    const type = el.dataset.editType || 'text';
    try {
      if (type === 'text' || type === 'html') return editInline(el, file, key, type);
      if (type === 'image') return editImage(el, file, key);
      if (type === 'video') return editVideo(el, file, key);
      if (type === 'gallery') return editGallery(el, file, key);
      if (type === 'list') return editList(el, file, key);
    } catch (e) { fail(e); }
  }

  function editInline(el, file, key, type) {
    const before = type === 'html' ? el.innerHTML : el.textContent;
    el.classList.add('im-active');
    el.setAttribute('contenteditable', type === 'html' ? 'true' : 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only' && type === 'text') el.setAttribute('contenteditable', 'true');
    if (type === 'text') pasteAsCleanText(el);
    if (type === 'text') el.addEventListener('keydown', function enter(e) { if (e.key === 'Enter' && el.tagName !== 'DIV') { e.preventDefault(); save(); } if (!el.isContentEditable) el.removeEventListener('keydown', enter); });
    const tb = type === 'html' ? toolbarFor(el) : null;
    if (tb) el.before(tb);
    el.focus();
    const done = () => { el.removeAttribute('contenteditable'); el.classList.remove('im-active'); tb?.remove(); controls.remove(); };
    const cancel = () => { if (type === 'html') el.innerHTML = before; else el.textContent = before; done(); };
    const save = async () => {
      const value = type === 'html' ? el.innerHTML : el.textContent.trim();
      done(); el.classList.add('im-saving');
      try { const r = await patch(file, { [key]: value }); saved(); if (type === 'html') { const v = key.split('.').reduce((o, k) => o?.[k], r.data); if (typeof v === 'string') el.innerHTML = v; } }
      catch (e) { fail(e); if (type === 'html') el.innerHTML = before; else el.textContent = before; }
      el.classList.remove('im-saving');
    };
    const controls = inlineControls(el, save, cancel);
    el.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { cancel(); el.removeEventListener('keydown', esc); } });
  }

  async function editImage(el, file, key) {
    const data = await getFile(file);
    const cur = key.split('.').reduce((o, k) => o?.[k], data);
    const f = imageField(cur, 'Image');
    modal('Change image', f.el, { onSave: async () => {
      const v = f.get();
      await patch(file, { [key]: v });
      if (el.tagName === 'IMG') { if (v) { el.src = imgSrc(v.src); el.alt = v.alt; } else el.remove(); }
      saved();
    } });
  }

  async function editVideo(el, file, key) {
    const data = await getFile(file);
    const cur = key.split('.').reduce((o, k) => o?.[k], data);
    const f = videoField(cur);
    modal('Change video', f.el, { onSave: async () => { await patch(file, { [key]: f.get() }); saved(); toast('Saved. The new video appears after the site updates (about a minute).'); } });
  }

  async function editGallery(el, file, key) {
    const data = await getFile(file);
    let items = (key.split('.').reduce((o, k) => o?.[k], data) || []).map((x) => ({ ...x }));
    const list = h('ol', { class: 'im-gallery' });
    const render = () => {
      list.replaceChildren(...items.map((it, i) => {
        const alt = h('input', { type: 'text', value: it.alt || '', placeholder: 'Alt text' }); alt.addEventListener('input', () => (it.alt = alt.value));
        const cap = 'caption' in it ? h('input', { type: 'text', value: it.caption || '', placeholder: 'Caption (optional)' }) : null;
        cap?.addEventListener('input', () => (it.caption = cap.value));
        return h('li', {},
          h('img', { src: imgSrc(it.src), alt: '' }),
          h('div', { class: 'im-gal-fields' }, alt, cap),
          h('div', { class: 'im-gal-btns' },
            h('button', { type: 'button', title: 'Move up', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); } }, '↑'),
            h('button', { type: 'button', title: 'Move down', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); } }, '↓'),
            h('button', { type: 'button', title: 'Replace', onclick: async () => { const [f] = await pickFiles('image/*'); if (!f) return; const up = await uploadImage(f, (s) => (m.status.textContent = s)); previews.set(up.src, up.preview); it.src = up.src; m.status.textContent = ''; render(); } }, 'Replace'),
            h('button', { type: 'button', title: 'Remove', onclick: () => { items.splice(i, 1); render(); } }, 'Remove')));
      }));
    };
    const hasCaptions = items.some((x) => 'caption' in x);
    const add = h('button', { type: 'button', onclick: async () => {
      const files = await pickFiles('image/*', true);
      for (const [n, f] of files.entries()) {
        const up = await uploadImage(f, (s) => (m.status.textContent = `${n + 1}/${files.length}: ${s}`));
        previews.set(up.src, up.preview);
        items.push(hasCaptions ? { src: up.src, alt: '', caption: '' } : { src: up.src, alt: '' });
        render();
      }
      m.status.textContent = '';
    } }, '+ Add images');
    render();
    const m = modal('Edit images', h('div', {}, list, add), { wide: true, onSave: async () => { await patch(file, { [key]: items }); saved(); } });
  }

  async function editList(el, file, key) {
    const data = await getFile(file);
    const rows = (key.split('.').reduce((o, k) => o?.[k], data) || []).map((x) => ({ ...x }));
    const f = detailsField(rows);
    modal('Edit details', f.el, { onSave: async () => {
      const v = f.get(); await patch(file, { [key]: v });
      el.innerHTML = v.map((x) => `<p><strong>${esc(x.label)}</strong>: ${esc(x.value)}</p>`).join('');
      saved();
    } });
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function detailsField(rows, label = 'Details (Client, Role, Agency…)') {
    const box = h('div', { class: 'im-rows' });
    const render = () => box.replaceChildren(...rows.map((r, i) => {
      const l = h('input', { type: 'text', value: r.label, placeholder: 'Label, e.g. Client', 'aria-label': 'Label' }); l.addEventListener('input', () => (r.label = l.value));
      const v = h('input', { type: 'text', value: r.value, placeholder: 'Value', 'aria-label': 'Value' }); v.addEventListener('input', () => (r.value = v.value));
      return h('div', { class: 'im-row' }, l, v,
        h('button', { type: 'button', title: 'Move up', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; render(); } }, '↑'),
        h('button', { type: 'button', title: 'Remove', onclick: () => { rows.splice(i, 1); render(); } }, '✕'));
    }));
    render();
    const el = h('fieldset', { class: 'im-field' }, h('legend', {}, label), box, h('button', { type: 'button', onclick: () => { rows.push({ label: '', value: '' }); render(); } }, '+ Add line'));
    return { el, get: () => rows.filter((r) => r.label.trim() || r.value.trim()) };
  }

  /* ---------------- Item forms (case studies, testimonials, posts) ---------------- */
  const SCHEMAS = {
    caseStudy: { name: 'case study', fields: [
      ['title', 'text', 'Title'], ['category', 'select', 'Page', [['video', 'Video and film'], ['web', 'Web & app design']]],
      ['video', 'video', 'Video (video case studies)'], ['image', 'image', 'Screenshot / image (web case studies)'],
      ['bodyHtml', 'rich', 'Description'], ['details', 'details', 'Details'],
      ['order', 'number', 'Position on page (1 = top)'], ['published', 'checkbox', 'Show on site'],
    ], defaults: { category: 'video', published: true, order: 1, details: [{ label: 'Role', value: '' }, { label: 'Client', value: '' }], bodyHtml: '', image: null, video: null } },
    testimonial: { name: 'testimonial', fields: [
      ['quote', 'textarea', 'Quote'], ['name', 'text', 'Name'], ['title', 'text', 'Title / organization'],
      ['featured', 'checkbox', 'Show on home page'], ['homeOrder', 'number', 'Position on home page'],
      ['order', 'number', 'Position on About page'], ['published', 'checkbox', 'Show on site'],
    ], defaults: { featured: false, homeOrder: 0, order: 99, published: true, title: '' } },
    post: { name: 'blog post', fields: [
      ['title', 'text', 'Title'], ['date', 'date', 'Date'], ['excerpt', 'textarea', 'Short summary (shown in the list)'],
      ['hero', 'image', 'Main image'], ['video', 'video', 'Video (optional)'], ['bodyHtml', 'rich', 'Post'],
      ['tags', 'tags', 'Tags (comma separated)'], ['published', 'checkbox', 'Published (uncheck to keep as draft)'],
    ], defaults: () => ({ date: new Date().toISOString().slice(0, 10), published: true, tags: [], excerpt: '', hero: null, video: null, bodyHtml: '' }) },
  };

  function buildForm(type, data) {
    const s = SCHEMAS[type]; const getters = {};
    const fields = s.fields.map(([k, kind, label, opts]) => { const el = field(k, kind, label, opts); el.dataset.k = k; return el; });
    function field(k, kind, label, opts) {
      const v = data[k];
      if (kind === 'image') { const f = imageField(v, label); getters[k] = f.get; return f.el; }
      if (kind === 'video') { const f = videoField(v, label); getters[k] = f.get; return f.el; }
      if (kind === 'rich') { const f = richField(v, label); getters[k] = f.get; return f.el; }
      if (kind === 'details') { const f = detailsField((v || []).map((x) => ({ ...x })), label); getters[k] = f.get; return f.el; }
      let input;
      if (kind === 'textarea') input = h('textarea', { rows: 5 }, v || '');
      else if (kind === 'select') { input = h('select', {}, ...opts.map(([val, l]) => h('option', { value: val, selected: v === val }, l))); }
      else if (kind === 'checkbox') input = h('input', { type: 'checkbox', checked: !!v });
      else if (kind === 'date') input = h('input', { type: 'date', value: v ? String(v).slice(0, 10) : '' });
      else if (kind === 'number') input = h('input', { type: 'number', value: v ?? '', step: '1' });
      else if (kind === 'tags') input = h('input', { type: 'text', value: (v || []).join(', ') });
      else input = h('input', { type: 'text', value: v || '', required: k === 'title' || k === 'name' || k === 'quote' });
      getters[k] = () => kind === 'checkbox' ? input.checked : kind === 'number' ? Number(input.value || 0) : kind === 'tags' ? input.value.split(',').map((x) => x.trim()).filter(Boolean) : input.value.trim();
      return h('label', { class: 'im-field' + (kind === 'checkbox' ? ' im-check' : '') }, kind === 'checkbox' ? [input, ' ', label] : [label, input]);
    }
    const form = h('div', { class: 'im-form' }, fields);
    if (type === 'caseStudy') {
      const sel = form.querySelector('[data-k="category"] select');
      const sync = () => { form.querySelector('[data-k="video"]').hidden = sel.value !== 'video'; form.querySelector('[data-k="image"]').hidden = sel.value !== 'web'; };
      sel.addEventListener('change', sync); sync();
    }
    return { el: form, get: () => { const out = { ...data }; for (const k in getters) out[k] = getters[k](); return out; } };
  }

  async function editItem(type, path, after) {
    const data = await getFile(path);
    const f = buildForm(type, data);
    modal(`Edit ${SCHEMAS[type].name}`, f.el, { wide: true, onSave: async () => { await putFile(path, f.get()); saved(); after?.(); } });
  }
  function newItem(type, preset = {}, after) {
    const d = SCHEMAS[type].defaults; const data = { ...(typeof d === 'function' ? d() : d), ...preset };
    const f = buildForm(type, data);
    modal(`New ${SCHEMAS[type].name}`, f.el, { wide: true, saveLabel: 'Create', onSave: async () => {
      const v = f.get();
      if (type === 'caseStudy') { v.video = v.category === 'video' ? v.video : null; v.image = v.category === 'web' ? v.image : null; }
      await createItem(type, v); toast('Created. It appears on the site in about a minute.'); after?.();
    } });
  }
  async function deleteItem(path, label, after) {
    if (!confirm(`Delete "${label}"? This removes it from the site. (It stays in GitHub history if you need it back.)`)) return;
    try { await delFile(path); toast('Deleted. The site updates in about a minute.'); after?.(); } catch (e) { fail(e); }
  }
  async function moveItem(path, dir) {
    const el = $(`[data-item="${CSS.escape(path)}"]`); const sib = dir < 0 ? el?.previousElementSibling : el?.nextElementSibling;
    if (!sib?.dataset.item) return;
    try {
      const [a, b] = await Promise.all([getFile(path), getFile(sib.dataset.item)]);
      const isHome = el.closest('.home-testimonials'); const k = isHome ? 'homeOrder' : 'order';
      let ao = a[k], bo = b[k]; if (ao === bo) { ao = dir < 0 ? bo - 1 : bo + 1; } else [ao, bo] = [bo, ao];
      await patch(path, { [k]: ao }); await patch(sib.dataset.item, { [k]: bo });
      if (dir < 0) sib.before(el); else sib.after(el);
      saved();
    } catch (e) { fail(e); }
  }

  /* ---------------- Wire up the page ---------------- */
  function decorate() {
    document.body.append(pencil); pencil.hidden = true;
    document.addEventListener('mouseover', (e) => {
      if (document.body.classList.contains('im-preview')) return;
      const el = e.target.closest?.('[data-edit]');
      if (el && !el.classList.contains('im-active') && !el.closest('.im-modal')) placePencil(el);
    });
    document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-edit]'); if (el && !el.classList.contains('im-active')) placePencil(el); });
    // Stop links/buttons inside editable areas from navigating while editing
    document.addEventListener('click', (e) => {
      if (document.body.classList.contains('im-preview')) return;
      const el = e.target.closest?.('[data-edit]');
      if (el && (e.target.closest('a') || el.closest('a')) && !el.classList.contains('im-active') && !e.target.closest('#im-bar')) e.preventDefault();
    }, true);
    $$('[data-edit]').forEach((el) => { if (!el.matches('a, button, input, [tabindex]')) el.tabIndex = 0; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('[data-edit]:not(.im-active)')) { e.preventDefault(); startEdit(e.target); } });

    // Item toolbars
    $$('[data-item]').forEach((el) => {
      const type = el.dataset.itemType; const path = el.dataset.item;
      const label = el.querySelector('h3, .t-name, h2')?.textContent?.trim() || 'this item';
      el.classList.add('im-item');
      el.append(h('div', { class: 'im-item-bar' },
        h('button', { type: 'button', onclick: () => editItem(type, path).catch(fail) }, '✎ Edit all'),
        h('button', { type: 'button', title: 'Move up', onclick: () => moveItem(path, -1) }, '↑'),
        h('button', { type: 'button', title: 'Move down', onclick: () => moveItem(path, 1) }, '↓'),
        h('button', { type: 'button', class: 'im-danger', onclick: () => deleteItem(path, label, () => el.remove()) }, 'Delete')));
    });
    // Add buttons
    $$('[data-collection]').forEach((el) => {
      const type = el.dataset.collection; const preset = el.dataset.category ? { category: el.dataset.category } : {};
      const items = $$('[data-item]', el);
      if (type === 'caseStudy') preset.order = items.length + 1;
      if (type === 'testimonial') preset.order = items.length + 1;
      el.after(h('button', { type: 'button', class: 'im-add', onclick: () => newItem(type, preset) }, `+ Add ${SCHEMAS[type].name}`));
    });
    const home = $('.home-testimonials');
    if (home) home.append(h('p', { class: 'im-hint im-note' }, 'To choose which testimonials show here, use "Edit all" on a testimonial on the About page and tick "Show on home page".'));
  }

  async function init() {
    let email = null;
    try { email = (await api('/whoami/')).email; } catch (e) { /* not logged in */ }
    bar(email);
    if (!email) { toast('Log in to edit: click "Log in" in the top bar.', 'err', 0); return; }
    decorate();
  }

  window.IMEditor = { api, newItem, editItem, deleteItem, getFile, putFile, patch, buildForm, modal, toast, imageField };
  if (!window.IM_NO_DECORATE) (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init());
})();
