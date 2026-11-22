import type { APIRoute } from 'astro';
import { posts } from '../../lib/content';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async ({ site }) => {
  const base = site!.href.replace(/\/$/, '');
  const items = (await posts()).map((p) => `
    <item>
      <title>${esc(p.data.title)}</title>
      <link>${base}/blog/${p.id}/</link>
      <guid>${base}/blog/${p.id}/</guid>
      <pubDate>${p.data.date.toUTCString()}</pubDate>
      <description>${esc(p.data.excerpt)}</description>
    </item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Insightful Media blog</title><link>${base}/blog/</link>
  <description>News and stories from Insightful Media</description>${items}
</channel></rss>`, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
};
