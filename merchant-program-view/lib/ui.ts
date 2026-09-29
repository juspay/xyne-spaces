/** Small helpers for the components: thread connector lines, pagination windows and multi-select. */

export interface Line {
  l: string;
  t: string;
  h: string;
  w: string;
  bb: string;
  r: string;
}

/** Horizontal centre of the status glyph at a tree depth: `x0` is the depth-0 glyph's left edge, rows indent 24px per level. */
const cx = (depth: number, x0: number): number => x0 + depth * 24 + 7;
const rail = (x: number, t: string, h: string): Line => ({ l: `${x - 0.75}px`, t, h, w: '0', bb: 'none', r: '0' });

/**
 * Connector lines for one thread row: rails for ancestors that continue past it, an elbow from its
 * parent, the parent's rail on past it when it isn't the last child, and a rail down to its own children.
 * `cy` is the row's glyph centre from the top of the row; `x0` is where the depth-0 glyph starts, so the
 * tree can sit to the right of leading columns.
 */
export function threadLines(depth: number, rails: boolean[], isLast: boolean, hasKids: boolean, cy: number, x0 = 10): Line[] {
  const x = (d: number): number => cx(d, x0);
  const out: Line[] = [];
  rails.forEach((on, i) => {
    if (on) out.push(rail(x(i), '0', '100%'));
  });
  if (depth > 0) {
    out.push({ l: `${x(depth - 1) - 0.75}px`, t: '0', h: `${cy}px`, w: `${x(depth) - x(depth - 1) - 10}px`, bb: '1.5px solid var(--t6)', r: '7px' });
    if (!isLast) out.push(rail(x(depth - 1), `${cy}px`, `calc(100% - ${cy}px)`));
  }
  if (hasKids) out.push(rail(x(depth), `${cy + 10}px`, `calc(100% - ${cy + 10}px)`));
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

/**
 * The "Select all" row of a multi-select. `all` is whether every shown option is already picked; `next`
 * is the selection after clicking it: unpick the shown options if they're all picked, else add the rest.
 * Picks hidden by the search are left alone.
 */
export function selectAll(shown: string[], selected: string[]): { all: boolean; next: string[] } {
  const all = shown.length > 0 && shown.every(v => selected.includes(v));
  if (all) return { all, next: selected.filter(v => !shown.includes(v)) };
  return { all, next: [...selected, ...shown.filter(v => !selected.includes(v))] };
}
