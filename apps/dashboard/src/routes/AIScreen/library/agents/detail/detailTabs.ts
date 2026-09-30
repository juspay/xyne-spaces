/**
 * Settings behind the gear on the agent profile. The profile itself shows the
 * description, tools, subagents, skills, knowledge and instructions, so those
 * aren't repeated here (the old Tools tab is gone, Knowledge is down to Memory).
 */
export type AgentSettingsTabId =
  | 'persona'
  | 'behaviour'
  | 'memory'
  | 'people'
  | 'call-graph'
  | 'activity';

export interface AgentSettingsTab {
  id: AgentSettingsTabId;
  label: string;
  /** Delegation is the owner's call — contributors don't see the inbox. */
  ownerOnly?: boolean;
  /** About an agent that exists (its members, runs, memories): not there while creating. */
  savedOnly?: boolean;
}

export const AGENT_SETTINGS_TABS: readonly AgentSettingsTab[] = [
  { id: 'persona', label: 'Persona' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'memory', label: 'Memory', savedOnly: true },
  { id: 'people', label: 'People', savedOnly: true },
  { id: 'call-graph', label: 'Call graph', ownerOnly: true, savedOnly: true },
  { id: 'activity', label: 'Activity', savedOnly: true },
];

export const DEFAULT_AGENT_SETTINGS_TAB: AgentSettingsTabId = 'persona';

/** `?settings=<tab>` on the profile. */
export const SETTINGS_PARAM = 'settings';

function asSettingsTab(raw: string | null): AgentSettingsTabId | null {
  if (raw === 'knowledge') return 'memory';
  return AGENT_SETTINGS_TABS.find(tab => tab.id === raw)?.id ?? null;
}

/**
 * The settings tab the URL asks for, or null for the profile. Old `?tab=` links
 * to a settings-only tab (Behaviour, People, Call graph, Activity) still land
 * there; `?tab=persona|tools|knowledge` meant the profile's own content.
 */
export function settingsTabFromParams(params: URLSearchParams): AgentSettingsTabId | null {
  if (params.has(SETTINGS_PARAM)) {
    return asSettingsTab(params.get(SETTINGS_PARAM)) ?? DEFAULT_AGENT_SETTINGS_TAB;
  }
  const legacy = params.get('tab');
  return legacy === 'behaviour' ||
    legacy === 'people' ||
    legacy === 'call-graph' ||
    legacy === 'activity'
    ? legacy
    : null;
}
