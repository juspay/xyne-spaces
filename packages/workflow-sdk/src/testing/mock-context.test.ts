import { describe, it, expect } from 'vitest';
import { createMockContext } from './mock-context.js';

describe('createMockContext', () => {
  it('creates context with defaults', () => {
    const ctx = createMockContext();
    expect(ctx.workflow.id).toBe('wf_test');
    expect(ctx.workflow.metadata).toEqual({});
    expect(ctx.trigger.type).toBe('TEST');
    expect(ctx.steps).toEqual({});
  });

  it('accepts workflowId override', () => {
    const ctx = createMockContext({ workflowId: 'wf_custom' });
    expect(ctx.workflow.id).toBe('wf_custom');
  });

  it('accepts metadata override', () => {
    const ctx = createMockContext({
      metadata: { workspaceId: 'ws_1', tenantId: 't_1' },
    });
    expect(ctx.workflow.metadata).toEqual({
      workspaceId: 'ws_1',
      tenantId: 't_1',
    });
  });

  it('accepts triggerType and triggerData', () => {
    const ctx = createMockContext({
      triggerType: 'TICKET_CREATED',
      triggerData: { ticketId: 'tk_1', priority: 3 },
    });
    expect(ctx.trigger.type).toBe('TICKET_CREATED');
    expect((ctx.trigger as Record<string, unknown>)['ticketId']).toBe('tk_1');
  });

  it('accepts full workflow override', () => {
    const ctx = createMockContext({
      workflow: { id: 'full_override', attributes: undefined, metadata: { x: 1 } },
    });
    expect(ctx.workflow.id).toBe('full_override');
    expect(ctx.workflow.metadata).toEqual({ x: 1 });
  });

  it('accepts steps override', () => {
    const ctx = createMockContext({
      steps: {
        step1: { type: 'ECHO', output: { echoed: 'hi' } },
      },
    });
    expect(ctx.steps['step1']).toBeDefined();
    expect(ctx.steps['step1']!.output).toEqual({ echoed: 'hi' });
  });
});
