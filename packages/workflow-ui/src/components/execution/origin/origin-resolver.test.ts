import { describe, it, expect } from 'vitest';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import {
  getOriginRefs,
  resolveRef,
  buildOriginCtx,
  buildStepConfigMap,
  findPausedStepConfig,
  getFieldCitations,
  type OriginResolverCtx,
} from './origin-resolver.js';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';

// ─── getOriginRefs ───

describe('getOriginRefs', () => {
  it('extracts a single pure ref', () => {
    expect(getOriginRefs('{{steps.a.output.x}}')).toEqual(['steps.a.output.x']);
  });

  it('extracts multiple refs from a template, deduped', () => {
    expect(getOriginRefs('Hi {{trigger.name}} / {{trigger.name}} / {{steps.a.output.y}}')).toEqual([
      'trigger.name',
      'steps.a.output.y',
    ]);
  });

  it('returns [] for a literal value', () => {
    expect(getOriginRefs('just text')).toEqual([]);
    expect(getOriginRefs(42)).toEqual([]);
    expect(getOriginRefs(null)).toEqual([]);
  });

  it('walks nested objects/arrays (e.g. a step config)', () => {
    const cfg = { url: '{{trigger.host}}', body: { raw: '{{steps.a.output.id}}' } };
    expect(getOriginRefs(cfg).sort()).toEqual(['steps.a.output.id', 'trigger.host']);
  });
});

// ─── resolveRef ───

const ctx: OriginResolverCtx = {
  stepTitle: (id) => ({ reg: 'Register Mobile with NPCI', calc: 'Fraud Fork' }[id]),
  stepDescription: (id) => ({ reg: 'Registers the mobile with NPCI.' }[id]),
  stepGroup: (id) => ({ reg: { title: 'Onboarding' } }[id]),
  stepOutput: (id) => ({
    reg: { body: { binding_status: 'FAILED' } },
    calc: { result: { route: 'STANDARD' } },
  }[id]),
  stepRawConfig: (id) => ({
    // config interpolates a ref → derivable upstream
    reg: { body: { raw: '{{steps.init.output.result.mobile}}' } },
    // opaque code reads $context (no {{ref}}) → no derivable upstream
    calc: { code: 'return $context.trigger.category' },
  }[id]),
  triggerData: {
    rrn: 'RRN-1',
    category: 'FRAUD',
    attachments: [{ name: 'doc.pdf', mimeType: 'application/pdf', handle: 'mem://1' }],
  },
  varsData: {
    salesXlsx: [{ name: 'sales.xlsx', mimeType: 'application/vnd.ms-excel', handle: 'mem://x' }],
    companyName: 'ACME Corp',
  },
};

describe('resolveRef', () => {
  it('classifies step refs structurally (kind: step), with title, value, and config-ref upstream', () => {
    const o = resolveRef('steps.reg.output.body.binding_status', ctx);
    expect(o.kind).toBe('step'); // structural — never the step's type
    expect(o.label).toBe('Register Mobile with NPCI');
    expect(o.value).toBe('FAILED');
    expect(o.stepId).toBe('reg');
    expect(o.tier).toBe('derived');
    // reg's config interpolates a ref → surfaced as upstream (drives recursion)
    expect(o.upstreamRefs).toContain('steps.init.output.result.mobile');
    // step description + group surfaced alongside the title
    expect(o.stepDescription).toBe('Registers the mobile with NPCI.');
    expect(o.group).toEqual({ title: 'Onboarding' });
  });

  it('yields no auto upstream when a step hides its inputs in opaque code ($context)', () => {
    const o = resolveRef('calc.output.result.route', ctx);
    expect(o.kind).toBe('step');
    expect(o.value).toBe('STANDARD');
    // Not a {{ref}} — trail ends here (author-tagging would restore it). Documented limit.
    expect(o.upstreamRefs).toEqual([]);
  });

  it('resolves trigger refs against trigger data', () => {
    const o = resolveRef('trigger.rrn', ctx);
    expect(o.label).toBe('the original request');
    expect(o.kind).toBe('trigger');
    expect(o.value).toBe('RRN-1');
    expect(o.upstreamRefs).toEqual([]);
  });

  it('handles bare-shorthand step refs', () => {
    const o = resolveRef('reg.output.body.binding_status', ctx);
    expect(o.kind).toBe('step');
    expect(o.stepId).toBe('reg');
    expect(o.value).toBe('FAILED');
  });

  // A document supplied as a workflow variable is cited `vars.<key>.<i>`; without
  // a vars branch the ref resolved to nothing and its marker was inert.
  it('resolves a document supplied as a variable (vars.<key>.<i>) to its attachment', () => {
    const o = resolveRef('vars.salesXlsx.0', ctx);
    expect(o.value).toMatchObject({ name: 'sales.xlsx' });
    expect(o.attachments?.[0]).toMatchObject({ name: 'sales.xlsx' });
    expect(o.label).toBe('salesXlsx');
  });

  it('resolves a scalar variable', () => {
    expect(resolveRef('vars.companyName', ctx).value).toBe('ACME Corp');
  });

  it('uses the ctx trigger label when provided (varies by trigger type)', () => {
    expect(resolveRef('trigger.rrn', { ...ctx, triggerLabel: 'the scheduled run' }).label).toBe(
      'the scheduled run',
    );
  });
});

// ─── buildOriginCtx + displayOriginRefs ───

function detailFixture(): ExecutionDetail {
  return {
    id: 'exec1',
    workflowId: 'wf1',
    status: 'EXTERNAL_WAIT',
    createdAt: new Date(),
    triggerData: { mobile: '999' },
    config: {
      trigger: { type: 'MANUAL', config: {} },
      groups: [{ id: 'g1', title: 'Setup', description: 'Initial setup steps' }],
      variables: [
        { key: 'policyDoc', type: 'documents', value: [{ name: 'policy.pdf', mimeType: 'application/pdf', handle: 'mem://p' }] },
      ],
      steps: [
        { id: 'init', type: 'CODE', config: { code: 'return 1' } },
        {
          id: 'gate',
          type: 'WAIT',
          groupId: 'g1',
          config: {
            mode: 'approval',
            reason: 'review',
            display: [
              { label: 'Mobile', value: '{{steps.init.output.result.mobile}}' },
              { label: 'Note', value: 'static text' },
            ],
          },
        },
      ],
    },
    steps: [
      {
        stepName: 'step_0',
        status: 'COMPLETED',
        executorType: 'deterministic',
        data: JSON.stringify({ output: { result: { mobile: '999' } } }),
      },
      { stepName: 'step_1', status: 'EXTERNAL_WAIT', executorType: 'deterministic', data: JSON.stringify({ pauseState: {} }) },
    ],
  } as unknown as ExecutionDetail;
}

describe('buildStepConfigMap (generic nesting via walkStepConfigs)', () => {
  it('flattens steps nested in any control-flow shape, no hardcoded keys', () => {
    const config = {
      trigger: { type: 'MANUAL', config: {} },
      steps: [
        { id: 'top', type: 'CODE', config: { code: '1' } },
        {
          id: 'cond',
          type: 'CONDITIONAL',
          config: {
            if_true: [{ id: 'in_true', type: 'CODE', config: {} }],
            if_false: [{ id: 'in_false', type: 'CODE', config: {} }],
          },
        },
        {
          id: 'sw',
          type: 'SWITCH',
          config: { cases: [{ label: 'A', steps: [{ id: 'in_case', type: 'CODE', config: {} }] }] },
        },
      ],
    } as unknown as WorkflowConfig;
    const map = buildStepConfigMap(config);
    expect([...map.keys()].sort()).toEqual(
      ['cond', 'in_case', 'in_false', 'in_true', 'sw', 'top'].sort(),
    );
  });
});

describe('buildOriginCtx', () => {
  it('maps step_N records to config ids and exposes title/output/rawConfig', () => {
    const c = buildOriginCtx(detailFixture());
    expect(c.stepOutput('init')).toEqual({ result: { mobile: '999' } });
    expect(c.stepRawConfig('gate')).toBeDefined();
    expect(c.triggerData).toEqual({ mobile: '999' });
    // group resolved via groupId → workflow groups
    expect(c.stepGroup('gate')).toEqual({ title: 'Setup', description: 'Initial setup steps' });
    // trigger label derived from the trigger type
    expect(c.triggerLabel).toBe('the original request');
  });

  it('resolves a display ref end-to-end through the built ctx', () => {
    const c = buildOriginCtx(detailFixture());
    const o = resolveRef('steps.init.output.result.mobile', c);
    expect(o.value).toBe('999');
  });

  it('populates varsData from config.variables so a vars citation resolves', () => {
    const c = buildOriginCtx(detailFixture());
    const o = resolveRef('vars.policyDoc.0', c);
    expect(o.attachments?.[0]).toMatchObject({ name: 'policy.pdf' });
  });
});

describe('findPausedStepConfig + generic field refs', () => {
  it('returns the paused WAIT step config; getOriginRefs derives refs per visible field', () => {
    const cfg = findPausedStepConfig(detailFixture());
    const display = (cfg?.config as { display?: Array<{ value?: unknown }> } | undefined)?.display ?? [];
    // generic mechanism: any value → its refs (literal → none)
    expect(getOriginRefs(display[0]?.value)).toEqual(['steps.init.output.result.mobile']);
    expect(getOriginRefs(display[1]?.value)).toEqual([]);
  });
});

describe('node-path step records (nested steps)', () => {
  function nodePathDetail(): ExecutionDetail {
    return {
      id: 'exec2',
      workflowId: 'wf2',
      status: 'EXTERNAL_WAIT',
      createdAt: new Date(),
      config: {
        trigger: { type: 'MANUAL', config: {} },
        steps: [
          {
            id: 'router',
            type: 'CONDITIONAL',
            config: {
              if_true: [
                { id: 'ocr', type: 'OCR_DOCUMENT', config: {} },
                { id: 'approve', type: 'WAIT', config: { mode: 'approval', reason: 'ok' } },
              ],
            },
          },
        ],
      },
      steps: [
        // control-step marker — must be skipped by findPausedStepConfig
        { stepName: 'router', status: 'EXTERNAL_WAIT', executorType: 'conditional', data: JSON.stringify({ output: {} }) },
        // nested branch step keyed by node-path
        { stepName: 'router:if_true#0/ocr', status: 'COMPLETED', executorType: 'deterministic', data: JSON.stringify({ output: { text: 'hi' } }) },
        // the real leaf gate (REVIEW_WAIT), node-path keyed
        { stepName: 'router:if_true#0/approve', status: 'REVIEW_WAIT', executorType: 'deterministic', data: JSON.stringify({ pauseState: { reason: 'ok' } }) },
      ],
    } as unknown as ExecutionDetail;
  }

  it('resolves a nested step output under its bare config id', () => {
    const c = buildOriginCtx(nodePathDetail());
    expect(c.stepOutput('ocr')).toEqual({ text: 'hi' });
  });

  it('finds the leaf gate (REVIEW_WAIT, node-path keyed), skipping the control marker', () => {
    const cfg = findPausedStepConfig(nodePathDetail());
    expect(cfg?.id).toBe('approve');
  });
});

describe('resolveRef — attachments', () => {
  it('marks an attachment value with attachments + (still) structural kind', () => {
    const o = resolveRef('trigger.attachments', ctx);
    expect(o.kind).toBe('trigger');
    expect(o.attachments).toEqual([{ name: 'doc.pdf', mimeType: 'application/pdf', handle: 'mem://1' }]);
  });

  it('leaves attachments undefined for a non-file value', () => {
    expect(resolveRef('trigger.rrn', ctx).attachments).toBeUndefined();
  });
});

describe('getFieldCitations', () => {
  const stepConfig = {
    reason: 'hi',
    display: [{ id: 'sec_1', label: 'Amount', value: '{{x}}' }],
  };
  const citations = {
    'display[sec_1].value': [{ ref: '{{trigger.attachments}}', label: 'Doc' }],
    reason: [{ ref: '{{steps.a.output.x}}' }],
  };

  it('looks up citations for an array-element field via its stable path', () => {
    expect(getFieldCitations(stepConfig, citations, 'display.0.value')).toEqual([
      { ref: '{{trigger.attachments}}', label: 'Doc' },
    ]);
  });

  it('is prefix-aware: a row-level read surfaces a sub-field citation (and vice-versa)', () => {
    // reviewer renders the `display[sec_1]` row; author cited `display[sec_1].value`
    expect(getFieldCitations(stepConfig, citations, 'display.0')).toEqual([
      { ref: '{{trigger.attachments}}', label: 'Doc' },
    ]);
  });

  it('row-level read collects every citation beneath the element', () => {
    const multi = {
      'display[sec_1]': [{ ref: '{{a}}', label: 'row' }],
      'display[sec_1].value': [{ ref: '{{b}}', label: 'value' }],
    };
    expect(getFieldCitations(stepConfig, multi, 'display.0')).toEqual([
      { ref: '{{a}}', label: 'row' },
      { ref: '{{b}}', label: 'value' },
    ]);
  });

  it('does not bleed across sibling elements (delimiter-guarded prefix)', () => {
    const cfg = { display: [{ id: 'sec_1', value: '{{x}}' }, { id: 'sec_10', value: '{{y}}' }] };
    const cits = { 'display[sec_10].value': [{ ref: '{{z}}', label: 'Other' }] };
    // reading sec_1 must NOT match sec_10 just because the key starts with "sec_1"
    expect(getFieldCitations(cfg, cits, 'display.0')).toEqual([]);
  });

  it('looks up citations for a scalar field', () => {
    expect(getFieldCitations(stepConfig, citations, 'reason')).toEqual([{ ref: '{{steps.a.output.x}}' }]);
  });

  it('returns [] for a field with no citations', () => {
    expect(getFieldCitations(stepConfig, citations, 'prompt')).toEqual([]);
    expect(getFieldCitations(stepConfig, undefined, 'reason')).toEqual([]);
  });
});
