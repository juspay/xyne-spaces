import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AgentToolRegistry } from './tool-registry.js';
import type { WorkflowTool } from './tool-types.js';

function makeTool(name: string): WorkflowTool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({ x: z.string() }),
    execute: async () => ({ ok: true }),
  };
}

describe('AgentToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const reg = new AgentToolRegistry();
    const tool = makeTool('echo');
    reg.register(tool);
    expect(reg.get('echo')).toBe(tool);
    expect(reg.has('echo')).toBe(true);
    expect(reg.size).toBe(1);
  });

  it('returns undefined for unknown tool', () => {
    const reg = new AgentToolRegistry();
    expect(reg.get('nope')).toBeUndefined();
    expect(reg.has('nope')).toBe(false);
  });

  it('throws on duplicate registration', () => {
    const reg = new AgentToolRegistry();
    reg.register(makeTool('dup'));
    expect(() => reg.register(makeTool('dup'))).toThrow(
      'Tool "dup" is already registered',
    );
  });

  it('getAll returns all tools', () => {
    const reg = new AgentToolRegistry();
    reg.register(makeTool('a'));
    reg.register(makeTool('b'));
    const all = reg.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('resolve returns tools in requested order', () => {
    const reg = new AgentToolRegistry();
    reg.register(makeTool('first'));
    reg.register(makeTool('second'));
    const resolved = reg.resolve(['second', 'first']);
    expect(resolved.map((t) => t.name)).toEqual(['second', 'first']);
  });

  it('resolve throws for missing tool', () => {
    const reg = new AgentToolRegistry();
    reg.register(makeTool('exists'));
    expect(() => reg.resolve(['exists', 'missing'])).toThrow(
      'Tool "missing" not found in registry',
    );
  });

  it('size reflects registrations', () => {
    const reg = new AgentToolRegistry();
    expect(reg.size).toBe(0);
    reg.register(makeTool('a'));
    reg.register(makeTool('b'));
    expect(reg.size).toBe(2);
  });
});
