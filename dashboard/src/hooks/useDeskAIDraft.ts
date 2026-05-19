import { useState, useCallback, useEffect, useRef } from 'react';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';
import {
  fetchSessionDetail,
  fetchUserSessionForConversation,
} from '../services/XyneAI/XyneAISessionsService';
import type { Message, DraftSource } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import { logger, Event } from '../utils/logger';

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
}

export type AIRefineQuickAction = 'polish' | 'formalise' | 'elaborate' | 'shorten';

export interface UseDeskAIDraftReturn {
  draftContent: string;
  draftSources: DraftSource[];
  isStreaming: boolean;
  isDraftActive: boolean;
  triggerDraft: () => void;
  askAIRefine: (instruction: string, sourceText: string) => void;
  refineDraft: (instruction: string, options?: { selectedText?: string }) => void;
  quickRewrite: (action: AIRefineQuickAction, sourceText: string) => void;
  customRewrite: (instruction: string, sourceText: string) => void;
  acceptDraft: () => string;
  rejectDraft: () => void;
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

// Prior messages are chained via parentId — without a chain, every parentless
// draft turn becomes a sibling at BRANCH_ROOT_KEY and the sidebar renders
// branch arrows the next time any turn is added.
const loadPriorMessages = async (
  threadId: string,
  sessionId: string | null,
): Promise<Message[]> => {
  const active = xyneAIStreamManager.getActiveStream(threadId);
  if (active?.messages.length) return active.messages;
  if (!sessionId) return [];
  try {
    const detail = await fetchSessionDetail(sessionId);
    const chain: Message[] = [];
    for (const m of detail.messages) {
      const prev = chain[chain.length - 1];
      chain.push({
        id: m.id,
        type: m.type,
        content: m.content,
        timestamp: new Date(m.timestamp),
        isStreaming: false,
        ...(prev && { parentId: prev.id }),
      });
    }
    return chain;
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
}: UseDeskAIDraftOptions): UseDeskAIDraftReturn {
  const [draftContent, setDraftContent] = useState('');
  const [draftSources, setDraftSources] = useState<DraftSource[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDraftActive, setIsDraftActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const ourStreamIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const isComposeMode = mode === 'compose';
  const threadId = channelId
    ? isComposeMode
      ? `${channelId}_compose`
      : conversationId
        ? `${channelId}_${conversationId}`
        : ''
    : '';
  const storageKey = threadId ? `xd-ai-draft:${threadId}` : '';

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
    let cancelled = false;
    setDraftContent('');
    setDraftSources([]);
    setIsStreaming(false);
    setIsDraftActive(false);
    setSessionId(null);
    ourStreamIdRef.current = null;

    if (!isComposeMode && !conversationId)
      return () => {
        cancelled = true;
      };

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
          }
        }
      } catch {
        /* ignore corrupt entries */
      }
    }

    if (!isComposeMode && conversationId) {
      void (async () => {
        try {
          const resolved = await fetchUserSessionForConversation(conversationId);
          if (!cancelled && resolved) setSessionId(resolved);
        } catch {
          /* lookup failed — first interaction will create a fresh session */
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [conversationId, storageKey, isComposeMode, threadId]);

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
      setIsStreaming(state.status === 'streaming');
    });
  }, [threadId]);

  const submit = useCallback(
    async (query: string, displayContent: string, options?: { disableTools?: boolean }) => {
      if (!threadId || !channelId) return;
      if (!isComposeMode && !conversationId) return;

      setIsDraftActive(true);
      setIsStreaming(true);
      setDraftContent('');
      setDraftSources([]);

      const userMessageId = `user-${Date.now()}`;
      const effectiveSessionId =
        options?.disableTools || isComposeMode ? undefined : (sessionIdRef.current ?? undefined);

      const prior = await loadPriorMessages(threadId, effectiveSessionId ?? null);
      const lastPriorId = prior[prior.length - 1]?.id;

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
            ...(options?.disableTools && { disableTools: true }),
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
      }
    },
    [threadId, channelId, conversationId, ticketId, isComposeMode],
  );

  const basePrompt =
    (isComposeMode
      ? 'Draft a brand-new email. Write the full body — an appropriate greeting and the message itself. Do not include the subject line and do not append a signature block (the user has those configured separately).'
      : 'Draft a reply for this ticket.') + renderHeaderBlock(headers);

  const triggerDraft = useCallback(() => {
    const display = isComposeMode ? 'Draft an email' : 'Draft a reply';
    void submit(basePrompt, display);
  }, [submit, basePrompt, isComposeMode]);

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
      void submit(parts.join('\n\n'), trimmedInstruction || 'Refine draft');
    },
    [submit, basePrompt],
  );

  const refineDraft = useCallback(
    (instruction: string, options?: { selectedText?: string }) => {
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
      void submit(parts.join('\n\n'), trimmedInstruction || 'Refine draft');
    },
    [submit, draftContent, basePrompt],
  );

  const quickRewrite = useCallback(
    (action: AIRefineQuickAction, sourceText: string) => {
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
        'Formatting: the source may contain HTML (`<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<h1>`-`<h6>`, `<br>`, `<p>`, `<cite>`) or markdown. Preserve every formatting element from the source in your output as MARKDOWN — bold as `**text**`, italic as `*text*`, links as `[text](url)`, headings with `#`/`##`, bullets as `- item`, ordered lists as `1.`/`2.`, and keep paragraph breaks as blank lines. **Citation tags `<cite ref="X">…</cite>` MUST be preserved verbatim around the same factual span in the rewrite — do not drop them, do not change the `ref` attribute, do not move them to a different sentence.** If a phrase is bold (or italic / a list item / a link / wrapped in `<cite>`) in the source, the rewritten phrase covering the same point MUST be bold (or italic / a list item / a link / wrapped in `<cite>`) too. Never strip formatting. Never wrap the output in ``` code fences.',
        `Instruction: ${actionInstruction[action]}`,
        `Text to rewrite:\n"""\n${trimmedSource}\n"""${headerBlock}${signoffRule}`,
      ].join('\n\n');

      const displayLabel: Record<AIRefineQuickAction, string> = {
        polish: 'Polish',
        formalise: 'Formalise',
        elaborate: 'Elaborate',
        shorten: 'Shorten',
      };

      void submit(query, displayLabel[action], { disableTools: true });
    },
    [submit, headers],
  );

  const customRewrite = useCallback(
    (instruction: string, sourceText: string) => {
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
        'Formatting: the source may contain HTML (`<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<h1>`-`<h6>`, `<br>`, `<p>`, `<cite>`) or markdown. Preserve every formatting element from the source in your output as MARKDOWN — bold as `**text**`, italic as `*text*`, links as `[text](url)`, headings with `#`/`##`, bullets as `- item`, ordered lists as `1.`/`2.`, and keep paragraph breaks as blank lines. **Citation tags `<cite ref="X">…</cite>` MUST be preserved verbatim around the same factual span in the rewrite — do not drop them, do not change the `ref` attribute, do not move them to a different sentence.** If a phrase is bold (or italic / a list item / a link / wrapped in `<cite>`) in the source, the rewritten phrase covering the same point MUST be bold (or italic / a list item / a link / wrapped in `<cite>`) too. Never strip formatting. Never wrap the output in ``` code fences.',
        `Instruction: ${trimmedInstruction}`,
        `Text to rewrite:\n"""\n${trimmedSource}\n"""${headerBlock}${signoffRule}`,
      ].join('\n\n');

      void submit(query, trimmedInstruction, { disableTools: true });
    },
    [submit, headers],
  );

  const acceptDraft = useCallback(() => {
    setIsDraftActive(false);
    ourStreamIdRef.current = null;
    clearStorage();
    return draftContent;
  }, [draftContent, clearStorage]);

  const rejectDraft = useCallback(() => {
    if (threadId && ourStreamIdRef.current) {
      xyneAIStreamManager.abortStreamByThread(threadId);
    }
    ourStreamIdRef.current = null;
    setIsDraftActive(false);
    setDraftContent('');
    setDraftSources([]);
    setIsStreaming(false);
    clearStorage();
  }, [threadId, clearStorage]);

  return {
    draftContent,
    draftSources,
    isStreaming,
    isDraftActive,
    triggerDraft,
    askAIRefine,
    refineDraft,
    quickRewrite,
    customRewrite,
    acceptDraft,
    rejectDraft,
  };
}
