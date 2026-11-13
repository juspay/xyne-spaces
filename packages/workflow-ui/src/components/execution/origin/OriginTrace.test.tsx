import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { WorkflowUIProvider } from '../../provider/WorkflowUIProvider.js';
import type { WorkflowClient, Attachment } from '@xyne/workflow-sdk/client';
import { OriginChip, OriginChipFor, OriginPanel } from './OriginTrace.js';
import type { OriginResolverCtx } from './origin-resolver.js';

// The panel renders attachment cards, so it needs a client in scope for
// upload URL resolution — same stub shape as CitationArrow.test.tsx.
function makeClient(): WorkflowClient {
  return {
    baseUrl: 'http://localhost',
    uploads: {
      create: vi.fn(),
      url: (att: Attachment) => `http://localhost/attachments?ref=${encodeURIComponent(att.handle)}`,
    },
  } as unknown as WorkflowClient;
}

/** Render inside a provider, and re-render through the same wrapper. */
function renderInProvider(node: ReactNode) {
  const wrap = (n: ReactNode): ReactElement => (
    <WorkflowUIProvider client={makeClient()}>{n}</WorkflowUIProvider>
  );
  const result = render(wrap(node));
  return { ...result, rerender: (next: ReactNode) => { result.rerender(wrap(next)); } };
}

/** The subtree the provider renders into — what "renders nothing" is about. */
function providerBody(container: HTMLElement): Element {
  const body = container.querySelector('[data-workflow-ui]');
  if (!body) throw new Error('provider did not render');
  return body;
}

const ctx: OriginResolverCtx = {
  stepTitle: (id) => ({ reg: 'Register Mobile with NPCI', calc: 'Fraud Fork' }[id]),
  stepDescription: (id) => ({ reg: 'Registers the mobile with NPCI.' }[id]),
  stepGroup: (id) => ({ reg: { title: 'Onboarding' } }[id]),
  stepOutput: (id) => ({
    reg: { body: { binding_status: 'FAILED' } },
    calc: { result: { route: 'STANDARD' } },
  }[id]),
  stepRawConfig: (id) => ({
    reg: { body: { raw: '{{calc.output.result.route}}' } },
    calc: { code: 'x' }, // opaque — no refs
  }[id]),
  triggerData: {},
};

describe('OriginChip', () => {
  it('renders a source affordance and fires onClick', () => {
    let clicked = false;
    render(<OriginChip onClick={() => { clicked = true; }} />);
    fireEvent.click(screen.getByText(/source/i));
    expect(clicked).toBe(true);
  });
});

describe('OriginChipFor (generic, value-driven)', () => {
  it('renders a chip for a ref-bearing value and passes its auto refs', () => {
    let got: string[] | null = null;
    render(
      <OriginChipFor raw="{{steps.reg.output.body.binding_status}}" label="Status" onInspect={(_l, refs) => { got = refs; }} />,
    );
    fireEvent.click(screen.getByText(/source/i));
    expect(got).toEqual(['steps.reg.output.body.binding_status']);
  });

  it('renders a chip for a LITERAL value that has author citations', () => {
    let gotCitations: unknown = null;
    render(
      <OriginChipFor
        raw="just text"
        label="X"
        citations={[{ ref: '{{trigger.attachments}}', label: 'Doc' }]}
        onInspect={(_l, _r, c) => { gotCitations = c; }}
      />,
    );
    fireEvent.click(screen.getByText(/source/i));
    expect(gotCitations).toEqual([{ ref: '{{trigger.attachments}}', label: 'Doc' }]);
  });

  it('renders nothing for a literal value with no citations', () => {
    const { container } = render(<OriginChipFor raw="just text" label="X" onInspect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing without onInspect', () => {
    const { container } = render(<OriginChipFor raw="{{trigger.x}}" label="X" />);
    expect(container.firstChild).toBeNull();
  });

  it('finds refs anywhere inside an object (e.g. a form field)', () => {
    let got: string[] | null = null;
    render(
      <OriginChipFor
        raw={{ label: '{{trigger.field3}}', placeholder: 'type…' }}
        label="Field"
        onInspect={(_l, refs) => { got = refs; }}
      />,
    );
    fireEvent.click(screen.getByText(/source/i));
    expect(got).toEqual(['trigger.field3']);
  });
});

const noCitations: { label: string; autoRefs: string[]; citations: [] } = { label: '', autoRefs: [], citations: [] };

describe('OriginPanel', () => {
  it('renders nothing when not inspecting', () => {
    const { container } = renderInProvider(<OriginPanel inspected={null} ctx={ctx} onClose={() => {}} />);
    expect(providerBody(container).firstChild).toBeNull();
  });

  // The auto-derived "Where it came from" trace (step header, Trace back, View
  // full output, View step) was deliberately removed from the reviewer UI in
  // PR #8697 — only author-attached sources are shown; the auto refs survive
  // solely to collect documents and drive highlighting.
  //
  // This replaces four tests that asserted that removed UI. It inverts them into
  // a guard on the decision itself, which was previously unprotected: nothing
  // would have caught the trace being reintroduced.
  it('shows no auto-derived trace, however many upstream refs the value has', () => {
    renderInProvider(
      <OriginPanel
        inspected={{ ...noCitations, label: 'Binding Status', autoRefs: ['steps.reg.output.body.binding_status'] }}
        ctx={{ ...ctx, onJump: () => {} }}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText('Register Mobile with NPCI')).toBeNull();
    expect(screen.queryByText(/Trace back/i)).toBeNull();
    expect(screen.queryByText(/View full output/i)).toBeNull();
    expect(screen.queryByText('View step')).toBeNull();
    expect(screen.getByText(/No supporting sources are attached/i)).toBeInTheDocument();
  });

  it('renders an author "Sources" section with label, description, and the resolved card', () => {
    renderInProvider(
      <OriginPanel
        inspected={{
          label: 'Note',
          autoRefs: [],
          citations: [{ ref: '{{steps.reg.output.body.binding_status}}', label: 'Evidence', description: 'why flagged' }],
        }}
        ctx={ctx}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Supporting sources')).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByText('why flagged')).toBeInTheDocument();
    // the citation's ref is resolved like any origin
    expect(screen.getByText('Register Mobile with NPCI')).toBeInTheDocument();
  });

  // Says so plainly rather than rendering an empty panel — "nothing is attached"
  // is a real answer for a reviewer, and silence reads like a loading bug.
  it('states when nothing is attached to a value', () => {
    renderInProvider(<OriginPanel inspected={{ ...noCitations, label: 'Note' }} ctx={ctx} onClose={() => {}} />);
    expect(screen.getByText(/No supporting sources are attached/i)).toBeInTheDocument();
  });
});
