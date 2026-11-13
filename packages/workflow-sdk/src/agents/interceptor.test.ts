import { describe, it, expect } from 'vitest';
import {
  runInterceptorChain,
  type ToolInterceptor,
} from './interceptor.js';
import { ApprovalGateInterceptor } from './interceptors/approval-gate.js';
import { ToolLoggingInterceptor } from './interceptors/tool-logger.js';

describe('runInterceptorChain', () => {
  it('returns allow when no interceptors', async () => {
    expect(await runInterceptorChain([], 'tool', {})).toBe('allow');
  });

  it('returns allow when no interceptor matches', async () => {
    const interceptor: ToolInterceptor = {
      shouldIntercept: () => false,
      handle: async () => 'deny',
    };
    expect(await runInterceptorChain([interceptor], 'tool', {})).toBe(
      'allow',
    );
  });

  it('returns deny from first matching interceptor', async () => {
    const denier: ToolInterceptor = {
      shouldIntercept: () => true,
      handle: async () => 'deny',
    };
    const allower: ToolInterceptor = {
      shouldIntercept: () => true,
      handle: async () => 'allow',
    };
    expect(await runInterceptorChain([denier, allower], 'tool', {})).toBe(
      'deny',
    );
  });

  it('returns pause from matching interceptor', async () => {
    const pauser: ToolInterceptor = {
      shouldIntercept: () => true,
      handle: async () => 'pause',
    };
    expect(await runInterceptorChain([pauser], 'tool', {})).toBe('pause');
  });

  it('continues chain when interceptor returns allow', async () => {
    const allower: ToolInterceptor = {
      shouldIntercept: () => true,
      handle: async () => 'allow',
    };
    const denier: ToolInterceptor = {
      shouldIntercept: () => true,
      handle: async () => 'deny',
    };
    expect(await runInterceptorChain([allower, denier], 'tool', {})).toBe(
      'deny',
    );
  });

  it('passes toolName and args to interceptor', async () => {
    let captured: { tool: string; args: Record<string, unknown> } | undefined;
    const spy: ToolInterceptor = {
      shouldIntercept: (tool, args) => {
        captured = { tool, args };
        return true;
      },
      handle: async () => 'allow',
    };
    await runInterceptorChain([spy], 'delete_file', { path: '/tmp' });
    expect(captured).toEqual({
      tool: 'delete_file',
      args: { path: '/tmp' },
    });
  });
});

describe('ApprovalGateInterceptor', () => {
  it('intercepts gated tools', () => {
    const gate = new ApprovalGateInterceptor(['rm', 'drop']);
    expect(gate.shouldIntercept('rm', {})).toBe(true);
    expect(gate.shouldIntercept('drop', {})).toBe(true);
    expect(gate.shouldIntercept('echo', {})).toBe(false);
  });

  it('always returns pause', async () => {
    const gate = new ApprovalGateInterceptor(['rm']);
    expect(await gate.handle('rm', {})).toBe('pause');
  });
});

describe('ToolLoggingInterceptor', () => {
  it('intercepts all tools', () => {
    const logger = new ToolLoggingInterceptor(() => {});
    expect(logger.shouldIntercept('any', {})).toBe(true);
  });

  it('emits tool_call event and returns allow', async () => {
    const events: unknown[] = [];
    const logger = new ToolLoggingInterceptor((event) => {
      events.push(event);
    });
    const result = await logger.handle('search', { q: 'test' });
    expect(result).toBe('allow');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'tool_call',
      data: { tool: 'search', args: { q: 'test' }, phase: 'start' },
    });
  });
});
