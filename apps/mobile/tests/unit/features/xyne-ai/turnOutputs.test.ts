import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ToolInvocation } from '@/src/features/xyne-ai/api/xyneAIEvents';
import { createdCanvases, openUrlTargets } from '@/src/features/xyne-ai/model/turnOutputs';

const tool = (overrides: Partial<ToolInvocation>): ToolInvocation => ({
  toolName: 'open-url',
  args: {},
  status: 'completed',
  ...overrides,
});

describe('openUrlTargets', () => {
  it('lists each http(s) page once and skips failed or unrelated calls', () => {
    assert.deepEqual(
      openUrlTargets([
        tool({ args: { url: ' https://example.com/a ' } }),
        tool({ args: { url: 'https://example.com/a' } }),
        tool({ args: { url: 'javascript:alert(1)' } }),
        tool({ args: { url: 'https://example.com/b' }, isError: true }),
        tool({ toolName: 'search', args: { url: 'https://example.com/c' } }),
      ]),
      ['https://example.com/a'],
    );
  });
});

describe('createdCanvases', () => {
  const canvas = { kind: 'canvas' as const, viewAccessId: 'v1', label: 'Plan' };

  it('returns the canvas a completed create-canvas call cites, once', () => {
    assert.deepEqual(
      createdCanvases([
        tool({ toolName: 'xyne-spaces__spaces-create-canvas', citations: [canvas] }),
        tool({ toolName: 'spaces-create-canvas', citations: [canvas] }),
      ]),
      [canvas],
    );
  });

  it('ignores running, failed and other tools', () => {
    assert.deepEqual(
      createdCanvases([
        tool({ toolName: 'spaces-create-canvas', status: 'running', citations: [canvas] }),
        tool({ toolName: 'spaces-create-canvas', isError: true, citations: [canvas] }),
        tool({ toolName: 'spaces-read-canvas', citations: [canvas] }),
      ]),
      [],
    );
  });
});
