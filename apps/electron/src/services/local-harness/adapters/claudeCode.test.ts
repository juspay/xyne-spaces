import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { buildClaudeCodeArgs } from './claudeCode';

const base = {
  systemPrompt: 'system',
  mcpConfigPath: '/tmp/xyne-mcp.json',
  mcpServerName: 'xyne',
  tools: 'Read,Write,Edit,Glob,Grep,Bash',
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('claude code launch arguments', () => {
  it('pre-approves the Xyne tool facade when a local folder is attached', () => {
    const args = buildClaudeCodeArgs({ ...base, writable: true });
    expect(flag(args, '--permission-mode')).toBe('acceptEdits');
    expect(flag(args, '--allowedTools')).toBe('mcp__xyne');
  });

  it('keeps bypass mode and the facade allow-list without a folder', () => {
    const args = buildClaudeCodeArgs({ ...base, tools: '', writable: false });
    expect(flag(args, '--permission-mode')).toBe('bypassPermissions');
    expect(flag(args, '--allowedTools')).toBe('mcp__xyne');
    expect(flag(args, '--tools')).toBe('');
  });

  it('only pre-approves the Xyne server, not every MCP server', () => {
    const args = buildClaudeCodeArgs({ ...base, mcpServerName: 'xyne-tools', writable: true });
    expect(args.filter((a) => a.startsWith('mcp__'))).toEqual(['mcp__xyne-tools']);
  });
});
