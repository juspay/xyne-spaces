import { basename, resolve, sep } from 'path';

/** Reduces an untrusted name to one safe path segment (no separators, no leading dots). */
export function safePathSegment(raw: string | null | undefined, fallback: string): string {
  const name = basename(String(raw ?? '').replace(/\\/g, '/'))
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return name || fallback;
}

/** Resolves `name` inside `dir`, or returns null when the result would land outside `dir`. */
export function safeChildPath(dir: string, name: string): string | null {
  const root = resolve(dir);
  const target = resolve(root, name);
  return target.startsWith(`${root}${sep}`) ? target : null;
}
