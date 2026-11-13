import { describe, it, expect } from 'vitest';
import { resolveCitationRef } from './citation-resolver.js';
import type { OriginResolverCtx } from './origin-resolver.js';
import type { RefCitation } from '../../shared/citation.js';

const invoice = { name: 'invoice.pdf', mimeType: 'application/pdf', handle: 'mem://1' };
const receipt = { name: 'receipt.pdf', mimeType: 'application/pdf', handle: 'mem://2' };

/** An OCR step output shaped as the step now emits it — doc beside the data. */
const ocrOutput = {
  results: [
    {
      source: invoice,
      name: 'invoice.pdf',
      data: 'INVOICE TOTAL 5000',
      pages: [
        { page: 1, text: 'cover' },
        { page: 3, text: 'TOTAL 5000' },
      ],
    },
    { source: receipt, name: 'receipt.pdf', data: 'RECEIPT TOTAL 250', pages: [] },
  ],
};

function makeCtx(outputs: Record<string, unknown>, triggerData: unknown = {}): OriginResolverCtx {
  return {
    stepTitle: () => undefined,
    stepDescription: () => undefined,
    stepGroup: () => undefined,
    stepOutput: (id: string) => outputs[id],
    stepRawConfig: () => undefined,
    triggerData,
  };
}

/** The anchor a doc citation should carry — page becomes a locator, quote stays. */
const at = (page?: number, quote?: string) => ({
  ...(quote !== undefined ? { quote } : {}),
  ...(page !== undefined ? { locator: { at: 'page' as const, page } } : {}),
});

const ref = (r: string, page?: number, quote?: string): RefCitation => ({
  kind: 'ref',
  ref: r,
  ...(page !== undefined ? { locator: { at: 'page' as const, page } } : {}),
  ...(quote !== undefined ? { quote } : {}),
});

describe('resolveCitationRef', () => {
  describe('rule 1 — direct', () => {
    it('resolves a ref that lands on an attachment', () => {
      const out = resolveCitationRef(
        ref('steps.ocr.output.results.0.source'),
        makeCtx({ ocr: ocrOutput }),
      );
      expect(out).toEqual({ kind: 'doc', attachment: invoice });
    });

    it('resolves a url citation without touching the workflow', () => {
      const out = resolveCitationRef(
        { kind: 'url', url: 'https://sec.test/filing', title: 'Filing' },
        makeCtx({}),
      );
      expect(out).toEqual({ kind: 'url', url: 'https://sec.test/filing', title: 'Filing' });
    });
  });

  describe('rule 2 — walk-up', () => {
    // The OCR case: the agent cites the text it read, not the document.
    it('finds the document sitting beside the cited data', () => {
      const out = resolveCitationRef(
        ref('steps.ocr.output.results.0.data', 3, 'TOTAL 5000'),
        makeCtx({ ocr: ocrOutput }),
      );
      expect(out).toEqual({ kind: 'doc', attachment: invoice, anchor: at(3, 'TOTAL 5000') });
    });

    // The index in the ref is what discriminates which document.
    it('picks the document belonging to the cited result, not the first one', () => {
      const out = resolveCitationRef(
        ref('steps.ocr.output.results.1.data'),
        makeCtx({ ocr: ocrOutput }),
      );
      expect(out).toMatchObject({ kind: 'doc', attachment: receipt });
    });

    // The safety net. Labels name the document (`…results.0.source | page 2`), so
    // this is a non-compliant agent citing an internal text node instead. We still
    // recover the document rather than dropping the citation — but the precise
    // page is lost, which is the honest cost of not copying the label.
    it('still finds the document when an agent cites an internal text node', () => {
      const out = resolveCitationRef(
        ref('steps.ocr.output.results.0.pages.1.text'),
        makeCtx({ ocr: ocrOutput }),
      );
      expect(out).toMatchObject({ kind: 'doc', attachment: invoice });
    });

    // The normal path: the address travels in the citation, copied from the label.
    it("uses the agent's locator as the anchor", () => {
      const out = resolveCitationRef(
        ref('steps.ocr.output.results.0.source', 9),
        makeCtx({ ocr: ocrOutput }),
      );
      expect(out).toMatchObject({ anchor: at(9) });
    });
  });

  describe('rule 3 — forward through a prior citation', () => {
    const agent1 = {
      response: {
        value: { total: '5000' },
        citation: { total: [ref('steps.ocr.output.results.0.data', 3, 'TOTAL 5000')] },
      },
    };

    it('inherits provenance from the agent that produced the value', () => {
      const out = resolveCitationRef(
        ref('steps.agent1.output.response.value.total'),
        makeCtx({ ocr: ocrOutput, agent1 }),
      );
      expect(out).toEqual({ kind: 'doc', attachment: invoice, anchor: at(3, 'TOTAL 5000') });
    });

    it("lets the citing agent's own page and quote win", () => {
      const out = resolveCitationRef(
        ref('steps.agent1.output.response.value.total', 7, 'five thousand'),
        makeCtx({ ocr: ocrOutput, agent1 }),
      );
      expect(out).toMatchObject({ attachment: invoice, anchor: at(7, 'five thousand') });
    });

    // An agent that generated a file has it on `output.attachments`. Walking up
    // from the cited value passes straight through that, so a structural guess
    // could hand back the agent's OWN artifact instead of the real source. The
    // citation it actually asserted must win over anything inferred.
    it('does not mistake the citing step\'s own artifact for the source', () => {
      const agentWithArtifact = {
        response: {
          value: { total: '5000' },
          citation: { total: [ref('steps.ocr.output.results.0.data', 3)] },
        },
        // a report the agent produced — NOT where `total` came from
        attachments: [{ name: 'report.pdf', mimeType: 'application/pdf', handle: 'mem://out' }],
      };
      const out = resolveCitationRef(
        ref('steps.agent1.output.response.value.total'),
        makeCtx({ ocr: ocrOutput, agent1: agentWithArtifact }),
      );
      expect(out).toMatchObject({ kind: 'doc', attachment: invoice, anchor: at(3) });
    });

    it('forwards a url citation too', () => {
      const agentUrl = {
        response: {
          value: { claim: 'x' },
          citation: { claim: [{ kind: 'url', url: 'https://sec.test/a' }] },
        },
      };
      const out = resolveCitationRef(
        ref('steps.agentUrl.output.response.value.claim'),
        makeCtx({ agentUrl }),
      );
      expect(out).toMatchObject({ kind: 'url', url: 'https://sec.test/a' });
    });

    it('terminates on a citation that points at itself', () => {
      const loop = {
        response: {
          value: { total: '1' },
          citation: { total: [ref('steps.loop.output.response.value.total')] },
        },
      };
      const out = resolveCitationRef(
        ref('steps.loop.output.response.value.total'),
        makeCtx({ loop }),
      );
      // Terminates rather than recursing forever. It resolves to the value it
      // points at — never to a document, since the cycle yields no source.
      expect(out).toMatchObject({ kind: 'value' });
    });
  });

  describe('rule 4 — nothing', () => {
    // An API-derived fact has no document — but it still has provenance. Showing
    // the value and its producing step beats a dead marker, and inventing a
    // document would be worse than either.
    it('resolves a non-document ref to its value', () => {
      const out = resolveCitationRef(
        ref('steps.api.output.body.rate'),
        makeCtx({ api: { body: { rate: 12 } } }),
      );
      expect(out).toMatchObject({ kind: 'value', ref: 'steps.api.output.body.rate', value: 12 });
    });

    it('returns undefined for a ref that resolves to nothing', () => {
      const out = resolveCitationRef(ref('steps.missing.output.x'), makeCtx({}));
      expect(out).toBeUndefined();
    });
  });
});

describe('resolveCitationRef — derived (computed values)', () => {
  const derived = {
    kind: 'derived' as const,
    expression: '(#2 - #1) / #1',
    inputs: [
      ref('steps.ocr.output.results.0.data', 3, '8900000'),
      ref('steps.ocr.output.results.1.data', 1, '10004000'),
    ],
  };

  it('resolves each input to its own source', () => {
    const out = resolveCitationRef(derived, makeCtx({ ocr: ocrOutput }));
    expect(out).toMatchObject({ kind: 'derived', expression: '(#2 - #1) / #1' });
    const inputs = (out as { inputs: unknown[] }).inputs;
    expect(inputs).toHaveLength(2);
    // The index in each ref is what picks the document, so the two inputs must
    // resolve to *different* files rather than both to the first.
    expect(inputs[0]).toMatchObject({ kind: 'doc', attachment: invoice, anchor: at(3) });
    expect(inputs[1]).toMatchObject({ kind: 'doc', attachment: receipt, anchor: at(1) });
  });

  it('keeps the derivation even when an input cannot be resolved', () => {
    const out = resolveCitationRef(
      { ...derived, inputs: [ref('steps.nope.output.x'), ref('steps.ocr.output.results.0.data')] },
      makeCtx({ ocr: ocrOutput }),
    );
    // The expression is still worth showing — dropping the whole citation would
    // lose the record of how the value was reached.
    expect(out).toMatchObject({ kind: 'derived' });
    expect((out as { inputs: unknown[] }).inputs).toHaveLength(1);
  });

  it('carries a url input through', () => {
    const out = resolveCitationRef(
      { kind: 'derived', inputs: [{ kind: 'url', url: 'https://sec.test/a' }] },
      makeCtx({}),
    );
    expect((out as { inputs: unknown[] }).inputs[0]).toMatchObject({ kind: 'url' });
  });

  // Provenance composes: an input can itself be a value another agent cited.
  it('resolves an input that forwards through an upstream citation', () => {
    const agent1 = {
      response: {
        value: { total: '5000' },
        citation: { total: [ref('steps.ocr.output.results.0.data', 3)] },
      },
    };
    const out = resolveCitationRef(
      { kind: 'derived', inputs: [ref('steps.agent1.output.response.value.total')] },
      makeCtx({ ocr: ocrOutput, agent1 }),
    );
    expect((out as { inputs: unknown[] }).inputs[0]).toMatchObject({
      kind: 'doc', attachment: invoice, anchor: at(3),
    });
  });
});
