import type { Skill } from '@/services/claw/clawSkillsTypes';

export type SkillScope = 'global' | 'personal';

export interface SkillCatalogEntry {
  id: string;
  slug: string;
  label: string;
  description: string;
  scope: SkillScope;
  source: string;
  ownerName: string | null;
  enabled: boolean;
  skill: Skill;
}

export function buildSkillCatalog(skills: readonly Skill[]): SkillCatalogEntry[] {
  return skills.map(skill => ({
    id: skill.id,
    slug: skill.slug,
    label: skill.label || skill.name || skill.slug,
    description: skill.description,
    scope: skill.scope === 'global' ? 'global' : 'personal',
    source: skill.source,
    ownerName: skill.owner?.name ?? skill.owner?.email ?? null,
    enabled: skill.enabled,
    skill,
  }));
}

export function isSkillSelected(selectedIds: readonly string[], entry: SkillCatalogEntry): boolean {
  return selectedIds.includes(entry.id);
}

export function enableSkill(selectedIds: readonly string[], entry: SkillCatalogEntry): string[] {
  return selectedIds.includes(entry.id) ? [...selectedIds] : [...selectedIds, entry.id];
}

export function disableSkill(selectedIds: readonly string[], entry: SkillCatalogEntry): string[] {
  return selectedIds.filter(id => id !== entry.id);
}

export function toggleSkill(selectedIds: readonly string[], entry: SkillCatalogEntry): string[] {
  return isSkillSelected(selectedIds, entry)
    ? disableSkill(selectedIds, entry)
    : enableSkill(selectedIds, entry);
}
