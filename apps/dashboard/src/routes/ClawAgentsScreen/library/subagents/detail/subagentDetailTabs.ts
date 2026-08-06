export type SubagentDetailTabId = 'persona' | 'knowledge' | 'tools' | 'people';

export interface SubagentDetailTab {
  id: SubagentDetailTabId;
  label: string;
}

/** Mirrors the reference's subagent tabs (persona / knowledge / tools / contributors). */
export const SUBAGENT_DETAIL_TABS: readonly SubagentDetailTab[] = [
  { id: 'persona', label: 'Persona' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'tools', label: 'Tools' },
  { id: 'people', label: 'People' },
];

export const DEFAULT_SUBAGENT_DETAIL_TAB: SubagentDetailTabId = 'persona';

export function resolveSubagentTab(raw: string | null): SubagentDetailTabId {
  const match = SUBAGENT_DETAIL_TABS.find(tab => tab.id === raw);
  return match ? match.id : DEFAULT_SUBAGENT_DETAIL_TAB;
}
