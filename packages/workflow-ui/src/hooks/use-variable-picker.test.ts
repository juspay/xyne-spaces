import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { VariableNode } from './use-variable-picker.js';

// Mock the client hook so the picker resolves a fixed available-context.
const availableContext = vi.fn();
vi.mock('./use-workflow-client.js', () => ({
  useWorkflowClient: () => ({ schema: { availableContext } }),
}));

import { useVariablePicker } from './use-variable-picker.js';

// Source context: an OCR-style array-of-objects output, an author-defined CODE
// step output (a `number` field under `result`), and a trigger attachment array.
const CONTEXT = {
  'steps.ocr.output': {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, data: { type: 'string' } },
        },
      },
    },
  },
  'steps.code.output': {
    type: 'object',
    properties: {
      result: { type: 'object', properties: { score: { type: 'number' } } },
    },
  },
  trigger: {
    type: 'object',
    properties: {
      attachments: { type: 'array', items: { type: 'object', format: 'attachment' } },
    },
  },
};

function allRefs(nodes: VariableNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.refString);
    out.push(...allRefs(n.children));
  }
  return out;
}

async function refsFor(filterType?: string): Promise<string[]> {
  availableContext.mockResolvedValue(CONTEXT);
  const { result } = renderHook(() =>
    useVariablePicker({
      config: {} as never,
      atStepId: 'consumer',
      ...(filterType ? { filterType } : {}),
    }),
  );
  await waitFor(() => expect(result.current.variables.length).toBeGreaterThan(0));
  return allRefs(result.current.variables);
}

describe('useVariablePicker filtering', () => {
  it('string field surfaces array / object / number sources (universal sink)', async () => {
    const refs = await refsFor('string');
    expect(refs).toContain('{{steps.ocr.output.results}}'); // array-of-objects, whole
    expect(refs).toContain('{{steps.code.output.result.score}}'); // author number field
  });

  it('number field hides arrays but keeps numeric (author-defined) sources', async () => {
    const refs = await refsFor('number');
    expect(refs).toContain('{{steps.code.output.result.score}}');
    expect(refs).not.toContain('{{steps.ocr.output.results}}');
  });

  it('attachment field stays attachment-only', async () => {
    const refs = await refsFor('attachment[]');
    expect(refs).toContain('{{trigger.attachments}}');
    expect(refs).not.toContain('{{steps.ocr.output.results}}');
    expect(refs).not.toContain('{{steps.code.output.result.score}}');
  });

  it('no filter shows everything', async () => {
    const refs = await refsFor();
    expect(refs).toContain('{{steps.ocr.output.results}}');
    expect(refs).toContain('{{trigger.attachments}}');
    expect(refs).toContain('{{steps.code.output.result.score}}');
  });
});
