# insightful.media

The Insightful Media LLC website, rebuilt with [Astro](https://astro.build) and hosted on Cloudflare Workers. It replaces the old WordPress/Elementor site and keeps the same look and the same URLs.

## How editing works

1. Go to **https://insightful.media/admin/** and log in. Cloudflare Access emails you a one-time code.
2. That turns on **edit mode** in your browser. Every page now has an edit bar at the top.
3. Hover over any text, image, video or gallery and click the orange **✎ pencil**:
   - **Text** becomes editable in place. Click **Save**, or press Esc to cancel.
   - **Images** open a picker. The new image is resized and uploaded automatically.
   - **Videos** can be uploaded straight to Cloudflare Stream, or you can paste a YouTube or Vimeo link.
   - **Galleries** (Photography, home page slider) let you add, remove, reorder and caption photos.
4. Case studies, testimonials and blog posts have **Edit all / ↑ / ↓ / Delete** buttons, and each list has a **+ Add** button.
5. The **Dashboard** (/admin/) lists everything, including hidden items and drafts.

Each save is a commit to this GitHub repo. Cloudflare rebuilds the site automatically, usually in about a minute. Nothing is ever lost, because every version stays in the Git history.

To turn edit mode off in your browser, click **Exit edit mode**.

## Where content lives

| What | File(s) |
|---|---|
| Page text (Home, About, What we provide…) | `src/content/pages/*.json` |
| Case studies (Video and film, Web & app design) | `src/content/case-studies/*.json` |
| Testimonials | `src/content/testimonials/*.json` |
| Blog posts | `src/content/posts/*.json` (Blog shows in the menu once a post is published) |
| Site settings | `src/content/settings.json` |
| Images | `public/media/` (uploads go to `public/media/uploads/YEAR/`) |

## One-time setup

### 1. Move DNS to Cloudflare (free plan)
1. In the Cloudflare dashboard, **Add a domain**: `insightful.media`.
2. Check the imported DNS records. These **must** be kept:
   - MX records for Google Workspace (`aspmx.l.google.com` and the `alt` servers)
   - TXT `v=spf1 include:_spf.google.com include:sender.zohoinvoice.com include:sendgrid.net ~all`
   - TXT `google-site-verification=…`
   - TXT `1522905413783._domainkey` (DKIM)
   - Leave the A record pointing to SiteGround (`35.209.124.137`) for now, so the old site stays up.
3. At your domain registrar, change the nameservers to the two that Cloudflare gives you.

### 2. Deploy from GitHub
Go to **Workers & Pages → Create → Import a repository** and choose `phillsimon/insightful-media`.
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

You get a preview address like `insightful-media.<you>.workers.dev`. Every push to `main` redeploys.

### 3. Protect the editor with Cloudflare Access
Go to **Zero Trust → Access → Applications → Add → Self-hosted**.
- Domains: `insightful.media/admin` and `insightful.media/api/admin`. While testing, also add the workers.dev host with the same two paths.
- Policy: **Allow**, Include → Emails → `phillip@insightful.media`.
- Login method: One-time PIN.

Copy the **Application Audience (AUD) tag** into `ACCESS_AUD` in `wrangler.jsonc`, and your team domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`. The API checks the Access login itself too, so editing stays locked even if Access is misconfigured.

### 4. Secrets
Set these in **Worker → Settings → Variables and secrets**, or with `npx wrangler secret put NAME`:

| Secret | What it is |
|---|---|
| `GITHUB_TOKEN` | GitHub fine-grained token, **only this repo**, permission *Contents: Read and write* |
| `CF_STREAM_TOKEN` | Cloudflare API token with *Stream: Edit* (also set `CF_ACCOUNT_ID` in `wrangler.jsonc`) |
| `TURNSTILE_SECRET` | Turnstile secret key (contact form spam check) |
| `RESEND_API_KEY` | [Resend](https://resend.com) key for sending contact form email (verify `send.insightful.media` in Resend) |

Then open **Dashboard → Site settings** and fill in the Stream customer code (from `customer-XXXX.cloudflarestream.com`) and the Turnstile site key.

### 5. Go live
Go to **Worker → Settings → Domains & Routes → Add → Custom domain** and add `insightful.media` and `www.insightful.media`. This replaces the SiteGround A record. Old WordPress URLs redirect to the new pages (see `public/_redirects`).

## Local development
```sh
npm install
cp .dev.vars.example .dev.vars   # DEV_EDITOR_EMAIL skips Access on localhost only
npm run dev
```
