import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { AIComposer, type AIComposerAttachment } from '@/components/AIScreen/AIComposer';
import { AIEmptyState } from '@/components/AIScreen/AIEmptyState';
import { type ComposerContext, toStreamOverrides } from '@/components/AIScreen/composerContext';
import type { Message, MessageAttachment } from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import { useXyneAIStream } from '@/hooks/useXyneAIStream';
import { xyneAIStreamManager } from '@/services/XyneAI';
import { clawErrorText } from '@/services/claw/clawRequest';
import { cn } from '@/utils/classNames';
import { buildXyneAIStreamThreadId, newStreamSlotKey } from '@/utils/xyneAIStreamThreadId';
import {
  createModeQuery,
  parseCreateChatAction,
  visibleCreateReply,
  type CreateCanvasSnapshot,
  type ParsedCreateChatAction,
} from './createChatMode';

const toMessageAttachments = (attachments: AIComposerAttachment[]): MessageAttachment[] =>
  attachments.map(att => ({
    filename: att.filename,
    mimeType: att.mimeType,
    data: att.data,
  }));

export interface CreateChatTurn {
  userText: string;
  marker: ParsedCreateChatAction;
}

interface AgentCreateChatPanelProps {
  canvas: CreateCanvasSnapshot;
  onTurnComplete: (turn: CreateChatTurn) => Promise<void>;
  disabled?: boolean;
}

export function AgentCreateChatPanel({
  canvas,
  onTurnComplete,
  disabled,
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
  }, [messages, conversationId, streamThreadKey]);

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
    const marker = parseCreateChatAction(raw);
    void onTurnCompleteRef.current({ userText: lastUser.content, marker }).catch((err: unknown) => {
      setCanvasError(clawErrorText(err, 'Could not draft from chat. Try again.'));
    });
  }, [messages, streaming]);

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
        },
      );
    },
    [disabled, messages, streaming, submitQuery],
  );

  const empty = messages.length === 0 && !streaming && !canvasError;

  return (
    <div
      className='flex h-full min-w-0 flex-col bg-background'
      data-component='AgentCreateChatPanel'
    >
      <div className='flex h-11 flex-shrink-0 items-center px-5'>
        <span className='text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground'>
          Chat
        </span>
      </div>
      <div className='flex-1 overflow-y-auto'>
        {empty ? (
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
              const thinking =
                message.type === 'bot' &&
                Boolean(message.isStreaming) &&
                streamingText.trim().length === 0;
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
                  ) : thinking ? (
                    <div
                      className='flex items-center gap-2 text-sm text-muted-foreground'
                      data-testid='agent-create-chat-thinking'
                    >
                      <Loader2 className='size-4 animate-spin' aria-hidden />
                      <span>{message.statusMessage || 'Thinking…'}</span>
                    </div>
                  ) : (
                    <div>
                      {message.errorInfo ? (
                        <p className='text-sm leading-5 text-destructive' role='alert'>
                          {message.errorInfo.message || message.errorInfo.title}
                        </p>
                      ) : (
                        <p
                          className='whitespace-pre-wrap text-sm leading-relaxed text-foreground'
                          data-testid='agent-create-chat-reply'
                        >
                          {streamingText}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
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
      <div className='flex-shrink-0 px-3 pb-3 pt-1'>
        <AIComposer
          autoFocus
          placeholder='Ask anything'
          hideDisclaimer
          showAgentSelector={false}
          pending={streaming || Boolean(disabled)}
          {...(streaming ? { onStop: abortCurrentRequest } : {})}
          onSubmit={(text, attachments, context, trigger) => {
            void handleSubmit(text, attachments, context, trigger);
          }}
        />
      </div>
    </div>
  );
}
