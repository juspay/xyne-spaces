import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import type { WorkflowClient, Attachment } from '@xyne/workflow-sdk/client';
import { CitationMarks } from './CitationArrow.js';
import { CitationOriginContext, CitationOpenContext, type OpenCitationDoc } from './citation-context.js';
import type { CitationRef } from './citation.js';
import type { OriginResolverCtx } from '../execution/origin/origin-resolver.js';

const invoice: Attachment = { name: 'invoice.pdf', mimeType: 'application/pdf', handle: 'mem://1' };

function makeClient(): WorkflowClient {
  return {
    baseUrl: 'http://localhost',
    uploads: {
      create: vi.fn(),
      url: (att: Attachment) => `http://localhost/attachments?ref=${encodeURIComponent(att.handle)}`,
    },
  } as unknown as WorkflowClient;
}

function makeOriginCtx(): OriginResolverCtx {
  const outputs: Record<string, unknown> = {
    ocr: { results: [{ source: invoice, data: 'INVOICE TOTAL 5000' }] },
    // No attachment anywhere in this output — a citation into it resolves to step
    // DATA rather than a document, which is the second source kind.
    api: { body: { rate: '7.5', currency: 'INR' } },
  };
  return {
    stepTitle: () => undefined,
    stepDescription: () => undefined,
    stepGroup: () => undefined,
    stepOutput: (id: string) => outputs[id],
    stepRawConfig: () => undefined,
    triggerData: {},
  };
}

function wrap(refs: CitationRef[] | undefined, withCtx = true) {
  const marks = React.createElement(CitationMarks, { refs });
  const inner = withCtx
    ? React.createElement(CitationOriginContext.Provider, { value: makeOriginCtx() }, marks)
    : marks;
  return render(React.createElement(WorkflowUIProvider, { client: makeClient(), children: inner }));
}

// A citation as the agent now emits it: the ref names the DOCUMENT, and the
// address travels in `locator` — both copied verbatim from a `[source: …]` label.
const docRef: CitationRef = {
  kind: 'ref',
  ref: 'steps.ocr.output.results.0.source',
  locator: { at: 'page', page: 3 },
  quote: 'TOTAL 5000',
};
const urlRef: CitationRef = { kind: 'url', url: 'https://sec.test/filing', title: 'Filing' };

afterEach(() => { vi.restoreAllMocks(); });

describe('CitationMarks', () => {
  // An uncited value must look exactly as it did before citations existed.
  it('renders nothing when there are no citations', () => {
    const { container } = wrap([]);
    expect(container.querySelector('button')).toBeNull();
    const empty = wrap(undefined);
    expect(empty.container.querySelector('button')).toBeNull();
  });

  it('renders nothing without an execution in scope', () => {
    const { container } = wrap([docRef], false);
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders one marker for a single citation, unnumbered', () => {
    const { container } = wrap([docRef]);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('sup')).toBeNull();
  });

  // How well-backed a value is still has to be legible at a glance — but as a
  // count on ONE chip, not ↗¹ ↗² ↗³ stamped after every field, which made a dense
  // report unreadable.
  it('collapses every source into one chip carrying the count', () => {
    const { container } = wrap([docRef, urlRef, docRef]);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain('3');
    expect(buttons[0]?.getAttribute('aria-label')).toBe('3 sources');
  });

  // The chip is O(1) in the number of citations, so a pathological count needs no
  // overflow rule — and the popover groups by document, so nine citations of one
  // file read as one source seen nine times, not nine sources.
  it('stays one chip however many citations there are', () => {
    const { container } = wrap(Array.from({ length: 9 }, () => docRef));
    const chip = container.querySelector('button');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(chip?.textContent).toContain('9');

    fireEvent.focus(chip!);
    const popover = screen.getByRole('dialog');
    expect(within(popover).getByText('9×')).toBeDefined();
    expect(within(popover).getAllByRole('button')).toHaveLength(1);
  });

  it('names each source in the popover', () => {
    const { container } = wrap([docRef, urlRef]);

    fireEvent.focus(container.querySelector('button')!);

    const popover = screen.getByRole('dialog');
    expect(within(popover).getByText('invoice.pdf')).toBeDefined();
    expect(within(popover).getByText('p.3')).toBeDefined();
    expect(within(popover).getByText('Filing')).toBeDefined();
    // The cited passage travels with the source, so a reader can judge relevance
    // before deciding to open the document at all.
    expect(within(popover).getByText(/TOTAL 5000/)).toBeDefined();
  });
});

describe('CitationMarks — a computed (derived) value', () => {
  // A derivation over ONE document used to render as N identical filenames, so
  // `(#1 + #2)` was unreadable — the reader could not tell which term was which.
  // Each row must lead with the cited text itself.
  const derived: CitationRef = {
    kind: 'derived',
    label: 'Debt Service Coverage Ratio',
    expression: '(#1+#2)/(#3)',
    inputs: [
      { kind: 'ref', ref: 'steps.ocr.output.results.0.source', quote: 'Net Profit = 58.3' },
      { kind: 'ref', ref: 'steps.ocr.output.results.0.source', quote: 'Depreciation = 6.02' },
      { kind: 'ref', ref: 'steps.ocr.output.results.0.source', quote: 'Principal TL = 160.76' },
    ],
  };

  it('names what every input is, not just which file it came from', () => {
    const { container } = wrap([derived]);
    fireEvent.focus(container.querySelector('button')!);
    const popover = screen.getByRole('dialog');

    expect(within(popover).getByText('Debt Service Coverage Ratio')).toBeDefined();
    expect(within(popover).getByText('(#1+#2)/(#3)')).toBeDefined();
    // the operands — without these the expression is positional gibberish
    expect(within(popover).getByText('Net Profit = 58.3')).toBeDefined();
    expect(within(popover).getByText('Depreciation = 6.02')).toBeDefined();
    expect(within(popover).getByText('Principal TL = 160.76')).toBeDefined();
    // …and each still says where it came from
    expect(within(popover).getAllByText(/invoice\.pdf/)).toHaveLength(3);
  });

  it('marks the value as computed rather than quoted', () => {
    const { container } = wrap([derived]);
    // ƒ, not ↗ — the reader should see "calculated" before opening anything
    expect(container.querySelector('button')?.getAttribute('aria-label'))
      .toBe('computed from 1 source');
  });
});

/**
 * A citation resolves to one of two openable things: a document, or the step
 * output a value came from. The second used to be a deliberate no-op — honest,
 * but it left 128 of 480 citations in one real run as buttons that did nothing.
 */
describe('CitationMarks — a value cited from a step output', () => {
  // `api` isn't an attachment, so this resolves to step data rather than a doc.
  const dataRef: CitationRef = { kind: 'ref', ref: 'steps.api.output.body.rate', quote: '7.5' };

  it('marks it as data, not a document', () => {
    const { container } = wrap([dataRef]);
    // `{}` not `↗` — the reader should know a data panel opens, not a file
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('1 step output');
  });

  it('opens the producing step at the cited path instead of doing nothing', () => {
    const openInPanel = vi.fn() as unknown as OpenCitationDoc;
    const { container } = render(
      React.createElement(WorkflowUIProvider, {
        client: makeClient(),
        children: React.createElement(
          CitationOriginContext.Provider,
          { value: makeOriginCtx() },
          React.createElement(
            CitationOpenContext.Provider,
            { value: openInPanel },
            React.createElement(CitationMarks, { refs: [dataRef] }),
          ),
        ),
      }),
    );

    fireEvent.click(container.querySelector('button')!);

    expect(openInPanel).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'value', stepId: 'api', path: ['body', 'rate'] }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // No panel host ⇒ nothing sensible to show, so it must stay quiet rather than
  // opening a modal with no document in it.
  it('stays inert where no panel can host it', () => {
    const { container } = wrap([dataRef]);
    fireEvent.click(container.querySelector('button')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('CitationMarks — opening a source', () => {
  it('opens a url citation in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { container } = wrap([urlRef]);

    fireEvent.click(container.querySelector('button')!);

    expect(open).toHaveBeenCalledWith('https://sec.test/filing', '_blank', 'noopener,noreferrer');
  });

  // Fallback for surfaces with nowhere to put a panel.
  it('opens a document citation in a modal when no panel host is present', () => {
    const { container } = wrap([docRef]);

    fireEvent.click(container.querySelector('button')!);

    expect(screen.getByText('invoice.pdf')).toBeDefined();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  // The run view hosts a side panel: the source opens beside the data, never over
  // it — you can't verify a value against evidence that's covering it.
  it('hands a document citation to the side panel when one is hosted', () => {
    const openInPanel = vi.fn() as unknown as OpenCitationDoc;
    const { container } = render(
      React.createElement(WorkflowUIProvider, {
        client: makeClient(),
        children: React.createElement(
          CitationOriginContext.Provider,
          { value: makeOriginCtx() },
          React.createElement(
            CitationOpenContext.Provider,
            { value: openInPanel },
            React.createElement(CitationMarks, { refs: [docRef] }),
          ),
        ),
      }),
    );

    fireEvent.click(container.querySelector('button')!);

    // Provenance reaches the panel as an Anchor — the page is a locator, not a
    // loose field, so a spreadsheet or docx citation is equally expressible.
    expect(openInPanel).toHaveBeenCalledWith({
      kind: 'doc',
      attachment: invoice,
      anchor: { quote: 'TOTAL 5000', locator: { at: 'page', page: 3 } },
    });
    // and crucially, no modal covering the value
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // A ref the agent invented must stay visible — silently dropping it would read
  // as "this value has no citation", hiding the very thing worth reviewing. It
  // just must not pretend to be openable.
  it('leaves an unresolvable citation inert rather than hiding it', () => {
    const { container } = wrap([{ kind: 'ref', ref: 'steps.nope.output.x' }]);
    const chip = container.querySelector('button');
    expect(chip).not.toBeNull();

    fireEvent.click(chip!);

    // No document opens; the source row itself is what's disabled.
    expect(screen.queryByText('invoice.pdf')).toBeNull();
    const row = within(screen.getByRole('dialog')).getByRole('button');
    expect(row.hasAttribute('disabled')).toBe(true);
  });
});
