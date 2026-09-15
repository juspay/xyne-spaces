export type AgentDetailTabId =
  | 'persona'
  | 'behaviour'
  | 'tools'
  | 'knowledge'
  | 'people'
  | 'call-graph'
  | 'activity';

export interface AgentDetailTab {
  id: AgentDetailTabId;
  label: string;
  /** Delegation is the owner's call — contributors don't see the inbox. */
  ownerOnly?: boolean;
}

export const AGENT_DETAIL_TABS: readonly AgentDetailTab[] = [
  { id: 'persona', label: 'Persona' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'tools', label: 'Tools' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'people', label: 'People' },
  { id: 'call-graph', label: 'Call graph', ownerOnly: true },
  { id: 'activity', label: 'Activity' },
];

export const DEFAULT_AGENT_DETAIL_TAB: AgentDetailTabId = 'persona';

export function resolveTab(raw: string | null): AgentDetailTabId {
  const match = AGENT_DETAIL_TABS.find(tab => tab.id === raw);
  return match ? match.id : DEFAULT_AGENT_DETAIL_TAB;
}
