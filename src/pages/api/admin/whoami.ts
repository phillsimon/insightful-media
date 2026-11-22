import { handle, json } from '../../../lib/server';
export const prerender = false;
export const GET = handle(async (_req, email) => json({ email }));
