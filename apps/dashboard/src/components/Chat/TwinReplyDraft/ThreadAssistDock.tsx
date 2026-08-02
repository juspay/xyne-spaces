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
  MessageSquareX,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import { XyneAIStar } from '../../icons/xyne-ai';
import { cn } from '../../../utils/classNames';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import type { TwinReplyDraftView, PostedTarget } from './twinReplyDraftApi';
import type { AssistTab } from './useThreadAssist';

// Mount / vanish of the whole dock (used by the composer's AnimatePresence).
const expand = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: 6, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } },
} as const;

// The body opens/closes as a real height spring (height: 0 ↔ auto) — animating
// the height property, not a `layout` transform, so content never distorts. A
// small `bounce` gives the subtle overshoot on expand/collapse.
const bodySpring = { type: 'spring', bounce: 0.2, duration: 0.4 } as const;

// A single draft card sliding out while the next slides in — the smooth
// transition the pager and post-send auto-advance rely on. A fixed body height
// keeps the card size stable so swaps never jump.
const swap = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, x: -12, transition: { duration: 0.13, ease: [0.4, 0, 1, 1] } },
} as const;

/**
 * Resolved triggering-message info for a draft: who sent the message the twin is
 * replying to, its text (drives the one-line preview) and a jump-to-message
 * handler. Supplied by ThreadPannel, which holds the thread's messages + the
 * scroll target. Any field may be absent (e.g. the source message isn't in the
 * loaded window) — the UI degrades gracefully.
 */
export interface TwinSourceInfo {
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
    /** This thread's pending Twin proposals, newest-first (may be several). */
    drafts: TwinReplyDraftView[];
    /** Draft ids with an approve/decline in flight (per-card spinners). */
    pending: ReadonlySet<string>;
    approve: (draftId: string, edited?: string) => Promise<PostedTarget | null>;
    decline: (draftId: string) => Promise<void>;
  };
  /** Called after a successful send with where the reply landed (for redirect). */
  onPosted: (target: PostedTarget | null) => void;
  /** Open the reasoning/debug side drawer for a specific proposal (the "Why?" button). */
  onOpenReasoning: (draft: TwinReplyDraftView) => void;
  /** Resolve the triggering message for a draft (sender, text, jump-to-message). */
  resolveSource?: (draft: TwinReplyDraftView) => TwinSourceInfo;
  /** True when a composer sits below (in-thread): tucks the dock's lower edge
   *  behind the still-rounded composer, so expanding it reads as a layered panel.
   *  False = standalone preview card. */
  attached?: boolean;
  /** Hand editing off to the message composer (highlight + back button). When
   *  provided (there IS a composer), the Edit action calls this instead of the
   *  in-card textarea; when absent (preview card, no composer) editing stays
   *  inline. */
  onBeginEdit?: (draft: TwinReplyDraftView) => void;
  /** When set, the dock is in composer-edit mode: it shows the "Editing draft"
   *  header (clickable → back), collapses its body (the draft is down in the
   *  composer), and glows. Presence of this callback IS the edit flag. */
  onEditBack?: () => void;
}

/**
 * The Digital Twin's in-thread assist surface: a rounded panel tucked behind the
 * message composer. Expanding its header reveals the panel while the composer
 * keeps its own rounded foreground silhouette.
 *
 *  - Collapsed it is a slim "N AI replies ready" bar carrying the senders it is
 *    replying to (or a neutral recap bar when there's only a recap).
 *  - Expanded it shows ONE draft at a time — a sleek, fully-clickable header
 *    (red star + "Reply to <sender>", ‹ n/N › pager), the destination ("Reply in
 *    this thread" + "Only you can see this"), a one-line preview of the message
 *    being replied to (jumps to it), a fixed-height draft body, and Send / Edit /
 *    Reject (right-aligned) · Why?. Collapse/expand springs with a subtle bounce.
 */
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
  onOpenReasoning,
  resolveSource,
  attached = true,
  onBeginEdit,
  onEditBack,
}: ThreadAssistDockProps): ReactElement {
  const drafts = reply.drafts;
  const replyCount = drafts.length;
  // Which draft is showing (internal — the top-level recap/reply tab is owned by
  // useThreadAssist). Clamped in render so a shrinking list (a draft was
  // sent/rejected) never points past the end and instead advances to the next.
  const [sel, setSel] = useState(0);
  // The dock is keyed stably across threads (it doesn't remount on navigation),
  // so reset the selected index when the thread changes — otherwise a fresh
  // thread could open on draft #2. Guarded setState-in-render (React re-renders).
  const convId = drafts[0]?.conversationId;
  const convRef = useRef(convId);
  if (convRef.current !== convId) {
    convRef.current = convId;
    if (sel !== 0) setSel(0);
  }
  const active = replyCount > 0 ? Math.min(sel, replyCount - 1) : 0;
  const selectedDraft = tab === 'reply' && replyCount > 0 ? drafts[active] : undefined;
  const selectedSource = selectedDraft ? resolveSource?.(selectedDraft) : undefined;

  // Distinct senders of the messages we're replying to — the names the collapsed
  // bar lists ("Devesh, Anurag, Shekhar").
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
  // Composer-edit mode: the draft is down in the composer, so the tray shows the
  // "Editing draft" header and closes its body (via the same accordion, which
  // masks the header swap with a downward motion).
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
      {/* Always (collapsed AND expanded) a negative margin tucks the tray's bottom
          12px BEHIND the composer (which keeps its rounded top and paints over the
          tuck) — so it reads as tucked INTO the composer, emerging from behind it
          on expand. Preview (no composer): a standalone rounded card. The header is
          always shown; the body reveals/hides as a height spring. In edit mode the
          card gets a soft twin glow that continues into the composer below. */}
      <div
        className={cn(
          'overflow-hidden border border-input bg-card',
          attached ? 'rounded-t-2xl border-b-0' : 'rounded-2xl',
          // editing && 'bg-gradient-to-b from-blue-400/[0.14] to-red-blue/[0.05]',
        )}
      >
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
          // Sleek header — the WHOLE row collapses the dock (interactive controls
          // opt back in via pointer-events). Star + "Reply to <sender>".
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
              <div className='px-3.5 pb-3 pt-2'>
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
                        onOpenReasoning={() => onOpenReasoning(selectedDraft)}
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

/** The header shown while a draft is being edited in the composer: a back arrow +
 *  the Xyne star + "Editing draft · reply to <sender>". The WHOLE row goes back
 *  (a full-bleed overlay button behind the content), matching the collapse/expand
 *  headers — click anywhere to return to the drafts tray. */
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

/** The slim bar the dock closes to. For replies it echoes the design's "N AI
 *  replies ready · <senders>" with a soft accent tint; for a bare recap it falls
 *  back to a neutral label. The whole bar expands the dock. */
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
        // Neutral surface, matching the context pill (bg-muted). The gradient
        // Xyne star supplies the only accent. pb-3 keeps content clear of the
        // bottom 12px that tucks behind the composer.
        className='flex h-[42px] w-full select-none items-center gap-2 bg-muted/60 px-3 pb-3 text-left transition-colors hover:bg-muted'
      >
        <span className='flex shrink-0'>
          <XyneAIStar size={14} />
        </span>
        <span className='shrink-0 text-[13px] font-semibold text-foreground'>
          {replyCount === 1 ? '1 AI reply ready' : `${replyCount} AI replies ready`}
        </span>
        {senderNames.length > 0 && (
          <>
            <AvatarCluster names={senderNames} />
            <span className='min-w-0 truncate text-[13px] text-muted-foreground'>
              {senderNames.join(', ')}
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
      className='flex h-[42px] w-full select-none items-center gap-2.5 bg-muted/60 px-3 pb-3 text-left transition-colors hover:bg-muted'
    >
      <span className='text-xs font-semibold text-foreground'>{recapLabel}</span>
      <ChevronUp size={15} className='ml-auto text-muted-foreground' />
    </button>
  );
}

/** The sleek, fully-clickable expanded header: red star + "Reply to <sender>"
 *  (or the recap label), an optional Recap/Reply toggle, the ‹ n/N › pager, and
 *  a collapse chevron.
 *
 *  The whole row collapses the dock via a full-bleed overlay <button> BEHIND the
 *  content (keyboard-accessible, no nested-interactive-element ARIA violation).
 *  Non-interactive content is `pointer-events-none` so clicks fall through to the
 *  overlay; the toggle/pager opt back in with `pointer-events-auto`. */
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
    <div className='relative flex h-9 select-none items-center gap-2 border-b border-border/60 px-3'>
      <button
        type='button'
        onClick={onCollapse}
        aria-label='Collapse'
        data-track-category='twin-dock'
        data-track-name='collapse'
        className='absolute inset-0 cursor-pointer transition-colors hover:bg-muted/30'
      />
      {/* When a recap AND replies both exist, show them as two tabs (Replies /
          Recap). Otherwise just the single title. */}
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

/** A pill tab in the expanded header (Replies / Recap). */
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

/** Overlapping sender avatars for the collapsed bar (max 3, hashed colours). */
function AvatarCluster({ names }: { names: string[] }): ReactElement {
  return (
    <div className='flex shrink-0 -space-x-1.5'>
      {names.slice(0, 3).map((n, i) => (
        <SourceAvatar key={`${n}-${i}`} name={n} size={16} />
      ))}
    </div>
  );
}

/** ‹ n / N › pager for stepping through a thread's several draft proposals.
 *  `pointer-events-auto` so its buttons work while the surrounding header lets
 *  clicks fall through to the collapse overlay. */
function Pager({
  active,
  total,
  onGoTo,
}: {
  active: number;
  total: number;
  onGoTo: (index: number) => void;
}): ReactElement {
  // Cyclic: wrap around at the ends so you can keep clicking the same arrow.
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

/** A small deterministic palette for source-message avatars — colour picked by a
 *  stable hash of the sender name so the same person is always the same colour. */
const AVATAR_COLORS = [
  '#e11d48',
  '#7c3aed',
  '#0891b2',
  '#d97706',
  '#059669',
  '#2563eb',
  '#db2777',
  '#4f46e5',
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** Initial-in-a-circle avatar for the message's sender (no user lookup needed —
 *  the draft carries the sender name). Colour is hashed so senders stay distinct. */
function SourceAvatar({
  name,
  size = 16,
}: {
  name?: string | undefined;
  size?: number;
}): ReactElement {
  const label = (name ?? '').trim();
  const initial = (label[0] ?? '?').toUpperCase();
  return (
    <span
      className='inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase leading-none text-white'
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.52),
        backgroundColor: avatarColor(label),
      }}
    >
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
      {/* Lightweight recap: soften markdown emphasis (no heavy black headings /
          bold) so it reads as a quiet summary, not a shouting block. */}
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

/** Icon + reply verb + "where" clause for the reply's destination. Kept as a
 *  verb ("reply"/"post"/"send") + clause ("in this thread") so it composes both
 *  standalone ("Reply in this thread") and after a reaction ("React 👍 and reply
 *  in this thread"). Names are resolved server-side; falls back to a generic
 *  noun when the name is unavailable. */
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

/** The one-line, clickable preview of the message this reply is drafted for — the
 *  "who we're replying to" field. Borderless/inline (matches the original), a
 *  single truncated line; clicking jumps to the source message in the thread. */
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
        // w-full + min-w-0 so this fills (and can shrink to) the container width,
        // letting the message text truncate to a single line responsively.
        'group flex w-full min-w-0 items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground/60',
        clickable && 'cursor-pointer',
      )}
    >
      <SourceAvatar name={source.name} size={14} />
      {source.name && (
        <span className='max-w-[45%] shrink-0 truncate font-medium text-muted-foreground/80'>
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
  onOpenReasoning,
  onBeginEdit,
}: {
  draft: TwinReplyDraftView;
  source?: TwinSourceInfo | undefined;
  loading: boolean;
  approve: (edited?: string) => Promise<PostedTarget | null>;
  decline: () => Promise<void>;
  onPosted: (t: PostedTarget | null) => void;
  onOpenReasoning: () => void;
  /** Present ⇒ hand editing to the composer; absent ⇒ inline textarea fallback. */
  onBeginEdit?: () => void;
}): ReactElement {
  // Inline-edit state is only used as the fallback when there's no composer to
  // delegate to (the threads-page preview card). With a composer, Edit calls
  // onBeginEdit and this stays dormant.
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const hasReact = draft.action === 'react' || draft.action === 'react_and_reply';
  const hasReply = draft.action === 'reply' || draft.action === 'react_and_reply';
  const dest = destinationInfo(draft);
  const emoji = <span className='text-sm leading-none'>{draft.emoji}</span>;

  // One line that states the full intent: the reaction and/or where the reply
  // lands, so react_and_reply reads as "React 👍 and reply in this thread".
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
    <div className='flex flex-col gap-1.5'>
      {/* destination indicator (reaction + where) + private hint — kept faded so
          focus stays on the draft body below. */}
      <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground/60'>
        {hasReply && dest.icon}
        <span>{intent}</span>
        <span className='ml-auto shrink-0'>Only you can see this</span>
      </div>

      {/* the message this reply is drafted for — inline, clickable, jumps to it.
          Height reserved so paging to a draft whose source isn't loaded doesn't
          change the card height. */}
      <div className='flex min-h-[22px] items-center'>
        {source ? <SourcePreview source={source} /> : null}
      </div>

      {/* draft body — dashed hairline marks it unsent; FIXED height so switching
          drafts never changes the card size (long drafts scroll). */}
      <div className='mt-0.5 h-[76px] overflow-y-auto rounded-md border border-dashed border-border bg-muted/30 px-3 py-2'>
        {hasReact && !hasReply ? (
          <div className='flex h-full items-center gap-2.5'>
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
            className='h-full w-full resize-none rounded bg-background px-2 py-1.5 text-sm text-foreground outline-none ring-1 ring-border focus:ring-foreground/40'
          />
        ) : (
          <div className='whitespace-pre-wrap text-sm text-foreground'>{draft.message}</div>
        )}
      </div>

      {/* actions: Why? on the left; Reject / Edit / Send right-aligned (Send is
          the red primary, rightmost) — matches the reference. */}
      <div className='flex items-center gap-1'>
        {draft.reasoning && (
          <button
            onClick={onOpenReasoning}
            aria-label='Why this reply'
            data-track-category='twin-dock'
            data-track-name='open-reasoning'
            className='flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            Why?
          </button>
        )}
        <div className='ml-auto flex items-center gap-1'>
          {/* Reject + Edit are icon-only; Send is the red primary with an up
              arrow — matching the reference. */}
          <Button
            size='iconSm'
            variant='ghost'
            onClick={() => void decline()}
            disabled={loading}
            aria-label='Reject'
            className='text-muted-foreground hover:text-foreground'
          >
            <MessageSquareX size={17} />
          </Button>
          {hasReply && (
            <Button
              size='iconSm'
              variant='ghost'
              onClick={editing ? () => setEditing(false) : beginEdit}
              disabled={loading}
              aria-label={editing ? 'Cancel edit' : 'Edit'}
              className='text-muted-foreground hover:text-foreground'
            >
              <Pencil size={16} />
            </Button>
          )}
          <Button size='sm' onClick={() => void send()} disabled={loading} loading={loading}>
            {!loading && <ArrowUp size={15} />}
            {hasReact && !hasReply ? 'Send reaction' : editing ? 'Send edited' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
