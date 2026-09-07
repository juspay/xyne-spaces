// modelProviderConfig — read / validate / apply the Model & Provider settings
// that live inside an agent's `config` bag. Mirrors xyne-claw-auth's
// ProviderTabV3 (provider preference order + policy + subagent routing) and
// SpacesDefaultRowV3 (model run params). All of it persists through
// updateAgent(slug, { config }); only non-model keys (tools, behaviour) are left
// untouched on save.

export const HOSTED_PROVIDERS = [
  'codex',
  'claude',
  'copilot',
  'openrouter',
  'litellm',
  'spaces',
] as const;

export const LOCAL_HARNESS_PROVIDERS = ['claude-code', 'codex-cli'] as const;
export type LocalHarnessProviderKey = (typeof LOCAL_HARNESS_PROVIDERS)[number];

export const ALL_PROVIDERS = [...HOSTED_PROVIDERS, ...LOCAL_HARNESS_PROVIDERS] as const;
export type ProviderKey = (typeof ALL_PROVIDERS)[number];

export const isLocalHarnessProvider = (p: string): p is LocalHarnessProviderKey =>
  (LOCAL_HARNESS_PROVIDERS as readonly string[]).includes(p);

/* eslint-disable @typescript-eslint/naming-convention */

/** User-facing labels for the wire-level provider keys. */
export const PROVIDER_DISPLAY: Record<string, string> = {
  spaces: 'Spaces',
  copilot: 'GitHub Copilot',
  claude: 'Anthropic Claude',
  codex: 'OpenAI Codex',
  openrouter: 'OpenRouter',
  litellm: 'LiteLLM (own key)',
  'claude-code': 'Claude Code (this device)',
  'codex-cli': 'Codex CLI (this device)',
};

export const LOCAL_HARNESS_MODEL_OPTIONS: Record<
  LocalHarnessProviderKey,
  ReadonlyArray<{ value: string; label: string }>
> = {
  'claude-code': [
    { value: '', label: 'CLI default' },
    { value: 'opus', label: 'Opus — most capable' },
    { value: 'sonnet', label: 'Sonnet — balanced' },
    { value: 'haiku', label: 'Haiku — fastest' },
  ],
  'codex-cli': [
    { value: '', label: 'CLI default' },
    { value: 'gpt-5.5', label: 'gpt-5.5' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
  ],
};

/* eslint-enable @typescript-eslint/naming-convention */

/** Extended-thinking levels for the model settings. '' = platform default. */
export const THINKING_OPTIONS = [
  { value: '', label: 'Default (platform setting)' },
  { value: 'off', label: 'Off — no extended thinking' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

export interface ModelProviderDraft {
  /** Preference order — first entry is the parent provider, the rest form the
   *  quota-fallback chain. Empty = platform default only. */
  providerOrder: string[];
  /** true (Always On) — the agent's provider serves every run; false (On
   *  /upgrade) — runs default to the platform model unless the user opts in. */
  alwaysOn: boolean;
  /** Which provider the agent's subagents run on. */
  subagentMode: 'parent' | 'spaces';
  /** Model run params (strings for form binding; validated before save). */
  temperature: string;
  maxTokens: string;
  thinkingLevel: string;
  localHarnessModels: Record<string, string>;
}

type ConfigBag = Record<string, unknown> | undefined | null;

/** Read-side view — named optional props allow dot access with no assertions. */
interface ProviderConfigShape {
  provider?: unknown;
  providerOrder?: unknown;
  providerAlwaysOn?: unknown;
  subagentProviderMode?: unknown;
  localHarnessModels?: unknown;
  modelSettings?: {
    model?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
    thinkingLevel?: unknown;
  };
}

function readLocalHarnessModels(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const harness of LOCAL_HARNESS_PROVIDERS) {
    const value = (raw as Record<string, unknown>)[harness];
    if (typeof value === 'string' && value) out[harness] = value;
  }
  return out;
}

/** Reads the model/provider draft out of an agent's config bag. */
export function readModelProviderDraft(config: ConfigBag): ModelProviderDraft {
  const c = (config ?? {}) as ProviderConfigShape;
  const order = Array.isArray(c.providerOrder)
    ? c.providerOrder.filter((p): p is string => typeof p === 'string')
    : typeof c.provider === 'string'
      ? [c.provider]
      : [];
  const ms = c.modelSettings ?? {};
  return {
    providerOrder: order,
    alwaysOn: c.providerAlwaysOn !== false,
    subagentMode: c.subagentProviderMode === 'parent' ? 'parent' : 'spaces',
    temperature: typeof ms.temperature === 'number' ? String(ms.temperature) : '',
    maxTokens: typeof ms.maxTokens === 'number' ? String(ms.maxTokens) : '',
    thinkingLevel: typeof ms.thinkingLevel === 'string' ? ms.thinkingLevel : '',
    localHarnessModels: readLocalHarnessModels(c.localHarnessModels),
  };
}

/** The empty/default draft, for initial state. */
export const EMPTY_MODEL_PROVIDER_DRAFT: ModelProviderDraft = readModelProviderDraft(undefined);

/** True when the draft differs from what's stored in the agent's config. */
export function modelProviderDirty(config: ConfigBag, draft: ModelProviderDraft): boolean {
  return JSON.stringify(readModelProviderDraft(config)) !== JSON.stringify(draft);
}

/**
 * Validates the model run params before save. Returns a user-facing error
 * string, or null when savable. Mirrors SpacesDefaultRowV3's rules: temperature
 * 0–1, maxTokens integer 1024–64000, and temperature requires thinking "Off".
 */
export function validateModelProvider(draft: ModelProviderDraft): string | null {
  const temperatureSet = draft.temperature.trim() !== '';
  if (temperatureSet) {
    const t = Number(draft.temperature);
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      return 'Temperature must be between 0 and 1';
    }
  }
  if (draft.maxTokens.trim() !== '') {
    const m = Number(draft.maxTokens);
    if (!Number.isInteger(m) || m < 1024 || m > 64000) {
      return 'Max output tokens must be an integer between 1024 and 64000';
    }
  }
  if (temperatureSet && draft.thinkingLevel !== '' && draft.thinkingLevel !== 'off') {
    return 'Temperature requires thinking "Off" — thinking models ignore temperature';
  }
  return null;
}

/**
 * Merges the model/provider draft onto the existing config. Assumes
 * {@link validateModelProvider} already passed.
 */
export function applyModelProvider(
  config: ConfigBag,
  draft: ModelProviderDraft,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(config ?? {}) };

  if (draft.providerOrder.length > 0) next['providerOrder'] = draft.providerOrder;
  else delete next['providerOrder'];
  // Retire the legacy single-pick field — preference order is canonical now.
  delete next['provider'];

  // Omit when it matches the backend backfill default (true) to keep JSON minimal.
  if (draft.alwaysOn) delete next['providerAlwaysOn'];
  else next['providerAlwaysOn'] = false;

  if (draft.subagentMode === 'parent') next['subagentProviderMode'] = 'parent';
  else delete next['subagentProviderMode'];

  const harnessModels: Record<string, string> = {};
  for (const harness of draft.providerOrder.filter(isLocalHarnessProvider)) {
    const model = draft.localHarnessModels[harness]?.trim();
    if (model) harnessModels[harness] = model;
  }
  if (Object.keys(harnessModels).length > 0) next['localHarnessModels'] = harnessModels;
  else delete next['localHarnessModels'];

  const existing = (config ?? {}) as ProviderConfigShape;
  const existingMs = existing.modelSettings ?? {};
  const settings: Record<string, unknown> = {};
  if (typeof existingMs.model === 'string' && existingMs.model)
    settings['model'] = existingMs.model;

  const temperatureSet = draft.temperature.trim() !== '';
  if (temperatureSet) settings['temperature'] = Number(draft.temperature);
  if (draft.maxTokens.trim() !== '') settings['maxTokens'] = Number(draft.maxTokens);
  let thinking = draft.thinkingLevel;
  // Temperature with no explicit thinking choice persists the "off" the backend
  // requires so the saved config is self-consistent.
  if (temperatureSet && !thinking) thinking = 'off';
  if (thinking) settings['thinkingLevel'] = thinking;

  if (Object.keys(settings).length > 0) next['modelSettings'] = settings;
  else delete next['modelSettings'];

  return next;
}
