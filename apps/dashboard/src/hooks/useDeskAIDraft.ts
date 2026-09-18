import { useState, useCallback, useEffect, useRef } from 'react';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';
import { fetchV2ConversationMessages } from '../services/XyneAI/XyneAISessionsV2Service';
import type {
  Message,
  DraftSource,
  ToolInvocation,
} from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import { logger, Event } from '../utils/logger';
import { rewriteEmailText } from '../services/emailQuickRewriteService';
import {
  extractInlineCitations,
  type InlineCitation,
} from '../components/ui/TipTapExtensions/CitationMark';
import { globalClickTracker } from '../services/Analytics/globalClickTracker';
import { lengthBucket } from '../services/Analytics/trackSource';

/** How the current desk draft was produced. */
export type DeskDraftRunKind = 'manual' | 'refine' | 'quick_rewrite' | 'custom_rewrite';

/**
 * What DraftCard stamps onto its Insert / Discard / Refine clicks so they join
 * back to DRAFT_GENERATED. One desk composer is open at a time, so a single
 * module-level record is enough; `generatedAt` is a timestamp rather than a
 * delta because the attribute is baked at render, not at the click.
 */
export interface DeskDraftTrackingSnapshot {
  generatedAt: number | null;
  refineCount: number;
  kind: DeskDraftRunKind;
  /** The composer mount this draft belongs to (see newComposerSessionId). */
  composerSessionId: string | null;
  ticketId: string | null;
  /** Length of the draft the agent inserted, for the edit-before-send check at send time. */
  acceptedLength: number | null;
  /** The agent discarded the last AI draft instead of inserting it. */
  rejected: boolean;
}

/**
 * One record per hook instance, i.e. per composer. It is NOT module state:
 * several compose windows and a reply composer can be mounted at once, and
 * each one's Insert / Discard clicks and send-time `aiDraftState` must join
 * back to its own COMPOSER_OPENED / SEND_EMAIL_* rows.
 */
function createDeskDraftTracking(
  composerSessionId: string | null,
  ticketId: string | null,
): DeskDraftTrackingSnapshot {
  return {
    generatedAt: null,
    refineCount: 0,
    kind: 'manual',
    composerSessionId,
    ticketId,
    acceptedLength: null,
    rejected: false,
  };
}

function trackDeskDraftOutcome(
  tracking: DeskDraftTrackingSnapshot,
  ok: boolean,
  extra: {
    kind: DeskDraftRunKind;
    draftMode: 'reply' | 'compose';
    startedAt: number | null;
    contentLength?: number;
    sourcesCount?: number;
    hasTicketContext?: boolean;
    errorKind?: string;
  },
): void {
  const { startedAt, contentLength, ...rest } = extra;
  globalClickTracker.trackManualEvent(
    'AIDraft',
    ok ? 'DRAFT_GENERATED' : 'DRAFT_FAILED',
    undefined,
    {
      ...rest,
      latencyMs: startedAt === null ? null : Date.now() - startedAt,
      ...(contentLength !== undefined && { draftLengthBucket: lengthBucket(contentLength) }),
      refineCount: tracking.refineCount,
      ...(tracking.composerSessionId && { composerSessionId: tracking.composerSessionId }),
      ...(tracking.ticketId && { ticketId: tracking.ticketId }),
    },
  );
}
export interface DeskAIDraftHeaders {
  from?: string | null;
  to?: ReadonlyArray<string> | null;
  cc?: ReadonlyArray<string> | null;
  signatureWillBeAppended?: boolean;
}

interface UseDeskAIDraftOptions {
  channelId: string;
  conversationId: string;
  ticketId?: string | null;
  mode?: 'reply' | 'compose';
  headers?: DeskAIDraftHeaders;
  agentSlug?: string;
  /** The owning composer's session id (see newComposerSessionId), stamped on every AIDraft event. */
  composerSessionId?: string | null;
}

export type AIRefineQuickAction = 'polish' | 'formalise' | 'elaborate' | 'shorten';

export interface UseDeskAIDraftReturn {
  draftContent: string;
  draftSources: DraftSource[];
  draftInlineCitations: InlineCitation[];
  draftToolInvocations: ToolInvocation[];
  sessionId: string | null;
  isStreaming: boolean;
  isDraftActive: boolean;
  /** Text selected by user for partial refinement (from AI Draft or Your Draft) */
  selectedTextForRefine: string;
  triggerDraft: () => void;
  askAIRefine: (instruction: string, sourceText: string) => void;
  refineDraft: (instruction: string, options?: { selectedText?: string }) => Promise<void>;
  quickRewrite: (action: AIRefineQuickAction, sourceText: string) => Promise<void>;
  customRewrite: (instruction: string, sourceText: string) => Promise<void>;
  acceptDraft: () => string;
  rejectDraft: () => void;
  /** Prepare refine from external source (e.g., "Your Draft") - sets draft content and selected text */
  prepareRefineFromExternal: (sourceContent: string, selectedText: string) => void;
  /** Clear the selected text for refine */
  clearSelectedTextForRefine: () => void;
  /** This composer's draft bookkeeping, for DraftCard clicks and the send-time aiDraftState. */
  getTrackingSnapshot: () => Readonly<DeskDraftTrackingSnapshot>;
}

const latestBotContent = (messages: Message[]): string | null => {
  const bot = [...messages].reverse().find(m => m.type === 'bot');
  if (!bot) return null;
  if (bot.parsedContent?.summary) return bot.parsedContent.summary;
  const stream = bot.streamingContent || bot.content || '';
  const head = stream.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return null;
  return stream || null;
};

const latestBotSources = (messages: Message[]): DraftSource[] => {
  const bot = [...messages].reverse().find(m => m.type === 'bot');
  return bot?.sources ?? [];
};

const latestBotToolInvocations = (messages: Message[]): ToolInvocation[] => {
  const bot = [...messages].reverse().find(m => m.type === 'bot');
  return bot?.toolInvocations ?? [];
};

// Prior messages are chained via parentId — without a chain, every parentless
// draft turn becomes a sibling at BRANCH_ROOT_KEY and the sidebar renders
// branch arrows the next time any turn is added.
const loadPriorMessages = async (
  threadId: string,
  sessionId: string | null,
  agentSlug: string,
): Promise<Message[]> => {
  const active = xyneAIStreamManager.getActiveStream(threadId);
  if (active?.messages.length) return active.messages;
  if (!sessionId) return [];
  try {
    // v2/claw: sessionId is the claw conversation id, so its messages map
    // cleanly. They already carry parentId (branching tree) from the backend.
    return await fetchV2ConversationMessages(sessionId, agentSlug);
  } catch {
    return [];
  }
};

const renderHeaderBlock = (headers?: DeskAIDraftHeaders): string => {
  if (!headers) return '';
  const lines: string[] = [];
  if (headers.from?.trim()) lines.push(`From: ${headers.from.trim()}`);
  const to = (headers.to ?? []).filter(s => s && s.trim());
  if (to.length) lines.push(`To: ${to.join(', ')}`);
  const cc = (headers.cc ?? []).filter(s => s && s.trim());
  if (cc.length) lines.push(`Cc: ${cc.join(', ')}`);

  if (lines.length === 0) return '';

  const signOffRule = headers.signatureWillBeAppended
    ? 'IMPORTANT: Do NOT include any closing or valediction (no "Best regards,", "Thanks,", "Sincerely,", etc.) and do NOT include any sign-off name. The body must end immediately after the final sentence of the message — the user has a signature block that will be appended verbatim after it.'
    : 'Sign-off rule: treat the `From:` email above as the sender. Use a neutral closing ("Best regards,", "Thanks,") followed on the next line by the sender derived from the `From:` address (e.g. for `support@acme.com` use "Support Team"; for a personal mailbox derive from the local-part). Do NOT pull a sign-off name from prior messages in the conversation, the ticket creator, or any other source — the `From:` address is the only authoritative sender.';

  return `\n\n${lines.join('\n')}\n\n${signOffRule}`;
};

export function useDeskAIDraft({
  channelId,
  conversationId,
  ticketId,
  mode = 'reply',
  headers,
  agentSlug = 'ask-ai',
  composerSessionId,
}: UseDeskAIDraftOptions): UseDeskAIDraftReturn {
  const [draftContent, setDraftContent] = useState('');
  const [draftSources, setDraftSources] = useState<DraftSource[]>([]);
  const [draftInlineCitations, setDraftInlineCitations] = useState<InlineCitation[]>([]);
  const [draftToolInvocations, setDraftToolInvocations] = useState<ToolInvocation[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDraftActive, setIsDraftActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedTextForRefine, setSelectedTextForRefine] = useState('');
  const sessionIdRef = useRef<string | null>(null);
  const ourStreamIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const isComposeMode = mode === 'compose';

  // DRAFT_GENERATED / DRAFT_FAILED bookkeeping. Streamed runs resolve in the
  // subscription below; the inline rewrites resolve in `rewriteTracked`.
  // Per hook instance, so two mounted composers never share a record; the ids
  // are re-synced each render because the ticket can arrive after mount.
  const trackingRef = useRef<DeskDraftTrackingSnapshot>(
    createDeskDraftTracking(composerSessionId ?? null, ticketId ?? null),
  );
  trackingRef.current.composerSessionId = composerSessionId ?? null;
  trackingRef.current.ticketId = ticketId ?? null;
  const getTrackingSnapshot = useCallback((): Readonly<DeskDraftTrackingSnapshot> => {
    return trackingRef.current;
  }, []);
  const runStartedAtRef = useRef<number | null>(null);
  const runKindRef = useRef<DeskDraftRunKind>('manual');
  const prevStreamStatusRef = useRef<StreamState['status'] | null>(null);
  const beginRun = useCallback((kind: DeskDraftRunKind): void => {
    runKindRef.current = kind;
    runStartedAtRef.current = Date.now();
    if (kind !== 'manual') trackingRef.current.refineCount += 1;
    else
      trackingRef.current = {
        ...trackingRef.current,
        generatedAt: null,
        refineCount: 0,
        acceptedLength: null,
        rejected: false,
      };
    trackingRef.current.kind = kind;
  }, []);
  const rewriteTracked = useCallback(
    async (kind: DeskDraftRunKind, query: string): Promise<{ rewrittenText: string }> => {
      beginRun(kind);
      const startedAt = runStartedAtRef.current;
      try {
        const result = await rewriteEmailText({ query });
        trackingRef.current.generatedAt = Date.now();
        trackDeskDraftOutcome(trackingRef.current, true, {
          kind,
          draftMode: mode,
          startedAt,
          contentLength: result.rewrittenText.length,
          hasTicketContext: !!ticketId,
        });
        return result;
      } catch (error) {
        trackDeskDraftOutcome(trackingRef.current, false, {
          kind,
          draftMode: mode,
          startedAt,
          hasTicketContext: !!ticketId,
          errorKind: error instanceof Error ? error.name : 'unknown',
        });
        throw error;
      }
    },
    [beginRun, mode, ticketId],
  );
  const threadId = channelId
    ? isComposeMode
      ? `${channelId}_compose`
      : conversationId
        ? `${channelId}_${conversationId}`
        : ''
    : '';
  const storageKey = threadId ? `xd-ai-draft:${threadId}` : '';
  const sessionStorageKey = threadId ? `xd-ai-session:${threadId}` : '';

  const writeStorage = useCallback(
    (content: string): void => {
      if (!storageKey || typeof window === 'undefined') return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ content }));
      } catch {
        /* quota / private mode — non-fatal */
      }
    },
    [storageKey],
  );
  const clearStorage = useCallback((): void => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* non-fatal */
    }
  }, [storageKey]);

  useEffect(() => {
    setDraftContent('');
    setDraftSources([]);
    setDraftInlineCitations([]);
    setIsStreaming(false);
    setIsDraftActive(false);
    setSessionId(null);
    ourStreamIdRef.current = null;

    if (!isComposeMode && !conversationId) return;

    if (threadId) {
      const active = xyneAIStreamManager.getActiveStream(threadId);
      if (active) {
        ourStreamIdRef.current = active.streamId;
        if (active.sessionId) setSessionId(active.sessionId);
        setIsDraftActive(true);
        setIsStreaming(active.status === 'streaming');
        const content = latestBotContent(active.messages);
        if (content !== null) setDraftContent(content);
        setDraftSources(latestBotSources(active.messages));
        setDraftToolInvocations(latestBotToolInvocations(active.messages));
        const raw = active.messages[active.messages.length - 1]?.content ?? '';
        setDraftInlineCitations(extractInlineCitations(raw));
      }
    }

    if (storageKey && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { content?: string };
          if (parsed?.content) {
            setDraftContent(parsed.content);
            setIsDraftActive(true);
            setDraftInlineCitations(extractInlineCitations(parsed.content));
          }
        }
      } catch {
        /* ignore corrupt entries */
      }
    }

    if (sessionStorageKey && typeof window !== 'undefined') {
      try {
        const restoredSessionId = localStorage.getItem(sessionStorageKey);
        if (restoredSessionId) setSessionId(restoredSessionId);
      } catch {
        /* non-fatal */
      }
    }

    // Ask AI v1 resolved a prior session from the desk conversationId here
    // (fetchUserSessionForConversation). v2/claw has no equivalent
    // by-conversation lookup, so we rely on the localStorage session key above;
    // the first interaction otherwise creates a fresh claw session.
  }, [conversationId, storageKey, sessionStorageKey, isComposeMode, threadId]);

  useEffect(() => {
    if (!sessionStorageKey || typeof window === 'undefined' || !sessionId) return;
    try {
      localStorage.setItem(sessionStorageKey, sessionId);
    } catch {
      /* non-fatal */
    }
  }, [sessionId, sessionStorageKey]);

  useEffect(() => {
    if (!isDraftActive) return;
    if (!draftContent) return;
    if (!isStreaming) {
      writeStorage(draftContent);
      return;
    }
    const handle = setTimeout(() => writeStorage(draftContent), 250);
    return (): void => clearTimeout(handle);
  }, [draftContent, isDraftActive, isStreaming, writeStorage]);

  // Mirror content/status for streams we own. Also capture the session ID
  // assigned by the backend (when our local sessionId was null and the
  // backend created a fresh session) so the next click reuses it.
  useEffect(() => {
    if (!threadId) return;
    return xyneAIStreamManager.subscribe((state: StreamState): void => {
      if (state.threadId !== threadId) return;
      if (state.streamId !== ourStreamIdRef.current) return;

      if (state.status === 'aborted') {
        ourStreamIdRef.current = null;
        setIsStreaming(false);
        setIsDraftActive(false);
        setDraftContent('');
        setDraftSources([]);
        setDraftToolInvocations([]);
        setDraftInlineCitations([]);
        clearStorage();
        return;
      }

      if (
        state.sessionId &&
        state.sessionId !== sessionIdRef.current &&
        !state.sessionId.startsWith('ephemeral-')
      ) {
        setSessionId(state.sessionId);
      }
      const content = latestBotContent(state.messages);
      if (content !== null) setDraftContent(content);
      setDraftSources(latestBotSources(state.messages));
      setDraftToolInvocations(latestBotToolInvocations(state.messages));
      const raw = state.messages[state.messages.length - 1]?.content ?? '';
      setDraftInlineCitations(extractInlineCitations(raw));
      setIsStreaming(state.status === 'streaming');

      // Outcome of a streamed run, on the streaming → completed/error edge only
      // so the many streaming ticks stay silent. Aborts returned above.
      const prevStatus = prevStreamStatusRef.current;
      prevStreamStatusRef.current = state.status;
      if (prevStatus === 'streaming' && state.status !== 'streaming') {
        const ok = state.status === 'completed';
        if (ok) trackingRef.current.generatedAt = Date.now();
        trackDeskDraftOutcome(trackingRef.current, ok, {
          kind: runKindRef.current,
          draftMode: mode,
          startedAt: runStartedAtRef.current,
          contentLength: content?.length ?? 0,
          sourcesCount: latestBotSources(state.messages).length,
          hasTicketContext: !!ticketId,
          ...(!ok && { errorKind: 'stream' }),
        });
        runStartedAtRef.current = null;
      }
    });
  }, [threadId, clearStorage, mode, ticketId]);

  const submit = useCallback(
    async (query: string, displayContent: string, options?: { disableTools?: boolean }) => {
      if (!threadId || !channelId) return;
      if (!isComposeMode && !conversationId) return;

      setIsDraftActive(true);
      setIsStreaming(true);
      setDraftContent('');
      setDraftSources([]);
      setDraftToolInvocations([]);
      setDraftInlineCitations([]);

      const userMessageId = `user-${Date.now()}`;
      const effectiveSessionId =
        options?.disableTools || isComposeMode ? undefined : (sessionIdRef.current ?? undefined);

      const prior = await loadPriorMessages(threadId, effectiveSessionId ?? null, agentSlug);
      const lastPriorId = prior[prior.length - 1]?.id;

      prevStreamStatusRef.current = null;
      try {
        ourStreamIdRef.current = await xyneAIStreamManager.startStream(
          threadId,
          {
            query,
            displayQuery: displayContent,
            channelIds: [],
            conversationId: effectiveSessionId ?? '',
            ...(!isComposeMode && conversationId && { threadConversationId: conversationId }),
            webSearchEnabled: true,
            deepResearchEnabled: false,
            researchContext: null,
            attachments: [],
            ...(!isComposeMode && !options?.disableTools && ticketId && { ticketIds: [ticketId] }),
            localUserMessageId: userMessageId,
            ...(!options?.disableTools && lastPriorId && { parentMessageId: lastPriorId }),
            suppressCompletionToast: true,
            draftMode: true,
            showInSidebar: true,
            ...(options?.disableTools && { disableTools: true }),
            agentSlug,
          },
          [
            ...prior,
            {
              id: userMessageId,
              type: 'user',
              content: displayContent,
              timestamp: new Date(),
              ...(lastPriorId && { parentId: lastPriorId }),
            },
            {
              id: `bot-${Date.now()}`,
              type: 'bot',
              content: '',
              timestamp: new Date(),
              isStreaming: true,
              parentId: userMessageId,
            },
          ],
        );
      } catch (error) {
        logger.error(Event.DESK_AI_DRAFT_STREAM_FAILED, {
          threadId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        setIsStreaming(false);
        trackDeskDraftOutcome(trackingRef.current, false, {
          kind: runKindRef.current,
          draftMode: mode,
          startedAt: runStartedAtRef.current,
          hasTicketContext: !!ticketId,
          errorKind: 'start',
        });
        runStartedAtRef.current = null;
      }
    },
    [threadId, channelId, conversationId, ticketId, isComposeMode, agentSlug, mode],
  );

  const basePrompt =
    (isComposeMode
      ? 'Draft a brand-new email. Write the full body — an appropriate greeting and the message itself. Do not include the subject line and do not append a signature block (the user has those configured separately).'
      : 'Draft a reply for this ticket.') + renderHeaderBlock(headers);

  const triggerDraft = useCallback(() => {
    const display = isComposeMode ? 'Draft an email' : 'Draft a reply';
    beginRun('manual');
    void submit(basePrompt, display);
  }, [submit, basePrompt, isComposeMode, beginRun]);

  const askAIRefine = useCallback(
    (instruction: string, sourceText: string) => {
      const trimmedSource = sourceText.trim();
      const trimmedInstruction = instruction.trim();
      const parts = [basePrompt];
      if (trimmedSource) {
        parts.push(
          `The user has already started writing the following text in the composer — use it as a starting point and refine / expand it:\n"""\n${trimmedSource}\n"""`,
        );
      }
      if (trimmedInstruction) {
        parts.push(`Additional guidance from the user: "${trimmedInstruction}"`);
      }
      beginRun('refine');
      void submit(parts.join('\n\n'), trimmedInstruction || 'Refine draft');
    },
    [submit, basePrompt, beginRun],
  );

  const refineDraft = useCallback(
    async (instruction: string, options?: { selectedText?: string }) => {
      const rewriteKind: DeskDraftRunKind = 'refine';
      const trimmedInstruction = instruction.trim();
      const trimmedSelectedText = options?.selectedText?.trim() ?? '';
      const parts = [basePrompt];
      if (draftContent) {
        if (trimmedSelectedText) {
          parts.push(
            `A previous AI draft was generated. Refine only the selected portion while keeping the rest of the draft aligned with the same tone and intent.\n\nFull AI draft:\n"""\n${draftContent}\n"""\n\nSelected text to refine:\n"""\n${trimmedSelectedText}\n"""`,
          );
        } else {
          parts.push(
            `A previous AI draft was generated:\n"""\n${draftContent}\n"""\nRefine it per the user's guidance below.`,
          );
        }
      }
      if (trimmedInstruction) {
        parts.push(
          trimmedSelectedText
            ? `Refinement guidance from the user for the selected text: "${trimmedInstruction}"`
            : `Refinement guidance from the user: "${trimmedInstruction}"`,
        );
      }

      const query = parts.join('\n\n');

      setIsDraftActive(true);
      setIsStreaming(true);
      setDraftContent('');
      setDraftSources([]);
      setDraftToolInvocations([]);
      setDraftInlineCitations([]);

      try {
        const result = await rewriteTracked(rewriteKind, query);

        setDraftContent(result.rewrittenText);
        setDraftInlineCitations(extractInlineCitations(result.rewrittenText));
        setIsStreaming(false);
        writeStorage(result.rewrittenText);
      } catch (error) {
        logger.error(Event.DESK_AI_DRAFT_STREAM_FAILED, {
          threadId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        setIsStreaming(false);
      }
    },
    [draftContent, basePrompt, threadId, conversationId, writeStorage, rewriteTracked],
  );

  const quickRewrite = useCallback(
    async (action: AIRefineQuickAction, sourceText: string) => {
      const rewriteKind: DeskDraftRunKind = 'quick_rewrite';
      const trimmedSource = sourceText.trim();
      if (!trimmedSource) return;

      const actionInstruction: Record<AIRefineQuickAction, string> = {
        polish:
          'Polish the wording and improve clarity while preserving the meaning, tone, structure, and any specific details (numbers, names, links).',
        formalise:
          'Rewrite the text in a more formal, professional tone while preserving the meaning, structure, and any specific details (numbers, names, links).',
        elaborate:
          'Expand the text with helpful detail and context while preserving the meaning, intent, and any specific details (numbers, names, links). Do not invent facts.',
        shorten:
          'Make the text shorter and more concise without losing meaning, tone, or any specific details (numbers, names, links).',
      };

      const headerLines: string[] = [];
      const fromLine = headers?.from?.trim();
      if (fromLine) headerLines.push(`From: ${fromLine}`);
      const to = (headers?.to ?? []).filter(s => s && s.trim());
      if (to.length) headerLines.push(`To: ${to.join(', ')}`);
      const headerBlock = headerLines.length
        ? `\n\nFor context (do not output these as headers — they are only for tone alignment):\n${headerLines.join('\n')}`
        : '';

      const signoffRule = headers?.signatureWillBeAppended
        ? '\n\nIMPORTANT: Do NOT add any closing or sign-off — a signature block will be appended after.'
        : '';

      const query = [
        'You are an inline rewrite engine.',
        'Rewrite the text below according to the instruction. Do not invoke any tools, do not search, do not fetch external content. Output ONLY the rewritten text — no preamble, no explanation, no headers, no quotes around the output.',
        'Formatting: the source may contain HTML (`<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<h1>`-`<h6>`, `<br>`, `<p>`, `<cite>`) or markdown. Preserve every formatting element from the source in your output as MARKDOWN — bold as `**text**`, italic as `*text*`, links as `[text](url)`, headings with `#`/`##`, bullets as `- item`, ordered lists as `1.`/`2.`, and keep paragraph breaks as blank lines. **Citation tags `<cite ref="X">…</cite>` and trailing `<citation>…</citation>` source blocks MUST be preserved verbatim in the rewrite — do not drop them, do not change citation refs/URLs, and do not move inline `<cite>` tags to a different sentence.** If a phrase is bold (or italic / a list item / a link / wrapped in `<cite>`) in the source, the rewritten phrase covering the same point MUST be bold (or italic / a list item / a link / wrapped in `<cite>`) too. Never strip formatting. Never wrap the output in ``` code fences.',
        `Instruction: ${actionInstruction[action]}`,
        `Text to rewrite:\n"""\n${trimmedSource}\n"""${headerBlock}${signoffRule}`,
      ].join('\n\n');

      setIsDraftActive(true);
      setIsStreaming(true);
      setDraftContent('');
      setDraftSources([]);
      setDraftToolInvocations([]);
      setDraftInlineCitations([]);

      try {
        const result = await rewriteTracked(rewriteKind, query);

        setDraftContent(result.rewrittenText);
        setDraftInlineCitations(extractInlineCitations(result.rewrittenText));
        setIsStreaming(false);
        writeStorage(result.rewrittenText);
      } catch (error) {
        logger.error(Event.DESK_AI_DRAFT_STREAM_FAILED, {
          threadId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        setIsStreaming(false);
      }
    },
    [headers, threadId, conversationId, writeStorage, rewriteTracked],
  );

  const customRewrite = useCallback(
    async (instruction: string, sourceText: string) => {
      const rewriteKind: DeskDraftRunKind = 'custom_rewrite';
      const trimmedSource = sourceText.trim();
      const trimmedInstruction = instruction.trim();
      if (!trimmedSource || !trimmedInstruction) return;

      const headerLines: string[] = [];
      const fromLine = headers?.from?.trim();
      if (fromLine) headerLines.push(`From: ${fromLine}`);
      const to = (headers?.to ?? []).filter(s => s && s.trim());
      if (to.length) headerLines.push(`To: ${to.join(', ')}`);
      const headerBlock = headerLines.length
        ? `\n\nFor context (do not output these as headers — they are only for tone alignment):\n${headerLines.join('\n')}`
        : '';

      const signoffRule = headers?.signatureWillBeAppended
        ? '\n\nIMPORTANT: Do NOT add any closing or sign-off — a signature block will be appended after.'
        : '';

      const query = [
        'You are an inline rewrite engine.',
        'Rewrite the text below according to the instruction. Do not invoke any tools, do not search, do not fetch external content. Output ONLY the rewritten text — no preamble, no explanation, no headers, no quotes around the output.',
        'Formatting: the source may contain HTML (`<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<h1>`-`<h6>`, `<br>`, `<p>`, `<cite>`) or markdown. Preserve every formatting element from the source in your output as MARKDOWN — bold as `**text**`, italic as `*text*`, links as `[text](url)`, headings with `#`/`##`, bullets as `- item`, ordered lists as `1.`/`2.`, and keep paragraph breaks as blank lines. **Citation tags `<cite ref="X">…</cite>` and trailing `<citation>…</citation>` source blocks MUST be preserved verbatim in the rewrite — do not drop them, do not change citation refs/URLs, and do not move inline `<cite>` tags to a different sentence.** If a phrase is bold (or italic / a list item / a link / wrapped in `<cite>`) in the source, the rewritten phrase covering the same point MUST be bold (or italic / a list item / a link / wrapped in `<cite>`) too. Never strip formatting. Never wrap the output in ``` code fences.',
        `Instruction: ${trimmedInstruction}`,
        `Text to rewrite:\n"""\n${trimmedSource}\n"""${headerBlock}${signoffRule}`,
      ].join('\n\n');

      setIsDraftActive(true);
      setIsStreaming(true);
      setDraftContent('');
      setDraftSources([]);
      setDraftToolInvocations([]);
      setDraftInlineCitations([]);

      try {
        const result = await rewriteTracked(rewriteKind, query);

        setDraftContent(result.rewrittenText);
        setDraftInlineCitations(extractInlineCitations(result.rewrittenText));
        setIsStreaming(false);
        writeStorage(result.rewrittenText);
      } catch (error) {
        logger.error(Event.DESK_AI_DRAFT_STREAM_FAILED, {
          threadId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        setIsStreaming(false);
      }
    },
    [headers, threadId, conversationId, writeStorage, rewriteTracked],
  );

  const acceptDraft = useCallback(() => {
    setIsDraftActive(false);
    if (threadId && ourStreamIdRef.current) {
      xyneAIStreamManager.abortStreamByThread(threadId);
    }
    ourStreamIdRef.current = null;
    clearStorage();
    // Remembered for SEND_EMAIL_SUCCEEDED's aiDraftState: the send compares
    // the body it ships against this length to say whether the draft was edited.
    trackingRef.current.acceptedLength = draftContent.length;
    trackingRef.current.rejected = false;
    return draftContent;
  }, [draftContent, clearStorage, threadId]);

  const rejectDraft = useCallback(() => {
    if (threadId && ourStreamIdRef.current) {
      xyneAIStreamManager.abortStreamByThread(threadId);
    }
    ourStreamIdRef.current = null;
    trackingRef.current.rejected = true;
    trackingRef.current.acceptedLength = null;
    setIsDraftActive(false);
    setDraftContent('');
    setDraftSources([]);
    setDraftToolInvocations([]);
    setDraftInlineCitations([]);
    setIsStreaming(false);
    setSelectedTextForRefine('');
    clearStorage();
  }, [threadId, clearStorage]);

  const prepareRefineFromExternal = useCallback(
    (sourceContent: string, selectedText: string): void => {
      setDraftContent(sourceContent);
      setSelectedTextForRefine(selectedText);
      setIsDraftActive(true);
      setDraftSources([]);
      setDraftToolInvocations([]);
      setDraftInlineCitations(extractInlineCitations(sourceContent));
    },
    [],
  );

  const clearSelectedTextForRefine = useCallback((): void => {
    setSelectedTextForRefine('');
  }, []);

  return {
    draftContent,
    draftSources,
    draftInlineCitations,
    draftToolInvocations,
    sessionId,
    isStreaming,
    isDraftActive,
    selectedTextForRefine,
    triggerDraft,
    askAIRefine,
    refineDraft,
    quickRewrite,
    customRewrite,
    acceptDraft,
    rejectDraft,
    prepareRefineFromExternal,
    clearSelectedTextForRefine,
    getTrackingSnapshot,
  };
}
