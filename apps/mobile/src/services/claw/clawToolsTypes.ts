export type IntegrationToolEntry = {
  slug: string;
  name: string;
  description: string;
  riskLevel: 'read' | 'write' | 'destructive';
};

export type Integration = {
  slug: string;
  label: string;
  kind: 'mcp' | 'builtin' | 'custom' | 'gateway';
  connected: boolean;
  readTools: IntegrationToolEntry[];
  writeTools: IntegrationToolEntry[];
  usageCount: number;
};

export type AvailableTools = {
  subagents: Array<{
    name: string;
    description: string;
    serverType: string;
    progressLabel: string;
  }>;
  customGroups: Array<{ source: string; tools: Array<{ slug: string; name: string }> }>;
  integrations: Integration[];
};
