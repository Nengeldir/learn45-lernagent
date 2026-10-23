import { randomUUID } from 'node:crypto';

export const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
export const nowIso = () => new Date().toISOString();

/** Pulls the first JSON object out of a model reply (models sometimes wrap JSON in prose or fences). */
export function extractJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
