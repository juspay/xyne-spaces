// behaviourConfig — read / validate / apply the Behaviour-tab settings that
// live inside an agent's free-form `config` bag. Mirrors the extract-and-apply
// logic in xyne-claw-auth's AgentDetailPageV3 so the same keys are written the
// same way. Keeping this out of the screen keeps the config-merge testable and
// leaves every non-behaviour config key (tools, etc.) untouched on save.

export interface BehaviourDraft {
  /** Extra instructions injected on every turn (config.promptInjection). */
  promptInjection: string;
  /** Offer a one-click "run autonomously" action (config.suggestGoal). */
  suggestGoal: boolean;
  /** Wrap every message as an autonomous /goal loop (config.autoGoal). */
  autoGoal: boolean;
  /** Verify claims against tool evidence before replying (config.verifyResponses). */
  verifyResponses: boolean;
  /** Extra delivery criteria, only meaningful when verifyResponses is on. */
  verifyResponseCriteria: string;
  /** Nudge the agent to add citations when it cited none (config.citationReflection). */
  citationReflection: boolean;
  /** Inject citation tokens into every tool result (config.autoToolCitations). */
  autoToolCitations: boolean;
  /** Whether structured output is enabled (config.outputFormat present). */
  outputFormatEnabled: boolean;
  outputType: 'json' | 'markdown';
  /** Raw JSON-schema text (json mode only). */
  outputSchema: string;
  /** Optional render template / outline. */
  outputTemplate: string;
  /** Comma/newline list of tool-name substrings required before submit. */
  outputRequireTools: string;
}

type ConfigBag = Record<string, unknown> | undefined | null;

interface OutputFormat {
  type?: string;
  schema?: Record<string, unknown>;
  template?: string;
  requireToolsBeforeSubmit?: string[];
}

/** Read-side view of the config bag — named optional props (not an index
 *  signature) so dot access is allowed and no assertions are needed. */
interface BehaviourConfigShape {
  promptInjection?: unknown;
  suggestGoal?: unknown;
  autoGoal?: unknown;
  verifyResponses?: unknown;
  verifyResponseCriteria?: unknown;
  citationReflection?: unknown;
  autoToolCitations?: unknown;
  outputFormat?: OutputFormat;
}

/** Reads the behaviour draft out of an agent's config bag. */
export function readBehaviourDraft(config: ConfigBag): BehaviourDraft {
  const c = (config ?? {}) as BehaviourConfigShape;
  const of = c.outputFormat;
  const promptInjection = c.promptInjection;
  const verifyResponseCriteria = c.verifyResponseCriteria;
  const outputFormatEnabled = of?.type === 'json' || of?.type === 'markdown';
  return {
    promptInjection: typeof promptInjection === 'string' ? promptInjection : '',
    suggestGoal: c.suggestGoal === true,
    autoGoal: c.autoGoal === true,
    verifyResponses: c.verifyResponses === true,
    verifyResponseCriteria:
      typeof verifyResponseCriteria === 'string' ? verifyResponseCriteria : '',
    citationReflection: c.citationReflection === true,
    autoToolCitations: c.autoToolCitations === true,
    outputFormatEnabled,
    outputType: of?.type === 'markdown' ? 'markdown' : 'json',
    outputSchema: of?.schema ? JSON.stringify(of.schema, null, 2) : '',
    outputTemplate: of?.template ?? '',
    outputRequireTools: Array.isArray(of?.requireToolsBeforeSubmit)
      ? of.requireToolsBeforeSubmit.join(', ')
      : '',
  };
}

/** The empty/default draft (all off), for initial state. */
export const EMPTY_BEHAVIOUR_DRAFT: BehaviourDraft = readBehaviourDraft(undefined);

/** True when the draft differs from what's stored in the agent's config. */
export function behaviourDirty(config: ConfigBag, draft: BehaviourDraft): boolean {
  return JSON.stringify(readBehaviourDraft(config)) !== JSON.stringify(draft);
}

/**
 * Validates the draft before save. Returns a user-facing error string, or null
 * when the draft is savable. Only structured JSON output needs validation.
 */
export function validateBehaviour(draft: BehaviourDraft): string | null {
  if (draft.outputFormatEnabled && draft.outputType === 'json') {
    if (!draft.outputSchema.trim()) {
      return 'Add a JSON Schema for structured output, or turn it off';
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft.outputSchema);
    } catch {
      return 'Output schema is not valid JSON';
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>)['type'] !== 'string'
    ) {
      return 'Output schema must be a JSON Schema object with a top-level "type"';
    }
  }
  return null;
}

/**
 * Merges the behaviour draft onto the existing config, adding keys when enabled
 * and deleting them when off — so unrelated config keys are preserved. Assumes
 * {@link validateBehaviour} already passed (JSON schema parse is safe here).
 */
export function applyBehaviour(config: ConfigBag, draft: BehaviourDraft): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(config ?? {}) };

  const setOrDelete = (key: string, on: boolean, value: unknown = true): void => {
    if (on) next[key] = value;
    else delete next[key];
  };

  const promptInjection = draft.promptInjection.trim();
  setOrDelete('promptInjection', !!promptInjection, promptInjection);
  setOrDelete('suggestGoal', draft.suggestGoal);
  setOrDelete('autoGoal', draft.autoGoal);

  if (draft.verifyResponses) {
    next['verifyResponses'] = true;
    const criteria = draft.verifyResponseCriteria.trim();
    if (criteria) next['verifyResponseCriteria'] = criteria;
    else delete next['verifyResponseCriteria'];
  } else {
    delete next['verifyResponses'];
    delete next['verifyResponseCriteria'];
  }

  setOrDelete('citationReflection', draft.citationReflection);
  setOrDelete('autoToolCitations', draft.autoToolCitations);

  if (draft.outputFormatEnabled) {
    const template = draft.outputTemplate.trim();
    const requireTools = draft.outputRequireTools
      .split(/[\n,]/)
      .map(t => t.trim())
      .filter(Boolean);
    const gate = requireTools.length ? { requireToolsBeforeSubmit: requireTools } : {};
    if (draft.outputType === 'markdown') {
      next['outputFormat'] = { type: 'markdown', ...(template ? { template } : {}), ...gate };
    } else {
      const schema = JSON.parse(draft.outputSchema) as Record<string, unknown>;
      next['outputFormat'] = { type: 'json', schema, ...(template ? { template } : {}), ...gate };
    }
  } else {
    delete next['outputFormat'];
  }

  return next;
}
