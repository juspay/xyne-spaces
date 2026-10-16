import type { ReactElement } from 'react';
import type { MessageAnsweredBy } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { cn } from '../../utils/classNames';

const LLM_PROVIDER_LABELS: Record<string, string> = {
  spaces: 'Xyne',
  litellm: 'LiteLLM',
  codex: 'Codex',
  claude: 'Claude',
  copilot: 'Copilot',
  openrouter: 'OpenRouter',
};

function llmProviderLabel(provider: string): string {
  return LLM_PROVIDER_LABELS[provider] ?? provider;
}

/** The model that answered, or the provider name when no model was reported. */
export function answeredByName(provider: string, model: string | undefined): string {
  return model?.trim() ? model.trim() : llmProviderLabel(provider);
}

export function answeredByText(answeredBy: MessageAnsweredBy): string {
  const answered = answeredByName(answeredBy.provider, answeredBy.model);
  if (!answeredBy.fellBack) return `Answered by ${answered}`;
  const requested = answeredBy.requestedProvider
    ? answeredByName(answeredBy.requestedProvider, answeredBy.requestedModel)
    : answeredBy.requestedModel;
  return requested && requested !== answered
    ? `Answered by ${answered} · fell back from ${requested}`
    : `Answered by ${answered} · fallback`;
}

/**
 * Per-reply "Answered by <model>" line (XYNE-66319 / XYNE-66326). Sourced from
 * the AgentRun claw-auth pairs to this message, so it names the model that
 * actually produced the reply — not the composer's current pick — and says so
 * when the run fell back off the requested provider (quota, expired
 * credential, transient failure).
 */
export function AnsweredByLabel({
  answeredBy,
  className,
}: {
  answeredBy: MessageAnsweredBy | undefined;
  className?: string;
}): ReactElement | null {
  if (!answeredBy?.provider) return null;
  const text = answeredByText(answeredBy);
  return (
    <div
      data-testid='message-answered-by'
      className={cn(
        'truncate text-[11px] leading-4',
        answeredBy.fellBack ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/70',
        className,
      )}
      title={
        answeredBy.fellBack
          ? `${text}. The requested model was unavailable for this reply, so a fallback model answered.`
          : text
      }
    >
      {text}
    </div>
  );
}
