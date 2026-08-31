import { ReactElement, ReactNode, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Spinner,
  ArrowTurnDownLeft,
  Hashtag,
  AtMark,
  ChevronBigUp,
  ChevronBigLeft,
  ChevronBigRight,
  ArrowUp,
  ArrowLeft,
  PencilEditAi,
  PencilEraserEditLine,
  ChatCancel,
} from '@xyne/icons';
import { Button } from '../../ui/Button';
import { Tooltip } from '../../ui/Tooltip';
import Avatar from '../../ui/Avatar/Avatar';
import { XyneAIStar } from '../../icons/xyne-ai';
import { cn } from '../../../utils/classNames';
import { useUser } from '../../../hooks/useUsers';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import {
  buildClawCitationToolNumbers,
  linkifyAndGroupClawCitations,
  stripCitationMarks,
} from '../../ui/TipTapExtensions/CitationMark';
import { registerClawIcons } from '../XyneAISidebar/utils/clawCitationUrl';
import type { ToolInvocation } from '../XyneAISidebar/utils/XyneAITypes';
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
  /** Id of the person being replied to — resolves their real profile picture. */
  userId?: string;
  name?: string;
  text?: string;
  onJump?: () => void;
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

  const senderNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const d of drafts) {
      const name = (resolveSource?.(d)?.name ?? d.senderName ?? '').trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }, [drafts, resolveSource]);

  const goTo = (index: number): void => {
    setSel(Math.max(0, Math.min(index, replyCount - 1)));
  };

  const headerName = selectedSource?.name ?? selectedDraft?.senderName;
  const editing = !!onEditBack;
  const bodyOpen = !collapsed && !editing;
  const fused = attached && !bodyOpen;
  const mutedHeader = collapsed && !editing;
  const ease = 'duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]';

  return (
    <motion.div
      variants={expand}
      initial='initial'
      animate='animate'
      exit='exit'
      className={cn('transition-[margin]', ease, attached && (fused ? '-mb-3' : 'mb-2'))}
    >
      <div
        className={cn(
          'overflow-hidden border border-border bg-background',
          'transition-[box-shadow,border-color]',
          ease,
          fused
            ? 'rounded-t-xl border-b-transparent shadow-none'
            : 'rounded-xl shadow-[0_-5px_17px_0_rgba(0,0,0,0.06)]',
        )}
      >
        <div className={cn('transition-colors', ease, mutedHeader ? 'bg-muted' : 'bg-transparent')}>
          {editing ? (
            <EditHeader senderName={headerName} onBack={onEditBack} />
          ) : collapsed ? (
            <CollapsedBar
              hasReply={hasReply}
              replyCount={replyCount}
              senderNames={senderNames}
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
        </div>

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
              <div className='px-3.5 pb-4 pt-2.5'>
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
    <div className='relative flex select-none items-center gap-1.5 px-3.5 pb-5 pt-2'>
      <button
        type='button'
        onClick={onBack}
        aria-label='Back to drafts'
        data-track-category='twin-dock'
        data-track-name='edit-back'
        className='absolute inset-0 cursor-pointer transition-colors hover:bg-muted/20'
      />
      <span className='pointer-events-none relative flex h-[22px] w-4 shrink-0 items-center justify-center text-muted-foreground'>
        <ArrowLeft size={16} />
      </span>
      <span className='pointer-events-none relative flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-[22px] tracking-[-0.1px] text-foreground'>
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
  senderNames,
  recapLabel,
  onExpand,
}: {
  hasReply: boolean;
  replyCount: number;
  senderNames: string[];
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
        className='flex w-full select-none items-center gap-1.5 px-3.5 pb-5 pt-2 text-left transition-colors hover:bg-foreground/[0.04]'
      >
        <span className='flex shrink-0 items-center gap-1'>
          <span className='flex h-4 w-4 items-center justify-center text-[color:var(--mention-color)]'>
            <PencilEditAi size={12} />
          </span>
          <span className='text-sm font-semibold leading-[22px] tracking-[-0.1px] text-[color:var(--mention-color)]'>
            {replyCount === 1 ? '1 AI reply ready' : `${replyCount} AI replies ready`}
          </span>
        </span>
        {senderNames.length > 0 && (
          <span className='min-w-0 truncate text-[13px] font-medium leading-[22px] tracking-[-0.1px] text-foreground/60'>
            {senderNames.join(', ')}
          </span>
        )}
      </button>
    );
  }
  return (
    <button
      onClick={onExpand}
      aria-label='Expand'
      data-track-category='twin-dock'
      data-track-name='expand'
      className='flex w-full select-none items-center gap-2.5 px-3.5 pb-5 pt-2 text-left transition-colors hover:bg-foreground/[0.04]'
    >
      <span className='text-sm font-semibold leading-[22px] tracking-[-0.1px] text-foreground'>
        {recapLabel}
      </span>
      <ChevronBigUp size={15} className='ml-auto text-muted-foreground' />
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
    <div className='relative flex select-none items-center gap-2 px-3.5 pb-1.5 pt-2'>
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
        <span className='pointer-events-none relative text-sm font-semibold leading-[22px] text-foreground'>
          Thread recap
        </span>
      ) : (
        <span className='pointer-events-none relative flex min-w-0 items-center gap-2 text-sm font-semibold leading-[22px] text-[color:var(--mention-color)]'>
          <span className='flex shrink-0'>
            <XyneAIStar size={14} />
          </span>
          <span className='truncate'>
            {senderName ? `Reply to ${senderName}` : 'Suggested reply'}
          </span>
        </span>
      )}

      <div className='pointer-events-none relative ml-auto flex items-center'>
        {tab === 'reply' && replyCount > 1 && (
          <Pager active={active} total={replyCount} onGoTo={onGoTo} />
        )}
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
        'pointer-events-auto flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors',
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
    'pointer-events-auto flex h-4 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground';
  return (
    <div className='flex items-center gap-1.5'>
      <Tooltip content='Previous draft' side='top'>
        <button
          onClick={() => onGoTo((active - 1 + total) % total)}
          aria-label='Previous draft'
          data-track-category='twin-dock'
          data-track-name='pager-prev'
          className={btn}
        >
          <ChevronBigLeft size={16} />
        </button>
      </Tooltip>
      <span
        role='status'
        aria-live='polite'
        className='text-[13px] font-semibold leading-[1.2] tabular-nums tracking-[-0.1px] text-foreground/60'
      >
        {active + 1}/{total}
      </span>
      <Tooltip content='Next draft' side='top'>
        <button
          onClick={() => onGoTo((active + 1) % total)}
          aria-label='Next draft'
          data-track-category='twin-dock'
          data-track-name='pager-next'
          className={btn}
        >
          <ChevronBigRight size={16} />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * The person the twin is replying to, drawn with the shared `Avatar` so the photo
 * and the identity colour agree with every other avatar in the app. This used to
 * hash the display NAME into a private eight-colour palette, so the same person
 * came out one colour here and a different one in the thread right above.
 *
 * `useUser` only resolves ids already in the loaded workspace roster, and Avatar
 * handed an unknown id renders blank initials over a colour hashed from that id
 * (handed none, it renders the CURRENT user). Either is a confidently wrong
 * identity, so an unresolved sender falls back to a neutral initial: the colour
 * is right or absent, never misleading.
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
    // size-[18px] beats Avatar's own size-4 through tailwind-merge; `rounded`
    // likewise beats its rounded-sm, and the image inherits that radius.
    return (
      <Avatar userId={userId} size='xs' showActiveStatus={false} className='size-[18px] rounded' />
    );
  }
  const initial = ((name ?? '').trim()[0] ?? '?').toUpperCase();
  return (
    <span className='inline-flex size-[18px] shrink-0 items-center justify-center rounded bg-muted text-[9px] font-semibold uppercase leading-none text-muted-foreground'>
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
            <Spinner size={14} className='animate-spin' /> Generating summary…
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
        icon: <Hashtag size={12} />,
        verb: 'post',
        where: (
          <>
            to <B>{draft.channelName ? `#${draft.channelName}` : 'this channel'}</B>
          </>
        ),
      };
    case 'channel':
      return {
        icon: <Hashtag size={12} />,
        verb: 'post',
        where: (
          <>
            to <B>{chan ? `#${chan}` : 'another channel'}</B>
          </>
        ),
      };
    case 'thread':
      return {
        icon: <ArrowTurnDownLeft size={12} />,
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
        icon: <AtMark size={12} />,
        verb: 'send',
        where: (
          <>
            as a DM to <B>{draft.senderName ?? 'the sender'}</B>
          </>
        ),
      };
    case 'dm':
      return {
        icon: <AtMark size={12} />,
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
        icon: <ArrowTurnDownLeft size={12} />,
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
      aria-label={clickable ? 'Jump to message' : undefined}
      data-track-category='twin-dock'
      data-track-name='jump-to-source'
      className={cn(
        'group flex w-full min-w-0 items-center gap-2 rounded-md border-[0.4px] border-border/60 bg-muted py-2 pl-2 pr-2.5',
        clickable && 'cursor-pointer',
      )}
    >
      <span className='w-[3px] shrink-0 self-stretch rounded-[2px] bg-[color:var(--mention-color)]' />
      <SourceAvatar
        {...(source.userId && { userId: source.userId })}
        {...(source.name && { name: source.name })}
      />
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        {source.name && (
          <span className='max-w-[45%] shrink-0 truncate text-[13px] font-bold leading-[1.2] tracking-[-0.1px] text-foreground/90'>
            {source.name}:
          </span>
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm font-normal text-foreground/60',
            clickable && 'group-hover:underline',
          )}
        >
          {source.text}
        </span>
      </div>
    </div>
  );
}

function DraftBody({ draft }: { draft: TwinReplyDraftView }): ReactElement {
  const message = draft.message ?? '';

  const clawCitationCtx = useMemo(() => {
    const clawCitations = draft.clawCitations as ToolInvocation[] | undefined;
    if (!clawCitations?.length) return undefined;
    registerClawIcons(draft.clawCitationIcons);
    const toolNumbers = buildClawCitationToolNumbers(message);
    if (toolNumbers.size === 0) return undefined;
    return { toolInvocations: clawCitations, toolNumbers };
  }, [draft.clawCitations, draft.clawCitationIcons, message]);

  const content = useMemo(() => {
    if (message.indexOf('clf-') === -1) return message;
    const linkified = clawCitationCtx
      ? linkifyAndGroupClawCitations(message, clawCitationCtx.toolNumbers)
      : message;
    return stripCitationMarks(linkified);
  }, [message, clawCitationCtx]);

  const markdownComponents = useMemo(
    () => createMarkdownComponents(`twin-draft-${draft.id}`, clawCitationCtx),
    [draft.id, clawCitationCtx],
  );

  return (
    <div className='bot-markdown-content max-h-[220px] overflow-y-auto px-1 text-sm leading-[22px] text-foreground'>
      <MarkdownMessageRenderer content={content} markdownComponents={markdownComponents} />
    </div>
  );
}

function provenanceLabel(draft: TwinReplyDraftView): string | null {
  const cites = draft.clawCitations as ToolInvocation[] | undefined;
  if (!cites?.length) return null;
  const total = cites.reduce((acc, c) => acc + (c.citations?.length ?? 0), 0);
  if (total === 0) return null;
  return `Derived from ${total} source${total > 1 ? 's' : ''}...`;
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

  const provenance = provenanceLabel(draft);
  const footerNote: ReactNode = provenance ?? (
    <span className='inline-flex items-center gap-1'>
      {hasReply && dest.icon}
      {intent}
    </span>
  );

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
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-3.5'>
        {source ? <SourcePreview source={source} /> : null}

        {hasReact && !hasReply ? (
          <div className='flex items-center gap-2.5 px-1'>
            <span className='flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-xl'>
              {draft.emoji}
            </span>
            <span className='text-xs text-muted-foreground'>
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
            className='h-[120px] w-full resize-none rounded-md bg-background px-2 py-1.5 text-sm leading-[22px] text-foreground outline-none ring-1 ring-border focus:ring-foreground/40'
          />
        ) : (
          <DraftBody draft={draft} />
        )}
      </div>

      <div className='flex items-center gap-8 px-1'>
        {/* Provenance only — plain text. It used to double as the reasoning
            trigger, which made a full-width line of prose clickable and easy to
            hit by accident; the "Why?" button below owns that job now. */}
        <span className='min-w-0 flex-1 truncate text-xs font-medium text-foreground/40'>
          {footerNote}
        </span>

        <div className='flex shrink-0 items-center gap-2'>
          <div className='flex items-center'>
            {draft.reasoning && (
              // A non-modal popover rather than a drawer, so the thread stays
              // readable behind it. No tooltip on the trigger: Radix owns the
              // click here, and the label already says what it opens.
              <TwinReasoningPopover
                open={reasoningOpen}
                onOpenChange={onReasoningOpenChange}
                draft={draft}
                conversationId={conversationId}
                trigger={
                  <button
                    aria-label='See why this reply was drafted'
                    aria-haspopup='dialog'
                    aria-expanded={reasoningOpen}
                    data-track-category='twin-dock'
                    data-track-name='open-reasoning'
                    // Same px-[9px] py-1.5 band as the icon buttons beside it, so
                    // the four controls read as one row.
                    className={cn(
                      'flex items-center justify-center px-[9px] py-1.5 text-xs font-medium transition-colors hover:text-foreground',
                      reasoningOpen ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    Why?
                  </button>
                }
              />
            )}
            <Tooltip content='Discard draft' side='top'>
              <Button
                variant='ghost'
                onClick={() => void decline()}
                disabled={loading}
                trackId='twin_decline_draft'
                aria-label='Discard draft'
                data-track-category='twin-dock'
                data-track-name='decline'
                className='flex items-center justify-center px-[9px] py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50'
              >
                <ChatCancel size={14} />
              </Button>
            </Tooltip>
            {hasReply && (
              <Tooltip content={editing ? 'Cancel edit' : 'Edit draft'} side='top'>
                <button
                  onClick={editing ? () => setEditing(false) : beginEdit}
                  disabled={loading}
                  aria-label={editing ? 'Cancel edit' : 'Edit draft'}
                  data-track-category='twin-dock'
                  data-track-name='edit'
                  className='flex items-center justify-center px-[9px] py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50'
                >
                  <PencilEraserEditLine size={14} />
                </button>
              </Tooltip>
            )}
          </div>
          <Button
            size='sm'
            onClick={() => void send()}
            data-track-category='twin-dock'
            data-track-name='send-draft'
            trackId='twin_send_reply'
            trackAction={send}
            disabled={loading}
            loading={loading}
            className='h-7 gap-1 rounded-lg px-[9px] text-[13px] font-medium'
          >
            {!loading && <ArrowUp size={14} className='size-3.5' />}
            {hasReact && !hasReply ? 'Send reaction' : editing ? 'Send edited' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
