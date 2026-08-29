import type { ComposerContext } from './composerContext';

const ASK_AI_DRAFT_PREFIX = 'ask-ai-draft:v1';

export interface AskAIComposerDraftKeyParts {
  workspaceId?: string | null | undefined;
  userId?: string | null | undefined;
  surface: 'sidebar' | 'ai-chat';
  agentSlug?: string | null | undefined;
  targetKey: string;
}

export interface AskAIComposerDraft {
  text: string;
  context?: ComposerContext | undefined;
  updatedAt: number;
}

const safePart = (value: string): string => encodeURIComponent(value);

export function buildAskAIComposerDraftKey({
  workspaceId,
  userId,
  surface,
  agentSlug,
  targetKey,
}: AskAIComposerDraftKeyParts): string | null {
  if (!workspaceId || !userId || !targetKey) return null;

  return [
    ASK_AI_DRAFT_PREFIX,
    safePart(workspaceId),
    safePart(userId),
    surface,
    safePart(agentSlug || 'ask-ai'),
    safePart(targetKey),
  ].join(':');
}

export function readAskAIComposerDraft(key: string | null | undefined): AskAIComposerDraft | null {
  if (!key || typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AskAIComposerDraft>;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      ...(parsed.context ? { context: parsed.context } : {}),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeAskAIComposerDraft(
  key: string | null | undefined,
  draft: Pick<AskAIComposerDraft, 'text'> & Partial<Pick<AskAIComposerDraft, 'context'>>,
): void {
  if (!key || typeof window === 'undefined') return;

  try {
    const normalizedText = draft.text.trim();
    if (!normalizedText) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(
      key,
      JSON.stringify({
        text: draft.text,
        ...(draft.context ? { context: draft.context } : {}),
        updatedAt: Date.now(),
      } satisfies AskAIComposerDraft),
    );
  } catch {
    // Draft persistence is best-effort; never block the composer.
  }
}

export function removeAskAIComposerDraft(key: string | null | undefined): void {
  if (!key || typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}
