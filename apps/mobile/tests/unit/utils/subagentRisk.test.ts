import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Integration } from '@/src/services/claw/clawToolsTypes';
import { integrationLabelForServerType, riskForSubagent } from '@/src/utils/subagentRisk';

const integration = (
  slug: string,
  label: string,
  writeRisk: Array<'read' | 'write' | 'destructive'> = [],
  readRisk: Array<'read' | 'write' | 'destructive'> = ['read'],
): Integration => ({
  slug,
  label,
  kind: 'mcp',
  connected: true,
  readTools: readRisk.map((riskLevel, index) => ({
    slug: `${slug}-read-${index}`,
    name: `${slug}-read-${index}`,
    description: '',
    riskLevel,
  })),
  writeTools: writeRisk.map((riskLevel, index) => ({
    slug: `${slug}-write-${index}`,
    name: `${slug}-write-${index}`,
    description: '',
    riskLevel,
  })),
  usageCount: 0,
});

describe('subagentRisk', () => {
  it('uses the highest tool risk on the matching integration', () => {
    const integrations = [
      integration('xyne-spaces', 'Xyne Spaces', ['write']),
      integration('bitbucket', 'Bitbucket', ['destructive']),
      integration('grafana', 'Grafana', [], ['read']),
    ];

    assert.equal(riskForSubagent('xyne-spaces', integrations), 'write');
    assert.equal(riskForSubagent('bitbucket', integrations), 'destructive');
    assert.equal(riskForSubagent('grafana', integrations), 'read');
    assert.equal(integrationLabelForServerType('xyne-spaces', integrations), 'Xyne Spaces');
  });

  it('defaults to readable when the server is unknown', () => {
    assert.equal(riskForSubagent('unknown', []), 'read');
    assert.equal(riskForSubagent(undefined, undefined), 'read');
  });
});
