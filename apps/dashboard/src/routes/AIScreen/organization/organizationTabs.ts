export type OrganizationTabId = 'members' | 'surfaces';

export interface OrganizationTab {
  id: OrganizationTabId;
  label: string;
}

export const ORGANIZATION_TABS: readonly OrganizationTab[] = [
  { id: 'members', label: 'Members' },
  { id: 'surfaces', label: 'Surfaces' },
];

export const DEFAULT_ORGANIZATION_TAB: OrganizationTabId = 'members';

export function resolveOrganizationTab(raw: string | null): OrganizationTabId {
  const match = ORGANIZATION_TABS.find(tab => tab.id === raw);
  return match ? match.id : DEFAULT_ORGANIZATION_TAB;
}
