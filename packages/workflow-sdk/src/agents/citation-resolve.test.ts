import { describe, it, expect } from 'vitest';
import {
  labelSources,
  attachmentRefBase,
  citationSystemNote,
  sanitizeCitationMap,
  splitCitedResponse,
} from './citation-resolve.js';
import { CITED_VALUE_SEGMENTS, splitCitedRef, CITATION_DIRECTIVE_ATTRS } from '../common/citation-ref.js';
import { resolvePath } from '../engine/variable-resolver.js';
import { createMockContext } from '../testing/mock-context.js';
import type { WorkflowContext } from '../types/context.js';

/** Collects warnings so we can assert the never-throw paths still report. */
function makeLog() {
  const calls: string[] = [];
  return { warn: (m: string) => calls.push(m), calls };
}

function ocrContext(): WorkflowContext {
  return createMockContext({
    triggerData: { customer: 'Acme Ltd' },
    steps: {
      ocr: {
        type: 'OCR_DOCUMENT',
        output: {
          results: [
            {
              source: { name: 'invoice.pdf', mimeType: 'application/pdf', handle: 'mem://1' },
              pages: [{ page: 1, text: 'INVOICE TOTAL 5000' }],
            },
            {
              source: { name: 'receipt.pdf', mimeType: 'application/pdf', handle: 'mem://2' },
              pages: [{ page: 1, text: 'RECEIPT TOTAL 250' }],
            },
          ],
        },
      },
    },
  });
}

describe('labelSources', () => {
  it('wraps each resolved ref in a labelled source block', () => {
    const out = labelSources('Analyse: {{steps.ocr.output.results.0.pages.0.text}}', ocrContext());
    expect(out).toContain('[source: steps.ocr.output.results.0.pages.0.text]');
    expect(out).toContain('INVOICE TOTAL 5000');
    expect(out).toContain('[/source]');
    expect(out).toContain('Analyse:');
  });

  it('returns the message unchanged when it holds no refs', () => {
    const msg = 'Summarise the attached invoice.';
    expect(labelSources(msg, ocrContext())).toBe(msg);
  });

  it('labels every ref in a multi-ref message', () => {
    const out = labelSources(
      '{{trigger.customer}} owes {{steps.ocr.output.results.0.pages.0.text}}',
      ocrContext(),
    );
    expect(out).toContain('[source: trigger.customer]');
    expect(out).toContain('Acme Ltd');
    expect(out).toContain('[source: steps.ocr.output.results.0.pages.0.text]');
  });

  it('serialises object values as JSON', () => {
    const out = labelSources('{{steps.ocr.output.results.0.source}}', ocrContext());
    expect(out).toContain('[source: steps.ocr.output.results.0.source]');
    expect(out).toContain('"name": "invoice.pdf"');
  });

  // Pages are records too, so they expand per page — letting the agent cite the
  // exact page it read rather than the whole document's text.
  it('expands per-page text into individually citable blocks', () => {
    const out = labelSources('{{steps.ocr.output.results.0.pages}}', ocrContext());
    expect(out).toContain('[source: steps.ocr.output.results.0.pages.0]');
    expect(out).toContain('"page": 1');
  });

  // The label still goes in: the agent should see the ref exists even when it
  // resolved to nothing, rather than silently losing the source.
  it('still labels a ref that resolves to nothing', () => {
    const out = labelSources('{{steps.missing.output.x}}', ocrContext());
    expect(out).toContain('[source: steps.missing.output.x]');
  });

  // Without per-element labels the agent could only cite `…results`, which spans
  // two documents — leaving no way to say which one a value came from.
  it('expands an array of records, labelling each with ITS document', () => {
    const out = labelSources('Analyse: {{steps.ocr.output.results}}', ocrContext());

    expect(out).toContain('[source: steps.ocr.output.results.0.source');
    expect(out).toContain('[source: steps.ocr.output.results.1.source');
    expect(out).not.toContain('[source: steps.ocr.output.results]\n');
  });

  // The point of the whole labelling scheme: a citation names something the
  // reader can OPEN, not an internal text path that breaks when the producer's
  // output shape changes.
  it('labels a document-derived block with the document ref, not the text path', () => {
    const out = labelSources('{{steps.ocr.output.results}}', ocrContext());

    expect(out).toContain('[source: steps.ocr.output.results.0.source | page 1]');
    expect(out).toContain('INVOICE TOTAL 5000');
    // never the internal path the text happens to live at
    expect(out).not.toContain('pages.0.text');
  });

  it('carries a cell address when the producer emits one', () => {
    const ctx = createMockContext({
      steps: {
        sheet: {
          type: 'READ_SHEET',
          output: {
            source: { name: 'pnl.xlsx', mimeType: 'application/vnd.ms-excel', handle: 'mem://x' },
            rows: [{ sheet: 'P&L', row: 14, col: 'B', value: '10004000' }],
          },
        },
      },
    });
    const out = labelSources('{{steps.sheet.output}}', ctx);

    expect(out).toContain('[source: steps.sheet.output.source | cell P&L!B14]');
  });

  // No document to name → fall back to the value's own path, unchanged.
  it('labels a record with no document by its own path', () => {
    const ctx = createMockContext({
      steps: { api: { type: 'HTTP_REQUEST', output: { body: { rate: 83.12 } } } },
    });
    const out = labelSources('{{steps.api.output.body}}', ctx);

    expect(out).toContain('[source: steps.api.output.body]');
    expect(out).toContain('83.12');
  });

  it('does not expand an array of scalars', () => {
    const ctx = createMockContext({ triggerData: { tags: ['a', 'b'] } });
    const out = labelSources('{{trigger.tags}}', ctx);

    expect(out).toContain('[source: trigger.tags]');
    expect(out).not.toContain('[source: trigger.tags.0]');
  });

  it('does not expand an empty array', () => {
    const ctx = createMockContext({ triggerData: { docs: [] } });
    const out = labelSources('{{trigger.docs}}', ctx);

    expect(out).toContain('[source: trigger.docs]');
    expect(out).not.toContain('[source: trigger.docs.0]');
  });
});

describe('attachmentRefBase', () => {
  it('extracts the bound ref path', () => {
    expect(attachmentRefBase('{{trigger.documents}}')).toBe('trigger.documents');
  });

  it('strips the optional context prefix', () => {
    expect(attachmentRefBase('{{context.trigger.documents}}')).toBe('trigger.documents');
  });

  it('returns undefined for a literal binding', () => {
    expect(attachmentRefBase([{ name: 'a.pdf' }])).toBeUndefined();
    expect(attachmentRefBase(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-pure ref', () => {
    expect(attachmentRefBase('files: {{trigger.documents}}')).toBeUndefined();
  });
});

describe('citationSystemNote', () => {
  it('describes the value/citation mirror for json output', () => {
    const note = citationSystemNote('json');
    expect(note).toContain('"value"');
    expect(note).toContain('"citation"');
    expect(note).toContain('MIRRORS');
  });

  it('describes the container directive for string output', () => {
    const note = citationSystemNote('string');
    expect(note).toContain(':::citation');
    expect(note).not.toContain('MIRRORS');
  });
});

describe('sanitizeCitationMap', () => {
  it('keeps a well-formed leaf', () => {
    const log = makeLog();
    const map = sanitizeCitationMap(
      { total: [{ kind: 'ref', ref: 'steps.ocr.output.results.0.pages.0.text', page: 1 }] },
      log,
    ) as Record<string, unknown>;
    expect(map['total']).toHaveLength(1);
    expect(log.calls).toHaveLength(0);
  });

  // Renderers only treat a leaf as citations when *every* entry is valid, so one
  // hallucinated entry would otherwise silently suppress the good one beside it.
  it('drops a malformed entry but keeps the valid one beside it', () => {
    const log = makeLog();
    const map = sanitizeCitationMap(
      { total: [{ kind: 'ref', ref: 'trigger.doc' }, { kind: 'nope' }] },
      log,
    ) as Record<string, unknown>;
    expect(map['total']).toHaveLength(1);
    expect(log.calls).toHaveLength(1);
  });

  it('drops a leaf whose entries are all malformed', () => {
    const log = makeLog();
    const map = sanitizeCitationMap({ total: [{ kind: 'nope' }] }, log) as Record<string, unknown>;
    expect(map['total']).toBeUndefined();
  });

  it('recurses into a mirror branch', () => {
    const log = makeLog();
    const map = sanitizeCitationMap(
      { lineItems: [{ amount: [{ kind: 'url', url: 'https://x.test' }] }] },
      log,
    ) as { lineItems: Array<{ amount: unknown[] }> };
    expect(map.lineItems[0]?.amount).toHaveLength(1);
    expect(log.calls).toHaveLength(0);
  });

  it('yields an empty map for junk', () => {
    expect(sanitizeCitationMap('nonsense', makeLog())).toEqual({});
    expect(sanitizeCitationMap(undefined, makeLog())).toEqual({});
  });
});

describe('splitCitedResponse', () => {
  it('unwraps a well-formed value/citation response', () => {
    const log = makeLog();
    const out = splitCitedResponse(
      {
        value: { total: '5000' },
        citation: { total: [{ kind: 'ref', ref: 'steps.ocr.output.results.0.pages.0.text', page: 3 }] },
      },
      log,
    );
    expect(out.value).toEqual({ total: '5000' });
    expect((out.citation as Record<string, unknown>)['total']).toHaveLength(1);
    expect(log.calls).toHaveLength(0);
  });

  it('treats a lone value key as the wrapper minus citations', () => {
    const log = makeLog();
    const out = splitCitedResponse({ value: [1, 2, 3] }, log);
    expect(out.value).toEqual([1, 2, 3]);
    expect(out.citation).toEqual({});
  });

  it('treats a bare object as the output and warns', () => {
    const log = makeLog();
    const out = splitCitedResponse({ total: '5000' }, log);
    expect(out.value).toEqual({ total: '5000' });
    expect(out.citation).toEqual({});
    expect(log.calls[0]).toContain('no "citation" map');
  });

  // A user's own field named `value` must not be mistaken for the wrapper —
  // unwrapping `{value, other}` would silently drop `other`.
  it('does not unwrap an output that merely has a value field', () => {
    const log = makeLog();
    const out = splitCitedResponse({ value: '5000', other: 'x' }, log);
    expect(out.value).toEqual({ value: '5000', other: 'x' });
    expect(out.citation).toEqual({});
  });
});

/**
 * CONTRACT — the producer and the consumer must agree on where a cited value and
 * its citation mirror live.
 *
 * The SDK creates the shape (`splitCitedResponse` → `output.response.{value,citation}`);
 * the UI resolver navigates it via `CITED_VALUE_SEGMENTS` / `splitCitedRef`. Those
 * two used to agree only by coincidence — a string literal in the UI matching what
 * the agent step happened to emit — and nothing failed if they drifted apart.
 * These assertions tie them together, so a rename breaks a test here rather than
 * silently dropping every chained citation at runtime.
 */
describe('contract: emitted shape ↔ ref navigation', () => {
  const log = makeLog();
  const emitted = splitCitedResponse(
    {
      value: { total: '5000' },
      citation: { total: [{ kind: 'ref', ref: 'steps.ocr.output.results.0.source' }] },
    },
    log,
  );
  // exactly how a step's recorded output nests it
  const stepOutput: unknown = { response: { value: emitted.value, citation: emitted.citation } };

  const walk = (root: unknown, segs: readonly string[]): unknown =>
    segs.reduce<unknown>(
      (cur, s) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[s] : undefined),
      root,
    );

  it('CITED_VALUE_SEGMENTS reaches the value the agent step actually emitted', () => {
    expect(walk({ output: stepOutput }, CITED_VALUE_SEGMENTS)).toEqual({ total: '5000' });
  });

  it('the citation mirror is the value’s sibling, reachable by swapping the last segment', () => {
    const sibling = [...CITED_VALUE_SEGMENTS.slice(0, -1), 'citation'];
    expect(walk({ output: stepOutput }, sibling)).toHaveProperty('total');
  });

  it('splitCitedRef splits a ref at exactly that boundary', () => {
    const ref = `steps.extract.${CITED_VALUE_SEGMENTS.join('.')}.total`;
    expect(splitCitedRef(ref)).toEqual({ base: 'steps.extract', envelope: 'response', field: ['total'] });
    // and the field path addresses the emitted value
    expect(walk({ output: stepOutput }, [...CITED_VALUE_SEGMENTS, 'total'])).toBe('5000');
  });
});

/**
 * A value that already carries provenance must travel WITH it, so a downstream
 * agent can adopt the original source instead of citing the step it came through.
 *
 * Real runs made the need concrete: shown one block for a whole upstream section,
 * 107 of 107 citations stopped at the bare `.value`. The reader then landed on an
 * intermediate result rather than the document — true, but a dead end.
 */
describe('labelSources — cited values carry their own citation', () => {
  const upstreamCitation = {
    constitution: [{ kind: 'ref', ref: 'steps.ocr.output.results.0.source',
                     locator: { at: 'page', page: 2 }, quote: 'EMDEE SALES PRIVATE LIMITED' }],
    incorporated: [{ kind: 'ref', ref: 'steps.ocr.output.results.1.source',
                     locator: { at: 'page', page: 1 }, quote: 'Incorporated 2011' }],
  };
  function citedContext(): WorkflowContext {
    return createMockContext({
      steps: {
        section: {
          type: 'RUN_AGENT',
          output: {
            response: {
              value: { constitution: 'Pvt Ltd', incorporated: '2011', uncited: 'n/a' },
              citation: upstreamCitation,
            },
          },
        },
      },
    });
  }

  it('pairs each field with its own citation instead of one block for the object', () => {
    const out = labelSources('{{steps.section.output.response.value}}', citedContext());
    expect(out).toContain('[source: steps.section.output.response.value.constitution]');
    expect(out).toContain('[source: steps.section.output.response.value.incorporated]');
    // the whole-object block is what produced coarse citations — it must be gone
    expect(out).not.toContain('[source: steps.section.output.response.value]\n');
  });

  it('sends the original source alongside the value, ready to be copied', () => {
    const out = labelSources('{{steps.section.output.response.value}}', citedContext());
    const block = out.slice(out.indexOf('.constitution]'), out.indexOf('.incorporated]'));
    expect(block).toContain('Pvt Ltd');
    expect(block).toContain('"ref":"steps.ocr.output.results.0.source"');
    expect(block).toContain('"page":2');
  });

  // Pairing must be structural: a citation attached to the wrong field is worse
  // than the coarse citation it replaces.
  it('never attaches a field’s citation to a different field', () => {
    const out = labelSources('{{steps.section.output.response.value}}', citedContext());
    const inc = out.slice(out.indexOf('.incorporated]'));
    expect(inc).toContain('"ref":"steps.ocr.output.results.1.source"');
    expect(inc).not.toContain('results.0.source');
  });

  it('omits fields the upstream agent never cited — there is nothing to attach', () => {
    const out = labelSources('{{steps.section.output.response.value}}', citedContext());
    expect(out).not.toContain('.uncited]');
  });

  it('carries the citation for a ref naming one field directly', () => {
    const out = labelSources('{{steps.section.output.response.value.constitution}}', citedContext());
    expect(out).toContain('[source: steps.section.output.response.value.constitution]');
    expect(out).toContain('[cited-from:');
    expect(out).toContain('results.0.source');
  });

  // The whole point of the generalization: a CODE merge re-emits the agent's
  // { value, citation } shape under the `result` envelope (not `response`).
  // Reading it must propagate the ORIGINAL source, not dead-end at the merge node.
  it('propagates the original citation through a CODE step’s `result` envelope', () => {
    const ctx = createMockContext({
      steps: {
        credit_merge: {
          type: 'CODE',
          output: {
            result: {
              value: { constitution: 'Pvt Ltd' },
              citation: {
                constitution: [{ kind: 'ref', ref: 'steps.ocr.output.results.0.source',
                                 locator: { at: 'page', page: 2 }, quote: 'EMDEE SALES PRIVATE LIMITED' }],
              },
            },
          },
        },
      },
    });
    const out = labelSources('{{steps.credit_merge.output.result.value}}', ctx);
    expect(out).toContain('[source: steps.credit_merge.output.result.value.constitution]');
    expect(out).toContain('[cited-from:');
    expect(out).toContain('"ref":"steps.ocr.output.results.0.source"');
    // must NOT dead-end at the merge node
    expect(out).not.toContain('[source: steps.credit_merge.output.result]\n');
  });

  // The regression bar: everything that isn't a cited value labels exactly as before.
  it('leaves documents, trigger data and uncited steps untouched', () => {
    const before = labelSources('Doc: {{steps.ocr.output.results}} for {{trigger.customer}}', ocrContext());
    expect(before).not.toContain('[cited-from:');
    expect(before).toContain('[source: steps.ocr.output.results.0.source | page 1]');
    expect(before).toContain('Acme Ltd');
  });
});

/**
 * ROUND TRIP — every ref we hand the agent must resolve back.
 *
 * Citation precision is bounded by label precision, so a label pointing at a path
 * that no longer exists silently produces uncitable data. This is exactly how a
 * stale `results.0.data` label survived a field being deleted from the OCR step.
 */
describe('labelSources — every emitted ref resolves', () => {
  const refsIn = (labelled: string): string[] =>
    [...labelled.matchAll(/\[source: ([^\]|]+)/g)].map((m) => m[1]!.trim());

  it('emits only refs that resolve against the same context', () => {
    const wf = ocrContext();
    const refs = refsIn(labelSources('{{steps.ocr.output.results}} {{trigger.customer}}', wf));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(resolvePath(wf, ref)).toBeDefined();
  });

  it('holds for the per-field blocks of a cited value too', () => {
    const wf = createMockContext({
      steps: {
        section: {
          type: 'RUN_AGENT',
          output: {
            response: {
              value: { a: '1', nested: { b: '2' } },
              citation: {
                a: [{ kind: 'ref', ref: 'steps.ocr.output.results.0.source' }],
                nested: { b: [{ kind: 'ref', ref: 'steps.ocr.output.results.0.source' }] },
              },
            },
          },
        },
        ocr: ocrContext().steps!['ocr']!,
      },
    });
    const refs = refsIn(labelSources('{{steps.section.output.response.value}}', wf));
    expect(refs).toContain('steps.section.output.response.value.nested.b');
    for (const ref of refs) expect(resolvePath(wf, ref)).toBeDefined();
  });
});

/**
 * `labelSources` attaches [cited-from] regardless of output mode, so a prose
 * agent sees it too. Explaining it only in json mode would leave markdown agents
 * with unexplained data in the prompt — likelier to confuse than to help.
 */
describe('citationSystemNote — cited-from is explained in both output modes', () => {
  it('tells a json agent to copy the citation verbatim', () => {
    const note = citationSystemNote('json');
    expect(note).toContain('[cited-from:');
    expect(note).toMatch(/copy the \[cited-from\] citation/i);
  });

  it('tells a prose agent how to map it onto the flat directive', () => {
    const note = citationSystemNote('string');
    expect(note).toContain('[cited-from:');
    // the directive has no locator attribute, so a page must be mapped across
    expect(note).toContain('page=N');
  });

  it('never lets the directive vocabulary drift from the sanitize allowlist', () => {
    const note = citationSystemNote('string');
    for (const attr of CITATION_DIRECTIVE_ATTRS) expect(note).toContain(attr);
  });
});
