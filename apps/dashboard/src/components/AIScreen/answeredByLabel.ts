import type { AnsweredBy } from '../Chat/XyneAISidebar/utils/XyneAITypes';

const PROVIDER_LABELS: Record<string, string> = {
  spaces: 'Xyne',
  litellm: 'LiteLLM',
  codex: 'Codex',
  claude: 'Claude',
  copilot: 'Copilot',
  openrouter: 'OpenRouter',
};

const REASON_LABELS: Record<NonNullable<AnsweredBy['fallbackFrom']>['reason'], string> = {
  quota: 'quota exhausted',
  auth: 'credential rejected',
  transient: 'provider unavailable',
  empty: 'returned nothing',
  unknown: 'provider error',
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** The model that answered, as shown next to the agent name ("gpt-5.5"). */
export function answeredByModelLabel(answeredBy: AnsweredBy): string {
  return answeredBy.model ?? providerLabel(answeredBy.provider);
}

/** "Fell back from gpt-5.5 (Codex): credential rejected", or null. */
export function answeredByFallbackNote(answeredBy: AnsweredBy): string | null {
  const fb = answeredBy.fallbackFrom;
  if (!fb) return null;
  const from = fb.fromModel
    ? `${fb.fromModel} (${providerLabel(fb.fromProvider)})`
    : providerLabel(fb.fromProvider);
  return `Fell back from ${from}: ${REASON_LABELS[fb.reason]}`;
}

/** Full tooltip: "Answered by private-large (Xyne). Fell back from …". */
export function answeredByTitle(answeredBy: AnsweredBy): string {
  const base = answeredBy.model
    ? `Answered by ${answeredBy.model} (${providerLabel(answeredBy.provider)})`
    : `Answered by ${providerLabel(answeredBy.provider)}`;
  const note = answeredByFallbackNote(answeredBy);
  return note ? `${base}. ${note}` : base;
}
