import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../components/provider/WorkflowUIProvider.js';
import type { WorkflowClient, Attachment } from '@xyne/workflow-sdk/client';
import { CitationOriginContext } from '../components/shared/citation-context.js';
import type { OriginResolverCtx } from '../components/execution/origin/origin-resolver.js';
import { renderLayout } from './index.js';

const invoice: Attachment = { name: 'invoice.pdf', mimeType: 'application/pdf', handle: 'mem://1' };

function makeClient(): WorkflowClient {
  return {
    baseUrl: 'http://localhost',
    uploads: { create: vi.fn(), url: () => 'http://localhost/attachments?ref=1' },
  } as unknown as WorkflowClient;
}

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

const cite = (ref = 'steps.ocr.output.results.0.data') => ({ kind: 'ref', ref, page: 3 });

/** The scope a cited agent step produces: response = { value, citation }. */
const scope = {
  output: {
    response: {
      value: {
        pan: 'ABCDE1234F',
        uncited: 'no source',
        rows: [{ amount: 100 }, { amount: 200 }],
      },
      citation: {
        pan: [cite()],
        rows: [{ amount: [cite()] }, {}],
      },
    },
  },
};

function renderTemplate(template: string) {
  const result = renderLayout(template, scope);
  if (!result.ok) throw new Error(`layout failed to parse: ${result.error}`);
  return render(
    React.createElement(WorkflowUIProvider, {
      client: makeClient(),
      children: React.createElement(
        CitationOriginContext.Provider,
        { value: makeOriginCtx() },
        result.node,
      ),
    }),
  );
}

describe('layout DSL — cite attribute', () => {
  it('renders a marker on a cited Field', () => {
    const { container } = renderTemplate(
      '<Field label="PAN" value={output.response.value.pan} cite={output.response.citation.pan} />',
    );
    expect(container.textContent).toContain('ABCDE1234F');
    const marker = container.querySelector('button');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('aria-label')).toBe('1 source');
    // The marker must name the document it points at, not merely exist — a cite
    // wired to the wrong field would still render a marker.
    fireEvent.focus(marker!);
    expect(within(screen.getByRole('dialog')).getByText('invoice.pdf')).toBeDefined();
  });

  it('renders no marker on an uncited Field', () => {
    const { container } = renderTemplate(
      '<Field label="Other" value={output.response.value.uncited} />',
    );
    expect(container.textContent).toContain('no source');
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders a marker on a cited Value', () => {
    const { container } = renderTemplate(
      '<Value value={output.response.value.pan} cite={output.response.citation.pan} />',
    );
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  // Containers take the whole branch and match each cell up themselves.
  it('places Table markers in the cells that are cited', () => {
    const { container } = renderTemplate(
      '<Table data={output.response.value.rows} cite={output.response.citation.rows} />',
    );
    const cells = container.querySelectorAll('tbody td');
    expect(cells).toHaveLength(2);
    expect(cells[0]?.querySelector('button')).not.toBeNull();
    // Row 1 has no citation for `amount`, so it stays bare.
    expect(cells[1]?.querySelector('button')).toBeNull();
  });

  // The mirror is walked all the way down, not just at the top level: the grid
  // marks `pan`, and recurses into `rows` to mark the nested cited `amount` too
  // (while `uncited` and `rows.1.amount`, which have no sources, stay bare).
  it('renders markers through a cited Grid, including nested values', () => {
    const { container } = renderTemplate(
      '<Grid data={output.response.value} cite={output.response.citation} />',
    );
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  // Documents the one constraint: a bare {expr} child has nowhere to carry a cite,
  // so generators must emit <Value value={…} cite={…}/> where citations matter.
  it('renders no marker for a bare expression child', () => {
    const { container } = renderTemplate('<Field label="PAN">{output.response.value.pan}</Field>');
    expect(container.textContent).toContain('ABCDE1234F');
    expect(container.querySelector('button')).toBeNull();
  });

  it('still renders an uncited layout exactly as before', () => {
    const { container } = renderTemplate(
      '<Section title="Summary"><Field label="PAN" value={output.response.value.pan} /></Section>',
    );
    expect(container.textContent).toContain('Summary');
    expect(container.textContent).toContain('ABCDE1234F');
    expect(container.querySelector('button')).toBeNull();
  });
});
