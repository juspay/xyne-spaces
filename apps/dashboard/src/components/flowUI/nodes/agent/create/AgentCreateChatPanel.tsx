import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { AnimatePresence, motion } from 'motion/react';
import { AIComposer, type AIComposerAttachment } from '@/components/AIScreen/AIComposer';
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
import { BuildConnectCards } from './BuildConnectCards';
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

/**
 * Keeps the transcript at the bottom while it grows, if it was there. The
 * scroll to a new message runs before late parts of it have any height (a
 * connect card waits for the connector catalog), which would leave them cut
 * off under the composer. Scrolling up to read stops it until the bottom is
 * reached again.
 */
function useStickToBottom(): {
  listRef: (node: HTMLUListElement | null) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
} {
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const scroller = list?.parentElement;
    if (!list || !scroller) return undefined;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [list]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);

  return { listRef: setList, onScroll };
}

/** Side padding shared by the transcript and the composer, so their edges line up. */
const CHAT_GUTTER = 'px-[11px]';

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
  /** Connectors this turn added that need the user's key, as connect cards under the reply. */
  connectors: (slugs: string[]) => void;
}

export interface IncomingBuildMessage {
  id: string;
  text: string;
}

/**
 * Sends incoming messages one at a time whenever the chat is free. Each id is
 * sent once, even if the effect runs twice.
 */
function useIncomingMessages(
  incoming: ReadonlyArray<IncomingBuildMessage> | undefined,
  ready: boolean,
  send: (text: string) => Promise<void>,
  onPhase: ((id: string, phase: 'running' | 'done') => void) | undefined,
): void {
  const startedRef = useRef(new Set<string>());
  const sendRef = useRef(send);
  sendRef.current = send;
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;
  const next = incoming?.find(message => !startedRef.current.has(message.id));
  useEffect(() => {
    if (!ready || !next || startedRef.current.has(next.id)) return;
    startedRef.current.add(next.id);
    onPhaseRef.current?.(next.id, 'running');
    void sendRef
      .current(next.text)
      .catch(() => undefined)
      .finally(() => onPhaseRef.current?.(next.id, 'done'));
  }, [next, ready]);
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
  /**
   * Messages sent here from elsewhere on the page (the test chat's Build and
   * Add buttons), oldest first. Each is sent once the chat is free.
   */
  incoming?: ReadonlyArray<IncomingBuildMessage>;
  /** Reports when an incoming message starts and when its turn ends. */
  onIncomingPhase?: (id: string, phase: 'running' | 'done') => void;
  disabled?: boolean;
  /** Live draft pipeline phase — Braille + AnimatedLabel, not chat bubbles. */
  progressLabel?: string | null;
  /** Changing a saved agent rather than building one: the empty state and hint say so. */
  editing?: boolean;
}

export function AgentCreateChatPanel(props: AgentCreateChatPanelProps): ReactElement {
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
  incoming,
  onIncomingPhase,
  disabled,
  progressLabel = null,
  editing = false,
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
          connectors: slugs => updateExtras(botId, prior => ({ ...prior, connect: slugs })),
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
  useIncomingMessages(incoming, !busy, submit, onIncomingPhase);
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
      editing={editing}
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
            {turn.connect?.length ? <BuildConnectCards slugs={turn.connect} /> : null}
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
  incoming,
  onIncomingPhase,
  disabled,
  progressLabel = null,
  editing = false,
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

  useIncomingMessages(
    incoming,
    !streaming && !disabled && !progressLabel,
    text => handleSubmit(text, [], undefined, 'programmatic'),
    onIncomingPhase,
  );

  const empty = messages.length === 0 && !streaming && !canvasError;

  return (
    <CreateChatLayout
      editing={editing}
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

function CreateChatLayout({
  editing = false,
  empty,
  canvasError,
  messages,
  bottomRef,
  pending,
  onStop,
  onSubmit,
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
  /** Changing a saved agent: the empty state and hint ask what to change. */
  editing?: boolean;
}): ReactElement {
  const pinned = useStickToBottom();
  return (
    <div
      className='flex h-full min-w-0 flex-col bg-background'
      data-component='AgentCreateChatPanel'
    >
      {pane ? null : (
        <div className='flex h-11 flex-shrink-0 items-center gap-3 px-5'>
          <span className='text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground'>
            Chat
          </span>
        </div>
      )}
      <div className='flex-1 overflow-y-auto' onScroll={pinned.onScroll}>
        {empty && !progressLabel ? (
          <CreateEmptyState {...(editing ? { title: 'What should change?' } : {})} />
        ) : (
          <ul ref={pinned.listRef} className='flex flex-col pb-2'>
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
                    CHAT_GUTTER,
                    message.type === 'user' ? 'flex justify-end py-3' : 'py-5',
                  )}
                >
                  {message.type === 'user' ? (
                    <div className='flex max-w-[78%] flex-col items-end'>
                      <div className='ai-user-bubble max-w-full rounded-3xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground'>
                        <p className='whitespace-pre-wrap'>{message.content}</p>
                      </div>
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
              <li className={cn(CHAT_GUTTER, 'py-3')}>
                <WorkingProgressRow label={progressLabel} />
              </li>
            ) : null}
            {canvasError ? (
              <li className={cn(CHAT_GUTTER, 'pb-4')}>
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
      <div className={cn(CHAT_GUTTER, 'flex-shrink-0 pb-[11px]')}>
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
                appearance='create'
                autoFocus
                placeholder={
                  editing ? 'Describe what to change…' : 'Describe what agent you want to build...'
                }
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
