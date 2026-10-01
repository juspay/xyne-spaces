import { describe, expect, it } from 'vitest';
import {
  createDraftReveal,
  expectedSlots,
  rowPatch,
  rowSuggestions,
  typingSteps,
  type RevealSlot,
} from './draftReveal';
import { EMPTY_CREATE_FORM, type CreateHubSuggestions } from './types';

const tick = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** A reveal whose parts record when they run. */
function rig(waitMs = 40): {
  reveal: ReturnType<typeof createDraftReveal>;
  order: string[];
  part: (slot: RevealSlot, label?: string, ms?: number) => void;
} {
  const order: string[] = [];
  const reveal = createDraftReveal({ signal: new AbortController().signal, waitMs });
  const part = (slot: RevealSlot, label: string = slot, ms = 0): void =>
    reveal.fill(slot, async () => {
      order.push(`${label}:start`);
      await tick(ms);
      order.push(`${label}:end`);
    });
  return { reveal, order, part };
}

describe('createDraftReveal', () => {
  it('shows parts top to bottom, whatever order they arrive in', async () => {
    const { reveal, order, part } = rig();
    reveal.start(new Set(['identity', 'capabilities', 'schedule', 'properties', 'instructions']));
    part('schedule');
    part('properties');
    part('identity', 'identity', 5);
    await tick(5);
    part('capabilities');
    part('instructions');
    await reveal.finish();
    expect(order).toEqual([
      'identity:start',
      'identity:end',
      'capabilities:start',
      'capabilities:end',
      'schedule:start',
      'schedule:end',
      'properties:start',
      'properties:end',
      'instructions:start',
      'instructions:end',
    ]);
  });

  it('lets each part finish before the next starts', async () => {
    const { reveal, order, part } = rig();
    reveal.start(new Set(['identity', 'schedule']));
    part('identity', 'identity', 15);
    part('schedule');
    await reveal.finish();
    expect(order).toEqual(['identity:start', 'identity:end', 'schedule:start', 'schedule:end']);
  });

  it('stops waiting for a slow tool plan once the instructions start', async () => {
    const { reveal, order, part } = rig(10_000);
    reveal.start(new Set(['identity', 'capabilities', 'schedule', 'instructions']));
    part('identity');
    part('schedule');
    await tick(5);
    expect(order).toEqual(['identity:start', 'identity:end']);
    part('instructions', 'instructions', 30);
    await tick(5);
    // The plan lands late, while the instructions are still writing: it shows at once.
    part('capabilities');
    await reveal.finish();
    expect(order.slice(2)).toEqual([
      'schedule:start',
      'schedule:end',
      'instructions:start',
      'capabilities:start',
      'capabilities:end',
      'instructions:end',
    ]);
  });

  it('moves past a part that never comes after the wait', async () => {
    const { reveal, order, part } = rig(20);
    reveal.start(new Set(['identity', 'capabilities', 'schedule']));
    part('identity');
    part('schedule');
    await tick(60);
    expect(order).toEqual(['identity:start', 'identity:end', 'schedule:start', 'schedule:end']);
    await reveal.finish();
  });

  it('still shows everything, in order, when the turn never said what it writes', async () => {
    const { reveal, order, part } = rig();
    part('properties');
    part('identity');
    await reveal.finish();
    expect(order).toEqual(['identity:start', 'identity:end', 'properties:start', 'properties:end']);
  });

  it('skips what is left once the turn is cancelled', async () => {
    const controller = new AbortController();
    const order: string[] = [];
    const reveal = createDraftReveal({ signal: controller.signal, waitMs: 40 });
    reveal.start(new Set(['identity', 'schedule']));
    reveal.fill('identity', () => {
      order.push('identity');
      controller.abort();
      return Promise.resolve();
    });
    reveal.fill('schedule', () => {
      order.push('schedule');
      return Promise.resolve();
    });
    await reveal.finish();
    expect(order).toEqual(['identity']);
  });
});

describe('expectedSlots', () => {
  it('expects the tool plan on every first draft and only asked-for parts on an edit', () => {
    expect([...expectedSlots('draft', ['name', 'instructions'])]).toEqual([
      'identity',
      'capabilities',
      'instructions',
    ]);
    expect([...expectedSlots('edit', ['schedule', 'properties'])]).toEqual([
      'schedule',
      'properties',
    ]);
    expect([...expectedSlots('edit', ['skills'])]).toEqual(['capabilities']);
  });
});

describe('tools rows', () => {
  const plan = {
    tools: {
      subagents: ['research'],
      direct: [],
      custom: ['custom:web'],
      gateway: ['github', 'slack'],
      callableAgents: [],
    },
    selectedSkillIds: ['skill-1'],
  };

  it('splits a plan patch into one patch per row, over the live form', () => {
    const form = EMPTY_CREATE_FORM;
    const mcp = rowPatch('mcp', plan, form);
    expect(mcp.tools?.gateway).toEqual(['github', 'slack']);
    expect(mcp.tools?.custom).toEqual(form.tools.custom);
    expect(mcp.tools?.subagents).toEqual(form.tools.subagents);

    const afterMcp = { ...form, tools: mcp.tools! };
    const builtin = rowPatch('builtin', plan, afterMcp);
    expect(builtin.tools?.custom).toEqual(['custom:web']);
    // Rows already shown keep what they show.
    expect(builtin.tools?.gateway).toEqual(['github', 'slack']);

    expect(rowPatch('skills', plan, form)).toEqual({ selectedSkillIds: ['skill-1'] });
    expect(rowPatch('knowledge', plan, form)).toEqual({});
  });

  it('leaves a row alone when the plan does not change it', () => {
    const form = { ...EMPTY_CREATE_FORM, tools: plan.tools };
    expect(rowPatch('mcp', plan, form)).toEqual({});
    expect(rowPatch('subagent', plan, form)).toEqual({});
  });

  it('replaces suggested chips one row at a time', () => {
    const empty: CreateHubSuggestions = {
      mcp: [],
      builtin: [],
      subagents: [],
      skills: [],
      knowledge: [],
    };
    const next: CreateHubSuggestions = {
      ...empty,
      subagents: [{ name: 'writer', confidence: 0.6 }],
      skills: [{ id: 's', label: 'S', confidence: 0.6 }],
    };
    const mcpOnly = rowSuggestions(empty, next, ['tools', 'skills'], 'mcp');
    expect(mcpOnly).toBe(empty);
    const withSubagents = rowSuggestions(empty, next, ['tools', 'skills'], 'subagent');
    expect(withSubagents.subagents).toEqual(next.subagents);
    expect(withSubagents.skills).toEqual([]);
    // A row the plan doesn't decide keeps its chips.
    expect(rowSuggestions(empty, next, ['tools'], 'skills')).toBe(empty);
  });
});

describe('typing', () => {
  it('types a name in within the time given and ends on the full text', () => {
    const steps = typingSteps(40, 260);
    expect(steps.at(-1)).toBe(40);
    expect(steps.length).toBeLessThanOrEqual(17);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(typingSteps(0, 260)).toEqual([]);
  });
});
