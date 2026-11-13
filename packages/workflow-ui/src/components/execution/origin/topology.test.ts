/**
 * TOPOLOGY MATRIX — the same citation, resolved through every control-flow shape.
 *
 * Three separate bugs shipped because every resolver fixture was FLAT:
 *   1. the forward rule pattern-matched an absolute path → dead inside PARALLEL
 *   2. the walk-up floor used the same match → unbounded inside PARALLEL
 *   3. attribution used the OUTERMOST step → every citation labelled with the
 *      container ("Section extractors (parallel)") instead of its producer
 *
 * All three are one class: code that infers meaning from ref *shape* while
 * assuming steps are top-level. Five step types splice a nested container
 * (`parallel`, `map`, `loop`, `switch`, `conditional`) and `getBranches` is a
 * `BaseStep` hook, so future ones will too. Running the matrix means a new
 * control-flow shape is one fixture away from being covered, rather than a bug
 * discovered in production months later.
 */
import { describe, it, expect } from 'vitest';
import { resolveCitationRef } from './citation-resolver.js';
import type { OriginResolverCtx } from './origin-resolver.js';

const doc = { name: 'cma.xlsx', mimeType: 'application/vnd.ms-excel', handle: 'mem://cma' };

/** What a cited agent's output looks like, wherever it ends up nested. */
const producer = {
  response: {
    // `note` is deliberately UNCITED: it resolves to step output rather than a
    // document, which is where attribution becomes visible to the reader.
    value: { amount: '250.00', note: 'not separately cited' },
    citation: {
      amount: [{
        kind: 'ref',
        ref: 'steps.reader.output.results.0.source',
        locator: { at: 'page', page: 4 },
        quote: 'Sanctioned amount 250.00',
      }],
    },
  },
  // files this step PRODUCED — never what it read
  attachments: [{ name: 'own-report.pdf', mimeType: 'application/pdf', handle: 'mem://own' }],
};

const reader = { results: [{ source: doc, pages: [{ page: 4, text: 'Sanctioned amount 250.00' }] }] };

/**
 * Each shape wraps `producer` the way its step type nests step outputs, and
 * states the ref a downstream agent would cite. `flat` is the control.
 */
const SHAPES = [
  {
    name: 'flat',
    output: producer,
    ref: 'steps.section.output.response.value.amount',
    outputs: { section: producer, reader },
  },
  {
    name: 'parallel',
    ref: 'steps.group.output.branches.section.steps.section.output.response.value.amount',
    outputs: { group: { branches: { section: { steps: { section: { output: producer } } } } }, reader },
  },
  {
    name: 'switch',
    ref: 'steps.router.output.branches.caseA.steps.section.output.response.value.amount',
    outputs: { router: { branches: { caseA: { steps: { section: { output: producer } } } } }, reader },
  },
  {
    name: 'conditional',
    ref: 'steps.gate.output.branches.true.steps.section.output.response.value.amount',
    outputs: { gate: { branches: { true: { steps: { section: { output: producer } } } } }, reader },
  },
  {
    name: 'nested parallel',
    ref: 'steps.outer.output.branches.a.steps.inner.output.branches.b.steps.section.output.response.value.amount',
    outputs: {
      outer: { branches: { a: { steps: { inner: { output: { branches: { b: { steps: { section: { output: producer } } } } } } } } } },
      reader,
    },
  },
] as const;

function ctxFor(outputs: Record<string, unknown>): OriginResolverCtx {
  return {
    stepTitle: (id: string) => ({ section: 'Risk Assessment & Mitigation', group: 'Section extractors (parallel)' }[id]),
    stepDescription: () => undefined,
    stepGroup: () => undefined,
    stepOutput: (id: string) => outputs[id],
    stepRawConfig: () => undefined,
    triggerData: {},
    varsData: {},
  } as unknown as OriginResolverCtx;
}

describe.each(SHAPES)('citation resolution — $name', ({ ref, outputs }) => {
  const ctx = ctxFor(outputs as Record<string, unknown>);

  it('forwards through to the document the producer actually cited', () => {
    const r = resolveCitationRef({ kind: 'ref', ref, quote: '250.00' }, ctx);
    expect(r).toMatchObject({
      kind: 'doc',
      attachment: { name: 'cma.xlsx' },
      anchor: { locator: { at: 'page', page: 4 } },
    });
  });

  it('never attributes the value to the producer’s OWN output artifact', () => {
    const r = resolveCitationRef({ kind: 'ref', ref }, ctx);
    expect(r).not.toMatchObject({ attachment: { name: 'own-report.pdf' } });
  });
});

describe.each(SHAPES)('attribution — $name', ({ ref, outputs }) => {
  const ctx = ctxFor(outputs as Record<string, unknown>);
  const uncited = ref.replace(/\.amount$/, '.note');

  // The reported bug: every citation inside a parallel was labelled with the
  // container, which ran twelve branches and says nothing about this value.
  it('names the producing step, not the control-flow container', () => {
    const r = resolveCitationRef({ kind: 'ref', ref: uncited }, ctx);
    expect(r).toMatchObject({ kind: 'value', label: 'Risk Assessment & Mitigation' });
    expect((r as { label: string }).label).not.toBe('Section extractors (parallel)');
  });

  it('points the panel at the producing step and the field within its output', () => {
    const r = resolveCitationRef({ kind: 'ref', ref: uncited }, ctx);
    expect(r).toMatchObject({ stepId: 'section', path: ['response', 'value', 'note'] });
    // and the output ref ends at that step's own output root
    expect((r as { stepOutputRef?: string }).stepOutputRef?.endsWith('steps.section.output')).toBe(true);
  });
});

/** MAP/LOOP run the same step id once per item — the ref is the only thing that
 *  distinguishes iterations, so identity must not collapse to the step id. */
describe('map iterations stay distinct', () => {
  const iter = (amount: string) => ({ response: { value: { amount } } });
  const ctx = ctxFor({
    loop: { items: { 0: { steps: { section: { output: iter('100.00') } } },
                     1: { steps: { section: { output: iter('900.00') } } } } },
  });

  it('resolves each iteration to its own value, not the first or last', () => {
    const a = resolveCitationRef(
      { kind: 'ref', ref: 'steps.loop.output.items.0.steps.section.output.response.value.amount' }, ctx);
    const b = resolveCitationRef(
      { kind: 'ref', ref: 'steps.loop.output.items.1.steps.section.output.response.value.amount' }, ctx);
    expect((a as { value: unknown }).value).toBe('100.00');
    expect((b as { value: unknown }).value).toBe('900.00');
  });

  it('addresses the right iteration’s output, so the panel cannot show the wrong one', () => {
    const b = resolveCitationRef(
      { kind: 'ref', ref: 'steps.loop.output.items.1.steps.section.output.response.value.amount' }, ctx);
    // the output ref keeps `items.1` — a bare step id would name both iterations
    expect((b as { stepOutputRef?: string }).stepOutputRef)
      .toBe('steps.loop.output.items.1.steps.section.output');
    expect((b as { path?: string[] }).path).toEqual(['response', 'value', 'amount']);
  });
});
