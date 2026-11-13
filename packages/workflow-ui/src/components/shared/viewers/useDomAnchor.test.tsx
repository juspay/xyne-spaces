import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React, { useRef } from 'react';
import { useDomAnchor, type Anchor } from './useDomAnchor.js';

// jsdom has no layout engine — it reports every rect as 0×0 and doesn't implement
// Range.getClientRects or scrollIntoView at all. Supply them, with a non-zero rect,
// so the hook's real DOM work runs instead of being silently skipped (the overlay
// deliberately drops zero-area rects).
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = vi.fn(
    () => [{ left: 10, top: 20, width: 100, height: 14 } as DOMRect] as unknown as DOMRectList,
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 500, height: 400,
  } as DOMRect);
});

/**
 * Renders content as JSX children — the way every real viewer does. (Deliberately
 * not `dangerouslySetInnerHTML`: React re-applies that on re-render and would wipe
 * the appended overlay, which is a property of that API rather than of the hook.)
 */
function Harness({ children, anchor }: { children: React.ReactNode; anchor?: Anchor | undefined }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { hit } = useDomAnchor(ref, anchor, 'ready');
  return (
    <div>
      <span data-testid="hit">{String(hit)}</span>
      <div ref={ref}>{children}</div>
    </div>
  );
}

const Table = () => (
  <table>
    <tbody>
      <tr>
        <td data-row="2" data-col="A">alpha</td>
        <td data-row="2" data-col="B">100</td>
      </tr>
      <tr>
        <td data-row="3" data-col="A">beta</td>
        <td data-row="3" data-col="B">200</td>
      </tr>
    </tbody>
  </table>
);

const overlays = (c: HTMLElement) => c.querySelectorAll('[data-wui-anchor-layer]');

describe('useDomAnchor — quote', () => {
  it('finds the quote, reports a hit and paints an overlay', () => {
    const { getByTestId, container } = render(
      <Harness anchor={{ quote: 'total is 36,816.00' }}>
        <p>Invoice total is 36,816.00 due.</p>
      </Harness>,
    );
    expect(getByTestId('hit').textContent).toBe('true');
    expect(overlays(container).length).toBe(1);
  });

  it('scrolls the match into view', () => {
    render(
      <Harness anchor={{ quote: 'beta gamma' }}><p>alpha beta gamma</p></Harness>,
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  // The honest degradation: the document still opens, just unhighlighted.
  it('reports a miss and paints nothing when the quote is absent', () => {
    const { getByTestId, container } = render(
      <Harness anchor={{ quote: 'TOTAL DUE 36,816.00' }}><p>unrelated content</p></Harness>,
    );
    expect(getByTestId('hit').textContent).toBe('false');
    expect(overlays(container).length).toBe(0);
  });

  // The regression bar: an un-anchored viewer must behave exactly as before.
  it('does nothing at all without an anchor', () => {
    const { getByTestId, container } = render(<Harness><p>alpha beta</p></Harness>);
    expect(getByTestId('hit').textContent).toBe('false');
    expect(overlays(container).length).toBe(0);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('useDomAnchor — locator', () => {
  it('resolves a cell locator by attribute lookup', () => {
    const { getByTestId, container } = render(
      <Harness anchor={{ locator: { at: 'cell', row: 3, col: 'B' } }}><Table /></Harness>,
    );
    expect(getByTestId('hit').textContent).toBe('true');
    expect(overlays(container).length).toBe(1);
  });

  it('resolves a line locator', () => {
    const { getByTestId } = render(
      <Harness anchor={{ locator: { at: 'line', from: 2 } }}>
        <pre><span data-line="1">first</span><span data-line="2">second</span></pre>
      </Harness>,
    );
    expect(getByTestId('hit').textContent).toBe('true');
  });

  it('misses cleanly when the cell does not exist', () => {
    const { getByTestId } = render(
      <Harness anchor={{ locator: { at: 'cell', row: 99, col: 'Z' } }}><Table /></Harness>,
    );
    expect(getByTestId('hit').textContent).toBe('false');
  });

  // The ladder: a structural miss must still try the portable anchor.
  it('falls back to the quote when the locator misses', () => {
    const { getByTestId } = render(
      <Harness anchor={{ locator: { at: 'cell', row: 99, col: 'Z' }, quote: 'beta' }}><Table /></Harness>,
    );
    expect(getByTestId('hit').textContent).toBe('true');
  });

  // DOM viewers have no pages; a page locator is pdf.js's business.
  it('ignores a page locator but still honours the quote', () => {
    const { getByTestId } = render(
      <Harness anchor={{ locator: { at: 'page', page: 3 }, quote: 'beta gamma' }}>
        <p>alpha beta gamma</p>
      </Harness>,
    );
    expect(getByTestId('hit').textContent).toBe('true');
  });
});
