import { logger, Event as LogEvent } from '../../utils/logger';
import {
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type ReactElement,
  type CSSProperties,
} from 'react';
import {
  Menu,
  Copy,
  ThumbsUp,
  ThumbsDown,
  ChevronLeft,
  ChevronRight,
  Link2,
  ArrowDown,
  Bug,
  Upload,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Link } from 'react-router-dom';
import { useXyneAIStream } from '../../hooks/useXyneAIStream';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import { useAskAIVersion } from '../../hooks/useAskAIVersion';
import type {
  Message,
  MessageAttachment,
  ToolInvocation as ToolInvocationType,
  ClawCitation,
  DebugEventRecord,
} from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { buildXyneAIStreamThreadId } from '../../utils/xyneAIStreamThreadId';
import { cn } from '../../utils/classNames';
import { AskAiRatingButtons } from './AskAiRatingButtons';
import { AIComposer, type AIComposerAttachment, type AIComposerHandle } from './AIComposer';
import { ReadonlyContextPills } from './ReadonlyContextPills';
import { type ComposerContext, toStreamOverrides } from './composerContext';
import { fetchV2ConversationMessages } from '../../services/XyneAI/XyneAISessionsV2Service';
import { xyneAIStreamManager } from '../../services/XyneAI/XyneAIStreamManager';
import { BASE_URL } from '../../services/clients/apiClient';
import { BrailleLoader, AnimatedLabel, useStableLabel } from './ReasoningLoader';
import { createMarkdownComponents } from '../../utils/markdownComponents';
import { StreamingMarkdownBlocks, rehypeStreamWordFade } from '../utils/StreamingMarkdownBlocks';
import {
  stripCitationMarks,
  extractInlineCitations,
  linkifyAndGroupClawCitations,
  parseCiteGroupHref,
  buildClawCitationToolNumbers,
  type InlineCitation,
} from '../ui/TipTapExtensions/CitationMark';
import { ClawCitationGroup } from '../Chat/XyneAISidebar/components/ClawCitationGroup';
import {
  findCitationForChunk,
  buildClawCitationUrl,
  getClawCitationLabel,
  citationOpensInNewTab,
  resolveCitationIconUrl,
} from '../Chat/XyneAISidebar/utils/clawCitationUrl';
import { CitationLink } from '../Chat/XyneAISidebar/components/CitationLink';
import { useCitationDocs, panelDocFromCitation } from './citationDocs';
import { MessageReactArtifacts } from './ReactArtifact';
import { Tooltip } from '../ui/Tooltip';
import {
  ConversationToolInvocationsContext,
  AttachmentPreview,
  useMentionResolver,
  processNodeForUserTags,
} from '../Chat/XyneAISidebar/components/MessageItem';
import { ToolInvocationList } from '../Chat/XyneAISidebar/components/ToolInvocationList';
import {
  ActivityStatusChip,
  LiveReasoning,
  formatDuration,
  formatCount,
  useElapsedMs,
  useSmoothCount,
} from '../Chat/XyneAISidebar/components/activityShared';
import { AskAIDebugPanel } from '../Chat/XyneAISidebar/components/AskAIDebugPanel';
import {
  resolveActivePath,
  getSiblings,
  BRANCH_ROOT_KEY,
} from '../Chat/XyneAISidebar/utils/XyneAIUtils';

type FeedbackValue = 'LIKE' | 'DISLIKE' | null;

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface AIChatThreadProps {
  sessionId?: string | undefined;
  initialQuery?: string | undefined;
  initialAttachments?: AIComposerAttachment[] | undefined;
  /** Context/toggles chosen on the landing composer — applied to the first
   *  auto-submitted turn and used to seed the chat composer. */
  initialExtras?: ComposerContext | undefined;
  onSetMobileSidebarOpen?: ((open: boolean) => void) | undefined;
  onConversationChange?: ((sessionId: string) => void) | undefined;
  /** Forwarded to the composer's AIAgentSelector — fires when the user picks
   *  a different agent from inside an active chat, so the parent can open a
   *  fresh conversation scoped to that agent. Carries the current composer
   *  context so the parent can preserve the user's selections across the switch. */
  onAgentChange?: ((slug: string | null, context: ComposerContext) => void) | undefined;
  /** Bubbled up from the composer so the parent can preserve the user's
   *  selections when switching to a recent chat. */
  onContextChange?: ((context: ComposerContext) => void) | undefined;
  /** Fired once the landing query has actually been submitted, so the parent can
   *  drop it. The in-component guard is a `useRef`, which resets on remount — if
   *  the parent keeps handing the same `initialQuery` back, ANY remount re-sends
   *  it and opens yet another conversation. Clearing it at the source is the
   *  guard that survives a remount. */
  onInitialQueryConsumed?: (() => void) | undefined;
}

export interface AIChatThreadHandle {
  addFiles: (files: File[]) => void;
}

const toMessageAttachments = (attachments: AIComposerAttachment[]): MessageAttachment[] =>
  attachments.map(att => ({
    filename: att.filename,
    mimeType: att.mimeType,
    data: att.data,
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function newStreamSlotKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Strip bracketed citation-shaped tokens that lack the `clf-` prefix. Covers
// both the canonical-malformed form `[custom-ref-123#1]` AND range/multi-#
// hallucinations like `[tool-read#0-#1]`. clf-prefixed tokens are left alone
// so the main linkify → stripCitationMarks pipeline can either render them
// as chips or strip them as malformed.
const NON_CLF_CITATION_TOKEN_RE = /[【[⟦]\s*([A-Za-z0-9_.:-]+)#[\d._#-]+\s*[】\]⟧]/g;

function stripNonClfCitationTokens(content: string): string {
  return content.replace(NON_CLF_CITATION_TOKEN_RE, (match, rawId: string) =>
    rawId.startsWith('clf-') ? match : '',
  );
}

// The model sometimes cites a tool using its function-path form
// `functions.<toolName>:<callIdx>` instead of the real toolCallId. Strip the
// `functions.` prefix and the trailing `:<idx>` so the result can match
// against a tool's `toolName` in knownToolCallIds.
function normalizeCitedToolId(id: string): string {
  let normalized = id.startsWith('functions.') ? id.slice('functions.'.length) : id;
  const colonIdx = normalized.lastIndexOf(':');
  if (colonIdx > 0 && /^\d+$/.test(normalized.slice(colonIdx + 1))) {
    normalized = normalized.slice(0, colonIdx);
  }
  return normalized;
}

// Strip markdown-link citation form `[label](cite:<href>)` when the cited
// (toolCallId, chunkIndex) pair doesn't correspond to a real citation in
// any of this message's tool invocations. Accepts both `cite:clf-…` and
// `cite:tool-…` / `cite:functions.…` etc. — the LLM types these literally
// as examples. A link survives only if its (id, chunk) is in
// validCitationKeys (which indexes both raw toolCallId / toolName and
// normalized synthetic forms).
const CITE_LINK_RE = /\[[^\]]*\]\(cite:([^)]+)\)/g;

function stripUnknownCiteLinks(content: string, validCitationKeys: Set<string>): string {
  return content.replace(CITE_LINK_RE, (match, href: string) => {
    const body = href.startsWith('clf-') ? href.slice(4) : href;
    const hashIdx = body.lastIndexOf('#');
    if (hashIdx <= 0) return '';
    const toolCallId = body.slice(0, hashIdx);
    const chunkIndex = body.slice(hashIdx + 1);
    if (validCitationKeys.has(`${toolCallId}#${chunkIndex}`)) return match;
    if (validCitationKeys.has(`${normalizeCitedToolId(toolCallId)}#${chunkIndex}`)) return match;
    return '';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Topbar
// ═══════════════════════════════════════════════════════════════════════════════

function ChatTopbar({
  title,
  onOpenSidebar,
}: {
  title: string;
  onOpenSidebar?: () => void;
}): ReactElement {
  return (
    <header className='ai-chat-topbar flex h-12 shrink-0 items-center gap-1 border-b border-[#e5e2dc] bg-transparent px-3 backdrop-blur-md sm:px-4'>
      <button
        type='button'
        onClick={onOpenSidebar}
        aria-label='Open sidebar'
        aria-controls='ai-sidebar'
        className='grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground md:hidden'
        data-track-category='XyneAI'
        data-track-name='OPEN_MOBILE_SIDEBAR'
      >
        <Menu className='h-4 w-4' aria-hidden strokeWidth={1.75} />
      </button>
      <h1 className='flex-1 truncate text-[13.5px] font-medium text-foreground'>{title}</h1>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reasoning Section (expandable, matching xyne-search reference)
// ═══════════════════════════════════════════════════════════════════════════════

// Rotating phase labels shown while reasoning is streaming. We don't have
// pi-mono-style tool events here (just a single accumulating string), so we
// cycle through a small list of human-sounding phases driven by how much
// reasoning has arrived. Matches the "Thinking → Weighing it up → Reasoning"
// feel of the xyne-search /ai chip without faking tool-specific labels.
const STREAMING_PHASES = ['Thinking', 'Weighing it up', 'Reasoning'] as const;

function phaseLabelFor(reasoningLength: number): string {
  if (reasoningLength === 0) return STREAMING_PHASES[0];
  if (reasoningLength < 240) return STREAMING_PHASES[1];
  return STREAMING_PHASES[2];
}

// Top + bottom fade mask for the expanded panel — mirrors the sidebar's
// ActivityBlock so the section bleeds into the surrounding message column
// instead of ending in a hard edge.
const REASONING_FADE_MASK_STYLE: CSSProperties = {
  WebkitMaskImage:
    'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)',
  maskImage:
    'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)',
};

function ReasoningSection({
  reasoning,
  isStreaming,
  toolInvocations,
  messageAborted,
}: {
  reasoning: string;
  isStreaming?: boolean | undefined;
  toolInvocations?: ToolInvocationType[] | undefined;
  messageAborted?: boolean | undefined;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const hasReasoning = reasoning.trim().length > 0;
  const hasTools = !!toolInvocations && toolInvocations.length > 0;
  const canExpand = hasReasoning || hasTools;
  // Anything to show? When this flips false on completion (pure text answer) the
  // grid-rows collapse eases the section out. No remount now (stable key), so the
  // transition actually animates.
  const shouldShow = !!isStreaming || hasReasoning || hasTools;

  // Throttled so the chip doesn't strobe through phases.
  const stablePhase = useStableLabel(phaseLabelFor(reasoning.length));
  const elapsedMs = useElapsedMs(!!isStreaming);
  const completedToolCount = (toolInvocations ?? []).filter(t => !t.parentToolCallId).length;
  const toolDurationSumMs = (toolInvocations ?? []).reduce((a, t) => a + (t.durationMs || 0), 0);
  const displayedDurationMs = elapsedMs ?? toolDurationSumMs;
  // Tool count tweens on the rare +1; the char count updates per delta (no
  // per-frame tween) — keeps streaming cheap.
  const smoothTools = useSmoothCount(completedToolCount);
  // Done label mirrors the sidebar: "Thought for Ns · N tools".
  const doneLabel =
    displayedDurationMs > 0
      ? `Thought for ${formatDuration(displayedDurationMs)}${hasTools ? ` · ${smoothTools} tool${smoothTools === 1 ? '' : 's'}` : ''}`
      : hasReasoning
        ? 'Thought process'
        : 'Reasoning';
  const liveText = isStreaming ? `${stablePhase}…` : doneLabel;
  // Streaming right-side metadata: live char counter + elapsed (tweened digits).
  const streamingBits = isStreaming
    ? [
        reasoning.length > 0 ? `${formatCount(reasoning.length)} chars` : null,
        displayedDurationMs > 0 ? formatDuration(displayedDurationMs) : null,
      ].filter(Boolean)
    : [];

  return (
    // Whole-section collapse: grid-rows(1fr↔0fr)+opacity eases the section out on
    // completion when nothing's left to show. Kept mounted (collapsed) so the exit
    // transitions; CSS only animates on change, so a message that starts hidden
    // (history) renders collapsed with no motion. Margin is on the inner div so it
    // collapses with the height.
    <div
      className={cn(
        'grid',
        shouldShow ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
      style={{ transition: 'grid-template-rows 220ms ease-out, opacity 180ms ease-out' }}
    >
      <div className='overflow-hidden'>
        <div className='my-1 text-[12.5px]'>
          <button
            type='button'
            onClick={() => {
              if (canExpand) setExpanded(!expanded);
            }}
            disabled={!canExpand}
            aria-expanded={expanded}
            aria-label={isStreaming ? liveText : 'Show reasoning'}
            className={cn(
              '-ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              canExpand ? 'hover:bg-secondary/70 hover:text-foreground' : 'cursor-default',
            )}
            data-track-category='XyneAI'
            data-track-name='TOGGLE_REASONING'
          >
            <ChevronRight
              className={cn(
                'h-3 w-3 flex-shrink-0 transition-transform duration-200',
                expanded && 'rotate-90',
                !canExpand && 'opacity-50',
              )}
              aria-hidden
              strokeWidth={2}
            />
            {isStreaming && <BrailleLoader />}
            <span className='select-none'>
              <AnimatedLabel text={liveText} />
            </span>
            {streamingBits.length > 0 && (
              <span className='text-[10px] tabular-nums text-muted-foreground/60'>
                · {streamingBits.join(' · ')}
              </span>
            )}
            {/* ONE consolidated status chip ("⟳ 2 running · ⧗ 5 bg") — fixed
            footprint, tweened counts, so the header never grows or jumps as
            parallel calls come and go. Renders after completion too while
            detached background work is still running. */}
            <ActivityStatusChip toolInvocations={toolInvocations} />
          </button>

          {/* Live streaming surface: streams the model's reasoning live in a bounded
          auto-scroll window. Collapses out (grid-rows + opacity) when streaming
          ends instead of unmounting abruptly; kept mounted while collapsed so the
          exit transitions. */}
          <div
            className={cn(
              'grid',
              isStreaming && hasReasoning
                ? 'grid-rows-[1fr] opacity-100'
                : 'grid-rows-[0fr] opacity-0',
            )}
            style={{ transition: 'grid-template-rows 220ms ease-out, opacity 180ms ease-out' }}
          >
            <div className='overflow-hidden'>
              <div className='mt-1 pl-5'>
                <LiveReasoning reasoning={reasoning} streaming={!!isStreaming} lines={5} />
              </div>
            </div>
          </div>

          {/* Smooth expand/collapse via the grid-rows 0fr→1fr trick — quick, never
          snaps. Content stays mounted. */}
          {canExpand && (
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-200 ease-out',
                expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className='overflow-hidden'>
                <div
                  className='mt-1.5 max-h-[28rem] overflow-y-auto pl-5 pr-0.5 py-2 space-y-3'
                  style={REASONING_FADE_MASK_STYLE}
                >
                  {hasReasoning && (
                    <div>
                      <div className='mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70'>
                        Reasoning
                      </div>
                      <pre className='whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground'>
                        {reasoning}
                      </pre>
                    </div>
                  )}

                  {hasTools && (
                    <div>
                      {hasReasoning && (
                        <div className='mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70'>
                          Tool calls
                        </div>
                      )}
                      <ToolInvocationList
                        invocations={toolInvocations}
                        messageAborted={messageAborted}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Citation Chip + Inline Citations (ported from XyneAISidebar/MessageItem)
// ═══════════════════════════════════════════════════════════════════════════════

const buildClawCitationTooltip = (citation: ClawCitation | null): string => {
  if (!citation) return 'Citation';
  if (citation.kind === 'ticket' && citation.ticketId) {
    return citation.channelName
      ? `Ticket ${citation.ticketId} in #${citation.channelName}`
      : `Ticket ${citation.ticketId}`;
  }
  if (citation.kind === 'thread') {
    return citation.channelName ? `Thread in #${citation.channelName}` : 'Spaces thread';
  }
  if (citation.kind === 'canvas') {
    return citation.label ? `Canvas — ${citation.label}` : 'Canvas';
  }
  if (citation.kind === 'recording') {
    return citation.label ? `Recording — ${citation.label}` : 'Recording';
  }
  if (citation.kind === 'external') {
    return citation.label || citation.url || 'External link';
  }
  if (citation.kind === 'collection-item') {
    const name = citation.fileName || citation.label || 'Knowledge base file';
    return typeof citation.chunkIndex === 'number'
      ? `KB · ${name} (chunk ${citation.chunkIndex})`
      : `KB · ${name}`;
  }
  return getClawCitationLabel(citation);
};

function ClawCitationChip({
  toolCallId,
  chunkIndex,
  toolNumber,
  toolInvocations,
  onOpenToolDebug,
}: {
  toolCallId: string;
  chunkIndex: number;
  toolNumber: number;
  toolInvocations: ToolInvocationType[] | undefined;
  /** Generic auto-citations carry no link — clicking opens the originating tool
   *  call in the debug panel instead. Absent for normal (linkable) citations. */
  onOpenToolDebug?: ((toolCallId: string) => void) | undefined;
}): ReactElement {
  // Prefer the conversation-wide pool (cross-turn lookup); fall back to the
  // per-message prop so the chip still resolves if the provider is absent.
  const conversationTools = useContext(ConversationToolInvocationsContext);
  const lookupTools =
    conversationTools && conversationTools.length > 0 ? conversationTools : toolInvocations;
  const citation = findCitationForChunk(lookupTools, toolCallId, chunkIndex);
  const url = citation ? buildClawCitationUrl(citation) : null;

  // On the /ai page a KB PDF citation opens in the right-side docs panel instead
  // of navigating away (mirrors xyne-search). The provider is only present on
  // /ai, so elsewhere `citationDocs` is null and we fall back to navigation.
  const citationDocs = useCitationDocs();
  const panelDoc = citationDocs ? panelDocFromCitation(citation, url) : null;
  const openInPanel = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (panelDoc) citationDocs!.openDoc(panelDoc);
  };
  // Show the citation's header (title) instead of the bare number — easier to
  // read at a glance. Falls back to the number if the citation didn't resolve.
  const label = citation ? getClawCitationLabel(citation) : `${toolNumber}.${chunkIndex}`;
  const tooltip = buildClawCitationTooltip(citation);
  // Fixed-height pill, capped width; the label truncates with an ellipsis and
  // the full text shows on hover (tooltip).
  const chipClass =
    'claw-citation-chip inline-flex items-center gap-1 align-middle ' +
    'px-1.5 h-[1.25rem] max-w-[180px] mx-[2px] rounded ' +
    'text-[10px] font-medium leading-none ' +
    'bg-muted/60 border border-border/50 hover:bg-accent hover:border-border transition-colors';

  // Brand icon (Gmail/Calendar/Drive/Xyne/…) supplied by claw. Resolved from
  // the citation's `iconKey` against the shared icon registry (or an inline
  // `iconUrl` on legacy/streaming rows). Rendered generically as an <img>, so
  // adding a new source's icon is a claw-only change — no per-app logic here.
  const iconUrl = resolveCitationIconUrl(citation);
  const chipInner = (
    <>
      {iconUrl ? (
        <img src={iconUrl} alt='' aria-hidden className='w-3 h-3 shrink-0 object-contain' />
      ) : null}
      <span className='min-w-0 truncate'>{label}</span>
    </>
  );
  const trigger = url ? (
    panelDoc ? (
      <button
        type='button'
        className={chipClass}
        aria-label={tooltip}
        onClick={openInPanel}
        data-track-category='ask-ai'
        data-track-name='citation-open-doc-panel'
      >
        {chipInner}
      </button>
    ) : (
      <CitationLink
        url={url}
        newTab={!!citation && citationOpensInNewTab(citation)}
        className={chipClass}
        ariaLabel={tooltip}
      >
        {chipInner}
      </CitationLink>
    )
  ) : onOpenToolDebug ? (
    // No link (generic auto-citation) — open the source tool call in the debug panel.
    <button
      type='button'
      className={chipClass}
      aria-label={`${tooltip} — open in debugger`}
      onClick={() => onOpenToolDebug(toolCallId)}
      data-track-category='XyneAI'
      data-track-name='DEBUG_CITATION_OPEN'
    >
      {chipInner}
    </button>
  ) : (
    <span className={chipClass} aria-label={tooltip}>
      {chipInner}
    </span>
  );

  return (
    <Tooltip content={tooltip} side='top' delayDuration={200} sideOffset={4}>
      {trigger}
    </Tooltip>
  );
}

function InlineCitations({ citations }: { citations: InlineCitation[] }): ReactElement | null {
  if (citations.length === 0) return null;
  const hasPoints = citations.some(c => c.point);
  return (
    <div className='mt-4 space-y-3'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {hasPoints ? 'Key Points' : 'Citations'}
      </h3>
      <ol className='space-y-3'>
        {citations.map((citation, idx) => (
          <li key={idx} className='flex items-start gap-2'>
            <span className='mt-0.5 min-w-[1.2rem] text-xs font-semibold text-muted-foreground'>
              {idx + 1}.
            </span>
            <div className='text-sm leading-relaxed text-foreground'>
              {citation.point ? (
                <span>
                  {citation.point}
                  {citation.label ? (
                    <span className='ml-1.5 inline-flex items-center align-middle'>
                      {citation.url ? (
                        <Link
                          to={citation.url}
                          className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                        >
                          <Link2 size={10} />
                          {citation.label}
                        </Link>
                      ) : (
                        <span className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>
                          <Link2 size={10} />
                          {citation.label}
                        </span>
                      )}
                    </span>
                  ) : null}
                </span>
              ) : citation.url ? (
                <Link
                  to={citation.url}
                  className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                >
                  <Link2 size={10} />
                  {citation.label}
                </Link>
              ) : (
                <span className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>
                  <Link2 size={10} />
                  {citation.label}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Branch Navigator (`< 2/3 >` version switcher) — mirrors the sidebar's MessageItem
// ═══════════════════════════════════════════════════════════════════════════════

function BranchNavigator({
  index,
  total,
  onNavigate,
}: {
  index: number;
  total: number;
  onNavigate: (direction: 'prev' | 'next') => void;
}): ReactElement {
  return (
    <div className='flex items-center gap-0.5 text-xs text-muted-foreground'>
      <button
        type='button'
        onClick={() => onNavigate('prev')}
        className='rounded p-0.5 transition-colors hover:bg-muted'
        data-track-category='XyneAI'
        data-track-name='BRANCH_NAVIGATE_PREV'
      >
        <ChevronLeft size={14} />
      </button>
      <span className='min-w-[2rem] text-center tabular-nums'>
        {index + 1}/{total}
      </span>
      <button
        type='button'
        onClick={() => onNavigate('next')}
        className='rounded p-0.5 transition-colors hover:bg-muted'
        data-track-category='XyneAI'
        data-track-name='BRANCH_NAVIGATE_NEXT'
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message Bubble (xyne-search style matching reference image)
// ═══════════════════════════════════════════════════════════════════════════════

// Stable identities for the streaming answer's markdown render. React matches
// JSX elements by component-type REFERENCE — if these were fresh inline values
// on every render, React would treat each streaming delta as all-new element
// types, discard the real DOM nodes and rebuild them (re-firing the mount fade
// = the blink). Hoisted to module scope so identity can never change.
const ANSWER_REMARK_PLUGINS = [remarkGfm, remarkBreaks];
// Word-fade spans for live-streamed answers (see rehypeStreamWordFade). Only
// applied on the everStreamed path so history messages carry no extra spans.
const ANSWER_REHYPE_PLUGINS = [rehypeStreamWordFade];
// Preserve `cite:clf-…` hrefs — react-markdown's default sanitizer strips
// non-http(s) schemes, which would erase the href before the `a` override can
// intercept it.
const preserveUrlTransform = (url: string): string => url;

function ChatMessageBubble({
  message,
  onCopy,
  onFeedback,
  feedbackValue,
  onDebug,
  onOpenToolDebug,
  onEditSubmit,
  onRegenerate,
  onFollowUpSuggestionClick,
  branchInfo,
  onBranchNavigate,
  isV2,
  onRatingChange,
}: {
  message: Message;
  onCopy?: () => void;
  onFeedback?: (messageId: string, feedbackType: 'LIKE' | 'DISLIKE') => void;
  feedbackValue?: FeedbackValue;
  /** v2 (claw-backed) surface: route 👍/👎 to agent_runs.rating instead of Langfuse. */
  isV2?: boolean;
  /** v2 rating change — lets the parent reflect the new feedback in message state. */
  onRatingChange?: (messageId: string, feedback: 0 | 1 | 2, comment?: string | null) => void;
  onDebug?: (() => void) | undefined;
  /** Open the debug panel focused on a specific tool call — for clicking a
   *  generic auto-citation chip (which has no link target). */
  onOpenToolDebug?: ((toolCallId: string) => void) | undefined;
  /** Fork a new sibling branch from an edited user message. Absent → no edit UI. */
  onEditSubmit?: ((newContent: string) => void) | undefined;
  /** Re-run the last user query as a new bot sibling. Set only on the latest bot. */
  onRegenerate?: (() => void) | undefined;
  onFollowUpSuggestionClick?: ((suggestion: string) => void) | undefined;
  /** Sibling position for the branch switcher; absent when there's only one version. */
  branchInfo?: { index: number; total: number } | undefined;
  onBranchNavigate?: ((direction: 'prev' | 'next') => void) | undefined;
}): ReactElement {
  const isUser = message.type === 'user';
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Once this message has streamed live, KEEP the per-block render after
  // completion: the subtree keeps the same component type, unchanged blocks
  // memo-bail, and the streaming→done transition reuses the existing DOM in
  // place instead of tearing down and rebuilding the whole answer (a visibly
  // harsh repaint, and async blocks like mermaid would flash through their
  // loading state). History messages that never streamed here keep the plain
  // single-parse render, so cross-block markdown (reference links, footnotes)
  // renders exactly as before for them.
  const everStreamedRef = useRef(message.isStreaming);
  if (message.isStreaming) everStreamedRef.current = true;

  // Session-wide tool-invocation pool (flat union of every turn's invocations),
  // matching what ClawCitationChip uses to resolve citations. Citation validity
  // must be checked against the whole session — a later turn frequently cites a
  // chunk produced by a tool call in an earlier turn — not just this message's
  // own invocations. Fall back to the per-message list if the provider is absent.
  const conversationTools = useContext(ConversationToolInvocationsContext);
  // Memoized so downstream useMemo/useCallback (knownToolCallIds,
  // validCitationKeys, renderAnswerBlock) keep a stable identity across text
  // deltas — the `?? []` fallback would otherwise mint a fresh array every
  // render and defeat StreamingMarkdownBlocks' settled-block memo bail-out.
  const lookupTools = useMemo(
    () =>
      conversationTools && conversationTools.length > 0
        ? conversationTools
        : (message.toolInvocations ?? []),
    [conversationTools, message.toolInvocations],
  );

  // Set of every toolCallId AND toolName that actually ran across the session,
  // including nested tools (subagent calls). The invocation list is a flat array
  // storing both top-level and nested invocations — the `parentToolCallId` field
  // marks nesting. We add toolName too because the model often emits the
  // function-path form `functions.<toolName>:<idx>` instead of the real
  // toolCallId (see normalizeCitedToolId below).
  const knownToolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (const inv of lookupTools) {
      if (inv.toolCallId) {
        const id = inv.toolCallId.startsWith('clf-') ? inv.toolCallId.slice(4) : inv.toolCallId;
        ids.add(id);
      }
      if (inv.toolName) {
        ids.add(inv.toolName);
      }
    }
    return ids;
  }, [lookupTools]);

  // Per-(toolId, chunkIndex) validity set. A citation is real only if some
  // invocation has the cited chunkIndex in its `citations[]` array. We index
  // each chunk under multiple aliases — the invocation's own toolCallId,
  // its toolName, AND each child's toolCallId/toolName — because the model
  // sometimes cites a parent tool's chunk using a nested tool's identifier.
  // A citation token survives the strip pass only if one of these aliased
  // keys matches.
  const validCitationKeys = useMemo(() => {
    const set = new Set<string>();
    const invocations = lookupTools;
    for (const inv of invocations) {
      if (!inv.citations || inv.citations.length === 0) continue;
      const aliases: string[] = [];
      if (inv.toolCallId) {
        const id = inv.toolCallId.startsWith('clf-') ? inv.toolCallId.slice(4) : inv.toolCallId;
        aliases.push(id);
      }
      if (inv.toolName) aliases.push(inv.toolName);
      // The model often cites the parent tool's chunks using a nested
      // tool's name/id — index this invocation's chunks under each child
      // too so those citations survive.
      const children = inv.toolCallId
        ? invocations.filter(c => c.parentToolCallId === inv.toolCallId)
        : [];
      for (const child of children) {
        if (child.toolCallId) {
          const id = child.toolCallId.startsWith('clf-')
            ? child.toolCallId.slice(4)
            : child.toolCallId;
          aliases.push(id);
        }
        if (child.toolName) aliases.push(child.toolName);
      }
      for (const citation of inv.citations) {
        if (typeof citation.chunkIndex !== 'number') continue;
        for (const id of aliases) {
          set.add(`${id}#${citation.chunkIndex}`);
        }
      }
    }
    return set;
  }, [lookupTools]);

  // Build a stable `toolCallId → display number` map from the raw content and
  // rewrite `[clf-…#N]` tokens into markdown links pointing at synthetic
  // `cite:` hrefs. Order matters: linkify BEFORE strip so clf tokens are
  // turned into markdown links before stripCitationMarks eats them.
  //
  // Only assign numbers to tool IDs that resolve to a real (or nested) tool.
  // Unknown clf tokens stay raw and get stripped by stripCitationMarks.
  const clawCitationToolNumbers = useMemo(() => {
    const raw = message.content || message.streamingContent || '';
    const all = buildClawCitationToolNumbers(raw);
    const filtered = new Map<string, number>();
    let next = 1;
    for (const [id] of all) {
      if (knownToolCallIds.has(id) || knownToolCallIds.has(normalizeCitedToolId(id))) {
        filtered.set(id, next++);
      }
    }
    return filtered;
  }, [message.content, message.streamingContent, knownToolCallIds]);

  const displayContent = useMemo(() => {
    // While streaming, the manager batches deltas into `streamingContent` and
    // only writes `content` on completion. Reading content-only here is what
    // made /ai wait until the end to render anything; mirror the sidebar's
    // MessageItem and prefer streamingContent during streaming.
    const raw =
      message.type === 'bot' && message.isStreaming && message.streamingContent
        ? message.streamingContent
        : message.content || message.streamingContent || '';
    const linkified = linkifyAndGroupClawCitations(raw, clawCitationToolNumbers);
    const stripped = stripCitationMarks(linkified);
    const nonClfStripped = stripNonClfCitationTokens(stripped);
    const cleaned = stripUnknownCiteLinks(nonClfStripped, validCitationKeys);
    return message.isStreaming ? cleaned + '\n' : cleaned;
  }, [
    message.type,
    message.content,
    message.streamingContent,
    message.isStreaming,
    clawCitationToolNumbers,
    validCitationKeys,
  ]);

  const inlineCitations = useMemo(
    () => extractInlineCitations(message.content || message.streamingContent || ''),
    [message.content, message.streamingContent],
  );

  const markdownComponents = useMemo(() => createMarkdownComponents(message.id), [message.id]);

  // Resolve @-mentions to the same avatar+name chip the sidebar uses, so user
  // tagging looks identical on the AIScreen. Only names that map to exactly one
  // real workspace user become chips; everything else stays plain text.
  const resolveMention = useMentionResolver(message.userTags);

  // Volatile inputs of the markdown overrides, read through a ref so the
  // component identities below never depend on them. Updated every render —
  // the overrides always see current data without changing type reference.
  const latestAnswerDeps = useRef({
    resolveMention,
    lookupTools,
    validCitationKeys,
    clawCitationToolNumbers,
    onOpenToolDebug,
  });
  latestAnswerDeps.current = {
    resolveMention,
    lookupTools,
    validCitationKeys,
    clawCitationToolNumbers,
    onOpenToolDebug,
  };

  // THE anti-blink invariant (found via stream_debug logs): these override
  // components are memoized once per message. A fresh inline `p:`/`a:` arrow
  // per render is a NEW element type to React, which then rebuilds the real
  // <p>/<a> DOM nodes on every streaming delta — re-firing the mount fade on
  // text already on screen (the blink). With stable types React reconciles
  // the existing DOM in place, so the fade physically cannot re-fire.
  const answerComponents = useMemo<Components>(() => {
    const deps = latestAnswerDeps;
    return {
      ...markdownComponents,
      p: ({ children }) => <p>{processNodeForUserTags(children, deps.current.resolveMention)}</p>,
      li: ({ children, ...props }) => (
        <li {...props}>{processNodeForUserTags(children, deps.current.resolveMention)}</li>
      ),
      td: ({ children, ...props }) => (
        <td {...props}>{processNodeForUserTags(children, deps.current.resolveMention)}</td>
      ),
      th: ({ children, ...props }) => (
        <th {...props}>{processNodeForUserTags(children, deps.current.resolveMention)}</th>
      ),
      a: ({ href, children, ...props }) => {
        const {
          lookupTools: tools,
          validCitationKeys: validKeys,
          clawCitationToolNumbers: toolNumbers,
          onOpenToolDebug: openToolDebug,
        } = deps.current;
        // Grouped run of adjacent citations → one stacked cluster chip.
        if (href && href.startsWith('cite-group:')) {
          const groupRefs = parseCiteGroupHref(href);
          if (groupRefs.length >= 2) {
            return (
              <ClawCitationGroup
                refs={groupRefs}
                toolInvocations={tools}
                onOpenToolDebug={openToolDebug}
              />
            );
          }
        }
        if (href && href.startsWith('cite:clf-')) {
          const body = href.slice('cite:clf-'.length);
          const hashIdx = body.lastIndexOf('#');
          if (hashIdx > 0) {
            const citedId = body.slice(0, hashIdx);
            const chunkRaw = body.slice(hashIdx + 1);
            const chunkIndex = Number(chunkRaw);
            const toolNumber = toolNumbers.get(citedId) ?? 0;
            // Defense in depth — stripUnknownCiteLinks should have
            // removed any link without a backing citation, but
            // gate render here too so a survivor still falls
            // through to plain `<a>`/text rather than a fake chip.
            const hasBackingCitation =
              validKeys.has(`${citedId}#${chunkRaw}`) ||
              validKeys.has(`${normalizeCitedToolId(citedId)}#${chunkRaw}`);
            if (toolNumber > 0 && Number.isFinite(chunkIndex) && hasBackingCitation) {
              // Resolve the cited id to a real invocation. Prefer an
              // EXACT toolCallId match first: the model cites repeated
              // calls to the same tool as `functions.<name>:13` vs
              // `:14`, and that trailing index is the ONLY thing that
              // tells them apart. Normalizing to the bare toolName (and
              // taking the first match) collapses both onto the same
              // invocation → every same-tool citation resolves to one
              // file. So only fall back to toolName matching when no
              // invocation carries this exact id. (Mirrors the sidebar,
              // which matches on the raw cited id.)
              const stripClf = (id: string): string => (id.startsWith('clf-') ? id.slice(4) : id);
              const exactMatch = tools.find(
                inv => inv.toolCallId && stripClf(inv.toolCallId) === citedId,
              );
              const normalized = normalizeCitedToolId(citedId);
              const matchByName = exactMatch ?? tools.find(inv => inv.toolName === normalized);
              const resolvedToolCallId = matchByName?.toolCallId
                ? stripClf(matchByName.toolCallId)
                : citedId;
              return (
                <ClawCitationChip
                  toolCallId={resolvedToolCallId}
                  chunkIndex={chunkIndex}
                  toolNumber={toolNumber}
                  toolInvocations={tools}
                  onOpenToolDebug={openToolDebug}
                />
              );
            }
          }
        }

        const isExternal = (() => {
          if (!href) return false;
          try {
            const urlObj = new URL(href, window.location.origin);
            return urlObj.origin !== window.location.origin;
          } catch {
            return true;
          }
        })();

        if (isExternal) {
          return (
            <a href={href} target='_blank' rel='noopener noreferrer' {...props}>
              {children}
            </a>
          );
        }
        return (
          <a href={href} {...props}>
            {children}
          </a>
        );
      },
    };
  }, [markdownComponents]);

  // One definition of the answer's markdown render, shared verbatim by the
  // streaming per-block path and the completed single-parse path so both
  // produce identical output. Every prop has stable identity across streaming
  // deltas, so settled StreamingMarkdownBlocks blocks memo-bail entirely.
  // `wordFade` is constant for a given message's lifetime (true from the
  // first streaming render, false for history), so it never churns the
  // callback identity mid-stream.
  const wordFade = everStreamedRef.current;
  const renderAnswerBlock = useCallback(
    (markdown: string): ReactElement => (
      <ReactMarkdown
        remarkPlugins={ANSWER_REMARK_PLUGINS}
        rehypePlugins={wordFade ? ANSWER_REHYPE_PLUGINS : undefined}
        urlTransform={preserveUrlTransform}
        components={answerComponents}
      >
        {markdown}
      </ReactMarkdown>
    ),
    [answerComponents, wordFade],
  );

  const hasUserContent = isUser && message.content.trim().length > 0;
  const hasUserAttachments = isUser && !!message.attachments && message.attachments.length > 0;
  const hasAttachedContext =
    isUser && !!message.attachedContext && message.attachedContext.length > 0;
  if (isUser && !hasUserContent && !hasUserAttachments) {
    return null as unknown as ReactElement;
  }

  return (
    <div
      className={cn(
        'group w-full',
        isUser ? 'flex justify-end px-2 py-3 sm:px-4' : 'px-2 py-5 sm:px-4',
      )}
    >
      {isUser ? (
        <div
          className={cn(
            'flex flex-col items-end gap-1',
            isEditing ? 'w-full max-w-[90%]' : 'max-w-[78%]',
          )}
        >
          <div className='flex w-full items-start justify-end gap-1'>
            {/* Edit button — appears on hover to the left of the bubble, forks a
                new sibling branch from the same parent (mirrors the sidebar). */}
            {onEditSubmit && !isEditing && (
              <button
                type='button'
                onClick={() => {
                  setEditText(message.content);
                  setIsEditing(true);
                  setTimeout(() => editTextareaRef.current?.focus(), 0);
                }}
                className='mt-2 flex-shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100'
                title='Edit message'
                data-track-category='XyneAI'
                data-track-name='EDIT_MESSAGE'
              >
                <Pencil size={14} className='text-muted-foreground' />
              </button>
            )}
            <div
              className={cn(
                'ai-user-bubble rounded-3xl bg-[#ececec] px-4 py-2.5 text-[14.5px] leading-relaxed text-gray-900',
                isEditing ? 'w-full' : 'max-w-full',
              )}
            >
              {isEditing ? (
                <div className='flex flex-col gap-2'>
                  <textarea
                    ref={editTextareaRef}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (editText.trim()) {
                          onEditSubmit?.(editText.trim());
                          setIsEditing(false);
                        }
                      }
                      if (e.key === 'Escape') {
                        setIsEditing(false);
                      }
                    }}
                    className='min-h-[60px] w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-gray-900 outline-none'
                    rows={Math.max(2, editText.split('\n').length)}
                    data-track-category='XyneAI'
                    data-track-name='EDIT_TEXTAREA'
                  />
                  <div className='flex justify-end gap-2'>
                    <button
                      type='button'
                      onClick={() => setIsEditing(false)}
                      className='rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent'
                      data-track-category='XyneAI'
                      data-track-name='EDIT_CANCEL'
                    >
                      Cancel
                    </button>
                    <button
                      type='button'
                      onClick={() => {
                        if (editText.trim()) {
                          onEditSubmit?.(editText.trim());
                          setIsEditing(false);
                        }
                      }}
                      disabled={!editText.trim()}
                      className='rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50'
                      data-track-category='XyneAI'
                      data-track-name='EDIT_SUBMIT'
                    >
                      Send
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {hasUserAttachments && (
                    <div className={cn('flex flex-col gap-2', hasUserContent && 'mb-2')}>
                      {message.attachments!.map((attachment, index) => (
                        <AttachmentPreview key={index} attachment={attachment} />
                      ))}
                    </div>
                  )}
                  {hasUserContent && (
                    <div className='whitespace-pre-wrap'>
                      {processNodeForUserTags(
                        stripUnknownCiteLinks(
                          stripNonClfCitationTokens(stripCitationMarks(message.content)),
                          validCitationKeys,
                        ),
                        resolveMention,
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {/* Read-only context pills the user attached to this turn — persisted
              per message so they survive a reload (see ReadonlyContextPills).
              Rendered BELOW the message bubble. */}
          {hasAttachedContext && !isEditing && (
            <ReadonlyContextPills items={message.attachedContext!} />
          )}
          {/* Branch switcher for user-message versions (created via edit). */}
          {branchInfo && onBranchNavigate && !isEditing && (
            <BranchNavigator
              index={branchInfo.index}
              total={branchInfo.total}
              onNavigate={onBranchNavigate}
            />
          )}
        </div>
      ) : (
        <div className='flex min-w-0 flex-col gap-2'>
          {/* Reasoning section — also acts as the initial loading placeholder
              so the user sees "Reasoning" with bouncing dots from the moment
              streaming starts. When expanded, also reveals the tool-call tree
              inside (matching the sidebar's ActivityBlock layout). Always
              mounted so its grid-rows collapse can animate the exit on
              completion; it self-hides (collapsed) when there's nothing to show. */}
          <ReasoningSection
            reasoning={message.reasoning ?? ''}
            isStreaming={message.isStreaming}
            toolInvocations={message.toolInvocations}
            messageAborted={!!message.isAborted}
          />

          {displayContent && displayContent.length > 0 && (
            <div
              className={`bot-markdown-content xyne-ai-markdown text-[15px] font-normal leading-7 text-foreground${
                // Keyed off everStreamed (not isStreaming) so content that
                // lands AT completion — the final tail words, finalized
                // citation chips — still fades in instead of popping the
                // instant isStreaming flips false. Mount-only animations +
                // the no-remount architecture make the class harmless to
                // keep: settled DOM never re-animates.
                everStreamedRef.current ? ' streaming-answer-fade' : ''
              }`}
            >
              {everStreamedRef.current ? (
                <StreamingMarkdownBlocks content={displayContent} render={renderAnswerBlock} />
              ) : (
                renderAnswerBlock(displayContent)
              )}
            </div>
          )}

          {!isUser && <MessageReactArtifacts message={message} />}

          {/* Bot Message Attachments (e.g., generated PDFs from artifacts tool) */}
          {!isUser && message.attachments && message.attachments.length > 0 && (
            <div className='mt-2 space-y-2'>
              {message.attachments.map((attachment, index) => (
                <AttachmentPreview key={index} attachment={attachment} />
              ))}
            </div>
          )}

          {inlineCitations.length > 0 && <InlineCitations citations={inlineCitations} />}

          {!isUser &&
          !message.isStreaming &&
          onFollowUpSuggestionClick &&
          message.followUpSuggestions?.length ? (
            <div className='mt-1 flex flex-wrap gap-2' data-testid='ask-ai-follow-ups'>
              {message.followUpSuggestions.map(suggestion => (
                <button
                  key={suggestion}
                  type='button'
                  onClick={() => onFollowUpSuggestionClick(suggestion)}
                  className='rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs font-medium leading-5 text-muted-foreground transition-colors hover:bg-accent'
                  data-track-category='AskAI'
                  data-track-name='FollowUpSuggestion'
                  data-track-metadata={JSON.stringify({ suggestion })}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}

          {!isUser && onDebug && (
            <button
              type='button'
              onClick={onDebug}
              className='mt-1.5 inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              title='Debug this response'
              data-track-category='XyneAI'
              data-track-name='DEBUG_RESPONSE'
            >
              <Bug size={12} /> Debug this response
            </button>
          )}

          {/* Hover actions — on all bot messages */}
          {!isUser && !message.isStreaming && (
            <div className='mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100'>
              <button
                type='button'
                onClick={onCopy}
                title='Copy'
                className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
                data-track-category='XyneAI'
                data-track-name='COPY_MESSAGE'
              >
                <Copy className='h-3.5 w-3.5' aria-hidden strokeWidth={1.75} />
              </button>
              {isV2 ? (
                // v2 (claw): persist to agent_runs.rating (metrics + reload) with
                // an optional comment on 👎.
                <AskAiRatingButtons
                  messageId={message.id}
                  feedback={message.feedback}
                  comment={message.ratingComment}
                  onChange={(fb, c): void => onRatingChange?.(message.id, fb, c)}
                />
              ) : (
                <>
                  <button
                    type='button'
                    onClick={(): void => onFeedback?.(message.id, 'LIKE')}
                    title='Helpful'
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary hover:text-foreground',
                      feedbackValue === 'LIKE' ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    data-track-category='XyneAI'
                    data-track-name='LIKE_MESSAGE'
                  >
                    <ThumbsUp
                      className='h-3.5 w-3.5'
                      aria-hidden
                      strokeWidth={1.75}
                      fill={feedbackValue === 'LIKE' ? 'currentColor' : 'none'}
                      fillOpacity={feedbackValue === 'LIKE' ? 0.3 : 1}
                    />
                  </button>
                  <button
                    type='button'
                    onClick={(): void => onFeedback?.(message.id, 'DISLIKE')}
                    title='Not helpful'
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary hover:text-foreground',
                      feedbackValue === 'DISLIKE' ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    data-track-category='XyneAI'
                    data-track-name='DISLIKE_MESSAGE'
                  >
                    <ThumbsDown
                      className='h-3.5 w-3.5'
                      aria-hidden
                      strokeWidth={1.75}
                      fill={feedbackValue === 'DISLIKE' ? 'currentColor' : 'none'}
                      fillOpacity={feedbackValue === 'DISLIKE' ? 0.3 : 1}
                    />
                  </button>
                </>
              )}
              {/* Regenerate — re-runs the last user query as a new bot sibling.
                  Only wired on the latest bot message. */}
              {onRegenerate && (
                <button
                  type='button'
                  onClick={onRegenerate}
                  title='Regenerate response'
                  className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
                  data-track-category='XyneAI'
                  data-track-name='REGENERATE_MESSAGE'
                >
                  <RefreshCw className='h-3.5 w-3.5' aria-hidden strokeWidth={1.75} />
                </button>
              )}
              {/* Branch switcher for bot-response versions (created via regenerate). */}
              {branchInfo && onBranchNavigate && (
                <BranchNavigator
                  index={branchInfo.index}
                  total={branchInfo.total}
                  onNavigate={onBranchNavigate}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Chat Thread
// ═══════════════════════════════════════════════════════════════════════════════

export const AIChatThread = forwardRef<AIChatThreadHandle, AIChatThreadProps>(function AIChatThread(
  {
    sessionId,
    initialQuery,
    initialAttachments,
    initialExtras,
    onSetMobileSidebarOpen,
    onConversationChange,
    onAgentChange,
    onContextChange,
    onInitialQueryConsumed,
  },
  ref,
): ReactElement {
  const composerRef = useRef<AIComposerHandle | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      addFiles: (files: File[]): void => {
        composerRef.current?.addFiles(files);
      },
    }),
    [],
  );

  useEffect(() => {
    const el = dropZoneRef.current;
    if (!el) return;

    const hasFiles = (event: DragEvent): boolean =>
      Boolean(event.dataTransfer?.types?.includes('Files'));

    const handleDragEnter = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasFiles(event)) return;
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragging(true);
      }
    };
    const handleDragOver = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasFiles(event)) return;
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };
    const handleDragLeave = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasFiles(event)) return;
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };
    const handleDrop = (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const fileArray = Array.from(files).filter(f => f instanceof File);
      if (fileArray.length > 0) {
        composerRef.current?.addFiles(fileArray);
      }
    };

    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);
    return () => {
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('drop', handleDrop);
    };
  }, []);

  const [messages, setMessages] = useState<Message[]>([]);
  // Branch selection: parentId → chosen child id. Drives which sibling version
  // is shown at each fork. In-memory only — for v2 (claw) the backend persists
  // the tree via each message's parentId, so resolveActivePath defaults to the
  // latest branch on reload (no metadata save needed, matching the sidebar).
  const [branchSelections, setBranchSelections] = useState<Record<string, string>>({});
  const [conversationId, setConversationId] = useState<string>('');
  const [streamThreadKey, setStreamThreadKey] = useState<string>(
    () => sessionId ?? newStreamSlotKey(),
  );
  // True while this thread is on a draft (client-generated) stream slot — i.e. a
  // brand-new chat that hasn't acquired a server session yet. While draft, a
  // normal submit does NOT chain a parentId, so the first turn isn't linked as a
  // branch of another session. Flipped to false once the session is established
  // (see the draft→session migration effect below). Mirrors XyneAISidebar.
  const usesDraftStreamKeyRef = useRef<boolean>(!sessionId);
  const [debugEvents, setDebugEvents] = useState<DebugEventRecord[]>([]);
  const [debugArtifactsReadyVersion, setDebugArtifactsReadyVersion] = useState(0);
  const [showDebugger, setShowDebugger] = useState(false);
  const [debugTurnIndex, setDebugTurnIndex] = useState<number | null>(null);
  // Branching-safe debug pin: the AgentRun sessionId for the message being
  // debugged (carried on Message.debugSessionId from /messages runByMsgId). When
  // set, the panel filters runs by sessionId instead of the ambiguous turn index
  // — turn indices don't map cleanly once branches exist. Falls back to null
  // (turn-index path) for live streams whose run isn't linked yet. Mirrors the
  // sidebar.
  const [debugSessionId, setDebugSessionId] = useState<string | null>(null);
  // When opening the debugger from a citation chip, focus the panel on that
  // specific tool call; null means show the whole turn (opened via the toolbar
  // debug button).
  const [debugFocusToolCallId, setDebugFocusToolCallId] = useState<string | null>(null);
  const hasAutoSubmitted = useRef(false);
  const isLoadingSession = useRef(false);
  // Captures whether this thread instance was opened on an existing session
  // (sidebar selection) vs created fresh from the landing composer. Used to
  // suppress the backend re-fetch when sessionId is acquired mid-stream from
  // a new chat — re-fetching would race with the live stream and briefly
  // overwrite the streaming bot message, causing the loading dots to flicker
  // off and back on once reasoning starts.
  const mountedWithSessionIdRef = useRef<boolean>(Boolean(sessionId));

  // Read-only live viewer for a reloaded-mid-run conversation, keyed by the
  // sessionId it was attached for. Lives OUTSIDE the load-session effect so
  // effect re-runs can't tear it down mid-stream; detached only on unmount or
  // when the conversation actually changes.
  const liveViewerRef = useRef<{ sessionId: string; detach: () => void } | null>(null);
  useEffect(
    () => () => {
      liveViewerRef.current?.detach();
      liveViewerRef.current = null;
    },
    [],
  );
  // Conversation switch: drop the previous conversation's viewer.
  useEffect(() => {
    if (liveViewerRef.current && liveViewerRef.current.sessionId !== sessionId) {
      liveViewerRef.current.detach();
      liveViewerRef.current = null;
    }
  }, [sessionId]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [showJumpPill, setShowJumpPill] = useState(false);

  const threadId = useMemo(
    () =>
      buildXyneAIStreamThreadId({
        channelId: null,
        threadConversationId: null,
        streamSessionKey: streamThreadKey,
      }),
    [streamThreadKey],
  );

  void threadId; // Used by stream manager via useXyneAIStream internally

  const { selectedAgentSlug } = useSelectedAgent();
  const { askAIVersion } = useAskAIVersion();
  const isV2 = askAIVersion === 'v2';
  const effectiveAgentSlug = isV2 ? selectedAgentSlug : null;

  const { submitQuery, abortCurrentRequest } = useXyneAIStream({
    channelIds: [],
    conversationId,
    streamSessionKey: streamThreadKey,
    setMessages,
    setConversationId,
    setDebugEvents,
    setDebugArtifactsReadyVersion,
    isV2,
    agentSlug: effectiveAgentSlug,
  });

  // ── Branching: resolve the visible path from the full message tree ────────────
  // Mirrors XyneAISidebar. `messages` is the full tree (siblings share a
  // parentId); `displayMessages` is the single active path chosen by
  // `branchSelections`, defaulting to the most recent child at each fork.
  const displayMessages = useMemo(
    () => resolveActivePath(messages, branchSelections),
    [messages, branchSelections],
  );

  const isActiveSessionStreaming = useMemo(() => messages.some(m => m.isStreaming), [messages]);

  // Precompute the latest bot/user index in the active path plus each message's
  // sibling index/count, so the render pass doesn't re-scan on every delta.
  const { lastBotIndex, lastUserIndex, siblingIndexById, siblingCountById } = useMemo(() => {
    let botIdx = -1;
    let userIdx = -1;
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (botIdx === -1 && displayMessages[i]?.type === 'bot') botIdx = i;
      if (userIdx === -1 && displayMessages[i]?.type === 'user') userIdx = i;
      if (botIdx !== -1 && userIdx !== -1) break;
    }
    const indexById = new Map<string, number>();
    const countById = new Map<string, number>();
    const groups = new Map<string, string[]>();
    for (const m of messages) {
      const key = m.parentId ?? BRANCH_ROOT_KEY;
      const group = groups.get(key);
      if (group) group.push(m.id);
      else groups.set(key, [m.id]);
    }
    for (const [, group] of groups) {
      group.forEach((id, i) => {
        indexById.set(id, i);
        countById.set(id, group.length);
      });
    }
    return {
      lastBotIndex: botIdx,
      lastUserIndex: userIdx,
      siblingIndexById: indexById,
      siblingCountById: countById,
    };
  }, [messages, displayMessages]);

  // Legacy conversation: no message has a parentId — branching features disabled
  // (older sessions predate the tree; edit/regenerate/nav are hidden for them).
  const isLegacyConversation = useMemo(
    () =>
      messages.length > 0 && messages.every(m => m.parentId === null || m.parentId === undefined),
    [messages],
  );

  // Regenerate: re-submit the last user query, forking a sibling bot branch.
  const handleRegenerate = useCallback(async (): Promise<void> => {
    if (isActiveSessionStreaming) return;

    let lastUserMessage: Message | undefined;
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i]?.type === 'user') {
        lastUserMessage = displayMessages[i];
        break;
      }
    }
    if (!lastUserMessage) return;

    abortCurrentRequest();

    // parentId = the user message itself → the new bot response branches from it.
    await submitQuery(
      lastUserMessage.content,
      lastUserMessage.attachments ?? [],
      lastUserMessage.selectionContexts,
      lastUserMessage.content,
      undefined, // userTags
      lastUserMessage.id, // parentMessageId
      true, // isRegenerate
    );
  }, [isActiveSessionStreaming, displayMessages, abortCurrentRequest, submitQuery]);

  // Edit: fork a sibling branch with new content under the same parent. For v2
  // (claw) we pass `isEditUserMessage` + `editedUserMessageId` so claw-auth
  // clones the PI session BEFORE the original user message, keeping the pre-edit
  // assistant reply out of the new turn's context.
  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string): Promise<void> => {
      if (isActiveSessionStreaming) return;

      const messageToEdit = messages.find(m => m.id === messageId);
      if (!messageToEdit || messageToEdit.type !== 'user') return;

      abortCurrentRequest();

      const editedParentAssistant = messageToEdit.parentId ?? undefined;

      await submitQuery(
        newContent,
        messageToEdit.attachments ?? [],
        messageToEdit.selectionContexts,
        newContent,
        undefined, // userTags
        editedParentAssistant, // parentMessageId → sibling under same parent
        undefined, // isRegenerate
        true, // isEditUserMessage
        messageToEdit.id, // editedUserMessageId
        editedParentAssistant, // parentAssistantMessageId
      );
    },
    [isActiveSessionStreaming, messages, abortCurrentRequest, submitQuery],
  );

  // Navigate between sibling branches at a given message.
  const handleBranchNavigate = useCallback(
    (messageId: string, direction: 'prev' | 'next'): void => {
      const { siblings, currentIndex } = getSiblings(messages, messageId);
      if (siblings.length <= 1 || currentIndex === -1) return;

      const newIndex =
        direction === 'prev'
          ? (currentIndex - 1 + siblings.length) % siblings.length
          : (currentIndex + 1) % siblings.length;
      const newSibling = siblings[newIndex];
      if (!newSibling) return;

      const parentKey = newSibling.parentId ?? BRANCH_ROOT_KEY;
      setBranchSelections(prev => ({ ...prev, [parentKey]: newSibling.id }));
    },
    [messages],
  );

  // Promote the draft stream slot key → server session id once the first turn
  // completes. Keeps the threadId stable mid-stream, then re-homes the manager's
  // stream under the real session so follow-ups chain to it. After this flips
  // `usesDraftStreamKeyRef` to false, handleSubmit starts passing a parentId so
  // subsequent turns extend the thread instead of forking new root branches.
  useEffect(() => {
    if (!usesDraftStreamKeyRef.current || !conversationId) return;
    if (messages.some(m => m.isStreaming)) return;

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
      // v1: the backend mints a fresh server session id (id changed) — migrate
      // the threadId onto it and promote out of draft.
      xyneAIStreamManager.migrateThreadId(oldTid, newTid);
      setStreamThreadKey(conversationId);
      usesDraftStreamKeyRef.current = false;
    } else {
      // Same id, so there's nothing to migrate. Two cases land here:
      //   • v2 (claw reuses the client conversationId verbatim) after a turn
      //     completes — the slot is now server-backed, so promote out of draft.
      //   • An errored/never-established first turn (e.g. offline): conversationId
      //     is still the seeded draft key. Do NOT promote — there's no real
      //     session yet, and the next submit clears the dead turn (handleSubmit).
      // Without promoting the v2 case, the draft flag would stay stuck and every
      // later turn would be wrongly treated as a fresh draft. Mirrors XyneAISidebar.
      const lastBot = [...messages].reverse().find(m => m.type === 'bot');
      if (!lastBot?.errorInfo) {
        usesDraftStreamKeyRef.current = false;
      }
    }
  }, [messages, conversationId, streamThreadKey]);

  // Load existing session messages when sessionId is provided
  useEffect(() => {
    if (!sessionId || isLoadingSession.current) return;
    // Skip when sessionId was acquired mid-stream from a new chat — the
    // stream manager is already streaming the bot reply into local state.
    if (!mountedWithSessionIdRef.current) return;

    let cancelled = false;
    const loadSession = async (): Promise<void> => {
      isLoadingSession.current = true;
      // Carry the opened conversation's last user-turn context into the composer,
      // so switching chats pre-fills the input with the context you last used
      // there. Context is chat-wise: REPLACE the composer with this chat's
      // last-turn context, and CLEAR it when that turn had none — so a chat's
      // context never leaks into another chat.
      const seedComposerFromLastUserTurn = (msgs: Message[]): void => {
        const lastUser = [...msgs].reverse().find(m => m.type === 'user');
        composerRef.current?.setContext(lastUser?.attachedContext ?? []);
      };
      // Clear stale branch selections from any previously-viewed session; the
      // freshly-loaded tree defaults to its latest branch via resolveActivePath.
      setBranchSelections({});
      try {
        // Prefer the in-memory stream manager when it has a live or
        // recently-completed stream for this session (5-min TTL). The manager
        // holds the full streamed messages — reasoning included — while the
        // backend /messages endpoint may not persist reasoning, so a plain
        // server fetch loses it on switch-back. Mirrors XyneAISidebar's
        // handleLoadConversation adoption path.
        const live =
          xyneAIStreamManager.getActiveStream(threadId) ??
          xyneAIStreamManager.findActiveStreamBySessionId(sessionId);

        if (live && (live.status === 'streaming' || live.status === 'completed')) {
          const normalized = live.messages.map(m =>
            live.status === 'completed' && m.isStreaming ? { ...m, isStreaming: false } : m,
          );
          setMessages(normalized);
          seedComposerFromLastUserTurn(normalized);
          setConversationId(live.sessionId || sessionId);
          setDebugEvents(live.debugEvents);
          setDebugArtifactsReadyVersion(live.debugArtifactsReadyVersion);
          onConversationChange?.(sessionId);
          return;
        }

        // Reset debug state on a fresh server fetch — the bundle is fetched
        // by the panel on open via conversationId, so stale live events from a
        // previously-loaded session shouldn't leak in.
        setDebugEvents([]);
        setDebugArtifactsReadyVersion(0);
        setDebugSessionId(null);

        if (isV2) {
          const messages = await fetchV2ConversationMessages(sessionId, effectiveAgentSlug);
          const loadedMessages = messages.map(msg => ({
            ...msg,
            isStreaming: false,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
          }));

          // Overlay any local-only messages from the manager that haven't been
          // persisted yet (covers the race where the server hasn't committed
          // the just-finished bot reply when the user switches back).
          const liveForOverlay =
            xyneAIStreamManager.getActiveStream(threadId) ??
            xyneAIStreamManager.findActiveStreamBySessionId(sessionId);
          if (liveForOverlay) {
            const serverIds = new Set(loadedMessages.map(m => m.id));
            for (const localMsg of liveForOverlay.messages) {
              if (!serverIds.has(localMsg.id)) {
                loadedMessages.push({ ...localMsg, isStreaming: false });
              }
            }
          }

          setMessages(loadedMessages);
          seedComposerFromLastUserTurn(loadedMessages);
          setConversationId(sessionId);
          onConversationChange?.(sessionId);
          // Reload mid-run: no in-memory stream was adopted above, so attach a
          // read-only live viewer that streams an in-flight answer in. No-op if
          // the run already finished (the /live snapshot comes back empty).
          // Always (re)attach here: the MANAGER dedupes (no-ops when a live
          // viewer/driver already owns the thread, replaces a dead viewer's
          // leftover state), so a stale same-session ref — e.g. a viewer that
          // self-closed on `done` — can never block a fresh attach on return.
          if (!cancelled) {
            liveViewerRef.current = {
              sessionId,
              detach: xyneAIStreamManager.attachLiveViewer(
                threadId,
                sessionId,
                effectiveAgentSlug || 'ask-ai',
                loadedMessages,
              ),
            };
          }
          return;
        }
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[AIChatThread] Failed to load session:'),
          error: error,
        });
      } finally {
        isLoadingSession.current = false;
      }
    };

    void loadSession();
    // NOTE: no viewer detach here — this cleanup runs on every dep identity
    // change (e.g. onConversationChange re-created by a parent re-render), and
    // detaching would kill the live viewer mid-run while the manager state
    // stays 'streaming' (frozen bubble). Detach lives in the unmount-only
    // effect + the sessionId-change guard above.
    return () => {
      cancelled = true;
    };
  }, [sessionId, threadId, onConversationChange, effectiveAgentSlug, isV2]);

  // Auto-submit initialQuery once, applying the landing composer's chosen
  // context/toggles to this first turn. The ref guard resets on remount, so the
  // parent is told to drop the query too — see `onInitialQueryConsumed`.
  useEffect(() => {
    if (initialQuery && !hasAutoSubmitted.current) {
      hasAutoSubmitted.current = true;
      void submitQuery(
        initialQuery,
        toMessageAttachments(initialAttachments ?? []),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        initialExtras ? toStreamOverrides(initialExtras) : undefined,
      );
      // After the call, so "consumed" means "actually submitted" and the
      // attachments above are read before the parent drops them.
      onInitialQueryConsumed?.();
    }
  }, [initialQuery, initialAttachments, initialExtras, submitQuery, onInitialQueryConsumed]);

  // Notify parent when conversationId changes (draft -> real session)
  useEffect(() => {
    if (conversationId && onConversationChange) {
      onConversationChange(conversationId);
    }
  }, [conversationId, onConversationChange]);

  // Reset stick-to-bottom + hide the jump pill whenever the conversation
  // identity changes (draft → real session, or sidebar session swap that
  // doesn't trigger a remount). Matches xyne-search /ai behaviour where
  // every newly-opened chat starts pinned to the latest message.
  useEffect((): void => {
    isAtBottomRef.current = true;
    setShowJumpPill(false);
  }, [sessionId]);

  // Auto-scroll behaviour — mirrors xyne-search/ui2 c.$chatId.tsx so the
  // jump-to-latest pill appears/disappears on the same gestures: scrolling
  // up via wheel, ArrowUp/PageUp/Home, or a noticeable swipe-up on touch.
  useEffect(() => {
    const scroll = scrollRef.current;
    const tail = tailRef.current;
    if (!scroll || !tail) return;

    const io = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (!entry) return;
        isAtBottomRef.current = entry.isIntersecting;
        setShowJumpPill(!entry.isIntersecting);
      },
      { root: scroll, rootMargin: '0px 0px 80px 0px', threshold: 0 },
    );
    io.observe(tail);

    // Re-pin the tail when content height grows while we're meant to be at
    // bottom. On revisit, messages render synchronously but markdown / syntax
    // highlight / KaTeX finish later, pushing the tail below the viewport
    // after the initial scrollIntoView ran — the IO then flips to "not at
    // bottom" and shows the jump pill even though the user never scrolled.
    const content = contentRef.current;
    const ro = content
      ? new ResizeObserver((): void => {
          if (!isAtBottomRef.current) return;
          tail.scrollIntoView({ block: 'end', behavior: 'instant' as ScrollBehavior });
        })
      : null;
    if (content && ro) ro.observe(content);

    const onWheel = (e: globalThis.WheelEvent): void => {
      if (e.deltaY < 0) isAtBottomRef.current = false;
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') {
        isAtBottomRef.current = false;
      }
    };
    let touchStartY: number | null = null;
    const onTouchStart = (e: globalThis.TouchEvent): void => {
      touchStartY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: globalThis.TouchEvent): void => {
      if (touchStartY === null) return;
      const y = e.touches[0]?.clientY ?? null;
      if (y === null) return;
      if (y - touchStartY > 8) {
        isAtBottomRef.current = false;
        touchStartY = null;
      }
    };

    scroll.addEventListener('wheel', onWheel, { passive: true });
    scroll.addEventListener('keydown', onKey);
    scroll.addEventListener('touchstart', onTouchStart, { passive: true });
    scroll.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      io.disconnect();
      ro?.disconnect();
      scroll.removeEventListener('wheel', onWheel);
      scroll.removeEventListener('keydown', onKey);
      scroll.removeEventListener('touchstart', onTouchStart);
      scroll.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  // Scroll to bottom on new messages / streaming updates
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const tail = tailRef.current;
    if (!tail) return;
    tail.scrollIntoView({ block: 'end', behavior: 'instant' as ScrollBehavior });
  }, [messages]);

  const jumpToLatest = useCallback((): void => {
    isAtBottomRef.current = true;
    setShowJumpPill(false);
    tailRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, []);

  const handleSubmit = useCallback(
    async (
      text: string,
      attachments?: AIComposerAttachment[],
      context?: ComposerContext,
    ): Promise<void> => {
      const hasAttachments = (attachments?.length ?? 0) > 0;
      if (!text.trim() && !hasAttachments) return;
      // Re-pin to the latest on submit so the new exchange is in view, matching
      // the xyne-search /ai composer behaviour.
      isAtBottomRef.current = true;
      setShowJumpPill(false);

      // Stuck-draft recovery: a fresh draft slot still holding a completed turn
      // means the first turn ended without ever establishing a server session
      // (it errored/aborted before the sessionId arrived). A follow-up would be
      // inserted as a second parentless root and resolveActivePath would fork
      // the tree (phantom 1/2 branch arrows). The dead turn was never persisted
      // — a reload already shows only the surviving turn — so drop it and start
      // the retry as a clean single-chain conversation. Only clears local
      // message state (not streamThreadKey/conversationId), so the submitQuery
      // closure stays valid. Mirrors XyneAISidebar.handleSubmit.
      if (
        usesDraftStreamKeyRef.current &&
        messages.length > 0 &&
        !messages.some(m => m.isStreaming)
      ) {
        setMessages([]);
        setBranchSelections({});
      }

      // Chain a normal follow-up from the last message in the active path so the
      // turn extends the current branch instead of forking a new root. Skipped
      // for legacy conversations (no tree — resolveActivePath shows them flat)
      // and while still on a draft stream slot (first turn of a new chat, before
      // a server session exists). Mirrors XyneAISidebar.handleSubmit.
      let parentMessageId: string | undefined;
      if (!isLegacyConversation && !usesDraftStreamKeyRef.current) {
        parentMessageId = displayMessages[displayMessages.length - 1]?.id;
      }

      await submitQuery(
        text,
        toMessageAttachments(attachments ?? []),
        undefined,
        undefined,
        undefined,
        parentMessageId,
        undefined,
        undefined,
        undefined,
        undefined,
        context ? toStreamOverrides(context) : undefined,
      );
    },
    [submitQuery, isLegacyConversation, displayMessages, messages],
  );

  const handleStop = useCallback((): void => {
    abortCurrentRequest();
  }, [abortCurrentRequest]);

  const handleFollowUpSuggestion = useCallback((suggestion: string): void => {
    composerRef.current?.setPrompt(suggestion);
  }, []);

  const handleFeedback = useCallback(
    async (messageId: string, feedbackType: 'LIKE' | 'DISLIKE'): Promise<void> => {
      let previousFeedback: 0 | 1 | 2 | undefined;
      let traceId: string | undefined;
      let nextFeedback: 0 | 1 | 2 = 0;

      setMessages(prevMessages =>
        prevMessages.map(msg => {
          if (msg.id !== messageId) return msg;
          previousFeedback = msg.feedback;
          traceId = msg.traceId;
          const desired: 0 | 1 | 2 = feedbackType === 'LIKE' ? 1 : 2;
          nextFeedback = msg.feedback === desired ? 0 : desired;
          return { ...msg, feedback: nextFeedback };
        }),
      );

      // Only call the backend when setting feedback (not when toggling off) and
      // when we actually have a trace to attach it to.
      if (nextFeedback === 0 || !traceId) return;

      try {
        // eslint-disable-next-line local-rules/no-fetch-use-axios
        const res = await fetch(`${BASE_URL}/xyne-ai/feedback`, {
          method: 'POST',
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            traceId,
            value: feedbackType,
          }),
        });
        if (!res.ok) throw new Error(`Feedback request failed: ${res.status}`);
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[AIChatThread] Failed to submit feedback:'),
          error: error,
        });
        // Revert to the previous feedback on failure
        setMessages(prevMessages =>
          prevMessages.map(msg =>
            msg.id === messageId ? { ...msg, feedback: previousFeedback ?? 0 } : msg,
          ),
        );
      }
    },
    [],
  );

  // v2 (claw) rating change — the AskAiRatingButtons already persisted to
  // agent_runs; here we reflect the new feedback in local message state AND in
  // the stream manager's cache so the thumb survives a soft nav-away-and-back
  // within the stream TTL (which adopts the cached snapshot instead of
  // refetching).
  const handleRatingChange = useCallback(
    (messageId: string, feedback: 0 | 1 | 2, comment?: string | null): void => {
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === messageId ? { ...msg, feedback, ratingComment: comment ?? null } : msg,
        ),
      );
      xyneAIStreamManager.patchMessageFeedback(messageId, feedback, comment ?? null);
    },
    [setMessages],
  );

  const isAnyMessageStreaming = messages.some(m => m.isStreaming);

  const streamingBotTurnIndex = useMemo(() => {
    const idx = displayMessages.findIndex(m => m.type === 'bot' && m.isStreaming);
    if (idx < 0) return -1;
    return displayMessages.slice(0, idx + 1).filter(m => m.type === 'bot').length - 1;
  }, [displayMessages]);

  // Keep the debugger pinned to the turn that is CURRENTLY streaming, so the
  // live trace never stays bound to a prior turn (which would flip
  // selectedTurnLive false and hide the live block on turns 2+). Fires only
  // while a turn is live; -1 when idle, leaving a manual older-turn selection
  // intact.
  useEffect(() => {
    if (streamingBotTurnIndex >= 0) {
      setDebugTurnIndex(streamingBotTurnIndex);
      setDebugSessionId(null);
    }
  }, [streamingBotTurnIndex]);

  // Flat union of every visible message's toolInvocations. Powers the
  // ConversationToolInvocationsContext so a citation chip rendered in turn N
  // can resolve to a ClawCitation that was produced by a tool call in turn 1.
  // Built from the active path so citations resolve against the shown branch.
  const conversationToolInvocations = useMemo<ToolInvocationType[]>(() => {
    const all: ToolInvocationType[] = [];
    for (const m of displayMessages) {
      if (m.toolInvocations && m.toolInvocations.length > 0) {
        all.push(...m.toolInvocations);
      }
    }
    return all;
  }, [displayMessages]);

  const title =
    messages.length > 0
      ? (messages.find(m => m.type === 'user')?.content.slice(0, 40) ?? 'New chat')
      : 'New chat';

  return (
    <div className='flex h-full min-w-0 flex-1'>
      <div ref={dropZoneRef} className='relative flex h-full min-w-0 flex-1 flex-col'>
        {isDragging && (
          <div className='pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-background/95 backdrop-blur-sm'>
            <div className='flex flex-col items-center gap-3'>
              <div className='rounded-full bg-primary/10 p-4'>
                <Upload className='h-8 w-8 text-primary' />
              </div>
              <div className='text-center'>
                <p className='text-lg font-medium text-foreground'>Drop files to attach</p>
                <p className='text-sm text-muted-foreground'>
                  Images, PDF, text, office documents, or data files
                </p>
              </div>
            </div>
          </div>
        )}
        <ChatTopbar title={title} onOpenSidebar={(): void => onSetMobileSidebarOpen?.(true)} />

        {/* Messages area — tabIndex enables keyboard scroll (PageUp/Home/ArrowUp)
          which the auto-scroll effect listens for to unstick from bottom. */}
        <div
          ref={scrollRef}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className='relative flex-1 overflow-y-auto px-2 py-6 focus:outline-none sm:px-4'
          role='log'
          aria-live='polite'
          aria-label='Chat messages'
        >
          <div ref={contentRef} className='mx-auto flex max-w-3xl flex-col'>
            <ConversationToolInvocationsContext.Provider value={conversationToolInvocations}>
              {displayMessages.map((message, idx) => {
                const feedbackValue: FeedbackValue =
                  message.feedback === 1 ? 'LIKE' : message.feedback === 2 ? 'DISLIKE' : null;
                const botTurnIndex =
                  message.type === 'bot'
                    ? displayMessages.slice(0, idx + 1).filter(m => m.type === 'bot').length - 1
                    : -1;
                // Branching is disabled for legacy conversations (no parentId).
                const branchEnabled = !isLegacyConversation;
                const isLatestUserMessage = idx === lastUserIndex;
                const isLatestBotMessage = idx === lastBotIndex;
                const siblingCount = siblingCountById.get(message.id) ?? 1;
                const branchInfo =
                  branchEnabled && siblingCount > 1
                    ? { index: siblingIndexById.get(message.id) ?? 0, total: siblingCount }
                    : undefined;
                return (
                  <ChatMessageBubble
                    // Stable key so the bubble doesn't remount when the id swaps
                    // temp→server at completion (which would kill the reasoning
                    // section's transitions).
                    key={message.stableKey ?? message.id}
                    message={message}
                    onCopy={() => {
                      void navigator.clipboard.writeText(
                        message.content || message.streamingContent || '',
                      );
                    }}
                    onFeedback={(id, type) => {
                      void handleFeedback(id, type);
                    }}
                    feedbackValue={feedbackValue}
                    isV2={isV2}
                    onRatingChange={handleRatingChange}
                    onDebug={
                      isV2 && message.type === 'bot'
                        ? () => {
                            setDebugTurnIndex(botTurnIndex);
                            // Pin to this message's run when known (branching-safe);
                            // null falls back to turn-index for unlinked live runs.
                            setDebugSessionId(message.debugSessionId ?? null);
                            setDebugFocusToolCallId(null);
                            setShowDebugger(true);
                          }
                        : undefined
                    }
                    onOpenToolDebug={
                      isV2 && message.type === 'bot'
                        ? (toolCallId: string) => {
                            setDebugTurnIndex(botTurnIndex);
                            setDebugSessionId(message.debugSessionId ?? null);
                            setDebugFocusToolCallId(toolCallId);
                            setShowDebugger(true);
                          }
                        : undefined
                    }
                    onEditSubmit={
                      branchEnabled && isLatestUserMessage
                        ? (newContent: string) => void handleEditMessage(message.id, newContent)
                        : undefined
                    }
                    onRegenerate={
                      branchEnabled && isLatestBotMessage && !message.isStreaming
                        ? () => void handleRegenerate()
                        : undefined
                    }
                    onFollowUpSuggestionClick={
                      isV2 && isLatestBotMessage && !message.isStreaming
                        ? handleFollowUpSuggestion
                        : undefined
                    }
                    branchInfo={branchInfo}
                    onBranchNavigate={
                      branchInfo
                        ? (direction: 'prev' | 'next') =>
                            handleBranchNavigate(message.id, direction)
                        : undefined
                    }
                  />
                );
              })}
            </ConversationToolInvocationsContext.Provider>
            <div ref={tailRef} />
          </div>
        </div>

        {/* Bottom composer — pill sits above it, mirroring xyne-search /ai. */}
        <div className='relative shrink-0 px-4 pb-4 pt-3 sm:px-6'>
          {showJumpPill && (
            <button
              type='button'
              onClick={jumpToLatest}
              aria-label='Jump to latest'
              className='absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-full pb-2'
              data-track-category='XyneAI'
              data-track-name='JUMP_TO_LATEST'
            >
              <span className='inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[11.5px] font-medium text-foreground shadow-md transition hover:bg-secondary'>
                <ArrowDown className='h-3 w-3' aria-hidden strokeWidth={2} />
                Jump to latest
              </span>
            </button>
          )}
          <div className='mx-auto max-w-3xl'>
            <AIComposer
              ref={composerRef}
              autoFocus
              onSubmit={(text, attachments, context): void => {
                void handleSubmit(text, attachments, context);
              }}
              onAgentChange={onAgentChange}
              showAgentSelector={isV2}
              initialExtras={initialExtras}
              onContextChange={onContextChange}
              pending={isAnyMessageStreaming}
              onStop={handleStop}
              placeholder='Write a message...'
            />
          </div>
        </div>
      </div>

      {showDebugger && isV2 && (
        <AskAIDebugPanel
          inline
          open={showDebugger}
          conversationId={conversationId}
          agentSlug={effectiveAgentSlug || 'ask-ai'}
          liveEvents={debugEvents}
          running={isAnyMessageStreaming}
          artifactsReadyVersion={debugArtifactsReadyVersion}
          selectedTurnIndex={debugTurnIndex}
          selectedTurnLive={debugTurnIndex !== null && debugTurnIndex === streamingBotTurnIndex}
          selectedSessionId={debugSessionId}
          focusToolCallId={debugFocusToolCallId}
          onClose={() => setShowDebugger(false)}
        />
      )}
    </div>
  );
});
