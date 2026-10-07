import { describe, expect, it } from 'vitest';
import type { CredentialField, McpServer } from '@/services/claw/clawMcpTypes';
import { needsMcpKey } from './mcpConnectStrategy';

const server = (type: string, extra: Partial<McpServer> = {}): McpServer =>
  ({ id: `srv-${type}`, type, ...extra }) as McpServer;
const FIELDS = [{ name: 'token', label: 'Token' }] as CredentialField[];

describe('needsMcpKey', () => {
  it('never asks for the connectors that run on the Spaces sign-in', () => {
    for (const type of ['xyne-spaces', 'xyne-dashboard', 'xyne-workflows']) {
      expect(needsMcpKey(server(type), FIELDS)).toBe(false);
    }
  });

  it('asks for OAuth sign-ins and for connectors with credential fields', () => {
    expect(needsMcpKey(server('google'), [])).toBe(true);
    expect(needsMcpKey(server('slack'), FIELDS)).toBe(true);
  });

  it('asks nothing of a connector with no fields and no OAuth', () => {
    expect(needsMcpKey(server('public-docs'), [])).toBe(false);
  });
});
