import type { Integration } from '@/src/services/claw/clawToolsTypes';

export type SubagentRiskLevel = 'read' | 'write' | 'destructive';

export const SUBAGENT_RISK_LABEL: Record<SubagentRiskLevel, string> = {
  read: 'Readable',
  write: 'Writeable',
  destructive: 'Destructive',
};

const RISK_RANK: Record<SubagentRiskLevel, number> = {
  read: 0,
  write: 1,
  destructive: 2,
};

const normalize = (value: string): string => value.trim().toLowerCase().replace(/[_-]+/g, '');

export const riskForIntegration = (integration: Integration | undefined): SubagentRiskLevel => {
  if (!integration) return 'read';
  const tools = [...(integration.readTools ?? []), ...(integration.writeTools ?? [])];
  let highest: SubagentRiskLevel = integration.writeTools.length > 0 ? 'write' : 'read';
  for (const tool of tools) {
    if (RISK_RANK[tool.riskLevel] > RISK_RANK[highest]) {
      highest = tool.riskLevel;
    }
  }
  return highest;
};

export const findIntegrationForServerType = (
  serverType: string | undefined,
  integrations: Integration[] | undefined,
): Integration | undefined => {
  if (!serverType || !integrations?.length) return undefined;
  const needle = normalize(serverType);
  return integrations.find(integration => {
    const slug = normalize(integration.slug);
    const label = normalize(integration.label);
    return slug === needle || label === needle || slug.includes(needle) || needle.includes(slug);
  });
};

export const riskForSubagent = (
  serverType: string | undefined,
  integrations: Integration[] | undefined,
): SubagentRiskLevel => riskForIntegration(findIntegrationForServerType(serverType, integrations));

export const integrationLabelForServerType = (
  serverType: string | undefined,
  integrations: Integration[] | undefined,
): string => {
  const integration = findIntegrationForServerType(serverType, integrations);
  if (integration?.label) return integration.label;
  if (!serverType) return '';
  return serverType.replace(/[-_]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};
