export type SubagentDetailTabId = 'persona' | 'knowledge' | 'tools' | 'contributors';

export interface SubagentDetailTab {
  id: SubagentDetailTabId;
  label: string;
}

export const SUBAGENT_DETAIL_TABS: readonly SubagentDetailTab[] = [
  { id: 'persona', label: 'Persona' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'tools', label: 'Tools' },
  { id: 'contributors', label: 'Contributors' },
];

export const DEFAULT_SUBAGENT_DETAIL_TAB: SubagentDetailTabId = 'persona';

export function resolveSubagentTab(raw: string | null): SubagentDetailTabId {
  const match = SUBAGENT_DETAIL_TABS.find(tab => tab.id === raw);
  return match ? match.id : DEFAULT_SUBAGENT_DETAIL_TAB;
}
