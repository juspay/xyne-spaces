// behaviourConfig — read / validate / apply the Behaviour-tab settings that
// live inside an agent's free-form `config` bag. Mirrors the extract-and-apply
// logic in xyne-claw-auth's AgentDetailPageV3 so the same keys are written the
// same way. Keeping this out of the screen keeps the config-merge testable and
// leaves every non-behaviour config key (tools, etc.) untouched on save.

/**
 * Default plan-mode system prompt — the textarea pre-fill, and what the runtime
 * uses when config.planModePrompt is unset. MUST stay in sync with the
 * defaultPlanModePrimer in xyne-claw/src/routes/run.ts (the propose-plan gate is
 * enforced by the tool palette, not this text, so edits only change guidance).
 */
export const DEFAULT_PLAN_MODE_PROMPT = [
  '## Plan mode — propose first, do NOT execute',
  'You are in PLAN MODE. You have READ-ONLY tools (search / read) and ONE terminal tool: `propose-plan`. You CANNOT edit, run commands, send messages, or otherwise take action yet — those tools are intentionally unavailable until the user approves.',
  'Do this, in order:',
  '1. Investigate ONLY as much as you need to write a concrete, correct plan (search / read the relevant context). Keep it lightweight — you are scoping, not solving.',
  '2. Call `propose-plan` ONCE with: the full ordered todo list (`{ id, title }` each — stable ids and CRISP titles: imperative, max 6–8 words, NO "Step 1"/"Stage 2"/number prefixes; the UI numbers them), and a `document` — the full plan written out in GitHub-flavored MARKDOWN (context, approach, what each step does and why, risks, expected outcome). The todos are the checklist; the document is the detailed brief shown when the user expands the plan. Also pass a `trivial` judgment. This call ENDS your turn immediately.',
  '3. Do NOT do the work, do NOT write a final answer, do NOT call any tool after propose-plan. The user reviews your plan, picks the steps to keep, and approves — only then does execution begin (in a fresh turn where you’ll have your full tools back).',
  'Set `trivial: true` ONLY for a genuinely simple, low-risk ask where an approval prompt would just be noise; then it starts immediately. When unsure, use `trivial: false`.',
].join('\n');

export interface BehaviourDraft {
  /** Extra instructions injected on every turn (config.promptInjection). */
  promptInjection: string;
  /** Offer a one-click "run autonomously" action (config.suggestGoal). */
  suggestGoal: boolean;
  /** Wrap every message as an autonomous /goal loop (config.autoGoal). */
  autoGoal: boolean;
  /** Propose a plan and wait for approval before multi-step work (config.planMode). */
  planMode: boolean;
  /**
   * The plan-mode system prompt (config.planModePrompt). Pre-filled with
   * DEFAULT_PLAN_MODE_PROMPT; only persisted when the user customizes it (differs
   * from the default), otherwise the agent runtime uses its own built-in default.
   */
  planModePrompt: string;
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
  planMode?: unknown;
  planModePrompt?: unknown;
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
    planMode: c.planMode === true,
    planModePrompt:
      typeof c.planModePrompt === 'string' && c.planModePrompt.trim()
        ? c.planModePrompt
        : DEFAULT_PLAN_MODE_PROMPT,
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
  setOrDelete('planMode', draft.planMode);

  // Only persist a CUSTOM plan-mode prompt. Empty, or unchanged from the default,
  // ⇒ delete the key so the runtime falls back to its built-in default. Gated on
  // planMode being on (a prompt with no plan mode is meaningless).
  const planModePrompt = draft.planModePrompt.trim();
  if (draft.planMode && planModePrompt && planModePrompt !== DEFAULT_PLAN_MODE_PROMPT.trim()) {
    next['planModePrompt'] = planModePrompt;
  } else {
    delete next['planModePrompt'];
  }

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
