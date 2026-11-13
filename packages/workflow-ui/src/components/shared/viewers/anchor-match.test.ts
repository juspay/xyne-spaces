import { describe, it, expect } from 'vitest';
import { normalizeForMatch, buildQueryLadder, findRange } from './anchor-match.js';

/** Build a detached subtree from HTML so tests exercise real DOM traversal. */
function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('normalizeForMatch', () => {
  it('collapses whitespace runs and trims', () => {
    expect(normalizeForMatch('  TOTAL   DUE \n 36,816.00  ')).toBe('total due 36,816.00');
  });

  it('folds smart quotes and dashes to ascii', () => {
    expect(normalizeForMatch('“net” – 30')).toBe('"net" - 30');
    expect(normalizeForMatch('it’s')).toBe("it's");
  });

  it('folds ligatures and non-breaking spaces', () => {
    expect(normalizeForMatch('oﬃce')).toBe('office');
    expect(normalizeForMatch('a b')).toBe('a b');
  });
});

describe('buildQueryLadder', () => {
  it('starts with the full phrase, then shortens', () => {
    const ladder = buildQueryLadder('the quick brown fox jumps over the lazy dog');
    expect(ladder[0]).toBe('the quick brown fox jumps over the lazy dog');
    expect(ladder.length).toBeGreaterThan(1);
    // strictly shortening
    const lens = ladder.map((q) => q.split(' ').length);
    expect([...lens]).toEqual([...lens].sort((a, b) => b - a));
  });

  // A single-word rung would highlight the first "the" on the page.
  it('never produces a rung below 2 words / 4 chars', () => {
    for (const q of buildQueryLadder('alpha beta gamma delta epsilon zeta eta')) {
      expect(q.split(' ').length).toBeGreaterThanOrEqual(2);
      expect(q.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('falls back to the raw value for a short phrase', () => {
    expect(buildQueryLadder('5000')).toEqual(['5000']);
  });
});

describe('findRange', () => {
  it('finds an exact phrase', () => {
    const root = mount('<p>Invoice total is 36,816.00 due on receipt.</p>');
    const r = findRange(root, 'total is 36,816.00');
    expect(r).not.toBeNull();
    expect(r!.toString()).toContain('36,816.00');
  });

  // The real-world case: the agent quotes OCR text, the DOM renders differently.
  it('matches across whitespace drift', () => {
    const root = mount('<p>TOTAL   DUE\n36,816.00</p>');
    const r = findRange(root, 'TOTAL DUE 36,816.00');
    expect(r).not.toBeNull();
  });

  it('matches across smart-quote drift', () => {
    const root = mount('<p>Terms are “net 30” from invoice date.</p>');
    const r = findRange(root, '"net 30" from invoice');
    expect(r).not.toBeNull();
  });

  it('is case-insensitive', () => {
    const root = mount('<p>Acme Supplies Limited</p>');
    expect(findRange(root, 'ACME SUPPLIES')).not.toBeNull();
  });

  // A quote split across inline elements must still resolve to one Range.
  it('matches a phrase spanning element boundaries', () => {
    const root = mount('<p>TOTAL <strong>DUE</strong> <em>36,816.00</em></p>');
    const r = findRange(root, 'TOTAL DUE 36,816.00');
    expect(r).not.toBeNull();
    expect(normalizeForMatch(r!.toString())).toContain('36,816.00');
  });

  // The ladder: the middle drifted, but the head is intact.
  it('falls back to a prefix when the full phrase has drifted', () => {
    const root = mount('<p>SUMMARY AND AMOUNT PAYABLE later text</p>');
    const r = findRange(root, 'SUMMARY AND AMOUNT xxxxx yyyyy zzzzz');
    expect(r).not.toBeNull();
    expect(normalizeForMatch(r!.toString())).toBe('summary and amount');
  });

  it('returns null when nothing matches', () => {
    const root = mount('<p>completely unrelated content</p>');
    expect(findRange(root, 'TOTAL DUE 36,816.00')).toBeNull();
  });

  it('returns null for an empty quote or empty root', () => {
    expect(findRange(mount('<p>text</p>'), '   ')).toBeNull();
    expect(findRange(mount(''), 'anything')).toBeNull();
  });

  it('produces a Range positioned in real text nodes', () => {
    const root = mount('<p>alpha beta gamma</p>');
    const r = findRange(root, 'beta gamma')!;
    expect(r.startContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(r.endContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(r.toString()).toBe('beta gamma');
  });
});
