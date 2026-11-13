/**
 * SheetView must open the sheet a citation NAMES, not whichever sheet happens to
 * be first. Before this, `active` was pinned to 0 and `locator.sheet` was never
 * read — so a cell cited on "dscr sales" opened on "OPPR", and the anchor then
 * searched the wrong table and silently found nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const SHEETS: Record<string, unknown[][]> = {
  OPPR: [['Line', 'FY23'], ['Sales', '100']],
  'dscr sales': [['DSCR', '31.03.2026'], ['Net Profit', '58.3']],
  WC: [['Item', 'Amt'], ['Stock', '12']],
};

vi.mock('read-excel-file', () => ({
  default: (_buf: unknown, opts: { sheet: string }) => Promise.resolve(SHEETS[opts.sheet] ?? []),
  readSheetNames: () => Promise.resolve(Object.keys(SHEETS)),
}));

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { default: SheetView } = await import('./SheetView.js');

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  ) as unknown as typeof fetch;
  // jsdom implements neither scrollIntoView nor Range.getClientRects; without
  // them useDomAnchor throws the moment it locates a cell and tears the render
  // down. Supply them so this file tests sheet SELECTION, not jsdom's gaps.
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = vi.fn(
    () => [{ left: 0, top: 0, width: 10, height: 10 }] as unknown as DOMRectList,
  );
});

describe('SheetView — which sheet opens', () => {
  it('opens the first sheet when the citation names none', async () => {
    render(React.createElement(SheetView, { url: 'http://x/f.xlsx' }));
    await waitFor(() => { expect(screen.getByText('Sales')).toBeDefined(); });
  });

  it('opens the sheet named by a cell locator', async () => {
    render(
      React.createElement(SheetView, {
        url: 'http://x/f.xlsx',
        anchor: { locator: { at: 'cell', sheet: 'dscr sales', row: 2, col: 'B' } },
      }),
    );
    // the cited sheet's content, not the first sheet's
    await waitFor(() => { expect(screen.getByText('Net Profit')).toBeDefined(); });
    expect(screen.queryByText('Sales')).toBeNull();
  });

  // A sheet name copied out of a `[source: …]` label can drift in case/padding;
  // landing on the right tab matters more than an exact string match.
  it('matches a sheet name loosely (case and padding)', async () => {
    render(
      React.createElement(SheetView, {
        url: 'http://x/f.xlsx',
        anchor: { locator: { at: 'cell', sheet: '  DSCR Sales ', row: 2, col: 'B' } },
      }),
    );
    await waitFor(() => { expect(screen.getByText('Net Profit')).toBeDefined(); });
  });

  it('falls back to the first sheet when the named sheet does not exist', async () => {
    render(
      React.createElement(SheetView, {
        url: 'http://x/f.xlsx',
        anchor: { locator: { at: 'cell', sheet: 'No Such Sheet', row: 2, col: 'B' } },
      }),
    );
    // degrades to opening the workbook rather than rendering nothing
    await waitFor(() => { expect(screen.getByText('Sales')).toBeDefined(); });
  });
});

/**
 * A quote that isn't in the document used to fail silently — the file just opened
 * at the top. 109 citations in one real run were in exactly that state.
 */
describe('SheetView — anchor miss is reported', () => {
  it('says so when the cited passage is not in the sheet', async () => {
    render(
      React.createElement(SheetView, {
        url: 'http://x/f.xlsx',
        anchor: { quote: 'Paid up Capital : · read directly from CMA sheet' },
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Couldn’t locate the cited passage/);
    });
  });

  it('stays silent when the passage IS found', async () => {
    render(
      React.createElement(SheetView, {
        url: 'http://x/f.xlsx',
        anchor: { quote: 'Sales' },
      }),
    );
    // The notice is shown until the anchor effect reports a hit, so wait for it
    // to clear rather than sampling mid-flight.
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull(); });
    expect(screen.getByText('Sales')).toBeDefined();
  });

  it('renders nothing when no anchor was asked for', async () => {
    render(React.createElement(SheetView, { url: 'http://x/f.xlsx' }));
    await waitFor(() => { expect(screen.getByText('Sales')).toBeDefined(); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  // The notice echoes the quote. If it rendered INSIDE the anchored container,
  // findRange would match the notice itself and report a false hit.
  it('does not match its own echoed quote', async () => {
    render(
      React.createElement(SheetView, {
        url: 'http://x/f.xlsx',
        anchor: { quote: 'a passage that is definitely absent' },
      }),
    );
    // still reported as a miss on re-render, not flipped to a hit
    await waitFor(() => { expect(screen.getByRole('status')).toBeDefined(); });
    expect(screen.getByRole('status').textContent).toMatch(/Couldn’t locate/);
  });
});
