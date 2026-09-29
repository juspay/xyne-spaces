/** Small layout helpers for the components: thread connector lines and pagination windows. */

export interface Line {
  l: string;
  t: string;
  h: string;
  w: string;
  bb: string;
  r: string;
}

/** Horizontal centre of the status glyph at a tree depth (rows indent 24px per level). */
const cx = (depth: number): number => 10 + depth * 24 + 7;
const rail = (x: number, t: string, h: string): Line => ({ l: `${x - 0.75}px`, t, h, w: '0', bb: 'none', r: '0' });

/**
 * Connector lines for one thread row: rails for ancestors that continue past it, an elbow from its
 * parent, the parent's rail on past it when it isn't the last child, and a rail down to its own children.
 * `cy` is the row's glyph centre from the top of the row.
 */
export function threadLines(depth: number, rails: boolean[], isLast: boolean, hasKids: boolean, cy: number): Line[] {
  const out: Line[] = [];
  rails.forEach((on, i) => {
    if (on) out.push(rail(cx(i), '0', '100%'));
  });
  if (depth > 0) {
    out.push({ l: `${cx(depth - 1) - 0.75}px`, t: '0', h: `${cy}px`, w: `${cx(depth) - cx(depth - 1) - 10}px`, bb: '1.5px solid var(--t6)', r: '7px' });
    if (!isLast) out.push(rail(cx(depth - 1), `${cy}px`, `calc(100% - ${cy}px)`));
  }
  if (hasKids) out.push(rail(cx(depth), `${cy + 10}px`, `calc(100% - ${cy + 10}px)`));
  return out;
}

/** Page numbers to show: both ends plus three around the current page; null marks a gap. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const from = Math.max(1, Math.min(page - 1, pages - 2));
  const to = Math.min(pages, Math.max(page + 1, 3));
  const shown = [...new Set([1, ...Array.from({ length: to - from + 1 }, (_, i) => from + i), pages])];
  const out: (number | null)[] = [];
  shown.forEach((n, i) => {
    if (i > 0 && n - shown[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}
