import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { FileText } from '@xyne/icons';
import { BuildReplyMarkdown } from './BuildChatExtras';
import { ThinkingStatus } from './DraftChatComposer';
import type { DraftChatMessage } from './useDraftChat';

/** Closer than this to the bottom counts as "at the bottom". */
const PINNED_SLACK_PX = 24;

/**
 * The thread in the floating chat. It follows the newest message while you are
 * at the bottom, including when the composer grows and takes room from it;
 * scroll up and it stays where you left it.
 */
export function DraftChatTranscript({
  messages,
  avatar,
  emptyLabel,
  renderAfterReply,
}: {
  messages: DraftChatMessage[];
  /** The agent's face, at `size` px; `busy` while it is thinking. */
  avatar: (size: number, busy: boolean) => ReactNode;
  /** Under the face when nothing has been said yet. */
  emptyLabel: string;
  /**
   * Under a finished reply. `request` is the user message it answers; `latest`
   * is true for the newest reply only.
   */
  renderAfterReply?: (
    message: DraftChatMessage,
    context: { request: string; latest: boolean },
  ) => ReactNode;
}): ReactElement {
  const listRef = useRef<HTMLUListElement | null>(null);
  const pinnedRef = useRef(true);
  const lastUserId = [...messages].reverse().find(message => message.role === 'user')?.id;
  const lastReplyId = [...messages].reverse().find(message => message.role === 'assistant')?.id;
  const empty = messages.length === 0;

  // A message you just sent always brings you back to the bottom.
  useLayoutEffect(() => {
    pinnedRef.current = true;
  }, [lastUserId]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const follow = (): void => {
      if (pinnedRef.current) list.scrollTop = list.scrollHeight;
    };
    const resize = new ResizeObserver(follow);
    resize.observe(list);
    // Rows and buttons that appear under a finished reply don't change `messages`.
    const mutation = new MutationObserver(follow);
    mutation.observe(list, { childList: true, subtree: true });
    return (): void => {
      resize.disconnect();
      mutation.disconnect();
    };
    // The list only exists once there are messages.
  }, [empty]);

  if (empty) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
        {avatar(48, false)}
        <p className='text-sm text-muted-foreground'>{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      onScroll={event => {
        const list = event.currentTarget;
        pinnedRef.current =
          list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_SLACK_PX;
      }}
      className='flex h-full flex-col overflow-y-auto px-3 pb-3 pt-2'
      data-testid='draft-chat-transcript'
    >
      {messages.map((message, index) => (
        <li key={message.id} className={message.role === 'user' ? 'flex justify-end py-2' : 'py-3'}>
          {message.role === 'user' ? (
            <div className='flex max-w-[78%] flex-col items-end gap-1'>
              {message.files?.length ? (
                <ul className='flex flex-wrap justify-end gap-1'>
                  {message.files.map((name, index) => (
                    <li
                      key={`${index}-${name}`}
                      className='inline-flex h-6 max-w-[200px] items-center gap-1 rounded-lg bg-foreground/[0.06] px-2 text-xs text-foreground'
                    >
                      <FileText className='size-3 shrink-0 text-foreground/60' aria-hidden />
                      <span className='min-w-0 truncate'>{name}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className='max-w-full rounded-3xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground'>
                <p className='whitespace-pre-wrap'>{message.content}</p>
              </div>
            </div>
          ) : (
            <div className='flex min-w-0 flex-col gap-2'>
              {message.streaming && message.content.length === 0 && !message.error ? (
                <ThinkingStatus avatar={avatar(22, true)} replying={false} />
              ) : message.content.length > 0 ? (
                <BuildReplyMarkdown id={message.id} content={message.content} streamed />
              ) : null}
              {message.error ? (
                <p className='text-sm leading-5 text-destructive' role='alert'>
                  {message.error}
                </p>
              ) : null}
              {renderAfterReply && !message.streaming
                ? renderAfterReply(message, {
                    request:
                      messages
                        .slice(0, index)
                        .reverse()
                        .find(prior => prior.role === 'user')?.content ?? '',
                    latest: message.id === lastReplyId,
                  })
                : null}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
