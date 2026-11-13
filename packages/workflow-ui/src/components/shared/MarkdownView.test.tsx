import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import type { WorkflowClient, Attachment } from '@xyne/workflow-sdk/client';
import { MarkdownView } from './MarkdownView.js';
import { CitationOriginContext, CitationOpenContext, type OpenCitationDoc } from './citation-context.js';
import type { OriginResolverCtx } from '../execution/origin/origin-resolver.js';

const invoice: Attachment = { name: 'invoice.pdf', mimeType: 'application/pdf', handle: 'mem://1' };

function makeClient(): WorkflowClient {
  return {
    baseUrl: 'http://localhost',
    uploads: { create: vi.fn(), url: (att: Attachment) => `http://localhost/attachments?ref=${encodeURIComponent(att.handle)}` },
  } as unknown as WorkflowClient;
}

/** An execution with one OCR step, so a cited ref has something to resolve to. */
function makeOriginCtx(): OriginResolverCtx {
  const outputs: Record<string, unknown> = {
    ocr: { results: [{ source: invoice, data: 'INVOICE TOTAL 5000' }] },
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

/** Rendered inside an execution — citations resolve and markers appear.
 *  Pass `onOpen` to observe what a marker hands to the side panel. */
function wrapCited(markdown: string, onOpen?: OpenCitationDoc) {
  const tree = React.createElement(
    CitationOriginContext.Provider,
    { value: makeOriginCtx() },
    onOpen
      ? React.createElement(
          CitationOpenContext.Provider,
          { value: onOpen },
          React.createElement(MarkdownView, null, markdown),
        )
      : React.createElement(MarkdownView, null, markdown),
  );
  return render(React.createElement(WorkflowUIProvider, { client: makeClient(), children: tree }));
}

/** Rendered with no execution in scope — the many string-only callers. */
function wrapPlain(markdown: string) {
  return render(
    React.createElement(WorkflowUIProvider, {
      client: makeClient(),
      children: React.createElement(MarkdownView, null, markdown),
    }),
  );
}

describe('MarkdownView — :::citation directive', () => {
  it('renders the cited statement with a source marker', () => {
    const { container } = wrapCited(
      ':::citation{ref="steps.ocr.output.results.0.data" page=3 quote="TOTAL 5000"}\nThe invoice totals 5,000.\n:::',
    );

    expect(screen.getByText(/The invoice totals 5,000\./)).toBeDefined();
    const marker = container.querySelector('.wui-citation button');
    expect(marker).not.toBeNull();
    // The marker names where it goes — proving the ref resolved to the document.
    expect(marker?.getAttribute('title')).toContain('invoice.pdf');
  });

  // Markdown attributes are flat strings, so `page=3` is the directive's whole
  // address vocabulary; it has to widen into a structural locator on the way out.
  // Asserted by opening rather than by tooltip text: the page is only worth
  // anything if it reaches the viewer, and a rename that dropped it silently
  // (`page` → `locator`) is exactly the regression this guards.
  it('widens a directive page into a locator the viewer can act on', () => {
    const onOpen = vi.fn() as unknown as OpenCitationDoc;
    const { container } = wrapCited(
      ':::citation{ref="steps.ocr.output.results.0.data" page=3 quote="TOTAL 5000"}\nThe invoice totals 5,000.\n:::',
      onOpen,
    );

    fireEvent.click(container.querySelector('.wui-citation button')!);

    expect(onOpen).toHaveBeenCalledWith({
      kind: 'doc',
      attachment: invoice,
      anchor: { quote: 'TOTAL 5000', locator: { at: 'page', page: 3 } },
    });
  });

  it('omits the locator when the directive carries no page', () => {
    const onOpen = vi.fn() as unknown as OpenCitationDoc;
    const { container } = wrapCited(
      ':::citation{ref="steps.ocr.output.results.0.data" quote="TOTAL 5000"}\nTotal.\n:::',
      onOpen,
    );

    fireEvent.click(container.querySelector('.wui-citation button')!);

    // Quote-only still anchors — every DOM viewer can find it by text.
    expect(onOpen).toHaveBeenCalledWith({
      kind: 'doc',
      attachment: invoice,
      anchor: { quote: 'TOTAL 5000' },
    });
  });

  it('renders a url citation', () => {
    const { container } = wrapCited(
      ':::citation{url="https://sec.test/filing" title="Filing"}\nThe company IPO\'d in 2021.\n:::',
    );

    expect(screen.getByText(/The company IPO'd in 2021\./)).toBeDefined();
    expect(container.querySelector('.wui-citation button')?.getAttribute('title')).toContain('Filing');
  });

  it('drops a non-http url rather than making it clickable', () => {
    const { container } = wrapCited(':::citation{url="javascript:alert(1)"}\nclick me\n:::');

    expect(screen.getByText(/click me/)).toBeDefined();
    expect(container.querySelector('.wui-citation button')).toBeNull();
  });

  // The rehypeRaw round-trip + sanitize schema: the element must survive, and
  // nothing else may sneak through with it.
  it('keeps the citation element while still stripping unsafe markup', () => {
    const { container } = wrapCited(
      ':::citation{ref="steps.ocr.output.results.0.data"}\nSourced claim.\n:::\n\n<script>alert(1)</script>\n\n<foo bar="1">hi</foo>',
    );

    expect(container.querySelector('.wui-citation')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foo')).toBeNull();
  });

  it('renders the text but no marker when there is no execution in scope', () => {
    const { container } = wrapPlain(
      ':::citation{ref="steps.ocr.output.results.0.data"}\nThe invoice totals 5,000.\n:::',
    );

    expect(screen.getByText(/The invoice totals 5,000\./)).toBeDefined();
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders an unresolvable ref as an inert marker rather than dropping it', () => {
    const { container } = wrapCited(':::citation{ref="steps.nope.output.x"}\nUnbacked claim.\n:::');

    expect(screen.getByText(/Unbacked claim\./)).toBeDefined();
    expect(container.querySelector('.wui-citation button')?.hasAttribute('disabled')).toBe(true);
  });
});

describe('MarkdownView — enabling directives changes nothing else', () => {
  // remark-directive parses `:name` globally. Without the revert-to-source guard
  // these would be swallowed by sanitize, silently deleting the author's words.
  it('leaves text that merely looks like a directive alone', () => {
    wrapPlain('Deploy at 10:30, tag :release: and ship.');
    expect(screen.getByText(/Deploy at 10:30, tag :release: and ship\./)).toBeDefined();
  });

  it('leaves an unknown container block as literal text', () => {
    wrapPlain(':::note\nJust a note.\n:::');
    expect(screen.getByText(/Just a note\./)).toBeDefined();
  });

  it('still renders ordinary markdown', () => {
    const { container } = wrapPlain('**bold** and `code`');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('still renders a gfm table', () => {
    const { container } = wrapPlain('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(container.querySelector('table')).not.toBeNull();
  });
});
