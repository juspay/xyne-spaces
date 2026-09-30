import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { AnimatePresence, motion } from 'motion/react';
import {
  AIComposer,
  type AIComposerAttachment,
  type AIComposerHandle,
} from '@/components/AIScreen/AIComposer';
import { AnimatedLabel, useStableLabel } from '@/components/AIScreen/ReasoningLoader';
import { ActivityBlock } from '@/components/Chat/XyneAISidebar/components/ActivityBlock';
import { type ComposerContext, toStreamOverrides } from '@/components/AIScreen/composerContext';
import type { Message, MessageAttachment } from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import { useXyneAIStream } from '@/hooks/useXyneAIStream';
import { xyneAIStreamManager } from '@/services/XyneAI';
import { clawErrorText } from '@/services/claw/clawRequest';
import { cn } from '@/utils/classNames';
import { buildXyneAIStreamThreadId, newStreamSlotKey } from '@/utils/xyneAIStreamThreadId';
import { CreateEmptyState } from './CreateEmptyState';
import {
  BuildQuestionCard,
  BuildReplyMarkdown,
  BuildSearchLine,
  BuildSuggestionChips,
} from './BuildChatExtras';
import { readBuildChat, writeBuildChat, type BuildTurnExtras } from './buildChatStorage';
import {
  buildDraftHistory,
  guardQuestions,
  type DraftActivity,
  type DraftQuestion,
  type DraftSuggestion,
} from './agentDraftStream';
import {
  createModeQuery,
  decideCreateCanvasAction,
  parseCreateChatAction,
  shouldHoldDraftChatAck,
  visibleCreateReply,
  type CreateCanvasSnapshot,
  type ParsedCreateChatAction,
} from './createChatMode';
import { orbStateForProgress } from './createProgressLabel';

const SCRIPTED_THINK_PHASES = ['Thinking', 'Weighing it up', 'Reasoning'] as const;
const SCRIPTED_THINK_PHASE_MS = 1600;

/** The builder model's live indicator; the label beside it carries the words. */
function BuildOrb({ state = 'working' }: { state?: OrbState }): ReactElement {
  return <ThinkingOrb state={state} size={20} aria-hidden />;
}

function WorkingProgressRow({ label }: { label: string }): ReactElement {
  const stable = useStableLabel(label);
  return (
    <div
      className='-ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground'
      data-testid='agent-create-progress'
      data-progress-label={label}
    >
      {/* Keyed off the held label so the orb and its words change together. */}
      <BuildOrb state={orbStateForProgress(stable)} />
      <span className='select-none'>
        <AnimatedLabel text={stable} />
      </span>
    </div>
  );
}

function ScriptedThinkLabel(): ReactElement {
  const [phase, setPhase] = useState(0);
  useEffect((): (() => void) => {
    const id = window.setInterval((): void => {
      setPhase(current => (current + 1) % SCRIPTED_THINK_PHASES.length);
    }, SCRIPTED_THINK_PHASE_MS);
    return (): void => {
      window.clearInterval(id);
    };
  }, []);
  const label = useStableLabel(`${SCRIPTED_THINK_PHASES[phase]}…`);
  return (
    <div
      className='-ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground'
      data-testid='agent-create-chat-thinking'
    >
      <BuildOrb />
      <span className='select-none'>
        <AnimatedLabel text={label} />
      </span>
    </div>
  );
}

const toMessageAttachments = (attachments: AIComposerAttachment[]): MessageAttachment[] =>
  attachments.map(att => ({
    filename: att.filename,
    mimeType: att.mimeType,
    data: att.data,
  }));

/** One streamed draft turn, run by the page; the panel owns the chat bubbles. */
export interface DraftTurnArgs {
  userText: string;
  /** Earlier turns, oldest first (the draft reads the last few). */
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  signal: AbortSignal;
  /** Stream text into this turn's reply bubble. */
  appendReply: (text: string) => void;
  /** Add a line to the reply (an ack, a warning). */
  announce: (line: string) => void;
  /** A research step before the answer ("Searching the web…"), added or updated by id. */
  activity: (activity: DraftActivity) => void;
  /** Changes the user can apply with one tap, under the reply. */
  suggest: (suggestions: DraftSuggestion[]) => void;
  /** Follow-up questions, shown as a card under the reply. */
  ask: (card: { id: string; questions: DraftQuestion[] }) => void;
}

export interface CreateChatTurn {
  userText: string;
  marker: ParsedCreateChatAction;
  /** Append a short line after a canvas section lands (canvas-first order). */
  announceSection?: (line: string) => void;
}

interface AgentCreateChatPanelProps {
  canvas: CreateCanvasSnapshot;
  onTurnComplete: (turn: CreateChatTurn) => Promise<void>;
  /**
   * Fires as the user sends, before the model answers, so work that needs only
   * the user's words (the hub plan) can start while the model is still thinking.
   */
  onSend?: (userText: string) => void;
  /**
   * Streamed draft path: when set, sends go to the page's draft stream instead
   * of the Ask AI run, and the canvas fills as events arrive.
   */
  onDraftTurn?: (turn: DraftTurnArgs) => Promise<void>;
  /** Streamed path: where the Build chat is kept so a reload brings it back. */
  chatStorageKey?: string | null;
  disabled?: boolean;
  /** Live draft pipeline phase — Braille + AnimatedLabel, not chat bubbles. */
  progressLabel?: string | null;
  scripted?: boolean;
  scriptedMessages?: Message[];
  scriptedDraft?: string;
  scriptedPlaying?: boolean;
  scriptedTyping?: boolean;
  scriptedDone?: boolean;
  onScriptedEngage?: () => void;
  onScriptedReplay?: () => void;
}

export function AgentCreateChatPanel(props: AgentCreateChatPanelProps): ReactElement {
  if (props.scripted) {
    return <ScriptedAgentCreateChatPanel {...props} />;
  }
  if (props.onDraftTurn) {
    return <StreamedAgentCreateChatPanel {...props} onDraftTurn={props.onDraftTurn} />;
  }
  return <LiveAgentCreateChatPanel {...props} />;
}

let draftMessageSeq = 0;
const draftMessageId = (kind: string): string => `draft-${kind}-${Date.now()}-${++draftMessageSeq}`;

type TurnExtras = BuildTurnExtras;

/**
 * Chat for the streamed draft. Each send is one draft turn: the reply text and
 * the canvas both fill from the same stream, so there is no "wait for the
 * model, then animate the canvas" gap. A conversational turn may also carry a
 * web search line, one-tap suggestions, or a question card.
 */
function StreamedAgentCreateChatPanel({
  onDraftTurn,
  chatStorageKey = null,
  disabled,
  progressLabel = null,
}: AgentCreateChatPanelProps & {
  onDraftTurn: (turn: DraftTurnArgs) => Promise<void>;
}): ReactElement {
  // The page remounts this panel when the key changes, so it is read once here.
  const [stored] = useState(() => (chatStorageKey ? readBuildChat(chatStorageKey) : null));
  const [messages, setMessages] = useState<Message[]>(() => stored?.messages ?? []);
  const [extras, setExtras] = useState<Record<string, TurnExtras>>(() => stored?.extras ?? {});
  /** User turns sent from a question card: the answered card stands in for their bubble. */
  const [fromCard, setFromCard] = useState<ReadonlySet<string>>(
    () => new Set(stored?.fromCard ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, extras, error, progressLabel]);

  // Keep the stored chat in step, a beat behind so a streaming reply isn't written per token.
  useEffect(() => {
    if (!chatStorageKey) return undefined;
    const timer = window.setTimeout(
      () => writeBuildChat(chatStorageKey, { messages, extras, fromCard: [...fromCard] }),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [chatStorageKey, extras, fromCard, messages]);

  useEffect(() => (): void => abortRef.current?.abort(), []);

  const updateExtras = useCallback(
    (id: string, next: (prior: TurnExtras) => TurnExtras): void =>
      setExtras(prev => ({
        ...prev,
        [id]: next(prev[id] ?? { activities: [], suggestions: [] }),
      })),
    [],
  );

  const submit = useCallback(
    async (text: string, options: { viaCard?: boolean } = {}): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || disabled || running) return;
      setError(null);
      // Earlier suggestions go stale, and a card still waiting is passed over.
      setExtras(prev => {
        const next: Record<string, TurnExtras> = {};
        for (const [id, value] of Object.entries(prev)) {
          next[id] = {
            ...value,
            suggestions: [],
            ...(value.question?.phase === 'pending'
              ? { question: { ...value.question, phase: 'declined' } }
              : {}),
          };
        }
        return next;
      });
      const history = buildDraftHistory(
        messages.map(message => ({
          type: message.type === 'user' ? 'user' : 'bot',
          content: message.content ?? '',
          failed: Boolean(message.errorInfo),
          ...(extras[message.id]?.question
            ? { asked: extras[message.id]!.question!.questions }
            : {}),
        })),
      );
      const userId = draftMessageId('user');
      const botId = draftMessageId('bot');
      if (options.viaCard) setFromCard(prev => new Set(prev).add(userId));
      setMessages(prev => [
        ...prev,
        { id: userId, type: 'user', content: trimmed, timestamp: new Date() },
        {
          id: botId,
          type: 'bot',
          content: '',
          streamingContent: '',
          isStreaming: true,
          timestamp: new Date(),
        },
      ]);
      const write = (next: (prior: string) => string): void =>
        setMessages(prev =>
          prev.map(message => {
            if (message.id !== botId) return message;
            const content = next(message.content ?? '');
            return { ...message, content, streamingContent: content };
          }),
        );
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      try {
        await onDraftTurn({
          userText: trimmed,
          history,
          signal: controller.signal,
          appendReply: delta => write(prior => prior + delta),
          announce: line => write(prior => (prior.trim() ? `${prior.trimEnd()}\n${line}` : line)),
          activity: activity =>
            updateExtras(botId, prior => ({
              ...prior,
              activities: [...prior.activities.filter(a => a.id !== activity.id), activity],
            })),
          suggest: suggestions => updateExtras(botId, prior => ({ ...prior, suggestions })),
          ask: card => {
            const questions = guardQuestions(card.questions);
            if (questions.length === 0) return;
            updateExtras(botId, prior => ({
              ...prior,
              question: { id: card.id, questions, phase: 'pending', answers: {}, notes: {} },
            }));
          },
        });
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          setError(clawErrorText(err, 'Could not draft from chat. Try again.'));
        }
      } finally {
        setMessages(prev =>
          prev.map(message =>
            message.id === botId
              ? { ...message, isStreaming: false, isAborted: controller.signal.aborted }
              : message,
          ),
        );
        if (abortRef.current === controller) abortRef.current = null;
        setRunning(false);
      }
    },
    [disabled, extras, messages, onDraftTurn, running, updateExtras],
  );

  const busy = running || Boolean(disabled);
  const lastBotId = [...messages].reverse().find(message => message.type === 'bot')?.id;
  // A card still waiting for an answer takes the composer's place; once answered
  // (or passed over) it lives in the transcript under its reply.
  const waitingCard = [...messages]
    .reverse()
    .find(
      message =>
        message.type === 'bot' &&
        !message.isStreaming &&
        extras[message.id]?.question?.phase === 'pending',
    );
  const waitingState = waitingCard ? extras[waitingCard.id]?.question : undefined;

  return (
    <CreateChatLayout
      empty={messages.length === 0 && !error}
      canvasError={error}
      messages={messages.filter(message => !fromCard.has(message.id))}
      bottomRef={bottomRef}
      pending={running || Boolean(disabled) || Boolean(progressLabel)}
      progressLabel={progressLabel}
      pane
      conversational
      renderReply={(message, text) => (
        // Every reply here arrived live, so each keeps the streaming renderer for its lifetime.
        <BuildReplyMarkdown id={message.id} content={text} streamed />
      )}
      renderBeforeReply={message =>
        extras[message.id]?.activities.length ? (
          <BuildSearchLine activities={extras[message.id]!.activities} />
        ) : null
      }
      renderAfterReply={message => {
        const turn = extras[message.id];
        if (!turn || message.isStreaming) return null;
        return (
          <>
            {turn.question && turn.question.phase !== 'pending' ? (
              <BuildQuestionCard
                state={turn.question}
                disabled
                onChange={question => updateExtras(message.id, prior => ({ ...prior, question }))}
                onAnswer={answer => {
                  void submit(answer, { viaCard: true });
                }}
              />
            ) : null}
            {turn.suggestions.length > 0 && message.id === lastBotId ? (
              <BuildSuggestionChips
                suggestions={turn.suggestions}
                disabled={busy}
                onApply={suggestion => {
                  void submit(suggestion.message);
                }}
              />
            ) : null}
          </>
        );
      }}
      {...(running ? { onStop: () => abortRef.current?.abort() } : {})}
      onSubmit={text => {
        void submit(text);
      }}
      {...(waitingCard && waitingState
        ? {
            composerSlot: (
              <BuildQuestionCard
                key={waitingState.id}
                docked
                state={waitingState}
                disabled={busy}
                onChange={question =>
                  updateExtras(waitingCard.id, prior => ({ ...prior, question }))
                }
                onAnswer={answer => {
                  void submit(answer, { viaCard: true });
                }}
              />
            ),
            composerSlotKey: `question-${waitingState.id}`,
          }
        : {})}
    />
  );
}

function LiveAgentCreateChatPanel({
  canvas,
  onTurnComplete,
  onSend,
  disabled,
  progressLabel = null,
}: AgentCreateChatPanelProps): ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [streamThreadKey, setStreamThreadKey] = useState(newStreamSlotKey);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const usesDraftStreamKeyRef = useRef(true);
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const onTurnCompleteRef = useRef(onTurnComplete);
  onTurnCompleteRef.current = onTurnComplete;
  const handledUserIdsRef = useRef(new Set<string>());
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { submitQuery, abortCurrentRequest } = useXyneAIStream({
    channelIds: [],
    conversationId,
    streamSessionKey: streamThreadKey,
    setMessages,
    setConversationId,
    isV2: true,
    agentSlug: null,
    suppressCompletionToast: true,
    surface: 'page',
  });

  const streaming = messages.some(message => message.isStreaming);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, canvasError]);

  useEffect(() => {
    if (!usesDraftStreamKeyRef.current || !conversationId) return;
    if (messages.some(message => message.isStreaming)) return;

    const oldTid = buildXyneAIStreamThreadId({
      channelId: null,
      threadConversationId: null,
      streamSessionKey: streamThreadKey,
    });
    const newTid = buildXyneAIStreamThreadId({
      channelId: null,
      threadConversationId: null,
      streamSessionKey: conversationId,
    });

    if (oldTid !== newTid) {
      xyneAIStreamManager.migrateThreadId(oldTid, newTid);
      setStreamThreadKey(conversationId);
      usesDraftStreamKeyRef.current = false;
      return;
    }

    const lastBot = [...messages].reverse().find(message => message.type === 'bot');
    if (!lastBot?.errorInfo) {
      usesDraftStreamKeyRef.current = false;
    }
  }, [conversationId, messages, streamThreadKey]);

  const canvasStartedForUserRef = useRef<string | null>(null);

  const announceOnBot = useCallback((botId: string, line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    setMessages(prev =>
      prev.map(message => {
        if (message.id !== botId) return message;
        const prior = (message.content || message.streamingContent || '').trim();
        const next = prior ? `${prior}\n${trimmed}` : trimmed;
        return {
          ...message,
          content: next,
          streamingContent: next,
          isStreaming: false,
        };
      }),
    );
  }, []);

  const runCanvasTurn = useCallback(
    async (userText: string, raw: string, botId: string): Promise<void> => {
      const marker = parseCreateChatAction(raw);
      const holdAck = shouldHoldDraftChatAck(raw);
      if (holdAck) {
        // Canvas first: clear premature draft ack from the bot bubble.
        setMessages(prev =>
          prev.map(message =>
            message.id === botId
              ? { ...message, content: '', streamingContent: '', isStreaming: false }
              : message,
          ),
        );
      }
      await onTurnCompleteRef.current({
        userText,
        marker,
        announceSection: (line: string) => {
          announceOnBot(botId, line);
        },
      });
    },
    [announceOnBot],
  );

  // Canvas-first on turn complete: hold draft ack during stream, then write canvas before chat lines.
  useEffect(() => {
    if (streaming) return;
    const lastUser = [...messages].reverse().find(message => message.type === 'user');
    const lastBot = [...messages].reverse().find(message => message.type === 'bot');
    if (!lastUser || !lastBot) return;
    if (handledUserIdsRef.current.has(lastUser.id)) return;
    if (lastBot.isStreaming) return;
    handledUserIdsRef.current.add(lastUser.id);
    if (lastBot.errorInfo || lastBot.isAborted) return;
    const raw = lastBot.content || lastBot.streamingContent || '';
    // Reply-only: keep streamed answer. Draft: canvas pipeline first, then section lines.
    if (!shouldHoldDraftChatAck(raw)) {
      void onTurnCompleteRef
        .current({ userText: lastUser.content, marker: parseCreateChatAction(raw) })
        .catch((err: unknown) => {
          setCanvasError(clawErrorText(err, 'Could not draft from chat. Try again.'));
        });
      return;
    }
    canvasStartedForUserRef.current = lastUser.id;
    void runCanvasTurn(lastUser.content, raw, lastBot.id).catch((err: unknown) => {
      setCanvasError(clawErrorText(err, 'Could not draft from chat. Try again.'));
    });
  }, [messages, streaming, runCanvasTurn]);

  // DEV proof hook: seed user/bot rows then run canvas-first pipeline (no live LLM).
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const host = window as Window & {
      __xyneCreateProofTurn?: (userText: string, visibleReply?: string) => Promise<void>;
    };
    host.__xyneCreateProofTurn = async (userText, visibleReply) => {
      setCanvasError(null);
      const raw = visibleReply ?? userText;
      const marker = parseCreateChatAction(raw);
      const action = decideCreateCanvasAction({
        userText,
        canvasEmpty: canvasRef.current.empty,
        marker,
      });
      const userId = `proof-user-${Date.now()}`;
      const botId = `proof-bot-${Date.now()}`;
      const holdAck =
        action.type === 'draft' || action.type === 'rename' || shouldHoldDraftChatAck(raw);
      const replyOnly = !holdAck;
      setMessages([
        {
          id: userId,
          type: 'user',
          content: userText,
          timestamp: new Date(),
        },
        {
          id: botId,
          type: 'bot',
          content: replyOnly ? marker.visible : '',
          streamingContent: replyOnly ? marker.visible : '',
          isStreaming: false,
          timestamp: new Date(),
        },
      ]);
      handledUserIdsRef.current.add(userId);
      canvasStartedForUserRef.current = userId;
      await onTurnCompleteRef.current({
        userText,
        marker,
        ...(holdAck
          ? {
              announceSection: (line: string) => {
                announceOnBot(botId, line);
              },
            }
          : {}),
      });
    };
    return (): void => {
      delete host.__xyneCreateProofTurn;
    };
  }, [announceOnBot]);

  const handleSubmit = useCallback(
    async (
      text: string,
      attachments?: AIComposerAttachment[],
      context?: ComposerContext,
      trigger?: 'button' | 'enter' | 'programmatic',
    ): Promise<void> => {
      const trimmed = text.trim();
      const hasAttachments = (attachments?.length ?? 0) > 0;
      if ((!trimmed && !hasAttachments) || disabled) return;
      setCanvasError(null);

      if (usesDraftStreamKeyRef.current && messages.length > 0 && !streaming) {
        setMessages([]);
        handledUserIdsRef.current.clear();
      }

      if (trimmed) onSend?.(trimmed);

      let parentMessageId: string | undefined;
      if (!usesDraftStreamKeyRef.current && messages.length > 0) {
        parentMessageId = messages[messages.length - 1]?.id;
      }

      await submitQuery(
        createModeQuery(trimmed, canvasRef.current),
        toMessageAttachments(attachments ?? []),
        undefined,
        trimmed,
        undefined,
        parentMessageId,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          ...(context ? toStreamOverrides(context) : {}),
          ...(trigger ? { trigger } : {}),
          instant: true,
          disableTools: true,
          // Ask AI default thinking — do not force 'off' (was synthetic phase labels only).
          thinkingLevel: context?.thinkingLevel ?? 'low',
        },
      );
    },
    [disabled, messages, onSend, streaming, submitQuery],
  );

  const empty = messages.length === 0 && !streaming && !canvasError;

  return (
    <CreateChatLayout
      empty={empty}
      canvasError={canvasError}
      messages={messages}
      bottomRef={bottomRef}
      pending={streaming || Boolean(disabled) || Boolean(progressLabel)}
      progressLabel={progressLabel}
      pane
      {...(streaming ? { onStop: abortCurrentRequest } : {})}
      onSubmit={(text, attachments, context, trigger) => {
        void handleSubmit(text, attachments, context, trigger);
      }}
    />
  );
}

function ScriptedAgentCreateChatPanel({
  scriptedMessages,
  scriptedDraft = '',
  scriptedPlaying = false,
  scriptedTyping = false,
  scriptedDone = false,
  onScriptedEngage,
  onScriptedReplay,
}: AgentCreateChatPanelProps): ReactElement {
  const composerRef = useRef<AIComposerHandle>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messages = scriptedMessages ?? [];
  const streaming = messages.some(message => message.isStreaming);
  const empty = messages.length === 0 && !streaming;
  const pending = scriptedPlaying && !scriptedTyping;

  useEffect(() => {
    if (scriptedDraft === '' && !scriptedPlaying && !scriptedTyping) return;
    composerRef.current?.setPrompt(scriptedDraft);
  }, [scriptedDraft, scriptedPlaying, scriptedTyping]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, scriptedDraft]);

  const engage = useCallback((): void => {
    onScriptedEngage?.();
  }, [onScriptedEngage]);

  return (
    <CreateChatLayout
      empty={empty}
      canvasError={null}
      messages={messages}
      bottomRef={bottomRef}
      pending={pending}
      autoFocus={false}
      composerRef={composerRef}
      scripted
      pane
      scriptedDone={scriptedDone && !scriptedPlaying}
      locked={scriptedPlaying}
      onEngage={engage}
      {...(onScriptedReplay ? { onReplay: onScriptedReplay } : {})}
      {...(pending ? { onStop: () => undefined } : {})}
      onSubmit={() => {
        if (!scriptedPlaying) engage();
      }}
    />
  );
}

function CreateChatLayout({
  empty,
  canvasError,
  messages,
  bottomRef,
  pending,
  onStop,
  onSubmit,
  autoFocus = true,
  composerRef,
  scripted = false,
  scriptedDone = false,
  locked = false,
  onReplay,
  onEngage,
  progressLabel = null,
  pane = false,
  conversational = false,
  renderReply,
  renderBeforeReply,
  renderAfterReply,
  composerSlot,
  composerSlotKey,
}: {
  empty: boolean;
  canvasError: string | null;
  messages: Message[];
  bottomRef: RefObject<HTMLDivElement | null>;
  pending: boolean;
  onStop?: () => void;
  onSubmit: (
    text: string,
    attachments?: AIComposerAttachment[],
    context?: ComposerContext,
    trigger?: 'button' | 'enter' | 'programmatic',
  ) => void;
  autoFocus?: boolean;
  composerRef?: Ref<AIComposerHandle>;
  scripted?: boolean;
  scriptedDone?: boolean;
  locked?: boolean;
  onReplay?: () => void;
  onEngage?: () => void;
  progressLabel?: string | null;
  /** Figma pane: no "Chat" bar. The empty state shows in every overlay version. */
  pane?: boolean;
  /**
   * Replies are real answers, not canvas acks: shown as written (no profile-dump
   * rewrite), and the page's progress row is the only live indicator.
   */
  conversational?: boolean;
  /** Renders a bot reply's text (markdown in the streamed chat). */
  renderReply?: (message: Message, text: string) => ReactNode;
  /** Above a bot reply: its research line. */
  renderBeforeReply?: (message: Message) => ReactNode;
  /** Under a bot reply: suggestion chips or a question card. */
  renderAfterReply?: (message: Message) => ReactNode;
  /** Shown in place of the composer (a question card waiting for an answer). */
  composerSlot?: ReactNode;
  /** Changes when the slot holds something new, so it animates in again. */
  composerSlotKey?: string;
}): ReactElement {
  return (
    <div
      className='flex h-full min-w-0 flex-col bg-background'
      data-component='AgentCreateChatPanel'
      {...(scripted
        ? {
            'data-scripted': 'true',
            'data-testid': 'scripted-create-player',
          }
        : {})}
    >
      {pane && !scriptedDone ? null : (
        <div className='flex h-11 flex-shrink-0 items-center justify-between gap-3 px-5'>
          {pane ? (
            <span />
          ) : (
            <span className='text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground'>
              Chat
            </span>
          )}
          {scriptedDone ? (
            <button
              type='button'
              onClick={onReplay}
              className='text-[11px] font-medium text-foreground underline-offset-2 hover:underline'
              data-testid='scripted-create-replay'
              data-track-category='AGENT_ARTIFACT'
              data-track-name='SCRIPTED_CREATE_REPLAY'
            >
              Replay
            </button>
          ) : null}
        </div>
      )}
      <div className='flex-1 overflow-y-auto'>
        {empty && !progressLabel ? (
          <CreateEmptyState />
        ) : (
          <ul className='flex flex-col pb-2'>
            {messages.map(message => {
              const rawText = message.content || message.streamingContent || '';
              const streamingText = conversational
                ? rawText
                : visibleCreateReply(rawText, Boolean(message.isStreaming));
              const hasReasoning =
                message.type === 'bot' &&
                typeof message.reasoning === 'string' &&
                message.reasoning.trim().length > 0;
              const thinking =
                message.type === 'bot' &&
                Boolean(message.isStreaming) &&
                streamingText.trim().length === 0 &&
                !hasReasoning &&
                !progressLabel;
              const thinkLabel =
                typeof message.statusMessage === 'string' && message.statusMessage.trim().length > 0
                  ? message.statusMessage
                  : 'Thinking…';
              return (
                <li
                  key={message.stableKey ?? message.id}
                  className={cn(
                    'group w-full',
                    message.type === 'user' ? 'flex justify-end px-2 py-3' : 'px-2 py-5',
                  )}
                >
                  {message.type === 'user' ? (
                    <div className='flex max-w-[78%] flex-col items-end'>
                      <div className='ai-user-bubble max-w-full rounded-3xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground'>
                        <p className='whitespace-pre-wrap'>{message.content}</p>
                      </div>
                    </div>
                  ) : scripted ? (
                    <div className='flex min-w-0 flex-col gap-2'>
                      {thinking ? (
                        <ScriptedThinkLabel />
                      ) : message.isStreaming ? (
                        <div
                          className='-ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground'
                          data-testid='agent-create-chat-thinking'
                        >
                          <BuildOrb />
                          <span className='select-none'>
                            <AnimatedLabel text={thinkLabel} />
                          </span>
                        </div>
                      ) : null}
                      {message.errorInfo ? (
                        <p className='text-sm leading-5 text-destructive' role='alert'>
                          {message.errorInfo.message || message.errorInfo.title}
                        </p>
                      ) : streamingText.trim().length > 0 ? (
                        <p
                          className='bot-markdown-content xyne-ai-markdown whitespace-pre-wrap text-sm font-normal leading-7 text-foreground'
                          data-testid='agent-create-chat-reply'
                        >
                          {streamingText}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      className='flex min-w-0 flex-col gap-2'
                      data-testid='agent-create-chat-bot'
                    >
                      {hasReasoning ||
                      (!conversational && message.isStreaming && !progressLabel) ? (
                        <div data-testid='agent-create-chat-reasoning'>
                          <ActivityBlock
                            reasoning={message.reasoning ?? ''}
                            streaming={Boolean(message.isStreaming)}
                            toolInvocations={message.toolInvocations}
                            messageAborted={Boolean(message.isAborted)}
                            liveIndicator={<BuildOrb />}
                          />
                        </div>
                      ) : thinking ? (
                        <WorkingProgressRow label={thinkLabel} />
                      ) : null}
                      {renderBeforeReply?.(message)}
                      {message.errorInfo ? (
                        <p className='text-sm leading-5 text-destructive' role='alert'>
                          {message.errorInfo.message || message.errorInfo.title}
                        </p>
                      ) : streamingText.trim().length > 0 ? (
                        renderReply ? (
                          renderReply(message, streamingText)
                        ) : (
                          <p
                            className='whitespace-pre-wrap text-sm leading-relaxed text-foreground'
                            data-testid='agent-create-chat-reply'
                          >
                            {streamingText}
                          </p>
                        )
                      ) : null}
                      {renderAfterReply?.(message)}
                    </div>
                  )}
                </li>
              );
            })}
            {progressLabel ? (
              <li className='px-2 py-3'>
                <WorkingProgressRow label={progressLabel} />
              </li>
            ) : null}
            {canvasError ? (
              <li className='px-2 pb-4'>
                <p className='text-sm leading-5 text-destructive' role='alert'>
                  {canvasError}
                </p>
              </li>
            ) : null}
            <div ref={bottomRef} />
          </ul>
        )}
        {empty && canvasError ? (
          <p className='px-5 pb-3 text-sm leading-5 text-destructive' role='alert'>
            {canvasError}
          </p>
        ) : null}
      </div>
      <div
        className='flex-shrink-0 px-[11px] pb-[11px]'
        {...(scripted
          ? {
              onPointerDownCapture: onEngage,
              onFocusCapture: onEngage,
            }
          : {})}
        {...(locked
          ? {
              onKeyDownCapture: (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Tab') return;
                event.preventDefault();
                event.stopPropagation();
              },
              onPasteCapture: (event: ClipboardEvent<HTMLDivElement>) => {
                event.preventDefault();
                event.stopPropagation();
              },
            }
          : {})}
      >
        <AnimatePresence initial={false} mode='wait'>
          {composerSlot ? (
            <motion.div
              key={composerSlotKey ?? 'slot'}
              initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.14, ease: 'easeOut' } }}
              transition={{ type: 'spring', visualDuration: 0.32, bounce: 0.12 }}
            >
              {composerSlot}
            </motion.div>
          ) : (
            <motion.div
              key='composer'
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.14, ease: 'easeOut' } }}
              transition={{ type: 'spring', visualDuration: 0.28, bounce: 0 }}
            >
              <AIComposer
                ref={composerRef}
                appearance='create'
                autoFocus={autoFocus}
                placeholder='Describe what agent you want to build...'
                hideDisclaimer
                showAgentSelector={false}
                pending={pending}
                {...(onStop ? { onStop } : {})}
                onSubmit={onSubmit}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
