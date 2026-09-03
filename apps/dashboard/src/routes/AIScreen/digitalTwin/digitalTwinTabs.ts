export type DigitalTwinTabId =
  | 'memories'
  | 'hot'
  | 'proposals'
  | 'recall'
  | 'graph'
  | 'metrics'
  | 'settings';

export interface DigitalTwinTab {
  id: DigitalTwinTabId;
  label: string;
}

export const DIGITAL_TWIN_TABS: readonly DigitalTwinTab[] = [
  { id: 'memories', label: 'Memories' },
  { id: 'hot', label: 'Hot' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'recall', label: 'Recall' },
  { id: 'graph', label: 'Graph' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'settings', label: 'Settings' },
];

export const DEFAULT_DIGITAL_TWIN_TAB: DigitalTwinTabId = 'memories';

export function resolveDigitalTwinTab(raw: string | null): DigitalTwinTabId {
  const match = DIGITAL_TWIN_TABS.find(tab => tab.id === raw);
  return match ? match.id : DEFAULT_DIGITAL_TWIN_TAB;
}
