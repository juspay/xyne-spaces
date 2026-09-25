import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  type RefObject,
} from 'react';
import {
  AIComposer,
  type AIComposerAttachment,
  type AIComposerHandle,
} from '@/components/AIScreen/AIComposer';
import { AIEmptyState } from '@/components/AIScreen/AIEmptyState';
import {
  AnimatedLabel,
  BrailleLoader,
  useStableLabel,
} from '@/components/AIScreen/ReasoningLoader';
import { ActivityBlock } from '@/components/Chat/XyneAISidebar/components/ActivityBlock';
import { type ComposerContext, toStreamOverrides } from '@/components/AIScreen/composerContext';
import type { Message, MessageAttachment } from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import { useXyneAIStream } from '@/hooks/useXyneAIStream';
import { xyneAIStreamManager } from '@/services/XyneAI';
import { clawErrorText } from '@/services/claw/clawRequest';
import { cn } from '@/utils/classNames';
import { buildXyneAIStreamThreadId, newStreamSlotKey } from '@/utils/xyneAIStreamThreadId';
import {
  createModeQuery,
  decideCreateCanvasAction,
  parseCreateChatAction,
  resolveWalkCreateAction,
  shouldHoldDraftChatAck,
  visibleCreateReply,
  type CreateCanvasSnapshot,
  type ParsedCreateChatAction,
} from './createChatMode';

const SCRIPTED_THINK_PHASES = ['Thinking', 'Weighing it up', 'Reasoning'] as const;
const SCRIPTED_THINK_PHASE_MS = 1600;

function WorkingProgressRow({ label }: { label: string }): ReactElement {
  const stable = useStableLabel(label);
  return (
    <div
      className='-ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground'
      data-testid='agent-create-progress'
      data-progress-label={label}
    >
      <BrailleLoader />
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
      <BrailleLoader />
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

export interface CreateChatTurn {
  userText: string;
  marker: ParsedCreateChatAction;
  /** Append a short line after a canvas section lands (canvas-first order). */
  announceSection?: (line: string) => void;
}

interface AgentCreateChatPanelProps {
  canvas: CreateCanvasSnapshot;
  onTurnComplete: (turn: CreateChatTurn) => Promise<void>;
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
  return <LiveAgentCreateChatPanel {...props} />;
}

function LiveAgentCreateChatPanel({
  canvas,
  onTurnComplete,
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
      const walk = resolveWalkCreateAction(userText);
      const raw =
        walk && walk.type === 'draft'
          ? `${walk.visibleReply || visibleReply || ''}\nXYNE_CREATE_DRAFT: ${walk.intent}`
          : (visibleReply ?? userText);
      const marker = parseCreateChatAction(raw);
      const action =
        walk ??
        decideCreateCanvasAction({
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
    [disabled, messages, streaming, submitQuery],
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
      <div className='flex h-11 flex-shrink-0 items-center justify-between gap-3 px-5'>
        <span className='text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground'>
          Chat
        </span>
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
      <div className='flex-1 overflow-y-auto'>
        {empty && !progressLabel ? (
          <div className='flex h-full min-h-[12rem] flex-col items-center justify-center px-6'>
            <AIEmptyState />
            <p
              className='mt-3 text-center text-sm leading-5 text-muted-foreground'
              data-testid='agent-create-empty-hint'
            >
              The canvas on the right is the agent.
            </p>
          </div>
        ) : (
          <ul className='flex flex-col pb-2'>
            {messages.map(message => {
              const streamingText = visibleCreateReply(
                message.content || message.streamingContent || '',
                Boolean(message.isStreaming),
              );
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
                      <div className='ai-user-bubble max-w-full rounded-3xl bg-[#ececec] px-4 py-2.5 text-sm leading-relaxed text-gray-900'>
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
                          <BrailleLoader />
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
                      {hasReasoning || (message.isStreaming && !progressLabel) ? (
                        <div data-testid='agent-create-chat-reasoning'>
                          <ActivityBlock
                            reasoning={message.reasoning ?? ''}
                            streaming={Boolean(message.isStreaming)}
                            toolInvocations={message.toolInvocations}
                            messageAborted={Boolean(message.isAborted)}
                          />
                        </div>
                      ) : thinking ? (
                        <WorkingProgressRow label={thinkLabel} />
                      ) : null}
                      {message.errorInfo ? (
                        <p className='text-sm leading-5 text-destructive' role='alert'>
                          {message.errorInfo.message || message.errorInfo.title}
                        </p>
                      ) : streamingText.trim().length > 0 ? (
                        <p
                          className='whitespace-pre-wrap text-sm leading-relaxed text-foreground'
                          data-testid='agent-create-chat-reply'
                        >
                          {streamingText}
                        </p>
                      ) : null}
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
        className='flex-shrink-0 px-3 pb-3 pt-1'
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
        <AIComposer
          ref={composerRef}
          autoFocus={autoFocus}
          placeholder='Ask anything'
          hideDisclaimer
          showAgentSelector={false}
          pending={pending}
          {...(onStop ? { onStop } : {})}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}
