export type SkillDetailTabId = 'overview' | 'context';

export interface SkillDetailTab {
  id: SkillDetailTabId;
  label: string;
}

export const SKILL_DETAIL_TABS: readonly SkillDetailTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'context', label: 'Context' },
];

export const DEFAULT_SKILL_DETAIL_TAB: SkillDetailTabId = 'overview';

export function resolveSkillTab(raw: string | null): SkillDetailTabId {
  const match = SKILL_DETAIL_TABS.find(tab => tab.id === raw);
  return match ? match.id : DEFAULT_SKILL_DETAIL_TAB;
}
