import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const image = z.object({ src: z.string(), alt: z.string().default('') });
const video = z.object({
  provider: z.enum(['stream', 'youtube', 'vimeo']),
  id: z.string(),
  poster: z.string().optional(),
});

const caseStudies = defineCollection({
  loader: glob({ base: './src/content/case-studies', pattern: '*.json' }),
  schema: z.object({
    title: z.string(),
    category: z.enum(['web', 'video']),
    order: z.number().default(99),
    published: z.boolean().default(true),
    image: image.nullable().optional(),
    video: video.nullable().optional(),
    details: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
    bodyHtml: z.string().default(''),
  }),
});

const testimonials = defineCollection({
  loader: glob({ base: './src/content/testimonials', pattern: '*.json' }),
  schema: z.object({
    name: z.string(),
    title: z.string().default(''),
    quote: z.string(),
    featured: z.boolean().default(false),
    homeOrder: z.number().default(0),
    order: z.number().default(99),
    published: z.boolean().default(true),
  }),
});

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '*.json' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    excerpt: z.string().default(''),
    hero: image.nullable().optional(),
    video: video.nullable().optional(),
    tags: z.array(z.string()).default([]),
    published: z.boolean().default(true),
    bodyHtml: z.string().default(''),
  }),
});

export const collections = { caseStudies, testimonials, posts };
