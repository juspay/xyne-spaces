import { describe, it, expect } from 'vitest';
import { resolveCitationRef } from './citation-resolver.js';
import type { OriginResolverCtx } from './origin-resolver.js';

// ── Real output captured from the running app (localhost:3000) ──────────────
const pdf = { name: 'refund-policy.pdf', mimeType: 'application/pdf', handle: 'default/d0nkhml07pxnbb90rz61usjr-refund-policy.pdf' };
const xlsx = { name: 'sales.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', handle: 'default/vw7p19tebxpgyy4xi9nl41ag-sales.xlsx' };
const cma = { name: 'CMA Emdee sales  (Autosaved) (2).xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', handle: 'default/zfac1iklobogfbcqlrpuu0ix-CMA_Emdee_sales___Autosaved___2_.xlsx' };

const outputs: Record<string, unknown> = {
  // exec t2eom7vv6rn8d1xwbv31sxnz — PDF chain
  ocr: { results: [{ source: pdf, name: 'refund-policy.pdf',
    pages: [{ page: 1, text: 'Customers may request a refund within 30 days of purchase. For refund questions, email support@acme.example.' }] }] },
  extract: { response: {
    value: { refund_window_days: '30 days', contact_email: 'support@acme.example' },
    citation: { refund_window_days: [{ kind: 'ref', ref: 'steps.ocr.output.results.0.pages.0', locator: { at: 'page', page: 1 }, quote: 'Customers may request a refund within 30 days of purchase.' }] } } },
  summarize: { response: {
    value: { sentence: "The customer's refund window is 30 days." },
    citation: { sentence: [{ kind: 'ref', ref: 'steps.extract.output.response.value.refund_window_days', quote: '30 days' }] } } },
};
// exec b3q8j0dtwpbqwwza8bvq73i1 — XLSX
const varsCtx = { salesXlsx: [xlsx], cmaXlsx: [cma] };
const ctx: OriginResolverCtx = {
  stepTitle: () => undefined, stepDescription: () => undefined, stepGroup: () => undefined,
  stepOutput: (id: string) => outputs[id], stepRawConfig: () => undefined,
  triggerData: {}, varsData: varsCtx,
} as unknown as OriginResolverCtx;

describe('citation e2e — real execution data', () => {
  it('PDF: page-record ref → walk-up to the document at page 1', () => {
    const r = resolveCitationRef({ kind: 'ref', ref: 'steps.ocr.output.results.0.pages.0', locator: { at: 'page', page: 1 }, quote: 'Customers may request a refund within 30 days of purchase.' }, ctx);
    expect(r).toMatchObject({ kind: 'doc', attachment: { name: 'refund-policy.pdf' }, anchor: { locator: { at: 'page', page: 1 } } });
  });

  it('PDF: forward chain — summarize cites extract, resolves through to the PDF', () => {
    const r = resolveCitationRef({ kind: 'ref', ref: 'steps.extract.output.response.value.refund_window_days', quote: '30 days' }, ctx);
    expect(r).toMatchObject({ kind: 'doc', attachment: { name: 'refund-policy.pdf', handle: pdf.handle } });
  });

  it('XLSX: direct ref to the file, quote-anchored (no page — SheetView finds the cell text)', () => {
    const r = resolveCitationRef({ kind: 'ref', ref: 'vars.salesXlsx.0', quote: '1540000' }, ctx);
    expect(r).toMatchObject({ kind: 'doc', attachment: { name: 'sales.xlsx' }, anchor: { quote: '1540000' } });
    // no page locator — the anchor rides on quote alone, which is what a sheet needs
    expect((r as { anchor?: { locator?: unknown } }).anchor?.locator).toBeUndefined();
  });

  it('DERIVED: computed total (exec gr9pwb4q…) — expression preserved, every input resolves to the sheet', () => {
    // Real citation the agent emitted for total_revenue = 4190000.
    const r = resolveCitationRef({
      kind: 'derived', expression: '(#1+#2+#3+#4)',
      inputs: [
        { kind: 'ref', ref: 'vars.salesXlsx.0', quote: 'North America | 1250000 | 4200 | 12%' },
        { kind: 'ref', ref: 'vars.salesXlsx.0', quote: 'Europe | 980000 | 3100 | 8%' },
        { kind: 'ref', ref: 'vars.salesXlsx.0', quote: 'Asia Pacific | 1540000 | 5300 | 21%' },
        { kind: 'ref', ref: 'vars.salesXlsx.0', quote: 'Latin America | 420000 | 1500 | 5%' },
      ],
    }, ctx);
    expect(r?.kind).toBe('derived');
    expect((r as { expression?: string }).expression).toBe('(#1+#2+#3+#4)');
    const inputs = (r as { inputs: Array<{ kind: string; attachment?: { name: string } }> }).inputs;
    expect(inputs).toHaveLength(4);
    // each input is an openable sheet tab — the reviewer can compare all four rows
    expect(inputs.every((i) => i.kind === 'doc' && i.attachment?.name === 'sales.xlsx')).toBe(true);
  });

  it('DERIVED (complex, exec vt5bua29…): nested DSCR ratio — expression + all 5 line items resolve to the CMA sheet', () => {
    // Real citation for dscr_fy2026 = (58.3+6.02+0)/(160.76+0) = 0.40, from the
    // Emdee CMA. A genuine nested financial ratio, not a flat sum.
    const r = resolveCitationRef({
      kind: 'derived', expression: '(#1+#2+#3)/(#4+#5)',
      inputs: [
        { kind: 'ref', ref: 'vars.cmaXlsx.0', quote: 'Net Profit = 58.3' },
        { kind: 'ref', ref: 'vars.cmaXlsx.0', quote: 'Depreciation = 6.02' },
        { kind: 'ref', ref: 'vars.cmaXlsx.0', quote: 'Interest TL (term loan) = 0' },
        { kind: 'ref', ref: 'vars.cmaXlsx.0', quote: 'Principal TL (term loan repayment) = 160.76' },
        { kind: 'ref', ref: 'vars.cmaXlsx.0', quote: 'Interest TL (term loan) = 0' },
      ],
    }, ctx);
    expect(r?.kind).toBe('derived');
    // the nested expression survives to the reader, so the arithmetic is followable
    expect((r as { expression?: string }).expression).toBe('(#1+#2+#3)/(#4+#5)');
    const inputs = (r as { inputs: Array<{ kind: string; attachment?: { name: string } }> }).inputs;
    expect(inputs).toHaveLength(5);
    // every line item opens the CMA workbook — each numerator/denominator term is verifiable
    expect(inputs.every((i) => i.kind === 'doc' && i.attachment?.name === cma.name)).toBe(true);
  });

  it('URL: an external citation resolves to a link', () => {
    const r = resolveCitationRef({ kind: 'url', url: 'https://sec.gov/filing', title: 'SEC Filing' }, ctx);
    expect(r).toMatchObject({ kind: 'url', url: 'https://sec.gov/filing', title: 'SEC Filing' });
  });

  it('UNRESOLVABLE: an invented ref stays inert (no doc), never a wrong one', () => {
    const r = resolveCitationRef({ kind: 'ref', ref: 'steps.ghost.output.nope' }, ctx);
    expect(r).toBeUndefined();
  });
});

/**
 * Ref shapes taken verbatim from prod execution or1otp5eqyaupyewpuhjthif, where
 * every agent runs inside a PARALLEL. 107 chained citations there resolved to
 * nothing because the forward rule pattern-matched an absolute path that parallel
 * nesting breaks.
 */
describe('citations through a PARALLEL', () => {
  const cma = { name: 'cma.xlsx', mimeType: 'application/vnd.ms-excel', handle: 'mem://cma' };
  const ownArtifact = { name: 'section-viii.pdf', mimeType: 'application/pdf', handle: 'mem://out' };

  const pOutputs: Record<string, unknown> = {
    providers: { branches: { ocr: { steps: { ocr: { output: {
      results: [{ source: cma, pages: [{ page: 4, text: 'Sanctioned amount 250.00' }] }],
    } } } } } },
    extractors: { branches: { sec_viii: { steps: { sec_viii: { output: {
      response: {
        value: { sanctionedAmount: '250.00' },
        citation: { sanctionedAmount: [{
          kind: 'ref',
          ref: 'steps.providers.output.branches.ocr.steps.ocr.output.results.0.source',
          locator: { at: 'page', page: 4 },
          quote: 'Sanctioned amount 250.00',
        }] },
      },
      // files this step PRODUCED — must never be mistaken for what it read
      attachments: [ownArtifact],
    } } } } } },
  };
  const pctx = {
    stepTitle: () => undefined, stepDescription: () => undefined, stepGroup: () => undefined,
    stepOutput: (id: string) => pOutputs[id], stepRawConfig: () => undefined,
    triggerData: {}, varsData: {},
  } as unknown as OriginResolverCtx;

  const SEC8 = 'steps.extractors.output.branches.sec_viii.steps.sec_viii.output.response.value';

  it('a document cited from inside a parallel branch still resolves', () => {
    const r = resolveCitationRef({
      kind: 'ref',
      ref: 'steps.providers.output.branches.ocr.steps.ocr.output.results.0.source',
      locator: { at: 'page', page: 4 },
    }, pctx);
    expect(r).toMatchObject({ kind: 'doc', attachment: { name: 'cma.xlsx' } });
  });

  // The regression: one agent citing another agent's FIELD, both inside parallels.
  it('FORWARDS a field cited across parallel branches, through to the document', () => {
    const r = resolveCitationRef(
      { kind: 'ref', ref: `${SEC8}.sanctionedAmount`, quote: '250.00' }, pctx);
    expect(r).toMatchObject({
      kind: 'doc',
      attachment: { name: 'cma.xlsx' },
      anchor: { locator: { at: 'page', page: 4 } },
    });
  });

  // The floor must apply at any depth: without it the climb reaches the citing
  // step's OWN output artifact and reports it as the source — a wrong document,
  // which is worse than none.
  it('never mistakes the citing step\'s own artifact for the source', () => {
    const r = resolveCitationRef(
      { kind: 'ref', ref: `${SEC8}.notCited` }, pctx);
    expect(r).not.toMatchObject({ attachment: { name: 'section-viii.pdf' } });
  });

  // All 107 real chained refs cited the whole value object. There is no single
  // leaf to inherit, so it must degrade to the step-output form — honest about
  // what it is — rather than inventing a document.
  it('a whole-value citation resolves to the step output, not a document', () => {
    const r = resolveCitationRef({ kind: 'ref', ref: SEC8 }, pctx);
    expect(r?.kind).toBe('value');
  });
});

/**
 * Real output from exec adq0x7dfmgsrpnvs1d0yqykc — a step with no attachments
 * anywhere, so every citation into it must resolve to STEP OUTPUT and open the
 * panel at the cited path rather than rendering an inert marker.
 */
describe('citations that resolve to STEP OUTPUT', () => {
  const sctx = {
    stepTitle: (id: string) => (id === 'market_data' ? 'Market data' : undefined),
    stepDescription: () => undefined, stepGroup: () => undefined,
    stepOutput: (id: string) => (id === 'market_data'
      ? { response: { repoRate: '6.50', spread: '2.75', tenureMonths: '60', riskGrade: 'MS-4' } }
      : undefined),
    stepRawConfig: () => undefined, triggerData: {}, varsData: {},
  } as unknown as OriginResolverCtx;

  it('carries the step and the path so the panel can open and highlight it', () => {
    const r = resolveCitationRef(
      { kind: 'ref', ref: 'steps.market_data.output.response.riskGrade', quote: 'MS-4' }, sctx);
    expect(r).toMatchObject({ kind: 'value', stepId: 'market_data', value: 'MS-4' });
    // path is relative to the step's OUTPUT ROOT — no leading `output` segment,
    // or every lookup in the panel would miss by one level.
    expect((r as { path?: string[] }).path).toEqual(['response', 'riskGrade']);
  });

  it('is NOT reported as a document, since no attachment exists anywhere', () => {
    const r = resolveCitationRef(
      { kind: 'ref', ref: 'steps.market_data.output.response.tenureMonths' }, sctx);
    expect(r?.kind).not.toBe('doc');
  });

  it('a derived value over step-output inputs resolves every input the same way', () => {
    const r = resolveCitationRef({
      kind: 'derived', label: 'Effective lending rate', expression: '(#1+#2)',
      inputs: [
        { kind: 'ref', ref: 'steps.market_data.output.response.repoRate', quote: '6.50' },
        { kind: 'ref', ref: 'steps.market_data.output.response.spread', quote: '2.75' },
      ],
    }, sctx);
    expect(r?.kind).toBe('derived');
    const inputs = (r as { inputs: Array<{ kind: string; value?: unknown }> }).inputs;
    expect(inputs.map((i) => i.value)).toEqual(['6.50', '2.75']);
    expect(inputs.every((i) => i.kind === 'value')).toBe(true);
  });
});
