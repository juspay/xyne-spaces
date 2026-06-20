import {
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ReactElement,
} from 'react';
import {
  Menu,
  Copy,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  ChevronRight,
  Link2,
  ArrowDown,
  Bug,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Link } from 'react-router-dom';
import { useXyneAIStream } from '../../hooks/useXyneAIStream';
import type {
  Message,
  ToolInvocation as ToolInvocationType,
  ClawCitation,
  DebugEventRecord,
} from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { buildXyneAIStreamThreadId } from '../../utils/xyneAIStreamThreadId';
import { cn } from '../../utils/classNames';
import { AIComposer } from './AIComposer';
import { fetchV2ConversationMessages } from '../../services/XyneAI/XyneAISessionsV2Service';
import { xyneAIStreamManager } from '../../services/XyneAI/XyneAIStreamManager';
import { BASE_URL } from '../../services/clients/apiClient';
import { BrailleLoader, AnimatedLabel, useStableLabel } from './ReasoningLoader';
import { createMarkdownComponents } from '../../utils/markdownComponents';
import {
  stripCitationMarks,
  extractInlineCitations,
  linkifyClawCitations,
  buildClawCitationToolNumbers,
  type InlineCitation,
} from '../ui/TipTapExtensions/CitationMark';
import {
  findCitationForChunk,
  buildClawCitationUrl,
  getClawCitationLabel,
} from '../Chat/XyneAISidebar/utils/clawCitationUrl';
import { Tooltip } from '../ui/Tooltip';
import { ConversationToolInvocationsContext } from '../Chat/XyneAISidebar/components/MessageItem';
import { ToolInvocationList } from '../Chat/XyneAISidebar/components/ToolInvocationList';
import { AskAIDebugPanel } from '../Chat/XyneAISidebar/components/AskAIDebugPanel';

type FeedbackValue = 'LIKE' | 'DISLIKE' | null;

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface AIChatThreadProps {
  sessionId?: string | undefined;
  initialQuery?: string | undefined;
  onSetMobileSidebarOpen?: ((open: boolean) => void) | undefined;
  onConversationChange?: ((sessionId: string) => void) | undefined;
}

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

function ReasoningSection({
  reasoning,
  isStreaming,
}: {
  reasoning: string;
  isStreaming?: boolean | undefined;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const hasReasoning = reasoning.trim().length > 0;
  const canExpand = hasReasoning;

  // Throttled so the chip doesn't strobe through phases.
  const stablePhase = useStableLabel(phaseLabelFor(reasoning.length));
  const liveText = isStreaming ? `${stablePhase}…` : 'Reasoning';

  return (
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
      </button>

      {expanded && hasReasoning && (
        <div className='ml-2 mt-1.5 max-h-80 overflow-y-auto overscroll-contain border-l-2 border-border/70 pl-3 pr-1'>
          <pre className='overflow-auto whitespace-pre-wrap break-words py-1 font-mono text-[11px] leading-relaxed text-muted-foreground'>
            {reasoning}
          </pre>
        </div>
      )}
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
  if (citation.kind === 'external') {
    return citation.label || citation.url || 'External link';
  }
  return getClawCitationLabel(citation);
};

function ClawCitationChip({
  toolCallId,
  chunkIndex,
  toolNumber,
  toolInvocations,
}: {
  toolCallId: string;
  chunkIndex: number;
  toolNumber: number;
  toolInvocations: ToolInvocationType[] | undefined;
}): ReactElement {
  // Prefer the conversation-wide pool (cross-turn lookup); fall back to the
  // per-message prop so the chip still resolves if the provider is absent.
  const conversationTools = useContext(ConversationToolInvocationsContext);
  const lookupTools =
    conversationTools && conversationTools.length > 0 ? conversationTools : toolInvocations;
  const citation = findCitationForChunk(lookupTools, toolCallId, chunkIndex);
  const url = citation ? buildClawCitationUrl(citation) : null;
  const label = `${toolNumber}.${chunkIndex}`;
  const tooltip = buildClawCitationTooltip(citation);
  const chipClass =
    'claw-citation-chip inline-flex items-center justify-center align-baseline ' +
    'px-1 min-w-[1.125rem] h-[1.125rem] mx-[2px] rounded ' +
    'text-[9.5px] font-medium tabular-nums leading-none ' +
    'bg-muted/60 border border-border/50 hover:bg-accent hover:border-border transition-colors';

  const trigger = url ? (
    <Link to={url} className={chipClass} aria-label={tooltip}>
      {label}
    </Link>
  ) : (
    <span className={chipClass} aria-label={tooltip}>
      {label}
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
// Message Bubble (xyne-search style matching reference image)
// ═══════════════════════════════════════════════════════════════════════════════

function ChatMessageBubble({
  message,
  onCopy,
  onRetry,
  onFeedback,
  feedbackValue,
  onDebug,
}: {
  message: Message;
  onCopy?: () => void;
  onRetry?: () => void;
  onFeedback?: (messageId: string, feedbackType: 'LIKE' | 'DISLIKE') => void;
  feedbackValue?: FeedbackValue;
  onDebug?: (() => void) | undefined;
}): ReactElement {
  const isUser = message.type === 'user';

  // Set of every toolCallId AND toolName that actually ran for this message,
  // including nested tools (subagent calls). `message.toolInvocations` is a
  // flat array storing both top-level and nested invocations — the
  // `parentToolCallId` field marks nesting. We add toolName too because the
  // model often emits the function-path form `functions.<toolName>:<idx>`
  // instead of the real toolCallId (see normalizeCitedToolId below).
  const knownToolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (const inv of message.toolInvocations ?? []) {
      if (inv.toolCallId) {
        const id = inv.toolCallId.startsWith('clf-') ? inv.toolCallId.slice(4) : inv.toolCallId;
        ids.add(id);
      }
      if (inv.toolName) {
        ids.add(inv.toolName);
      }
    }
    return ids;
  }, [message.toolInvocations]);

  // Per-(toolId, chunkIndex) validity set. A citation is real only if some
  // invocation has the cited chunkIndex in its `citations[]` array. We index
  // each chunk under multiple aliases — the invocation's own toolCallId,
  // its toolName, AND each child's toolCallId/toolName — because the model
  // sometimes cites a parent tool's chunk using a nested tool's identifier.
  // A citation token survives the strip pass only if one of these aliased
  // keys matches.
  const validCitationKeys = useMemo(() => {
    const set = new Set<string>();
    const invocations = message.toolInvocations ?? [];
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
  }, [message.toolInvocations]);

  // Build a stable `toolCallId → display number` map from the raw content and
  // rewrite `[clf-…#N]` tokens into markdown links pointing at synthetic
  // `cite:` hrefs. Order matters: linkify BEFORE strip so clf tokens are
  // turned into markdown links before stripCitationMarks eats them.
  //
  // Only assign numbers to tool IDs that resolve to a real (or nested) tool.
  // Unknown clf tokens stay raw and get stripped by stripCitationMarks.
  const clawCitationToolNumbers = useMemo(() => {
    const raw = message.content || '';
    const all = buildClawCitationToolNumbers(raw);
    const filtered = new Map<string, number>();
    let next = 1;
    for (const [id] of all) {
      if (knownToolCallIds.has(id) || knownToolCallIds.has(normalizeCitedToolId(id))) {
        filtered.set(id, next++);
      }
    }
    return filtered;
  }, [message.content, knownToolCallIds]);

  const displayContent = useMemo(() => {
    const raw = message.content || '';
    const linkified = linkifyClawCitations(raw, clawCitationToolNumbers);
    const stripped = stripCitationMarks(linkified);
    const nonClfStripped = stripNonClfCitationTokens(stripped);
    const cleaned = stripUnknownCiteLinks(nonClfStripped, validCitationKeys);
    return message.isStreaming ? cleaned + '\n' : cleaned;
  }, [message.content, message.isStreaming, clawCitationToolNumbers, validCitationKeys]);

  const inlineCitations = useMemo(
    () => extractInlineCitations(message.content || ''),
    [message.content],
  );

  const markdownComponents = useMemo(() => createMarkdownComponents(message.id), [message.id]);

  return (
    <div
      className={cn(
        'group w-full',
        isUser ? 'flex justify-end px-2 py-3 sm:px-4' : 'px-2 py-5 sm:px-4',
      )}
    >
      {isUser ? (
        <div className='ai-user-bubble max-w-[78%] rounded-3xl bg-[#ececec] px-4 py-2.5 text-[14.5px] leading-relaxed text-gray-900'>
          <div className='whitespace-pre-wrap'>
            {stripUnknownCiteLinks(
              stripNonClfCitationTokens(stripCitationMarks(message.content)),
              validCitationKeys,
            )}
          </div>
        </div>
      ) : (
        <div className='flex min-w-0 flex-col gap-2'>
          {/* Reasoning section — also acts as the initial loading placeholder
              so the user sees "Reasoning" with bouncing dots from the moment
              streaming starts, matching the xyne-search /ai behaviour. */}
          {(message.isStreaming || (message.reasoning && message.reasoning.trim().length > 0)) && (
            <ReasoningSection
              reasoning={message.reasoning ?? ''}
              isStreaming={message.isStreaming}
            />
          )}

          {message.toolInvocations && message.toolInvocations.length > 0 && (
            <ToolInvocationList
              invocations={message.toolInvocations}
              messageAborted={!!message.isAborted}
            />
          )}

          {displayContent && displayContent.length > 0 && (
            <div className='bot-markdown-content xyne-ai-markdown text-[15px] font-normal leading-7 text-foreground'>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                // Preserve `cite:clf-…` hrefs — react-markdown's default
                // sanitizer strips non-http(s) schemes, which would erase the
                // href before our `a` override can intercept it.
                urlTransform={url => url}
                components={{
                  ...markdownComponents,
                  a: ({ href, children, ...props }) => {
                    if (href && href.startsWith('cite:clf-')) {
                      const body = href.slice('cite:clf-'.length);
                      const hashIdx = body.lastIndexOf('#');
                      if (hashIdx > 0) {
                        const citedId = body.slice(0, hashIdx);
                        const chunkRaw = body.slice(hashIdx + 1);
                        const chunkIndex = Number(chunkRaw);
                        const toolNumber = clawCitationToolNumbers.get(citedId) ?? 0;
                        // Defense in depth — stripUnknownCiteLinks should have
                        // removed any link without a backing citation, but
                        // gate render here too so a survivor still falls
                        // through to plain `<a>`/text rather than a fake chip.
                        const hasBackingCitation =
                          validCitationKeys.has(`${citedId}#${chunkRaw}`) ||
                          validCitationKeys.has(`${normalizeCitedToolId(citedId)}#${chunkRaw}`);
                        if (toolNumber > 0 && Number.isFinite(chunkIndex) && hasBackingCitation) {
                          // Resolve the model's synthetic `functions.<toolName>:<idx>`
                          // form to the real toolCallId via toolName match — so
                          // clicking the chip opens the right source.
                          const normalized = normalizeCitedToolId(citedId);
                          const matchByName = message.toolInvocations?.find(
                            inv => inv.toolName === normalized,
                          );
                          const resolvedToolCallId = matchByName?.toolCallId
                            ? matchByName.toolCallId.startsWith('clf-')
                              ? matchByName.toolCallId.slice(4)
                              : matchByName.toolCallId
                            : citedId;
                          return (
                            <ClawCitationChip
                              toolCallId={resolvedToolCallId}
                              chunkIndex={chunkIndex}
                              toolNumber={toolNumber}
                              toolInvocations={message.toolInvocations}
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
                }}
              >
                {displayContent}
              </ReactMarkdown>
            </div>
          )}

          {inlineCitations.length > 0 && <InlineCitations citations={inlineCitations} />}

          {!isUser && !message.isStreaming && onDebug && (
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
              <button
                type='button'
                onClick={onRetry}
                title='Retry'
                className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
                data-track-category='XyneAI'
                data-track-name='RETRY_MESSAGE'
              >
                <RefreshCw className='h-3.5 w-3.5' aria-hidden strokeWidth={1.75} />
              </button>
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

export function AIChatThread({
  sessionId,
  initialQuery,
  onSetMobileSidebarOpen,
  onConversationChange,
}: AIChatThreadProps): ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>('');
  const [streamThreadKey] = useState<string>(() => sessionId ?? newStreamSlotKey());
  const [debugEvents, setDebugEvents] = useState<DebugEventRecord[]>([]);
  const [debugArtifactsReadyVersion, setDebugArtifactsReadyVersion] = useState(0);
  const [showDebugger, setShowDebugger] = useState(false);
  const [debugTurnIndex, setDebugTurnIndex] = useState<number | null>(null);
  const hasAutoSubmitted = useRef(false);
  const isLoadingSession = useRef(false);
  // Captures whether this thread instance was opened on an existing session
  // (sidebar selection) vs created fresh from the landing composer. Used to
  // suppress the backend re-fetch when sessionId is acquired mid-stream from
  // a new chat — re-fetching would race with the live stream and briefly
  // overwrite the streaming bot message, causing the loading dots to flicker
  // off and back on once reasoning starts.
  const mountedWithSessionIdRef = useRef<boolean>(Boolean(sessionId));

  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  const { submitQuery, abortCurrentRequest } = useXyneAIStream({
    channelIds: [],
    conversationId,
    streamSessionKey: streamThreadKey,
    setMessages,
    setConversationId,
    setDebugEvents,
    setDebugArtifactsReadyVersion,
    isV2: true,
  });

  // Load existing session messages when sessionId is provided
  useEffect(() => {
    if (!sessionId || isLoadingSession.current) return;
    // Skip when sessionId was acquired mid-stream from a new chat — the
    // stream manager is already streaming the bot reply into local state.
    if (!mountedWithSessionIdRef.current) return;

    const loadSession = async (): Promise<void> => {
      isLoadingSession.current = true;
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

        const messages = await fetchV2ConversationMessages(sessionId);
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
        setConversationId(sessionId);
        onConversationChange?.(sessionId);
      } catch (error) {
        console.error('[AIChatThread] Failed to load session:', error);
      } finally {
        isLoadingSession.current = false;
      }
    };

    void loadSession();
  }, [sessionId, threadId, onConversationChange]);

  // Auto-submit initialQuery once on mount
  useEffect(() => {
    if (initialQuery && !hasAutoSubmitted.current) {
      hasAutoSubmitted.current = true;
      void submitQuery(initialQuery, []);
    }
  }, [initialQuery, submitQuery]);

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
    async (text: string): Promise<void> => {
      if (!text.trim()) return;
      // Re-pin to the latest on submit so the new exchange is in view, matching
      // the xyne-search /ai composer behaviour.
      isAtBottomRef.current = true;
      setShowJumpPill(false);
      await submitQuery(text, []);
    },
    [submitQuery],
  );

  const handleStop = useCallback((): void => {
    abortCurrentRequest();
  }, [abortCurrentRequest]);

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
        console.error('[AIChatThread] Failed to submit feedback:', error);
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

  const isAnyMessageStreaming = messages.some(m => m.isStreaming);

  const streamingBotTurnIndex = useMemo(() => {
    const idx = messages.findIndex(m => m.type === 'bot' && m.isStreaming);
    if (idx < 0) return -1;
    return messages.slice(0, idx + 1).filter(m => m.type === 'bot').length - 1;
  }, [messages]);

  // Flat union of every visible message's toolInvocations. Powers the
  // ConversationToolInvocationsContext so a citation chip rendered in turn N
  // can resolve to a ClawCitation that was produced by a tool call in turn 1.
  const conversationToolInvocations = useMemo<ToolInvocationType[]>(() => {
    const all: ToolInvocationType[] = [];
    for (const m of messages) {
      if (m.toolInvocations && m.toolInvocations.length > 0) {
        all.push(...m.toolInvocations);
      }
    }
    return all;
  }, [messages]);

  const title =
    messages.length > 0
      ? (messages.find(m => m.type === 'user')?.content.slice(0, 40) ?? 'New chat')
      : 'New chat';

  return (
    <div className='flex h-full min-w-0 flex-1'>
      <div className='flex h-full min-w-0 flex-1 flex-col'>
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
          <div className='mx-auto flex max-w-3xl flex-col'>
            <ConversationToolInvocationsContext.Provider value={conversationToolInvocations}>
              {messages.map((message, idx) => {
                const feedbackValue: FeedbackValue =
                  message.feedback === 1 ? 'LIKE' : message.feedback === 2 ? 'DISLIKE' : null;
                const botTurnIndex =
                  message.type === 'bot'
                    ? messages.slice(0, idx + 1).filter(m => m.type === 'bot').length - 1
                    : -1;
                return (
                  <ChatMessageBubble
                    key={message.id}
                    message={message}
                    onCopy={() => {
                      void navigator.clipboard.writeText(message.content);
                    }}
                    onRetry={() => {
                      // Retry = resubmit the user's last prompt
                      const userMsg = messages[idx - 1];
                      if (userMsg && userMsg.type === 'user') {
                        void submitQuery(
                          userMsg.content,
                          [],
                          undefined,
                          undefined,
                          undefined,
                          message.id,
                          true,
                        );
                      }
                    }}
                    onFeedback={(id, type) => {
                      void handleFeedback(id, type);
                    }}
                    feedbackValue={feedbackValue}
                    onDebug={
                      message.type === 'bot'
                        ? () => {
                            setDebugTurnIndex(botTurnIndex);
                            setShowDebugger(true);
                          }
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
              autoFocus
              onSubmit={(text): void => {
                void handleSubmit(text);
              }}
              pending={isAnyMessageStreaming}
              onStop={handleStop}
              placeholder='Write a message...'
            />
          </div>
        </div>
      </div>

      {showDebugger && (
        <AskAIDebugPanel
          inline
          open={showDebugger}
          conversationId={conversationId}
          agentSlug='ask-ai'
          liveEvents={debugEvents}
          running={isAnyMessageStreaming}
          artifactsReadyVersion={debugArtifactsReadyVersion}
          selectedTurnIndex={debugTurnIndex}
          selectedTurnLive={debugTurnIndex !== null && debugTurnIndex === streamingBotTurnIndex}
          onClose={() => setShowDebugger(false)}
        />
      )}
    </div>
  );
}
