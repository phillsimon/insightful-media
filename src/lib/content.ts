import settingsJson from '../content/settings.json';
import { getCollection } from 'astro:content';

const pageFiles = import.meta.glob('../content/pages/*.json', { eager: true, import: 'default' });

export const settings = settingsJson as any;

/** Load an editable page file and its repo path (used by the pencil editor). */
export function page(slug: string) {
  const key = `../content/pages/${slug}.json`;
  const data = pageFiles[key] as any;
  if (!data) throw new Error(`Missing page content: ${slug}`);
  return { data, file: `src/content/pages/${slug}.json` };
}

/** data-edit attributes for an inline-editable element. */
export function ed(file: string, key: string, type: 'text' | 'html' | 'image' | 'video' | 'gallery' | 'list' = 'text') {
  return { 'data-edit': `${file}#${key}`, 'data-edit-type': type };
}

export async function caseStudies(category: 'web' | 'video') {
  const all = await getCollection('caseStudies', (e) => e.data.category === category && e.data.published);
  return all.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));
}

export async function testimonials(featuredOnly = false) {
  const all = await getCollection('testimonials', (e) => e.data.published && (!featuredOnly || e.data.featured));
  return all.sort((a, b) => featuredOnly ? a.data.homeOrder - b.data.homeOrder : a.data.order - b.data.order);
}

export async function posts() {
  const all = await getCollection('posts', (e) => e.data.published);
  return all.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export const nav = [
  { href: '/web-app-design/', label: 'Web & app design' },
  { href: '/video-and-film/', label: 'Video and film' },
  { href: '/photography/', label: 'Photography' },
  { href: '/what-we-provide/', label: 'What we provide' },
  { href: '/how-we-work/', label: 'How we work' },
  { href: '/about-insightful-media/', label: 'About Insightful Media' },
];
