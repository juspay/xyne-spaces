import { ReactElement, ReactNode, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  CornerDownLeft,
  Hash,
  AtSign,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowLeft,
  Pencil,
  X,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { XyneAIStar } from '../../icons/xyne-ai';
import { cn } from '../../../utils/classNames';
import { useUser } from '../../../hooks/useUsers';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { TwinReasoningPopover } from './TwinReasoningPopover';
import type { TwinReplyDraftView, PostedTarget } from './twinReplyDraftApi';
import type { AssistTab } from './useThreadAssist';

const expand = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: 6, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } },
} as const;

const bodySpring = { type: 'spring', bounce: 0.2, duration: 0.4 } as const;

const swap = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, x: -12, transition: { duration: 0.13, ease: [0.4, 0, 1, 1] } },
} as const;

export interface TwinSourceInfo {
  /** Id of the person being replied to — resolves the real profile picture. */
  userId?: string;
  name?: string;
  text?: string;
  onJump?: () => void;
}

/** Sender chip for the collapsed bar: the name we show plus, when known, the id. */
interface DraftSender {
  name: string;
  userId?: string;
}

interface ThreadAssistDockProps {
  hasRecap: boolean;
  hasReply: boolean;
  tab: AssistTab;
  onTabChange: (t: AssistTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  recap: { content: string | undefined; loading: boolean };
  reply: {
    drafts: TwinReplyDraftView[];
    pending: ReadonlySet<string>;
    approve: (draftId: string, edited?: string) => Promise<PostedTarget | null>;
    decline: (draftId: string) => Promise<void>;
  };
  onPosted: (target: PostedTarget | null) => void;
  onReasoningOpenChange: (draft: TwinReplyDraftView, open: boolean) => void;
  reasoningOpen?: boolean;
  /** Conversation the reasoning popover's debug tab reads its session from. */
  conversationId: string;
  resolveSource?: (draft: TwinReplyDraftView) => TwinSourceInfo;
  attached?: boolean;
  onBeginEdit?: (draft: TwinReplyDraftView) => void;
  onEditBack?: () => void;
}

export function ThreadAssistDock({
  hasRecap,
  hasReply,
  tab,
  onTabChange,
  collapsed,
  onToggleCollapse,
  recap,
  reply,
  onPosted,
  onReasoningOpenChange,
  reasoningOpen = false,
  conversationId,
  resolveSource,
  attached = true,
  onBeginEdit,
  onEditBack,
}: ThreadAssistDockProps): ReactElement {
  const drafts = reply.drafts;
  const replyCount = drafts.length;
  const [sel, setSel] = useState(0);
  const convId = drafts[0]?.conversationId;
  const convRef = useRef(convId);
  if (convRef.current !== convId) {
    convRef.current = convId;
    if (sel !== 0) setSel(0);
  }
  const active = replyCount > 0 ? Math.min(sel, replyCount - 1) : 0;
  const selectedDraft = tab === 'reply' && replyCount > 0 ? drafts[active] : undefined;
  const selectedSource = selectedDraft ? resolveSource?.(selectedDraft) : undefined;

  const senders = useMemo(() => {
    const seen = new Set<string>();
    const list: DraftSender[] = [];
    for (const d of drafts) {
      const src = resolveSource?.(d);
      const name = (src?.name ?? d.senderName ?? '').trim();
      // Key on the id when we have one: two distinct users can share a display
      // name, and collapsing them would show the first one's real photo for both.
      const key = src?.userId ?? name;
      if (name && !seen.has(key)) {
        seen.add(key);
        list.push({ name, ...(src?.userId && { userId: src.userId }) });
      }
    }
    return list;
  }, [drafts, resolveSource]);

  const goTo = (index: number): void => {
    setSel(Math.max(0, Math.min(index, replyCount - 1)));
  };

  const headerName = selectedSource?.name ?? selectedDraft?.senderName;
  const editing = !!onEditBack;
  const bodyOpen = !collapsed && !editing;

  return (
    <motion.div
      variants={expand}
      initial='initial'
      animate='animate'
      exit='exit'
      className={attached ? '-mb-3' : undefined}
    >
      <div
        className={cn(
          'overflow-hidden border border-input bg-card',
          attached ? 'rounded-t-2xl border-b-0' : 'rounded-2xl',
        )}
      >
        {/* One tint layer for every state. The collapsed bar used to carry
            `bg-muted/60` itself, which made it read darker than the expanded
            body sitting on bare `bg-card`; hoisting it here keeps collapsed and
            expanded identical, and preserves the collapsed tone exactly (it is
            still muted/60 composited over card). */}
        <div className='bg-muted/60'>
          {editing ? (
            <EditHeader senderName={headerName} onBack={onEditBack} />
          ) : collapsed ? (
            <CollapsedBar
              hasReply={hasReply}
              replyCount={replyCount}
              senders={senders}
              recapLabel={hasRecap ? 'Thread recap' : 'Suggested reply'}
              onExpand={onToggleCollapse}
            />
          ) : (
            <ExpandedHeader
              tab={tab}
              hasRecap={hasRecap}
              hasReply={hasReply}
              replyCount={replyCount}
              active={active}
              senderName={headerName}
              onGoTo={goTo}
              onTabChange={onTabChange}
              onCollapse={onToggleCollapse}
            />
          )}

          <AnimatePresence initial={false}>
            {bodyOpen && (
              <motion.div
                key='body'
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ height: bodySpring, opacity: { duration: 0.15 } }}
                className='overflow-hidden'
              >
                {/* When attached, the shell is pulled 12px into the composer (-mb-3),
                  so pb-3 would leave the Send button sitting on the composer's top
                  border. pb-5 buys back a real gap. */}
                <div className={cn('px-3.5 pt-2', attached ? 'pb-5' : 'pb-3')}>
                  {tab === 'recap' ? (
                    <RecapPane content={recap.content} loading={recap.loading} />
                  ) : selectedDraft ? (
                    <AnimatePresence mode='wait' initial={false}>
                      <motion.div
                        key={selectedDraft.id}
                        variants={swap}
                        initial='initial'
                        animate='animate'
                        exit='exit'
                      >
                        <ReplyCard
                          draft={selectedDraft}
                          source={selectedSource}
                          loading={reply.pending.has(selectedDraft.id)}
                          approve={edited => reply.approve(selectedDraft.id, edited)}
                          decline={() => reply.decline(selectedDraft.id)}
                          onPosted={onPosted}
                          onReasoningOpenChange={next => onReasoningOpenChange(selectedDraft, next)}
                          reasoningOpen={reasoningOpen}
                          conversationId={conversationId}
                          {...(onBeginEdit && { onBeginEdit: () => onBeginEdit(selectedDraft) })}
                        />
                      </motion.div>
                    </AnimatePresence>
                  ) : (
                    <div className='text-sm text-muted-foreground'>No reply draft.</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function EditHeader({
  senderName,
  onBack,
}: {
  senderName?: string | undefined;
  onBack: () => void;
}): ReactElement {
  return (
    <div className='relative flex h-[42px] select-none items-center gap-1.5 px-2 pb-3'>
      <button
        type='button'
        onClick={onBack}
        aria-label='Back to drafts'
        data-track-category='twin-dock'
        data-track-name='edit-back'
        className='absolute inset-0 cursor-pointer transition-colors hover:bg-muted/20'
      />
      <span className='pointer-events-none relative flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground'>
        <ArrowLeft size={16} />
      </span>
      <span className='pointer-events-none relative flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-foreground'>
        <span className='flex shrink-0'>
          <XyneAIStar size={14} />
        </span>
        <span className='truncate'>
          Editing draft
          {senderName ? (
            <span className='font-normal text-muted-foreground/70'> · reply to {senderName}</span>
          ) : null}
        </span>
      </span>
    </div>
  );
}

function CollapsedBar({
  hasReply,
  replyCount,
  senders,
  recapLabel,
  onExpand,
}: {
  hasReply: boolean;
  replyCount: number;
  senders: DraftSender[];
  recapLabel: string;
  onExpand: () => void;
}): ReactElement {
  if (hasReply) {
    return (
      <button
        onClick={onExpand}
        aria-label='Expand AI replies'
        data-track-category='twin-dock'
        data-track-name='expand'
        className='flex h-[42px] w-full select-none items-center gap-2 px-3 pb-3 text-left transition-colors hover:bg-muted'
      >
        <span className='flex shrink-0'>
          <XyneAIStar size={14} />
        </span>
        <span className='shrink-0 text-[13px] font-semibold text-foreground'>
          {replyCount === 1 ? '1 AI reply ready' : `${replyCount} AI replies ready`}
        </span>
        {senders.length > 0 && (
          <>
            <AvatarCluster senders={senders} />
            <span className='min-w-0 truncate text-[13px] text-muted-foreground'>
              {senders.map(s => s.name).join(', ')}
            </span>
          </>
        )}
        <ChevronUp size={15} className='ml-auto shrink-0 text-muted-foreground' />
      </button>
    );
  }
  return (
    <button
      onClick={onExpand}
      aria-label='Expand'
      data-track-category='twin-dock'
      data-track-name='expand'
      className='flex h-[42px] w-full select-none items-center gap-2.5 px-3 pb-3 text-left transition-colors hover:bg-muted'
    >
      <span className='text-xs font-semibold text-foreground'>{recapLabel}</span>
      <ChevronUp size={15} className='ml-auto text-muted-foreground' />
    </button>
  );
}

function ExpandedHeader({
  tab,
  hasRecap,
  hasReply,
  replyCount,
  active,
  senderName,
  onGoTo,
  onTabChange,
  onCollapse,
}: {
  tab: AssistTab;
  hasRecap: boolean;
  hasReply: boolean;
  replyCount: number;
  active: number;
  senderName?: string | undefined;
  onGoTo: (index: number) => void;
  onTabChange: (t: AssistTab) => void;
  onCollapse: () => void;
}): ReactElement {
  const showToggle = hasRecap && hasReply;
  return (
    <div className='relative flex h-9 select-none items-center gap-2 border-b border-border px-3'>
      <button
        type='button'
        onClick={onCollapse}
        aria-label='Collapse'
        data-track-category='twin-dock'
        data-track-name='collapse'
        className='absolute inset-0 cursor-pointer transition-colors hover:bg-muted/30'
      />
      {showToggle ? (
        <div className='pointer-events-auto relative flex items-center gap-1'>
          <HeaderTab
            active={tab === 'reply'}
            onClick={() => onTabChange('reply')}
            icon={<XyneAIStar size={13} />}
            label='Replies'
          />
          <HeaderTab active={tab === 'recap'} onClick={() => onTabChange('recap')} label='Recap' />
        </div>
      ) : tab === 'recap' ? (
        <span className='pointer-events-none relative text-[13px] font-semibold text-foreground'>
          Thread recap
        </span>
      ) : (
        <span className='pointer-events-none relative flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-foreground'>
          <span className='flex shrink-0'>
            <XyneAIStar size={14} />
          </span>
          <span className='truncate'>
            {senderName ? `Reply to ${senderName}` : 'Suggested reply'}
          </span>
        </span>
      )}

      <div className='pointer-events-none relative ml-auto flex items-center gap-1.5'>
        {tab === 'reply' && replyCount > 1 && (
          <Pager active={active} total={replyCount} onGoTo={onGoTo} />
        )}
        <ChevronDown size={16} className='text-muted-foreground' />
      </div>
    </div>
  );
}

function HeaderTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactElement;
  label: string;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      data-track-category='twin-dock'
      data-track-name={`tab-${label.toLowerCase()}`}
      className={cn(
        'pointer-events-auto flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors',
        active
          ? 'bg-muted font-semibold text-foreground'
          : 'font-medium text-muted-foreground hover:bg-muted/50',
      )}
    >
      {icon && <span className='flex shrink-0'>{icon}</span>}
      {label}
    </button>
  );
}

function AvatarCluster({ senders }: { senders: DraftSender[] }): ReactElement {
  return (
    <div className='flex shrink-0 -space-x-1.5'>
      {senders.slice(0, 3).map((s, i) => (
        <SourceAvatar
          key={`${s.name}-${i}`}
          name={s.name}
          {...(s.userId && { userId: s.userId })}
        />
      ))}
    </div>
  );
}

function Pager({
  active,
  total,
  onGoTo,
}: {
  active: number;
  total: number;
  onGoTo: (index: number) => void;
}): ReactElement {
  const btn =
    'pointer-events-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';
  return (
    <div className='flex items-center'>
      <button
        onClick={() => onGoTo((active - 1 + total) % total)}
        aria-label='Previous draft'
        data-track-category='twin-dock'
        data-track-name='pager-prev'
        className={btn}
      >
        <ChevronLeft size={14} />
      </button>
      <span
        role='status'
        aria-live='polite'
        className='min-w-[34px] text-center text-[11px] tabular-nums text-muted-foreground'
      >
        {active + 1} / {total}
      </span>
      <button
        onClick={() => onGoTo((active + 1) % total)}
        aria-label='Next draft'
        data-track-category='twin-dock'
        data-track-name='pager-next'
        className={btn}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

/**
 * The sender being replied to, rendered with the shared `Avatar` primitive so the
 * profile picture and the identity colour agree with the rest of the app. `useUser`
 * only resolves against the loaded workspace roster, so an unknown id would render
 * `Avatar`'s blank-initials-over-a-hashed-colour state — we fall back to a neutral
 * initial instead, keeping the identity colour either correct or absent, never wrong.
 */
function SourceAvatar({
  userId,
  name,
}: {
  userId?: string | undefined;
  name?: string | undefined;
}): ReactElement {
  const user = useUser(userId ?? '');
  if (userId && user) {
    return <Avatar userId={userId} size='xs' rounded showActiveStatus={false} />;
  }
  const initial = ((name ?? '').trim()[0] ?? '?').toUpperCase();
  return (
    <span className='inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-semibold uppercase leading-none text-muted-foreground'>
      {initial}
    </span>
  );
}

function RecapPane({
  content,
  loading,
}: {
  content: string | undefined;
  loading: boolean;
}): ReactElement {
  const markdownComponents = useMemo(() => createMarkdownComponents('thread-recap'), []);
  return (
    <div className='max-h-56 overflow-y-auto'>
      <div className='text-[13px] font-normal leading-relaxed text-muted-foreground [&_h1]:text-[13px] [&_h1]:font-medium [&_h2]:text-[13px] [&_h2]:font-medium [&_h3]:text-[13px] [&_h3]:font-medium [&_h1]:text-foreground/80 [&_h2]:text-foreground/80 [&_h3]:text-foreground/80 [&_strong]:font-medium [&_strong]:text-foreground/80 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5'>
        {content ? (
          <MarkdownMessageRenderer content={content} markdownComponents={markdownComponents} />
        ) : loading ? (
          <span className='flex items-center gap-2'>
            <Loader2 size={14} className='animate-spin' /> Generating summary…
          </span>
        ) : (
          <span>No summary available for this thread yet.</span>
        )}
      </div>
    </div>
  );
}

function destinationInfo(draft: TwinReplyDraftView): {
  icon: ReactElement;
  verb: string;
  where: ReactElement;
} {
  const chan = draft.destinationChannelName;
  const B = ({ children }: { children: ReactNode }) => (
    <b className='font-medium text-muted-foreground/80'>{children}</b>
  );
  switch (draft.destinationKind) {
    case 'origin_channel':
      return {
        icon: <Hash size={12} />,
        verb: 'post',
        where: (
          <>
            to <B>{draft.channelName ? `#${draft.channelName}` : 'this channel'}</B>
          </>
        ),
      };
    case 'channel':
      return {
        icon: <Hash size={12} />,
        verb: 'post',
        where: (
          <>
            to <B>{chan ? `#${chan}` : 'another channel'}</B>
          </>
        ),
      };
    case 'thread':
      return {
        icon: <CornerDownLeft size={12} />,
        verb: 'post',
        where: (
          <>
            to a thread
            {chan ? (
              <>
                {' '}
                in <B>#{chan}</B>
              </>
            ) : (
              <> in another channel</>
            )}
          </>
        ),
      };
    case 'dm_sender':
      return {
        icon: <AtSign size={12} />,
        verb: 'send',
        where: (
          <>
            as a DM to <B>{draft.senderName ?? 'the sender'}</B>
          </>
        ),
      };
    case 'dm':
      return {
        icon: <AtSign size={12} />,
        verb: 'send',
        where: (
          <>
            as a DM to <B>{draft.destinationUserName ?? 'them'}</B>
          </>
        ),
      };
    case 'origin_thread':
    default:
      return {
        icon: <CornerDownLeft size={12} />,
        verb: 'reply',
        where: (
          <>
            in <B>this thread</B>
          </>
        ),
      };
  }
}

function SourcePreview({ source }: { source: TwinSourceInfo }): ReactElement | null {
  if (!source.text && !source.name) return null;
  const clickable = !!source.onJump;
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? source.onJump : undefined}
      onKeyDown={
        clickable
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                source.onJump?.();
              }
            }
          : undefined
      }
      title={clickable ? 'Jump to message' : undefined}
      data-track-category='twin-dock'
      data-track-name='jump-to-source'
      className={cn(
        'group mt-2 flex w-full min-w-0 items-center gap-1.5 border-l-2 border-border py-0.5 pl-2 text-[11px] leading-4 text-muted-foreground/80',
        clickable && 'cursor-pointer',
      )}
    >
      <SourceAvatar
        {...(source.userId && { userId: source.userId })}
        {...(source.name && { name: source.name })}
      />
      {source.name && (
        <span className='max-w-[45%] shrink-0 truncate font-medium text-foreground/70'>
          {source.name}
        </span>
      )}
      <span className={cn('min-w-0 flex-1 truncate', clickable && 'group-hover:underline')}>
        {source.text}
      </span>
    </div>
  );
}

function ReplyCard({
  draft,
  source,
  loading,
  approve,
  decline,
  onPosted,
  onReasoningOpenChange,
  reasoningOpen,
  conversationId,
  onBeginEdit,
}: {
  draft: TwinReplyDraftView;
  source?: TwinSourceInfo | undefined;
  loading: boolean;
  approve: (edited?: string) => Promise<PostedTarget | null>;
  decline: () => Promise<void>;
  onPosted: (t: PostedTarget | null) => void;
  onReasoningOpenChange: (open: boolean) => void;
  reasoningOpen: boolean;
  conversationId: string;
  onBeginEdit?: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const hasReact = draft.action === 'react' || draft.action === 'react_and_reply';
  const hasReply = draft.action === 'reply' || draft.action === 'react_and_reply';
  const dest = destinationInfo(draft);
  const emoji = <span className='text-sm leading-none'>{draft.emoji}</span>;

  let intent: ReactElement;
  if (hasReact && hasReply) {
    intent = (
      <>
        React {emoji} and {dest.verb} {dest.where}
      </>
    );
  } else if (hasReact) {
    intent = <>React {emoji} on the message</>;
  } else {
    intent = (
      <>
        {dest.verb.charAt(0).toUpperCase() + dest.verb.slice(1)} {dest.where}
      </>
    );
  }

  const beginEdit = (): void => {
    if (onBeginEdit) {
      onBeginEdit();
      return;
    }
    setEditText(draft.message ?? '');
    setEditing(true);
    setTimeout(() => textRef.current?.focus(), 0);
  };
  const send = async (): Promise<void> => {
    const posted = await approve(editing ? editText.trim() : undefined);
    onPosted(posted);
  };

  return (
    <div className='flex flex-col'>
      {/* what will happen — the quietest tier */}
      <div className='flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground/70'>
        {hasReply && <span className='flex shrink-0'>{dest.icon}</span>}
        <span className='min-w-0 truncate'>{intent}</span>
      </div>

      {/* the message being replied to */}
      {source ? <SourcePreview source={source} /> : null}

      {/* the draft itself — same 14px a posted message renders at, so it previews
          as the message it will become. No fill, no border: hierarchy is carried
          by the type/colour ladder above and the hairline below. */}
      {hasReact && !hasReply ? (
        <div className='mt-2.5 flex h-[104px] items-center gap-2.5'>
          <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-transparent text-xl'>
            {draft.emoji}
          </span>
          <span className='text-[13px] leading-[1.5] text-muted-foreground'>
            Adds this reaction to the triggering message
          </span>
        </div>
      ) : editing ? (
        <textarea
          ref={textRef}
          value={editText}
          onChange={e => setEditText(e.target.value)}
          data-track-category='twin-dock'
          data-track-name='edit-draft'
          className='mt-2.5 block h-[104px] w-full resize-none rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm leading-[1.6] text-foreground outline-none transition-colors focus:border-foreground/30'
        />
      ) : (
        // Same height as the edit textarea and the reaction row, so the dock never
        // resizes when you enter edit mode or page between drafts of different
        // lengths — it just scrolls.
        <div className='mt-2.5 h-[104px] overflow-y-auto overscroll-contain pr-1'>
          <div className='whitespace-pre-wrap text-sm leading-[1.6] text-foreground'>
            {draft.message}
          </div>
        </div>
      )}

      {/* No rule above this row: the composer's own top border sits just below the
          dock, and a second hairline here read as one nesting level too many. */}
      <div className='mt-3 flex items-center gap-1'>
        {draft.reasoning && (
          <TwinReasoningPopover
            open={reasoningOpen}
            onOpenChange={onReasoningOpenChange}
            draft={draft}
            conversationId={conversationId}
            trigger={
              <button
                aria-label='Why this reply'
                aria-haspopup='dialog'
                aria-expanded={reasoningOpen}
                data-track-category='twin-dock'
                data-track-name='open-reasoning'
                className={cn(
                  'flex items-center gap-1.5 rounded p-1.5 text-[11px] font-medium transition-all duration-200 ease-in-out',
                  reasoningOpen
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                Why?
              </button>
            }
          />
        )}
        {/* Same shape as the composer's own toolbar buttons (paperclip, emoji, @):
            `p-1.5 rounded hover:bg-accent` around a 16px icon. */}
        <div className='ml-auto flex items-center gap-1'>
          <button
            type='button'
            onClick={() => void decline()}
            disabled={loading}
            aria-label='Reject'
            data-track-category='twin-dock'
            data-track-name='decline-draft'
            className='rounded p-1.5 transition-all duration-200 ease-in-out hover:bg-accent disabled:pointer-events-none disabled:opacity-50'
          >
            <X className='h-4 w-4 text-muted-foreground' />
          </button>
          {hasReply && (
            <button
              type='button'
              onClick={editing ? () => setEditing(false) : beginEdit}
              disabled={loading}
              aria-label={editing ? 'Cancel edit' : 'Edit'}
              data-track-category='twin-dock'
              data-track-name={editing ? 'cancel-edit' : 'begin-edit'}
              className='rounded p-1.5 transition-all duration-200 ease-in-out hover:bg-accent disabled:pointer-events-none disabled:opacity-50'
            >
              <Pencil className='h-4 w-4 text-muted-foreground' />
            </button>
          )}
          {/* h-7 so the whole row — Why?, reject, edit, Send — is one 28px band,
              matching the composer toolbar directly below it. */}
          <Button
            size='sm'
            onClick={() => void send()}
            disabled={loading}
            loading={loading}
            className='h-7 gap-1.5 px-2.5 text-xs'
          >
            {!loading && <ArrowUp className='h-4 w-4' />}
            {hasReact && !hasReply ? 'Send reaction' : editing ? 'Send edited' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
