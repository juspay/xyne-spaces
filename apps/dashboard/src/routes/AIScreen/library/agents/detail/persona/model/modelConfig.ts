import {
  applyModelProvider,
  readModelProviderDraft,
  type ModelProviderDraft,
} from '@/services/claw/modelProviderConfig';

export type AutomationMode = 'chat' | 'platform';

export interface ModelCardDraft extends ModelProviderDraft {
  automationMode: AutomationMode;
}

export function readModelCardDraft(config: Record<string, unknown> | undefined): ModelCardDraft {
  const base = readModelProviderDraft(config);
  const raw = (config ?? {})['automationProvider'];
  return { ...base, automationMode: raw === 'platform' ? 'platform' : 'chat' };
}

export function applyModelCard(
  config: Record<string, unknown> | undefined,
  draft: ModelCardDraft,
): Record<string, unknown> {
  const next = applyModelProvider(config, draft);
  if (draft.automationMode === 'platform') next['automationProvider'] = 'platform';
  else delete next['automationProvider'];
  return next;
}

export function modelCardDirty(
  config: Record<string, unknown> | undefined,
  draft: ModelCardDraft,
): boolean {
  return JSON.stringify(readModelCardDraft(config)) !== JSON.stringify(draft);
}

export const SUBAGENT_OPTIONS = [
  { value: 'spaces', label: 'Spaces default' },
  { value: 'parent', label: 'Follow parent' },
] as const;

export const AUTOMATION_OPTIONS = [
  { value: 'chat', label: 'Same as chat' },
  { value: 'platform', label: 'Platform default' },
] as const;
