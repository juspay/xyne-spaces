import { ReactElement, useEffect, useMemo, useState } from 'react';
import { Sparkles, Bug, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
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

type ReasoningTab = 'reasoning' | 'debug';

interface TwinReasoningDrawerProps {
  open: boolean;
  /** The current draft (from the dock) — carries reasoning + the run identity. */
  draft: TwinReplyDraftView | undefined;
  /** Origin conversation — the debugger fetches the twin run's trace by this. */
  conversationId: string;
  onClose: () => void;
}

/**
 * Right-side drawer explaining a Twin draft: a **Reasoning** tab (the twin's
 * private rationale with clickable clf- citation chips) and a **Debug** tab
 * (the reused AskAIDebugPanel — the full run trace: tool calls, thinking,
 * timeline). Rendered as an overlay over the thread panel's right edge so it
 * never displaces the thread; dismissible. The debugger is scoped to THIS twin
 * run via (conversationId, agentSlug, sessionId) and owner-ACL'd server-side.
 */
export function TwinReasoningDrawer({
  open,
  draft,
  conversationId,
  onClose,
}: TwinReasoningDrawerProps): ReactElement | null {
  const [tab, setTab] = useState<ReasoningTab>('reasoning');

  // Default to the Reasoning tab every time the drawer opens.
  useEffect(() => {
    if (open) setTab('reasoning');
  }, [open]);

  if (!open) return null;

  const agentSlug = draft?.agentSlug ?? DIGITAL_TWIN_SLUG;

  return (
    <div className='absolute inset-y-0 right-0 z-20 flex w-full max-w-[480px] flex-col border-l border-border bg-background shadow-xl animate-slide-in-from-right'>
      <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
        <div className='flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5'>
          <TabButton
            active={tab === 'reasoning'}
            onClick={() => setTab('reasoning')}
            icon={<Sparkles size={13} />}
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
          onClick={onClose}
          aria-label='Close'
          data-track-category='twin-reasoning'
          data-track-name='close'
          className='ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <X size={16} />
        </button>
      </div>

      {tab === 'reasoning' ? (
        <div className='flex-1 overflow-y-auto p-4'>
          {draft?.reasoning ? (
            <ReasoningBody reasoning={draft.reasoning} draft={draft} />
          ) : (
            <p className='text-sm text-muted-foreground'>
              No reasoning was captured for this draft.
            </p>
          )}
        </div>
      ) : (
        // Reused run debugger — lazily mounted so it only fetches artifacts when
        // the Debug tab is actually opened. Scoped to this twin run.
        <div className='flex min-h-0 flex-1 flex-col'>
          <AskAIDebugPanel
            open
            inline
            agentSlug={agentSlug}
            conversationId={conversationId}
            onClose={onClose}
            selectedSessionId={draft?.sessionId ?? null}
          />
        </div>
      )}
    </div>
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

/**
 * The twin's rationale, rendered with the SAME clf- citation-chip pipeline as
 * thread messages: register the baked icon bytes, number the cited tools,
 * linkify `[clf-…#n]` tokens, then let createMarkdownComponents' `a`-override
 * swap them for clickable chips.
 */
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
    <>
      <div className='mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
        <Sparkles size={12} /> Why this reply
      </div>
      <div className='text-sm leading-relaxed text-foreground'>
        <MarkdownMessageRenderer
          content={citationContent}
          markdownComponents={markdownComponents}
        />
      </div>
    </>
  );
}
