import { describe, it, expect } from 'vitest';
import {
  CitationRefSchema,
  isCitationRef,
  isCitationRefArray,
  CITATION_REF_JSON_SCHEMA,
  CITATION_DIRECTIVE_ATTRS,
  splitCitedRef,
} from './citation-ref.js';

describe('CitationRef', () => {
  describe('CitationRefSchema', () => {
    it('parses a ref citation with a locator and quote', () => {
      const parsed = CitationRefSchema.safeParse({
        kind: 'ref',
        ref: 'steps.ocr.output.results.0.source',
        locator: { at: 'page', page: 3 },
        quote: '5,000',
      });
      expect(parsed.success).toBe(true);
    });

    it('parses each locator kind', () => {
      const mk = (locator: unknown) =>
        CitationRefSchema.safeParse({ kind: 'ref', ref: 'x', locator }).success;
      expect(mk({ at: 'page', page: 2 })).toBe(true);
      expect(mk({ at: 'cell', sheet: 'P&L', row: 14, col: 'B' })).toBe(true);
      expect(mk({ at: 'cell', row: 14, col: 2 })).toBe(true);
      expect(mk({ at: 'line', from: 42 })).toBe(true);
      expect(mk({ at: 'line', from: 42, to: 50 })).toBe(true);
    });

    // A locator is only meaningful when there is something to locate within, so
    // omitting it must stay valid — that is how a non-document citation looks.
    it('parses a ref citation with no locator at all', () => {
      expect(
        CitationRefSchema.safeParse({ kind: 'ref', ref: 'steps.api.output.body.rate' }).success,
      ).toBe(true);
    });

    it('rejects an unknown locator kind', () => {
      expect(
        CitationRefSchema.safeParse({ kind: 'ref', ref: 'x', locator: { at: 'bbox', x: 1 } }).success,
      ).toBe(false);
    });

    it('parses a minimal ref citation', () => {
      expect(CitationRefSchema.safeParse({ kind: 'ref', ref: 'trigger.doc' }).success).toBe(true);
    });

    it('parses a url citation', () => {
      const parsed = CitationRefSchema.safeParse({
        kind: 'url',
        url: 'https://example.test/filing',
        title: 'Filing',
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects an unknown kind', () => {
      expect(CitationRefSchema.safeParse({ kind: 'bogus', ref: 'x' }).success).toBe(false);
    });

    it('rejects a ref citation missing its ref', () => {
      expect(CitationRefSchema.safeParse({ kind: 'ref', page: 2 }).success).toBe(false);
    });

    it('rejects a url citation missing its url', () => {
      expect(CitationRefSchema.safeParse({ kind: 'url', title: 'x' }).success).toBe(false);
    });

    it('rejects a non-positive or fractional page in a locator', () => {
      const mk = (page: number) =>
        CitationRefSchema.safeParse({ kind: 'ref', ref: 'x', locator: { at: 'page', page } }).success;
      expect(mk(0)).toBe(false);
      expect(mk(1.5)).toBe(false);
      expect(mk(2)).toBe(true);
    });
  });

  describe('isCitationRef', () => {
    it('accepts both kinds', () => {
      expect(isCitationRef({ kind: 'ref', ref: 'trigger.doc' })).toBe(true);
      expect(isCitationRef({ kind: 'url', url: 'https://x.test' })).toBe(true);
    });

    it('rejects non-citations', () => {
      expect(isCitationRef(null)).toBe(false);
      expect(isCitationRef('ref')).toBe(false);
      expect(isCitationRef({})).toBe(false);
      expect(isCitationRef({ kind: 'ref' })).toBe(false);
      expect(isCitationRef({ kind: 'bogus', ref: 'x' })).toBe(false);
    });
  });

  describe('isCitationRefArray', () => {
    it('accepts a leaf of citations', () => {
      expect(isCitationRefArray([{ kind: 'ref', ref: 'trigger.doc', page: 1 }])).toBe(true);
    });

    it('rejects an empty array', () => {
      expect(isCitationRefArray([])).toBe(false);
    });

    // The distinction that makes the citation mirror walkable: only leaves carry
    // `kind`, so a branch mirroring an array of values must not read as a leaf.
    it('rejects a mirror branch', () => {
      expect(isCitationRefArray([{ amount: [{ kind: 'ref', ref: 'x' }] }])).toBe(false);
    });

    it('rejects a partially-malformed leaf', () => {
      expect(isCitationRefArray([{ kind: 'ref', ref: 'x' }, { nope: 1 }])).toBe(false);
    });
  });

  it('derives a JSON schema union covering every kind', () => {
    const oneOf = CITATION_REF_JSON_SCHEMA['oneOf'] as unknown[];
    expect(oneOf).toHaveLength(3); // ref | url | derived
  });

  describe('derived citations', () => {
    const input = { kind: 'ref' as const, ref: 'steps.sheet.output.rows.12.value' };

    it('parses a computed value with its inputs and expression', () => {
      const parsed = CitationRefSchema.safeParse({
        kind: 'derived',
        expression: '(#2 - #1) / #1',
        inputs: [input, { kind: 'ref', ref: 'steps.sheet.output.rows.13.value' }],
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts a derivation with no expression (inputs alone are still provenance)', () => {
      expect(CitationRefSchema.safeParse({ kind: 'derived', inputs: [input] }).success).toBe(true);
    });

    it('rejects a derivation with no inputs — there would be nothing to verify', () => {
      expect(CitationRefSchema.safeParse({ kind: 'derived', inputs: [] }).success).toBe(false);
      expect(CitationRefSchema.safeParse({ kind: 'derived' }).success).toBe(false);
    });

    // All-or-nothing: `expression` addresses inputs positionally, so dropping a
    // malformed one would shift every later index and silently recompute
    // something different.
    it('rejects the whole derivation when any input is malformed', () => {
      const parsed = CitationRefSchema.safeParse({
        kind: 'derived',
        expression: '#1 + #2',
        inputs: [input, { kind: 'ref' /* no ref path */ }],
      });
      expect(parsed.success).toBe(false);
    });

    // The guard is what tells a citation leaf from a mirror branch — a derived
    // citation that failed this check would never render at all.
    it('is recognised by the guards', () => {
      const derived = { kind: 'derived', inputs: [input] };
      expect(isCitationRef(derived)).toBe(true);
      expect(isCitationRefArray([derived])).toBe(true);
    });

    it('is not confused with a mirror branch', () => {
      expect(isCitationRefArray([{ amount: [{ kind: 'ref', ref: 'x' }] }])).toBe(false);
    });
  });

  it('declares the markdown directive vocabulary', () => {
    expect(CITATION_DIRECTIVE_ATTRS).toEqual(['ref', 'page', 'url', 'quote', 'title']);
  });
});

/**
 * The citation mirror is the value's SIBLING, at whatever depth the value sits.
 * Encoding that relative fact as an absolute path (`steps.<id>.output.response.value`)
 * is what silently disabled provenance inheritance for every agent inside a
 * PARALLEL — 107 citations in one real run. These cases pin the relative reading.
 */
describe('splitCitedRef — locating the value/citation boundary', () => {
  it('splits a flat step ref', () => {
    expect(splitCitedRef('steps.extract.output.response.value.total'))
      .toEqual({ base: 'steps.extract', envelope: 'response', field: ['total'] });
  });

  // The envelope word is the producing executor's: a CODE step (e.g. a merge that
  // returns { value, citation }) emits `output.result.value`, not `.response.`. We
  // match the SHAPE and report which envelope was found — no per-word whitelist.
  it('splits a CODE step (merge) ref under the `result` envelope', () => {
    expect(splitCitedRef('steps.credit_merge.output.result.value.record.creditRecord'))
      .toEqual({ base: 'steps.credit_merge', envelope: 'result', field: ['record', 'creditRecord'] });
  });

  // The shape that was broken: the producing step lives inside a parallel, so the
  // boundary is buried mid-path instead of sitting right after the step id.
  it('splits a ref that runs through a parallel branch', () => {
    expect(splitCitedRef(
      'steps.extractors.output.branches.sec_viii.steps.sec_viii.output.response.value.amount',
    )).toEqual({
      base: 'steps.extractors.output.branches.sec_viii.steps.sec_viii',
      envelope: 'response',
      field: ['amount'],
    });
  });

  it('takes the INNERMOST boundary when responses nest', () => {
    expect(splitCitedRef('steps.a.output.response.value.x.output.response.value.y'))
      .toEqual({ base: 'steps.a.output.response.value.x', envelope: 'response', field: ['y'] });
  });

  it('reports an empty field path when the whole value is cited', () => {
    expect(splitCitedRef('steps.a.output.response.value'))
      .toEqual({ base: 'steps.a', envelope: 'response', field: [] });
  });

  it('handles a deep field path', () => {
    expect(splitCitedRef('steps.a.output.response.value.indicators.0.values.31032026')?.field)
      .toEqual(['indicators', '0', 'values', '31032026']);
  });

  // Segment-wise, not substring: a field that merely CONTAINS the words must not
  // be mistaken for the boundary, or the citation would resolve against garbage.
  it('does not false-match a field whose name merely resembles the boundary', () => {
    expect(splitCitedRef('steps.a.output.body.valueX')).toBeUndefined();
    expect(splitCitedRef('steps.a.outputs.response.values.x')).toBeUndefined();
  });

  it('returns undefined for a ref that cites something other than a response', () => {
    expect(splitCitedRef('steps.ocr.output.results.0.source')).toBeUndefined();
    expect(splitCitedRef('trigger.cmaWorkbook.0')).toBeUndefined();
    expect(splitCitedRef('vars.policyDocs.0')).toBeUndefined();
  });
});
