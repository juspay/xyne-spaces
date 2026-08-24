import { ReactElement, ReactNode, useEffect, useMemo, useState } from 'react';
import { PencilEditAi, Bug, MultipleCrossCancelDefault } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { Popover } from '../../ui/Popover';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import {
  buildClawCitationToolNumbers,
  linkifyAndGroupClawCitations,
  stripCitationMarks,
} from '../../ui/TipTapExtensions/CitationMark';
import { registerClawIcons } from '../XyneAISidebar/utils/clawCitationUrl';
import type { ToolInvocation } from '../XyneAISidebar/utils/XyneAITypes';
import { AskAIDebugPanel } from '../XyneAISidebar/components/AskAIDebugPanel';
import type { TwinReplyDraftView } from './twinReplyDraftApi';

const DIGITAL_TWIN_SLUG = 'digital-twin';

/**
 * The debug tab is the widest thing we host, so it sets the fixed size. The panel
 * sizes itself from a number, the shell from a class — keep the two in step with
 * `w-[680px]` below.
 */
const MODAL_WIDTH = 680;

/**
 * The Debug tab's maximised JSON viewer portals its own overlay to `<body>`, i.e.
 * as a sibling of this popover — so Radix counts clicks in it as "outside", and
 * Escape would otherwise close both layers at once. Both handlers below yield to
 * it while it is mounted.
 */
const DEBUG_JSON_MODAL = '[data-debug-json-modal]';

type ReasoningTab = 'reasoning' | 'debug';

interface TwinReasoningPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: TwinReplyDraftView | undefined;
  conversationId: string;
  /** The "why this reply" trigger. Radix wires open/close/re-click toggling onto it. */
  trigger: ReactNode;
}

/**
 * The twin's reasoning, anchored above its trigger in the draft tray.
 *
 * Deliberately NON-modal: no backdrop, no dimming, no blur, and no
 * `body { pointer-events: none }` — the thread stays readable and clickable
 * behind it, which is the point of hanging it off the tray rather than
 * centring it. Radix gives us Escape, click-outside and re-click-the-trigger
 * dismissal for free, and returns focus to the trigger on close.
 */
export function TwinReasoningPopover({
  open,
  onOpenChange,
  draft,
  conversationId,
  trigger,
}: TwinReasoningPopoverProps): ReactElement {
  const [tab, setTab] = useState<ReasoningTab>('reasoning');

  useEffect(() => {
    if (open) setTab('reasoning');
  }, [open]);

  const agentSlug = draft?.agentSlug ?? DIGITAL_TWIN_SLUG;

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      side='top'
      // The trigger sits at the right end of the tray's action row, so anchor the
      // panel's right edge to it — align='start' would throw 680px of panel off
      // the right of the thread and leave Radix to shove it back.
      align='end'
      sideOffset={8}
      collisionPadding={12}
      onEscapeKeyDown={event => {
        if (document.querySelector(DEBUG_JSON_MODAL)) event.preventDefault();
      }}
      onInteractOutside={event => {
        const target = (event.detail?.originalEvent?.target ?? null) as Element | null;
        if (target?.closest?.(DEBUG_JSON_MODAL)) event.preventDefault();
      }}
      // p-0: the header/body supply their own padding. The height is a target,
      // not a floor — `available-height` keeps it inside the viewport when the
      // tray sits low, and the body scrolls internally.
      className={cn(
        'flex w-[512px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0',
        'max-h-[var(--radix-popover-content-available-height)] border-border shadow-lg',
      )}
    >
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-11 shrink-0 items-center gap-2 border-b border-border px-3'>
          <span className='flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-foreground'>
            <span className='flex shrink-0'>
              <PencilEditAi size={13} />
            </span>
            <span className='truncate'>Why this reply</span>
          </span>
          <div className='ml-auto flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5'>
            <TabButton
              active={tab === 'reasoning'}
              onClick={() => setTab('reasoning')}
              icon={<PencilEditAi size={13} />}
              label='Reasoning'
            />
            <TabButton
              active={tab === 'debug'}
              onClick={() => setTab('debug')}
              icon={<Bug size={13} />}
              label='Debug'
            />
          </div>
          <button
            onClick={() => onOpenChange(false)}
            aria-label='Close'
            data-track-category='twin-reasoning'
            data-track-name='close'
            className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <MultipleCrossCancelDefault size={16} />
          </button>
        </div>

        {tab === 'reasoning' ? (
          <div className='min-h-0 flex-1 overflow-y-auto p-4'>
            {/* Hold the reading column short of the 680px shell — prose at the full
                width runs to a ~95-character measure. */}
            <div className='max-w-[600px]'>
              {/* Which draft this reasoning belongs to. Matters in the pager, where
                  the tray can hold several drafts. */}
              {draft?.message ? (
                <div className='mb-3 line-clamp-3 border-l-2 border-border pl-2.5 text-[11px] leading-4 text-muted-foreground/80'>
                  {draft.message}
                </div>
              ) : null}
              {draft?.reasoning ? (
                <ReasoningBody reasoning={draft.reasoning} draft={draft} />
              ) : (
                <p className='text-sm text-muted-foreground'>
                  No reasoning was captured for this draft.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <AskAIDebugPanel
              open
              inline
              agentSlug={agentSlug}
              conversationId={conversationId}
              onClose={() => onOpenChange(false)}
              selectedSessionId={draft?.sessionId ?? null}
              width={MODAL_WIDTH}
            />
          </div>
        )}
      </div>
    </Popover>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactElement;
  label: string;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      data-track-category='twin-reasoning'
      data-track-name={`tab-${label.toLowerCase()}`}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ReasoningBody({
  reasoning,
  draft,
}: {
  reasoning: string;
  draft: TwinReplyDraftView;
}): ReactElement {
  const clawCitationCtx = useMemo(() => {
    const clawCitations = draft.clawCitations as ToolInvocation[] | undefined;
    if (!clawCitations?.length) return undefined;
    registerClawIcons(draft.clawCitationIcons);
    const toolNumbers = buildClawCitationToolNumbers(reasoning);
    if (toolNumbers.size === 0) return undefined;
    return { toolInvocations: clawCitations, toolNumbers };
  }, [draft.clawCitations, draft.clawCitationIcons, reasoning]);

  const citationContent = useMemo(() => {
    if (reasoning.indexOf('clf-') === -1) return reasoning;
    const linkified = clawCitationCtx
      ? linkifyAndGroupClawCitations(reasoning, clawCitationCtx.toolNumbers)
      : reasoning;
    return stripCitationMarks(linkified);
  }, [reasoning, clawCitationCtx]);

  const markdownComponents = useMemo(
    () => createMarkdownComponents('twin-why', clawCitationCtx),
    [clawCitationCtx],
  );

  return (
    <div className='text-sm leading-relaxed text-foreground'>
      <MarkdownMessageRenderer content={citationContent} markdownComponents={markdownComponents} />
    </div>
  );
}
