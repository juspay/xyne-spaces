import { logger, Event as LogEvent } from '../../../../utils/logger';
import {
  ReactElement,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
} from 'react';
import {
  Globe,
  Pencil,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Download,
  Check,
  Loader2,
  Bug,
  AlertTriangle,
} from 'lucide-react';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import { createMarkdownComponents } from '../../../../utils/markdownComponents';
import {
  StreamingMarkdownBlocks,
  rehypeStreamWordFade,
} from '../../../utils/StreamingMarkdownBlocks';
import {
  stripCitationMarks,
  extractInlineCitations,
  linkifyAndGroupClawCitations,
  parseCiteGroupHref,
  buildClawCitationToolNumbers,
  type InlineCitation,
} from '../../../ui/TipTapExtensions/CitationMark';
import { ClawCitationGroup } from './ClawCitationGroup';
import {
  findCitationForChunk,
  buildClawCitationUrl,
  getClawCitationLabel,
  citationOpensInNewTab,
  resolveCitationIconUrl,
} from '../utils/clawCitationUrl';
import { CitationLink } from './CitationLink';
import { genericInstance } from '../../../../services/clients/genericClient';
import type { Components } from 'react-markdown';
import {
  SingleStat,
  SimpleTable as Table,
  TimeSeriesChart as Highchart,
  BarChart1D as HighBarChart1D,
  VolumeChart as VolumeChartRenderer,
} from '../../../../components/Charts';
import type { ToolOutput as GeniusToolOutput } from '../../../../types/toolOutput';
import { PptSlideViewer } from '../../../PptSlideViewer';
import type { PptSlide } from '../../../PptSlideViewer';
import { PdfPageViewer } from '../../../PdfPageViewer';
import { PptxViewer } from '../../../PptxViewer';
import { Tooltip } from '../../../ui/Tooltip';
import { UserHoverWrapper } from '../../../ui/UserMentionPopover/UserMentionPopover';
import Avatar from '../../../ui/Avatar/Avatar';
import { useUser, useUsers } from '../../../../hooks/useUsers';
import { useProfilePictureUrl } from '../../../../hooks/useProfilePicture';
import FileDocumentIcon from '../../../icons/FileDocumentIcon';
import type {
  Message,
  SummarizerCitation,
  StreamingParsedContent,
  SummarizerKeyPoint,
  MessageAttachment,
  UserTag,
  Participant,
  SelectionContext,
  ToolInvocation as ToolInvocationType,
  ClawCitation,
} from '../utils/XyneAITypes';
import { ActivityBlock } from './ActivityBlock';
import { PendingActionBlock } from './PendingActionBlock';
import { respondToPendingAction } from '../../../../services/XyneAI/XyneAIPendingActionService';
import { Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AskAiRatingButtons } from '../../../AIScreen/AskAiRatingButtons';
import { Button } from '../../../ui/Button/Button';

/**
 * v3-style inline citation chip for `[clf-<toolCallId>#<chunkIndex>]` tokens.
 * Resolves to the structured ClawCitation on a ToolInvocation and renders as
 * a small clickable pill linking into Spaces. Falls back to a non-clickable
 * badge when no URL can be built (e.g. older agent output that doesn't carry
 * per-chunk citations).
 *
 * Lookup precedence: ConversationToolInvocationsContext (aggregate across
 * every turn in the conversation, so a tool invoked in turn 1 can still
 * resolve a chip rendered in turn 5) → falls back to the per-message
 * `toolInvocations` prop for safety.
 *
 * Display format `{toolNumber}.{chunkIndex}` matches v3's CitationChip so
 * users see consistent citation references across both surfaces.
 */
interface ClawCitationChipProps {
  toolCallId: string;
  chunkIndex: number;
  toolNumber: number;
  toolInvocations: ToolInvocationType[] | undefined;
  /** Generic auto-citations carry no link — clicking opens the originating tool
   *  call in the debug panel instead. Absent for normal (linkable) citations. */
  onOpenToolDebug?: ((toolCallId: string) => void) | undefined;
}

/**
 * Conversation-wide ToolInvocation pool. Populated by XyneAISidebar with the
 * flat union of `message.toolInvocations` across every visible message in the
 * current branch. ClawCitationChip prefers this over its per-message prop so
 * cross-turn citations (e.g. the bot in turn 5 referencing tool output from
 * turn 1) resolve correctly.
 */
export const ConversationToolInvocationsContext = createContext<ToolInvocationType[] | undefined>(
  undefined,
);

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

const ClawCitationChip = ({
  toolCallId,
  chunkIndex,
  toolNumber,
  toolInvocations,
  onOpenToolDebug,
}: ClawCitationChipProps): ReactElement => {
  // Prefer the conversation-wide pool (cross-turn lookup); fall back to the
  // per-message prop so the chip still resolves if the provider is absent.
  const conversationTools = useContext(ConversationToolInvocationsContext);
  const lookupTools =
    conversationTools && conversationTools.length > 0 ? conversationTools : toolInvocations;
  const citation = findCitationForChunk(lookupTools, toolCallId, chunkIndex);
  const url = citation ? buildClawCitationUrl(citation) : null;
  // Show the citation's header (title) instead of the bare number — easier to
  // read. Falls back to the number if the citation didn't resolve.
  const label = citation ? getClawCitationLabel(citation) : `${toolNumber}.${chunkIndex}`;
  const tooltip = buildClawCitationTooltip(citation);
  // `claw-citation-chip` is the hook for the `!important` override in
  // global.css that keeps the chip's text the paragraph's foreground colour
  // and un-underlined — otherwise `.xyne-ai-markdown a` would force link blue.
  // Hover swaps the neutral muted background for a soft rose tint so the
  // chip stands out without shouting. Dark-mode hover uses a low-opacity
  // rose so it stays readable on a near-black surface.
  // Fixed-height pill, capped width; the label truncates with an ellipsis and
  // the full text shows on hover (tooltip).
  const chipClass =
    'claw-citation-chip ' +
    'inline-flex items-center gap-1 align-middle ' +
    'px-1.5 h-[1.25rem] max-w-[180px] mx-[2px] rounded-xl ' +
    'text-[10px] font-medium leading-none ' +
    'bg-muted border border-border/50 ' +
    'hover:bg-accent hover:border-border ' +
    'transition-colors';

  // Brand icon (Gmail/Calendar/Drive/Xyne/…) supplied by claw. Resolved from
  // the citation's `iconKey` against the shared icon registry (or an inline
  // `iconUrl` on legacy/streaming rows). Rendered generically as an <img>, so
  // adding a new source's icon is a claw-only change — no per-app logic here.
  const iconUrl = resolveCitationIconUrl(citation);
  const chipInner = (
    <>
      {iconUrl ? (
        <img src={iconUrl} alt='' aria-hidden className='w-3.5 h-3.5 shrink-0 object-contain' />
      ) : null}
      <span className='min-w-0 truncate'>{label}</span>
    </>
  );
  const trigger = url ? (
    <CitationLink
      url={url}
      newTab={!!citation && citationOpensInNewTab(citation)}
      className={chipClass}
      ariaLabel={tooltip}
    >
      {chipInner}
    </CitationLink>
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
};

// Inline Citations Component - displays key points with inline citation pill badges
const InlineCitations = ({ citations }: { citations: InlineCitation[] }): ReactElement | null => {
  if (citations.length === 0) return null;

  const hasPoints = citations.some(c => c.point);

  return (
    <div className='space-y-3'>
      <h3 className='text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
        {hasPoints ? 'Key Points' : 'Citations'}
      </h3>
      <ol className='space-y-3'>
        {citations.map((citation, idx) => (
          <li key={idx} className='flex items-start gap-2'>
            <span className='text-xs font-semibold text-muted-foreground mt-0.5 min-w-[1.2rem]'>
              {idx + 1}.
            </span>
            <div className='text-sm text-foreground leading-relaxed'>
              {citation.point ? (
                <span>
                  {citation.point}
                  {citation.label ? (
                    <span className='ml-1.5 inline-flex items-center align-middle'>
                      {citation.url ? (
                        <Link
                          to={citation.url}
                          className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
                        >
                          <Link2 size={10} />
                          {citation.label}
                        </Link>
                      ) : (
                        <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground'>
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
                  className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
                >
                  <Link2 size={10} />
                  {citation.label}
                </Link>
              ) : (
                <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground'>
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
};

// ─── Image Component with Download Button (Sidebar only) ─────────────────────

const ImageWithDownload = ({
  src,
  alt,
  className,
}: React.ImgHTMLAttributes<HTMLImageElement>): ReactElement => {
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = (): void => {
    if (!src) return;

    void (async (): Promise<void> => {
      try {
        // Fetch the image as a blob to force download
        const response = await genericInstance.get<Blob>(src, {
          responseType: 'blob',
        });
        const blob = response.data;
        const blobUrl = window.URL.createObjectURL(blob);

        // Create a temporary anchor element to trigger download
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = alt || 'generated-image.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the blob URL
        window.URL.revokeObjectURL(blobUrl);

        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 2000);
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to download image:'),
          error: error,
        });
        // Fallback: try direct download
        const link = document.createElement('a');
        link.href = src;
        link.download = alt || 'generated-image.png';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    })();
  };

  return (
    <div className='relative inline-block max-w-full group'>
      <img src={src} alt={alt} className={className || 'max-w-full h-auto'} loading='lazy' />
      <button
        onClick={handleDownload}
        className='absolute top-2 right-2 p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-background z-10'
        title='Download image'
        data-track-category='xyne-ai'
        data-track-name='download-image'
      >
        {downloaded ? (
          <Check size={14} className='text-green-600' />
        ) : (
          <Download size={14} className='text-muted-foreground' />
        )}
      </button>
    </div>
  );
};

// ============================================================================
// User Tag Component and Utilities
// ============================================================================

// Memoized UserTag Component to prevent unnecessary re-renders.
// Rendered as a citation-style chip: a circular profile picture followed by the
// display name in a compact pill, mirroring the claw citation chip so inline
// @-mentions and source chips read as one visual family. The rich hover card
// (avatar + email + actions) is preserved via UserHoverWrapper. The shared
// Avatar handles the picture fetch + colored-initials fallback by userId.
const UserTagComponent = React.memo(({ userTag }: { userTag: UserTag }) => {
  const chipClass =
    'claw-citation-chip inline-flex items-center gap-1 align-middle ' +
    'pl-0.5 pr-1.5 h-[1.25rem] max-w-[180px] mx-[1px] rounded-full ' +
    'text-[10px] font-medium leading-none cursor-pointer border transition-colors ' +
    'bg-muted border-border/50 text-foreground hover:bg-accent hover:border-border';

  const chip = (
    <span className={chipClass}>
      {userTag.userId ? (
        <Avatar
          userId={userTag.userId}
          size='xs'
          rounded
          showActiveStatus={false}
          className='shrink-0'
        />
      ) : null}
      <span className='min-w-0 truncate'>{userTag.name}</span>
    </span>
  );

  return userTag.userId ? (
    <UserHoverWrapper userId={userTag.userId}>{chip}</UserHoverWrapper>
  ) : (
    chip
  );
});

UserTagComponent.displayName = 'UserTagComponent';

/** Resolves a candidate "@name" to a real workspace user, or null otherwise. */
type MentionResolver = (rawName: string) => UserTag | null;

const MENTION_AMBIGUOUS: unique symbol = Symbol('mention-ambiguous');

/**
 * Build a mention resolver from the run's `userTags` (server/input-resolved,
 * authoritative) PLUS the live workspace directory. A name resolves to a
 * mention only when it maps to exactly ONE real user — by display name, name,
 * or email local-part (so "@pradeesh.s" tags pradeesh.s@…). Ambiguous names
 * (e.g. two "John"s) resolve to nothing, so we never mis-tag.
 */
const makeMentionResolver = (
  userTags: Record<string, UserTag> | undefined,
  users: ReadonlyArray<{
    id: string;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
  }>,
): MentionResolver => {
  const map = new Map<string, UserTag | typeof MENTION_AMBIGUOUS>();
  const add = (key: string | null | undefined, tag: UserTag): void => {
    const k = key?.trim().toLowerCase();
    if (!k) return;
    const existing = map.get(k);
    if (existing === undefined) {
      map.set(k, tag);
    } else if (existing !== MENTION_AMBIGUOUS && existing.userId !== tag.userId) {
      map.set(k, MENTION_AMBIGUOUS);
    }
  };
  for (const u of users) {
    if (!u.id) continue;
    const display = u.displayName || u.name || (u.email ? u.email.split('@')[0]! : '') || 'Unknown';
    const tag: UserTag = { name: display, userId: u.id };
    add(u.name, tag);
    add(u.displayName, tag);
    if (u.email) add(u.email.split('@')[0], tag);
  }
  // userTags are explicit + authoritative — overwrite any directory entry.
  if (userTags) {
    for (const [key, tag] of Object.entries(userTags)) {
      const name = key.startsWith('<') && key.endsWith('>') ? key.slice(1, -1) : key;
      if (name) map.set(name.trim().toLowerCase(), tag);
    }
  }
  return (rawName: string): UserTag | null => {
    const hit = map.get(rawName.trim().toLowerCase());
    return hit && hit !== MENTION_AMBIGUOUS ? hit : null;
  };
};

/** Hook: a mention resolver for this message's userTags + the live directory.
 *  Exported so the AIScreen (AIChatThread) renders @-mentions as the same
 *  avatar+name chip as the sidebar. */
export const useMentionResolver = (userTags?: Record<string, UserTag>): MentionResolver => {
  const users = useUsers();
  return React.useMemo(() => makeMentionResolver(userTags, users), [userTags, users]);
};

/**
 * Replace `@Name` / `<Name>` references with a mention chip — but ONLY when the
 * name resolves to a real workspace user (via `resolve`). Any other "@text" is
 * left as plain text. Mirrors channels/threads, where only a real user becomes
 * a mention; arbitrary "@words" never do. For "@First Last …" it tags the
 * LONGEST leading run of words that resolves and leaves the rest as text.
 */
const processStringForUserTags = (str: string, resolve: MentionResolver): React.ReactNode[] => {
  if (!str || (str.indexOf('@') === -1 && str.indexOf('<') === -1)) return [str];

  // `@handle` / `@First Last` (words may contain . _ -) OR a `<Name>` placeholder.
  const re = /@([A-Za-z0-9][A-Za-z0-9._-]*(?:[ \t]+[A-Za-z0-9][A-Za-z0-9._-]*)*)|<([^>\n]+)>/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(str)) !== null) {
    const start = match.index;
    if (start > lastIndex) parts.push(str.slice(lastIndex, start));

    // `<Name>` form — resolve exactly; otherwise keep the literal untouched.
    if (match[2] !== undefined) {
      const tag = resolve(match[2].trim());
      parts.push(tag ? <UserTagComponent key={`m-${start}`} userTag={tag} /> : match[0]);
      lastIndex = re.lastIndex;
      continue;
    }

    // `@…` form — tag the longest leading run of words that resolves.
    const candidate = match[1]!;
    const tokens: Array<{ start: number; end: number; text: string }> = [];
    const wordRe = /[^ \t]+/g;
    let wm: RegExpExecArray | null;
    while ((wm = wordRe.exec(candidate)) !== null) {
      tokens.push({ start: wm.index, end: wm.index + wm[0].length, text: wm[0] });
    }

    let tag: UserTag | null = null;
    let consumedEnd = 0;
    for (let take = tokens.length; take >= 1; take--) {
      const found = resolve(candidate.slice(0, tokens[take - 1]!.end));
      if (found) {
        tag = found;
        consumedEnd = tokens[take - 1]!.end;
        break;
      }
    }
    // Single token with trailing punctuation, e.g. "John." → try "John".
    if (!tag && tokens.length > 0) {
      const first = tokens[0]!;
      const stripped = first.text.replace(/[.,;:!?]+$/g, '');
      if (stripped && stripped !== first.text) {
        const found = resolve(stripped);
        if (found) {
          tag = found;
          consumedEnd = first.start + stripped.length;
        }
      }
    }

    if (tag) {
      parts.push(<UserTagComponent key={`m-${start}`} userTag={tag} />);
      const remainder = candidate.slice(consumedEnd);
      if (remainder) parts.push(remainder);
    } else {
      parts.push(match[0]); // plain "@candidate"
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < str.length) parts.push(str.slice(lastIndex));
  return parts.length > 0 ? parts : [str];
};

/**
 * Process React node recursively to replace user tags. Exported for reuse on
 * the AIScreen so both ask-ai surfaces render mentions identically.
 */
export const processNodeForUserTags = (
  node: React.ReactNode,
  resolve: MentionResolver,
): React.ReactNode => {
  if (typeof node === 'string') {
    const parts = processStringForUserTags(node, resolve);
    return parts.length === 1 ? parts[0] : parts;
  }

  if (Array.isArray(node)) {
    return node.map((child: React.ReactNode, idx) => (
      <React.Fragment key={`user-tag-${idx}`}>
        {processNodeForUserTags(child, resolve)}
      </React.Fragment>
    ));
  }

  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{
      children?: React.ReactNode;
    }>;

    const children = element.props.children;

    const processedChildren =
      children !== undefined
        ? processNodeForUserTags(children as React.ReactNode, resolve)
        : undefined;

    return React.cloneElement(element, { children: processedChildren });
  }

  return node;
};

/**
 * Process a string to replace user tags with actual user names for copying
 * Returns plain text with user names instead of <Full Name> tags
 */
const processTextForCopy = (str: string, userTags?: Record<string, UserTag>): string => {
  if (!userTags || Object.keys(userTags).length === 0) return str;

  // Updated regex to match any content inside < > (e.g., <Pradeep J>, <Prajwal Prasad>)
  return str.replace(/<([^>]+)>/g, match => {
    const userTag = userTags[match];
    return userTag ? userTag.name : match;
  });
};

// Interfaces for component props
interface MessageContentProps {
  message: Message;
  displayContent: string;
  hasKeypoints: boolean | undefined;
  parsedContent: StreamingParsedContent | undefined;
  /** toolCallId → display number map, used to render inline `[clf-…#N]` chips. */
  clawCitationToolNumbers: ReadonlyMap<string, number>;
  /** Open the debug panel focused on a tool call — for generic auto-citation
   *  chips that have no link target. */
  onOpenToolDebug?: ((toolCallId: string) => void) | undefined;
  onCitationClick: (
    messageNumber: number,
    conversationIdMapping: Record<string, string>,
    messageIdMapping: Record<string, string>,
    channelIdMapping?: Record<string, string>,
  ) => void;
  onSummarizerCitationClick: (citation: SummarizerCitation) => void;
}

interface SingleStatObject {
  metric: string;
  value: string | number;
}

interface SingleStatSectionProps {
  singleStat: SingleStatObject | SingleStatObject[] | Record<string, string | number>[];
}

interface SummarizerContentProps {
  message: Message;
  onSummarizerCitationClick: (citation: SummarizerCitation) => void;
}

interface GeniusKeyPointsProps {
  parsedContent: StreamingParsedContent;
  message: Message;
  resolveMention: MentionResolver;
  onCitationClick: (
    messageNumber: number,
    conversationIdMapping: Record<string, string>,
    messageIdMapping: Record<string, string>,
    channelIdMapping?: Record<string, string>,
  ) => void;
}

interface MessageActionsProps {
  message: Message;
  copied: boolean;
  onCopy: () => void;
  onFeedback: (messageId: string, feedbackType: 'LIKE' | 'DISLIKE') => void;
  feedbackValue: 'LIKE' | 'DISLIKE' | null;
  onRegenerate?: (() => void) | undefined;
  /** v2 (claw-backed): route 👍/👎 to agent_runs.rating instead of Langfuse. */
  isV2?: boolean | undefined;
  onRatingChange?:
    | ((messageId: string, feedback: 0 | 1 | 2, comment?: string | null) => void)
    | undefined;
}

interface MessageItemProps {
  message: Message;
  onFeedback: (messageId: string, feedbackType: 'LIKE' | 'DISLIKE') => void;
  onCitationClick: (
    messageNumber: number,
    conversationIdMapping: Record<string, string>,
    messageIdMapping: Record<string, string>,
    channelIdMapping?: Record<string, string>,
  ) => void;
  onSummarizerCitationClick: (citation: SummarizerCitation) => void;
  feedbackValue: 'LIKE' | 'DISLIKE' | null;
  /** v2 (claw-backed): route 👍/👎 to agent_runs.rating instead of Langfuse. */
  isV2?: boolean | undefined;
  onRatingChange?:
    | ((messageId: string, feedback: 0 | 1 | 2, comment?: string | null) => void)
    | undefined;
  onRegenerate?: (() => void) | undefined;
  onEditSubmit?: ((newContent: string) => void) | undefined;
  onEditMobile?: (() => void) | undefined;
  isLatestBotMessage?: boolean | undefined;
  branchInfo?: { index: number; total: number } | undefined;
  onBranchNavigate?: ((direction: 'prev' | 'next') => void) | undefined;
  onDebug?: (() => void) | undefined;
  onFollowUpSuggestionClick?: ((suggestion: string) => void) | undefined;
  /** Open the debug panel focused on a specific tool call — used by generic
   *  auto-citation chips (which have no link target). */
  onOpenToolDebug?: ((toolCallId: string) => void) | undefined;
}

// Image preview component that fetches with auth and creates blob URL
const AttachmentImagePreview = ({
  attachment,
  displayName,
  onDownload,
  isDownloading,
}: {
  attachment: MessageAttachment;
  displayName: string;
  onDownload: () => void;
  isDownloading: boolean;
}): ReactElement => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasBase64Data = !!attachment.data;
  const attachmentId = attachment.id;

  useEffect(() => {
    let blobUrl: string | null = null;
    let isMounted = true;

    const loadImage = async (): Promise<void> => {
      // Case 1: Streaming with base64 data - use directly
      if (hasBase64Data && attachment.data) {
        setImageUrl(`data:${attachment.mimeType};base64,${attachment.data}`);
        setIsLoading(false);
        return;
      }

      // Case 2: Persisted attachment with ID - fetch via authenticated API
      if (attachmentId && !attachmentId.startsWith('temp-')) {
        try {
          const { apiInstance } = await import('../../../../services/clients/apiClient');
          const downloadUrl = `/xyne-ai/v2/attachments/${attachmentId}/download`;

          const response = await apiInstance.get(downloadUrl, {
            responseType: 'blob',
          });

          if (!isMounted) return;

          blobUrl = URL.createObjectURL(response.data as Blob);
          setImageUrl(blobUrl);
          setIsLoading(false);
        } catch (err) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[AttachmentImagePreview] Failed to load image:'),
            error: err,
          });
          if (isMounted) {
            setError('Failed to load image');
            setIsLoading(false);
          }
        }
      } else {
        // No valid image source
        setIsLoading(false);
      }
    };

    void loadImage();

    return () => {
      isMounted = false;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [attachment.data, attachment.mimeType, attachmentId, hasBase64Data]);

  if (isLoading) {
    return (
      <div className='relative overflow-hidden border border-border bg-card max-w-[300px] h-[150px] flex items-center justify-center'>
        <Loader2 size={24} className='animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div className='relative overflow-hidden border border-border bg-card max-w-[300px] p-4 text-center'>
        <span className='text-sm text-muted-foreground'>{error || 'Image unavailable'}</span>
      </div>
    );
  }

  return (
    <div className='relative group/image overflow-hidden border border-border bg-card max-w-[300px]'>
      <img src={imageUrl} alt={displayName} className='w-full h-auto' loading='lazy' />
      {/* Download button overlay */}
      <button
        onClick={onDownload}
        disabled={isDownloading}
        className='absolute top-2 right-2 p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border shadow-sm opacity-0 group-hover/image:opacity-100 transition-all duration-200 hover:bg-background disabled:opacity-50'
        title='Download image'
        data-track-category='xyne-ai'
        data-track-name='download-image'
      >
        {isDownloading ? (
          <Loader2 size={14} className='animate-spin text-muted-foreground' />
        ) : (
          <Download size={14} className='text-muted-foreground' />
        )}
      </button>
    </div>
  );
};

// Attachment preview component
export const AttachmentPreview = ({
  attachment,
}: {
  attachment: MessageAttachment;
}): ReactElement => {
  const isImage = attachment.mimeType.startsWith('image/');
  const isPdf = attachment.mimeType === 'application/pdf';
  const hasBase64Data = !!attachment.data;
  const attachmentId = attachment.id;
  const displayName = attachment.originalFilename || attachment.filename || 'Unnamed file';
  const [isDownloading, setIsDownloading] = useState(false);

  // Handle download for v2 attachments (from claw-auth)
  const handleDownload = async (): Promise<void> => {
    setIsDownloading(true);
    try {
      // If we have base64 data (streaming attachment), download directly
      if (hasBase64Data && attachment.data) {
        // Decode base64 to binary
        const byteCharacters = atob(attachment.data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: attachment.mimeType });

        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = displayName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        return;
      }

      // Otherwise, fetch from API using the real attachment ID
      if (!attachmentId || attachmentId.startsWith('temp-')) {
        const { toast } = await import('sonner');
        toast.error('Attachment not available for download yet');
        return;
      }

      // For v2 attachments, use the xyne-ai v2 download endpoint
      const downloadUrl = `/xyne-ai/v2/attachments/${attachmentId}/download`;

      // Import dynamically to avoid circular deps
      const { apiInstance } = await import('../../../../services/clients/apiClient');

      const response = await apiInstance.get(downloadUrl, {
        responseType: 'blob',
      });

      const blob = response.data as Blob;
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = displayName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[AttachmentPreview] Download failed:'),
        error: error,
      });
      const { toast } = await import('sonner');
      toast.error('Download failed', {
        description: error instanceof Error ? error.message : 'Failed to download file',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  // Render PDF viewer for PDF attachments
  if (isPdf) {
    const downloadUrl =
      hasBase64Data && attachment.data
        ? `data:application/pdf;base64,${attachment.data}`
        : attachmentId && !attachmentId.startsWith('temp-')
          ? `/xyne-ai/v2/attachments/${attachmentId}/download`
          : '';

    return (
      <PdfPageViewer
        attachmentId={attachmentId || ''}
        downloadUrl={downloadUrl}
        filename={displayName}
        title={displayName.replace(/\.pdf$/i, '')}
        base64Data={attachment.data}
      />
    );
  }

  // Render PPTX viewer for PowerPoint attachments
  const isPptx =
    attachment.mimeType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    attachment.mimeType === 'application/vnd.ms-powerpoint' ||
    displayName.toLowerCase().endsWith('.pptx') ||
    displayName.toLowerCase().endsWith('.ppt');

  if (isPptx) {
    const downloadUrl =
      hasBase64Data && attachment.data
        ? `data:${attachment.mimeType};base64,${attachment.data}`
        : attachmentId && !attachmentId.startsWith('temp-')
          ? `/xyne-ai/v2/attachments/${attachmentId}/download`
          : '';

    // Get slide data from attachment metadata (from xyne-claw)
    const slides = attachment.metadata?.slideJson as PptSlide[] | undefined;

    return (
      <PptxViewer
        attachmentId={attachmentId || ''}
        downloadUrl={downloadUrl}
        filename={displayName}
        title={displayName.replace(/\.(pptx|ppt)$/i, '')}
        base64Data={attachment.data}
        slides={slides}
        slideCount={slides?.length}
      />
    );
  }

  // Render image preview for both streaming and persisted attachments
  if (isImage) {
    return (
      <AttachmentImagePreview
        attachment={attachment}
        displayName={displayName}
        onDownload={() => void handleDownload()}
        isDownloading={isDownloading}
      />
    );
  }

  return (
    <div className='flex items-center gap-2 p-2 bg-card border border-border'>
      {attachmentId ? (
        // File attachment with ID - clickable download
        <button
          onClick={() => void handleDownload()}
          disabled={isDownloading}
          className='flex items-center gap-2 hover:opacity-80 transition-opacity disabled:opacity-50'
          data-track-category='xyne-ai'
          data-track-name='attachment-download'
        >
          <div className='flex-shrink-0 w-8 h-8 flex items-center justify-center bg-muted rounded'>
            <FileDocumentIcon color='currentColor' size={20} className='text-muted-foreground' />
          </div>
          <div className='flex flex-col overflow-hidden text-left'>
            <span className="text-sm font-medium text-foreground font-['Inter'] truncate">
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground font-['Inter']">
              {attachment.mimeType}
              {hasBase64Data && ' (preview)'}
              {isDownloading ? ' (downloading...)' : ' (click to download)'}
            </span>
          </div>
        </button>
      ) : (
        // File attachment without ID - show only
        <div className='flex items-center gap-2'>
          <div className='flex-shrink-0 w-8 h-8 flex items-center justify-center bg-muted rounded'>
            <FileDocumentIcon color='currentColor' size={20} className='text-muted-foreground' />
          </div>
          <div className='flex flex-col overflow-hidden'>
            <span className="text-sm font-medium text-foreground font-['Inter'] truncate">
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground font-['Inter']">
              {attachment.mimeType}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// Selection context preview component
const SelectionContextPreview = ({
  selection,
  onClick,
}: {
  selection: SelectionContext;
  onClick?: () => void;
}): ReactElement => {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex items-center gap-2 p-2 bg-muted border border-border hover:bg-accent transition-colors w-full text-left'
      title={`From canvas: ${selection.canvasTitle || 'Untitled'}`}
      data-track-category='XyneAI'
      data-track-name='SELECTION_CONTEXT_CLICK'
    >
      <div className='flex-shrink-0 w-8 h-8 flex items-center justify-center bg-background rounded'>
        <FileDocumentIcon color='currentColor' size={20} className='text-primary' />
      </div>
      <div className='flex flex-col overflow-hidden flex-1'>
        <span className="text-xs text-primary font-['Inter'] font-medium truncate">
          From canvas: {selection.canvasTitle || 'Untitled'}
        </span>
        <span className="text-sm text-foreground font-['Inter'] truncate">{selection.preview}</span>
      </div>
    </button>
  );
};

// Branch navigation UI: "< 1/2 >"
const BranchNavigator = ({
  index,
  total,
  onNavigate,
}: {
  index: number;
  total: number;
  onNavigate: (direction: 'prev' | 'next') => void;
}): ReactElement => (
  <div className='flex items-center gap-0.5 text-xs text-muted-foreground'>
    <button
      type='button'
      onClick={() => onNavigate('prev')}
      className='p-0.5 hover:bg-muted rounded transition-colors'
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
      className='p-0.5 hover:bg-muted rounded transition-colors'
      data-track-category='XyneAI'
      data-track-name='BRANCH_NAVIGATE_NEXT'
    >
      <ChevronRight size={14} />
    </button>
  </div>
);

/**
 * Render a `2:43 PM`-style time label for a message. Defensive against the
 * timestamp coming back from persisted history as a string/number instead of
 * a Date (Zod/JSON roundtrips don't preserve Date instances). Returns null
 * for invalid inputs so callers can skip the row entirely instead of showing
 * "Invalid Date".
 */
function formatMessageTime(input: Date | string | number | undefined | null): string | null {
  if (input === undefined || input === null) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const MessageItem = React.memo(
  ({
    message,
    onFeedback,
    onCitationClick,
    onSummarizerCitationClick,
    feedbackValue,
    isV2,
    onRatingChange,
    onRegenerate,
    onOpenToolDebug,
    onEditSubmit,
    onEditMobile,
    isLatestBotMessage,
    branchInfo,
    onBranchNavigate,
    onDebug,
    onFollowUpSuggestionClick,
  }: MessageItemProps): ReactElement => {
    const [copied, setCopied] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState('');
    const editTextareaRef = React.useRef<HTMLTextAreaElement>(null);
    const navigate = useNavigate();

    // Resolve `@name` against this message's userTags + the live workspace
    // directory. Only REAL, unambiguous users become mentions — every other
    // "@text" stays plain text (matches channels/threads).
    const resolveMention = useMentionResolver(message.userTags);

    // The rotating `displayStatus` + bouncing-dots indicator that used to live
    // here has been removed in favor of the single ActivityBlock shimmer
    // header. The backend `statusMessage` field is now ignored on this
    // surface; if we ever want to surface it again, route it through
    // ActivityBlock as a subtext prop instead of re-introducing a second
    // loading row.

    // Handle clicking selection context to navigate to canvas
    const handleSelectionContextClick = (canvasId: string): void => {
      void navigate(`/chat/canvas/${canvasId}`);
    };

    // Display streaming content directly without character reveal slicing.
    // Append a trailing newline during streaming so remark-breaks flushes the
    // current incomplete line and markdown constructs (headings, lists, code
    // blocks) render correctly before the closing token arrives.
    //
    // We also build a stable `toolCallId → display number` map from the raw
    // content and rewrite `[clf-…#N]` tokens into markdown links pointing at
    // synthetic `cite:` hrefs. Order matters: linkify BEFORE strip so the clf
    // tokens are converted into markdown links before stripCitationMarks eats
    // any leftover ones.
    const clawCitationToolNumbers = useMemo(() => {
      const raw = message.content || message.streamingContent || '';
      return buildClawCitationToolNumbers(raw);
    }, [message.content, message.streamingContent]);

    const displayContent = useMemo(() => {
      const raw =
        message.type === 'bot' && message.isStreaming && message.streamingContent
          ? message.streamingContent
          : message.content || message.streamingContent || '';
      const linkified = linkifyAndGroupClawCitations(raw, clawCitationToolNumbers);
      const stripped = stripCitationMarks(linkified);
      return message.isStreaming ? stripped + '\n' : stripped;
    }, [
      message.type,
      message.isStreaming,
      message.streamingContent,
      message.content,
      clawCitationToolNumbers,
    ]);

    const parsedContent = message.parsedContent;
    const hasKeypoints = parsedContent && parsedContent.keypoints.length > 0;

    const handleCopy = (): void => {
      let textToCopy = '';

      // Get summary/content
      if (message.agentType === 'summarizer' && message.summarizerOutput?.summary) {
        // Process summary to replace user tags with plain text names
        textToCopy = processTextForCopy(message.summarizerOutput.summary, message.userTags);
        // Add key points
        if (message.summarizerOutput.keyPoints && message.summarizerOutput.keyPoints.length > 0) {
          textToCopy += '\n\nKey Points:\n';
          textToCopy += message.summarizerOutput.keyPoints
            .map(kp => {
              // Process key points to replace user tags with plain text names
              return `• ${processTextForCopy(kp.point, message.userTags)}`;
            })
            .join('\n');
        }
      } else {
        // Genius or generic message
        textToCopy = message.content || message.streamingContent || '';
        // Add key points from parsed content
        if (message.parsedContent && message.parsedContent.keypoints.length > 0) {
          textToCopy += '\n\nKey Points:\n';
          textToCopy += message.parsedContent.keypoints
            .map(point => {
              // Remove markdown bold markers (**text**) and replace user tags
              const cleanedPoint = point.replace(/\*\*([^*]+)\*\*/g, '$1');
              return `• ${processTextForCopy(cleanedPoint, message.userTags)}`;
            })
            .join('\n');
        }
      }

      void navigator.clipboard.writeText(textToCopy).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

    return (
      <div
        className={`group/message flex ${message.type === 'user' ? 'justify-end gap-3' : 'justify-start'}`}
      >
        {/* Edit button for user messages - appears on hover to the left of the bubble */}
        {message.type === 'user' && (onEditSubmit || onEditMobile) && !isEditing && (
          <button
            onClick={() => {
              if (onEditMobile) {
                onEditMobile();
              } else {
                setEditText(message.content);
                setIsEditing(true);
                setTimeout(() => editTextareaRef.current?.focus(), 0);
              }
            }}
            className='self-start mt-2 p-1 rounded opacity-0 group-hover/message:opacity-100 transition-opacity hover:bg-accent flex-shrink-0'
            title='Edit message'
            data-track-category='XyneAI'
            data-track-name='EDIT_MESSAGE'
          >
            <Pencil size={14} className='text-muted-foreground' />
          </button>
        )}

        <div
          className={
            message.type === 'user'
              ? isEditing
                ? 'max-w-[90%] w-full overflow-hidden'
                : 'max-w-[80%] overflow-hidden'
              : 'flex-1 max-w-full overflow-hidden'
          }
        >
          {/* The legacy "displayStatus + bouncing dots" loading state lived
              here as the TRUE branch of a ternary. Removed in favor of the
              single thinking indicator on ActivityBlock — when there's no
              content yet, the transparent bot bubble is invisible and the
              user sees only the ActivityBlock shimmer above. */}
          <div
            className={`${
              message.type === 'user'
                ? isEditing
                  ? 'rounded-2xl bg-accent p-3'
                  : 'flex flex-col items-start gap-3 px-5 py-3 [border-radius:16px_16px_4px_16px] bg-accent text-foreground md:block md:w-fit'
                : 'bg-transparent text-foreground max-w-full'
            }`}
          >
            {message.type === 'user' && isEditing ? (
              /* Inline edit mode */
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
                  className="w-full bg-transparent text-sm font-['Inter'] font-[450] text-foreground resize-none outline-none min-h-[60px] leading-relaxed"
                  rows={Math.max(2, editText.split('\n').length)}
                  data-track-category='XyneAI'
                  data-track-name='EDIT_TEXTAREA'
                />
                <div className='flex justify-end gap-2'>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 text-xs font-medium rounded-full border border-border bg-background hover:bg-accent transition-colors font-['Inter']"
                    data-track-category='XyneAI'
                    data-track-name='EDIT_CANCEL'
                  >
                    Cancel
                  </button>
                  <Button
                    variant='ghost'
                    onClick={() => {
                      if (editText.trim()) {
                        onEditSubmit?.(editText.trim());
                        setIsEditing(false);
                      }
                    }}
                    trackId='edit_message_submit'
                    disabled={!editText.trim()}
                    className="px-3 py-1.5 text-xs font-medium rounded-full bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 font-['Inter']"
                    data-track-category='XyneAI'
                    data-track-name='EDIT_SUBMIT'
                  >
                    Send
                  </Button>
                </div>
              </div>
            ) : message.type === 'user' ? (
              <>
                {/* Selection context previews */}
                {message.selectionContexts && message.selectionContexts.length > 0 && (
                  <div className='mb-3 space-y-2'>
                    {message.selectionContexts.map((selection, index) => (
                      <SelectionContextPreview
                        key={index}
                        selection={selection}
                        onClick={() => handleSelectionContextClick(selection.canvasId)}
                      />
                    ))}
                  </div>
                )}
                {/* Attachment previews */}
                {message.attachments && message.attachments.length > 0 && (
                  <div className='mb-3 space-y-2'>
                    {message.attachments.map((attachment, index) => (
                      <AttachmentPreview key={index} attachment={attachment} />
                    ))}
                  </div>
                )}
                <div className="text-sm font-['Inter'] whitespace-pre-wrap break-words font-[450] tracking-[0] md:leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => {
                        const processed = processNodeForUserTags(children, resolveMention);
                        return <span>{processed}</span>;
                      },
                      a: ({ href, children, ...props }) => {
                        // Check if URL is external
                        const isExternal = (() => {
                          if (!href) return false;
                          try {
                            const urlObj = new URL(href, window.location.origin);
                            return urlObj.origin !== window.location.origin;
                          } catch {
                            return true;
                          }
                        })();

                        // API paths (e.g. /api/attachments/.../download) should bypass React Router
                        const isApiPath = href?.startsWith('/api/');

                        if (isExternal) {
                          return (
                            <a
                              href={href}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='text-blue-500 hover:text-blue-600 underline'
                              {...props}
                            >
                              {children}
                            </a>
                          );
                        }

                        if (isApiPath) {
                          return (
                            <a
                              href={href}
                              className='text-blue-500 hover:text-blue-600 underline'
                              data-track-category='xyne-ai'
                              data-track-name='api-download'
                              onClick={e => {
                                e.preventDefault();
                                window.location.href = href!;
                              }}
                              {...props}
                            >
                              {children}
                            </a>
                          );
                        }

                        return (
                          <a
                            href={href}
                            className='text-blue-500 hover:text-blue-600 underline'
                            {...props}
                          >
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {displayContent}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <MessageContent
                message={message}
                displayContent={displayContent}
                hasKeypoints={hasKeypoints}
                parsedContent={parsedContent}
                clawCitationToolNumbers={clawCitationToolNumbers}
                onCitationClick={onCitationClick}
                onSummarizerCitationClick={onSummarizerCitationClick}
                onOpenToolDebug={onOpenToolDebug}
              />
            )}
          </div>

          {/* Error display for bot messages */}
          {message.type === 'bot' && message.errorInfo && (
            <div className='mt-3 border border-destructive/20 bg-destructive/5 p-3'>
              <div className='flex items-start gap-2'>
                <AlertTriangle size={14} className='mt-0.5 shrink-0 text-destructive' />
                <div className='flex-1 min-w-0'>
                  <div className='text-xs font-medium text-destructive'>
                    {message.errorInfo.title}
                    {message.errorInfo.code && (
                      <span className='ml-1 text-[10px] opacity-70'>
                        ({message.errorInfo.code})
                      </span>
                    )}
                  </div>
                  <div className='mt-0.5 text-xs text-muted-foreground'>
                    {message.errorInfo.message}
                  </div>
                  {message.errorInfo.helpText && (
                    <div className='mt-1 text-[11px] text-muted-foreground/80'>
                      {message.errorInfo.helpText}
                    </div>
                  )}
                  {message.errorInfo.rawError && (
                    <details className='mt-2'>
                      <summary className='text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground'>
                        Technical details
                      </summary>
                      <pre className='mt-1 max-h-32 overflow-y-auto rounded bg-muted p-2 text-[10px] text-muted-foreground whitespace-pre-wrap break-all'>
                        {message.errorInfo.rawError}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Branch navigator for user messages (edit branches) - below the bubble */}
          {message.type === 'user' && branchInfo && onBranchNavigate && (
            <div className='flex justify-end mt-1'>
              <BranchNavigator
                index={branchInfo.index}
                total={branchInfo.total}
                onNavigate={onBranchNavigate}
              />
            </div>
          )}

          {/* Assistant footer — one consolidated row for Debug, Time,
                  optional "Stopped" badge, branch navigator and message
                  actions. Only renders once streaming is done so the in-flight
                  message stays uncluttered. Layout:
                    [Debug] [Time] [Stopped?]            [BranchNav] [Actions]
                  Aborted messages still get the row (without MessageActions'
                  destructive buttons disabled — the user may want to copy or
                  regenerate the partial response). */}
          {/* Assistant footer — Debug is ALWAYS available (it's for live
                  debugging the agent loop, so streaming responses need it
                  too). Time + Stopped + the MessageActions panel only show
                  once the response is complete.
                  Layout:
                    [Debug] [Time?] [Stopped?]            [BranchNav?] [Actions?]
                  Row renders only when there's at least Debug to show or the
                  message is complete — otherwise it'd be an empty mt-3 row
                  during streams without a debug handler. */}
          {message.type === 'bot' &&
            (onDebug || !message.isStreaming) &&
            (() => {
              const stamp = formatMessageTime(message.timestamp);
              const complete = !message.isStreaming;
              const showActions = complete && !message.isAborted;
              return (
                <div className='mt-3 flex items-center justify-between gap-2'>
                  <div className='flex items-center gap-2 text-muted-foreground'>
                    {onDebug && (
                      <button
                        type='button'
                        onClick={onDebug}
                        className='inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-muted hover:text-foreground'
                        title='Debug this response'
                        data-track-category='XyneAI'
                        data-track-name='DEBUG_RESPONSE'
                      >
                        <Bug size={12} /> Debug
                      </button>
                    )}
                    {complete && stamp && (
                      <span className='text-[10px] tabular-nums text-muted-foreground/60'>
                        {stamp}
                      </span>
                    )}
                    {complete && message.isAborted && (
                      <span className="text-[11px] font-['Inter'] italic text-muted-foreground/70">
                        Stopped
                      </span>
                    )}
                  </div>
                  {showActions && (
                    <div className='flex items-center gap-2'>
                      {branchInfo && onBranchNavigate && (
                        <BranchNavigator
                          index={branchInfo.index}
                          total={branchInfo.total}
                          onNavigate={onBranchNavigate}
                        />
                      )}
                      <MessageActions
                        message={message}
                        copied={copied}
                        onCopy={handleCopy}
                        onFeedback={onFeedback}
                        feedbackValue={feedbackValue}
                        isV2={isV2}
                        onRatingChange={onRatingChange}
                        onRegenerate={isLatestBotMessage ? onRegenerate : undefined}
                      />
                    </div>
                  )}
                </div>
              );
            })()}

          {message.type === 'bot' &&
          isLatestBotMessage &&
          !message.isStreaming &&
          onFollowUpSuggestionClick &&
          message.followUpSuggestions?.length ? (
            <div className='mt-3 flex flex-wrap gap-2' data-testid='ask-ai-follow-ups'>
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

          {/* User timestamp — right-aligned below the user bubble. Shown
                  for all user messages (they're always "complete"), hidden
                  only while the bubble is in edit mode. */}
          {message.type === 'user' &&
            !isEditing &&
            (() => {
              const stamp = formatMessageTime(message.timestamp);
              if (!stamp) return null;
              return (
                <div className='mt-1 text-right text-[10px] tabular-nums text-muted-foreground/60'>
                  {stamp}
                </div>
              );
            })()}
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (
      prev.message === next.message &&
      prev.feedbackValue === next.feedbackValue &&
      prev.isLatestBotMessage === next.isLatestBotMessage &&
      prev.onFollowUpSuggestionClick === next.onFollowUpSuggestionClick
    )
      return true;
    if (!next.message.isStreaming && !prev.message.isStreaming) {
      return (
        prev.message.id === next.message.id &&
        prev.message.content === next.message.content &&
        prev.message.errorInfo === next.message.errorInfo &&
        prev.message.followUpSuggestions === next.message.followUpSuggestions &&
        prev.isLatestBotMessage === next.isLatestBotMessage &&
        prev.onFollowUpSuggestionClick === next.onFollowUpSuggestionClick &&
        prev.feedbackValue === next.feedbackValue
      );
    }
    return (
      prev.message.id === next.message.id &&
      prev.message.streamingContent === next.message.streamingContent &&
      prev.message.statusMessage === next.message.statusMessage &&
      prev.message.isStreaming === next.message.isStreaming &&
      prev.message.toolOutputs === next.message.toolOutputs &&
      prev.message.summarizerOutput === next.message.summarizerOutput &&
      prev.message.reasoning === next.message.reasoning &&
      prev.message.toolInvocations === next.message.toolInvocations &&
      prev.message.pendingActions === next.message.pendingActions &&
      prev.message.errorInfo === next.message.errorInfo &&
      prev.message.followUpSuggestions === next.message.followUpSuggestions &&
      prev.isLatestBotMessage === next.isLatestBotMessage &&
      prev.onFollowUpSuggestionClick === next.onFollowUpSuggestionClick &&
      prev.feedbackValue === next.feedbackValue
    );
  },
);

MessageItem.displayName = 'MessageItem';

// Message content rendering component
// Stable identities for the streaming answer's markdown render. React matches
// JSX elements by component-type REFERENCE — if these were fresh inline values
// on every render, React would treat each streaming delta as all-new element
// types, discard the real DOM nodes and rebuild them (re-firing the mount fade
// = the blink). Hoisted to module scope so identity can never change.
const ANSWER_REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const STATIC_ANSWER_REHYPE_PLUGINS = [rehypeHighlight];
// Word-fade spans for live-streamed answers (see rehypeStreamWordFade). Only
// applied on the everStreamed path so history messages carry no extra spans.
const ANSWER_REHYPE_PLUGINS = [rehypeHighlight, rehypeStreamWordFade];
// Preserve `cite:clf-…` hrefs — react-markdown's default sanitizer strips
// non-http(s) schemes, which would erase the href before the `a` override can
// intercept it and substitute a ClawCitationChip. Same fix as v3
// ChatPageV3.tsx:417.
const preserveUrlTransform = (url: string): string => url;

const MessageContent = ({
  message,
  displayContent,
  hasKeypoints,
  parsedContent,
  clawCitationToolNumbers,
  onCitationClick,
  onSummarizerCitationClick,
  onOpenToolDebug,
}: MessageContentProps): ReactElement => {
  const resolveMention = useMentionResolver(message.userTags);

  // Once this message has streamed live, KEEP the per-block render after
  // completion: the subtree keeps the same component type, unchanged blocks
  // memo-bail, and the streaming→done transition reuses the existing DOM in
  // place instead of tearing down and rebuilding the whole answer (a visibly
  // harsh repaint). History messages that never streamed here keep the plain
  // single-parse render, so cross-block markdown (reference links, footnotes)
  // renders exactly as before for them.
  const everStreamedRef = useRef(message.isStreaming);
  if (message.isStreaming) everStreamedRef.current = true;

  // Memoize markdown components to prevent re-renders on parent updates
  const markdownComponents = useMemo(() => createMarkdownComponents(message.id), [message.id]);

  // Extend markdown components with image download button for sidebar
  const sidebarMarkdownComponents = useMemo<Components>(() => {
    return {
      ...markdownComponents,
      img: props => <ImageWithDownload {...props} />,
    };
  }, [markdownComponents]);

  // Volatile inputs of the markdown overrides, read through a ref so the
  // component identities below never depend on them. Updated every render —
  // the overrides always see current data without changing type reference.
  const latestAnswerDeps = useRef({
    resolveMention,
    toolInvocations: message.toolInvocations,
    clawCitationToolNumbers,
    onOpenToolDebug,
  });
  latestAnswerDeps.current = {
    resolveMention,
    toolInvocations: message.toolInvocations,
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
      ...sidebarMarkdownComponents,
      p: ({ children }) => {
        const processed = processNodeForUserTags(children, deps.current.resolveMention);
        return <p className='mb-2 last:mb-0'>{processed}</p>;
      },
      li: ({ children, ...props }) => {
        const processed = processNodeForUserTags(children, deps.current.resolveMention);
        return <li {...props}>{processed}</li>;
      },
      td: ({ children, ...props }) => {
        const processed = processNodeForUserTags(children, deps.current.resolveMention);
        return <td {...props}>{processed}</td>;
      },
      th: ({ children, ...props }) => {
        const processed = processNodeForUserTags(children, deps.current.resolveMention);
        return <th {...props}>{processed}</th>;
      },
      a: ({ href, children, ...props }) => {
        const {
          toolInvocations,
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
                toolInvocations={toolInvocations}
                onOpenToolDebug={openToolDebug}
              />
            );
          }
        }
        // v3-style inline citation: `linkifyClawCitations` rewrites
        // `[clf-<toolCallId>#<N>]` → `[<num>.<N>](cite:clf-<toolCallId>#<N>)`.
        // Intercept the synthetic `cite:` href and substitute a chip
        // that resolves to the matching ClawCitation on the parent
        // message's toolInvocations.
        if (href && href.startsWith('cite:clf-')) {
          const body = href.slice('cite:clf-'.length);
          const hashIdx = body.lastIndexOf('#');
          if (hashIdx > 0) {
            const toolCallId = body.slice(0, hashIdx);
            const chunkIndex = Number(body.slice(hashIdx + 1));
            const toolNumber = toolNumbers.get(toolCallId) ?? 0;
            if (toolNumber > 0 && Number.isFinite(chunkIndex)) {
              return (
                <ClawCitationChip
                  toolCallId={toolCallId}
                  chunkIndex={chunkIndex}
                  toolNumber={toolNumber}
                  toolInvocations={toolInvocations}
                  onOpenToolDebug={openToolDebug}
                />
              );
            }
          }
        }

        // Check if URL is external
        const isExternal = (() => {
          if (!href) return false;
          try {
            const urlObj = new URL(href, window.location.origin);
            return urlObj.origin !== window.location.origin;
          } catch {
            return true;
          }
        })();

        const isApiPath = href?.startsWith('/api/');

        // Add target="_blank" for external links
        if (isExternal) {
          return (
            <a href={href} target='_blank' rel='noopener noreferrer' {...props}>
              {children}
            </a>
          );
        }

        if (isApiPath) {
          return (
            <a
              href={href}
              data-track-category='xyne-ai'
              data-track-name='api-download'
              onClick={e => {
                e.preventDefault();
                window.location.href = href!;
              }}
              {...props}
            >
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
  }, [sidebarMarkdownComponents]);

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
        rehypePlugins={wordFade ? ANSWER_REHYPE_PLUGINS : STATIC_ANSWER_REHYPE_PLUGINS}
        urlTransform={preserveUrlTransform}
        components={answerComponents}
      >
        {markdown}
      </ReactMarkdown>
    ),
    [answerComponents, wordFade],
  );

  return (
    <div className='space-y-4 max-w-full'>
      {/* v2: Combined Thinking + Tool Calls panel. Inline block with the
          8-bit loader header while live, expandable to inspect reasoning +
          tool calls. */}
      <ActivityBlock
        reasoning={message.reasoning}
        toolInvocations={message.toolInvocations}
        streaming={message.isStreaming}
        messageAborted={!!message.isAborted}
      />

      {/* v2: Pending Actions (Human-in-the-loop) */}
      {message.pendingActions && message.pendingActions.length > 0 && (
        <PendingActionBlock
          actions={message.pendingActions}
          onApprove={async (action, index) => {
            await respondToPendingAction(message, action, index, true);
          }}
          onDecline={async (action, index) => {
            await respondToPendingAction(message, action, index, false);
          }}
        />
      )}

      {/* Tool Outputs */}
      {message.toolOutputs && message.toolOutputs.length > 0 && (
        <ToolOutputsSection toolOutputs={message.toolOutputs} />
      )}

      {/* Genius: Summary text */}
      {(!message.agentType || message.agentType === 'genius') && displayContent && (
        <div
          className={`bot-markdown-content xyne-ai-markdown text-sm font-['Inter'] leading-6 font-normal${
            // Keyed off everStreamed (not isStreaming) so content that lands
            // AT completion — the final tail words, finalized citation chips —
            // still fades in instead of popping the instant isStreaming flips
            // false. Mount-only animations + the no-remount architecture make
            // the class harmless to keep: settled DOM never re-animates.
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

      {/* Summarizer: Summary and Key Points */}
      {message.agentType === 'summarizer' && message.summarizerOutput && (
        <SummarizerContent
          message={message}
          onSummarizerCitationClick={onSummarizerCitationClick}
        />
      )}

      {/* Genius: Key points with citations */}
      {(!message.agentType || message.agentType === 'genius') && hasKeypoints && parsedContent && (
        <GeniusKeyPoints
          parsedContent={parsedContent}
          message={message}
          resolveMention={resolveMention}
          onCitationClick={onCitationClick}
        />
      )}

      {/* Bot Message Attachments (e.g., generated PDFs from artifacts tool) */}
      {message.attachments && message.attachments.length > 0 && (
        <div className='space-y-2'>
          {message.attachments.map((attachment, index) => (
            <AttachmentPreview key={index} attachment={attachment} />
          ))}
        </div>
      )}
      {/* v2: Inline Citations from <citation> block */}
      {(() => {
        const raw = message.content || message.streamingContent || '';
        const inlineCitations = extractInlineCitations(raw);
        return inlineCitations.length > 0 ? <InlineCitations citations={inlineCitations} /> : null;
      })()}
    </div>
  );
};

// Tool outputs rendering
const ToolOutputsSection = ({ toolOutputs }: { toolOutputs: GeniusToolOutput[] }): ReactElement => (
  <div className='space-y-4 max-w-full'>
    {toolOutputs.map((toolOutput, index) => (
      <div key={index} className='space-y-4 max-w-full'>
        {/* Time-Series Chart */}

        {toolOutput.rawChartData && toolOutput.groupbyConfig && toolOutput.selectedMetrics && (
          <div className='w-full max-w-full overflow-hidden'>
            <Highchart
              enableGroupby={true}
              rawChartData={toolOutput.rawChartData}
              groupbyConfig={toolOutput.groupbyConfig}
              selectedMetrics={toolOutput.selectedMetrics}
              showCardinalityControl={true}
              dimensionLabelMapper={(label: string) =>
                label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              }
              isMobile={true}
            />
          </div>
        )}

        {/* Bar Chart */}

        {toolOutput.barChartData && (
          <div className='w-full max-w-full overflow-hidden'>
            <HighBarChart1D
              rawData={toolOutput.barChartData.rawData}
              groupKey={toolOutput.barChartData.groupKey}
              selectedMetrics={toolOutput.barChartData.selectedMetrics}
              isHorizontalBar={toolOutput.barChartData.isHorizontalBar ?? true}
            />
          </div>
        )}

        {/* Volume Chart */}

        {toolOutput.volumeChartData && (
          <div className='w-full max-w-full overflow-hidden'>
            <VolumeChartRenderer
              rawData={toolOutput.volumeChartData.rawData}
              groupKey={toolOutput.volumeChartData.groupKey}
              selectedMetrics={toolOutput.volumeChartData.selectedMetrics}
              defaultChartType={toolOutput.volumeChartData.defaultChartType ?? 'bar'}
              showToggle={toolOutput.volumeChartData.showToggle ?? true}
              {...(toolOutput.volumeChartData.title && { title: toolOutput.volumeChartData.title })}
            />
          </div>
        )}

        {/* Single Stat */}

        {toolOutput.singleStat && (
          <SingleStatSection
            singleStat={
              toolOutput.singleStat as
                | SingleStatObject
                | SingleStatObject[]
                | Record<string, string | number>[]
            }
          />
        )}

        {/* Table Data */}

        {toolOutput.tableData && Array.isArray(toolOutput.tableData) && (
          <div className='w-full max-w-full overflow-x-auto'>
            <Table data={toolOutput.tableData} />
          </div>
        )}

        {/* PPT Slide Viewer */}
        {(() => {
          const pptData = (
            toolOutput as {
              pptData?: {
                attachmentId: string;
                downloadUrl: string;
                filename: string;
                title: string;
                slideCount?: number;
                slides?: Array<{ index: number; background?: unknown; objects: unknown[] }>;
              };
            }
          ).pptData;
          if (!pptData) return null;
          return (
            <div className='w-full max-w-full overflow-hidden'>
              <PptSlideViewer
                attachmentId={pptData.attachmentId}
                downloadUrl={pptData.downloadUrl}
                filename={pptData.filename}
                title={pptData.title}
                slideCount={
                  typeof pptData.slideCount === 'number'
                    ? pptData.slideCount
                    : (pptData.slides?.length ?? 0)
                }
                slides={pptData.slides as PptSlide[]}
              />
            </div>
          );
        })()}
      </div>
    ))}
  </div>
);

// Single stat rendering logic
const SingleStatSection = ({ singleStat }: SingleStatSectionProps): ReactElement | null => {
  if (Array.isArray(singleStat) && singleStat.length === 1) {
    const statsObject = singleStat[0];
    if (!statsObject) return null;
    const statEntries = Object.entries(statsObject) as [string, string | number][];

    return (
      <div className='flex flex-wrap gap-4 max-w-full'>
        {statEntries.map(([metric, value]: [string, string | number]) => (
          <div key={metric} className='flex-1 min-w-[150px] max-w-[250px]'>
            <SingleStat metric={metric} value={value} />
          </div>
        ))}
      </div>
    );
  }

  if (
    typeof singleStat === 'object' &&
    !Array.isArray(singleStat) &&
    'metric' in singleStat &&
    'value' in singleStat
  ) {
    return (
      <div className='w-full max-w-[250px]'>
        <SingleStat metric={singleStat.metric} value={singleStat.value} />
      </div>
    );
  }
  return null;
};

// Summarizer content rendering
const SummarizerContent = ({
  message,
  onSummarizerCitationClick,
}: SummarizerContentProps): ReactElement => {
  const resolveMention = useMentionResolver(message.userTags);
  // Memoize markdown components to prevent re-renders on parent updates
  const markdownComponents = useMemo(() => createMarkdownComponents(message.id), [message.id]);

  const sidebarMarkdownComponents = useMemo<Components>(() => {
    return {
      ...markdownComponents,
      img: props => <ImageWithDownload {...props} />,
    };
  }, [markdownComponents]);

  // Same trailing-newline fix as displayContent: flush the current incomplete
  // line so remark-breaks renders line breaks / code blocks correctly mid-stream.
  const summaryContent = message.summarizerOutput?.summary
    ? message.isStreaming
      ? message.summarizerOutput.summary + '\n'
      : message.summarizerOutput.summary
    : '';

  return (
    <>
      {/* Summary */}
      {summaryContent && (
        <div className='relative'>
          <div className="bot-markdown-content xyne-ai-markdown text-sm font-['Inter'] leading-6 font-normal">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              rehypePlugins={STATIC_ANSWER_REHYPE_PLUGINS}
              components={{
                ...sidebarMarkdownComponents,
                p: ({ children }) => {
                  const processed = processNodeForUserTags(children, resolveMention);
                  return <p className='mb-2 last:mb-0'>{processed}</p>;
                },
                li: ({ children, ...props }) => {
                  const processed = processNodeForUserTags(children, resolveMention);
                  return <li {...props}>{processed}</li>;
                },
                td: ({ children, ...props }) => {
                  const processed = processNodeForUserTags(children, resolveMention);
                  return <td {...props}>{processed}</td>;
                },
                th: ({ children, ...props }) => {
                  const processed = processNodeForUserTags(children, resolveMention);
                  return <th {...props}>{processed}</th>;
                },
                a: ({ href, children, ...props }) => {
                  // Check if URL is external
                  const isExternal = (() => {
                    if (!href) return false;
                    try {
                      const urlObj = new URL(href, window.location.origin);
                      return urlObj.origin !== window.location.origin;
                    } catch {
                      return true;
                    }
                  })();

                  const isApiPath = href?.startsWith('/api/');

                  // Add target="_blank" for external links
                  if (isExternal) {
                    return (
                      <a href={href} target='_blank' rel='noopener noreferrer' {...props}>
                        {children}
                      </a>
                    );
                  }

                  if (isApiPath) {
                    return (
                      <a
                        href={href}
                        data-track-category='xyne-ai'
                        data-track-name='api-download'
                        onClick={e => {
                          e.preventDefault();
                          window.location.href = href!;
                        }}
                        {...props}
                      >
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
              {summaryContent}
            </ReactMarkdown>
          </div>
          {message.isStreaming && <span className='animate-pulse ml-1'>▋</span>}
        </div>
      )}

      {/* Key Points */}
      {message.summarizerOutput?.keyPoints && message.summarizerOutput.keyPoints.length > 0 && (
        <div className='space-y-2'>
          <h3 className='text-sm font-semibold text-muted-foreground'>Key Points</h3>
          <ul className='space-y-1.5'>
            {(() => {
              // Count how many keypoints reference each entityId
              const entityKeyPointCount = new Map<string, number>();
              for (const kp of message.summarizerOutput.keyPoints) {
                const id = kp.citation?.entityId;
                if (id) entityKeyPointCount.set(id, (entityKeyPointCount.get(id) ?? 0) + 1);
              }

              // Pre-compute display labels:
              // - Single-referenced entity → plain docNum (e.g. "3")
              // - Multi-referenced entity → docNum.subIdx  (e.g. "1.0", "1.1")
              // docNum is assigned in first-appearance order across all keypoints
              const entityDocNumMap = new Map<string, number>();
              const entitySubCountMap = new Map<string, number>();
              let docCounter = 0;
              const displayLabels: string[] = [];

              for (const kp of message.summarizerOutput.keyPoints) {
                const c = kp.citation;
                if (!c?.entityId) {
                  displayLabels.push(String(c?.messageIndex ?? ''));
                  continue;
                }
                if (!entityDocNumMap.has(c.entityId)) {
                  docCounter++;
                  entityDocNumMap.set(c.entityId, docCounter);
                  entitySubCountMap.set(c.entityId, 0);
                }
                const docNum = entityDocNumMap.get(c.entityId)!;
                const count = entityKeyPointCount.get(c.entityId) ?? 0;
                if (count > 1) {
                  const subIdx = entitySubCountMap.get(c.entityId)!;
                  entitySubCountMap.set(c.entityId, subIdx + 1);
                  displayLabels.push(`${docNum}.${subIdx}`);
                } else {
                  displayLabels.push(String(docNum));
                }
              }

              return message.summarizerOutput.keyPoints.map(
                (keyPoint: SummarizerKeyPoint, index: number) => (
                  <li key={index} className='flex items-start'>
                    <span className='text-foreground text-sm inline prose prose-sm max-w-none'>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => {
                            const processed = processNodeForUserTags(children, resolveMention);
                            return <span>{processed}</span>;
                          },
                          a: ({ href, children, ...props }) => {
                            // Check if URL is external
                            const isExternal = (() => {
                              if (!href) return false;
                              try {
                                const urlObj = new URL(href, window.location.origin);
                                return urlObj.origin !== window.location.origin;
                              } catch {
                                return true;
                              }
                            })();

                            const isApiPath = href?.startsWith('/api/');

                            if (isExternal) {
                              return (
                                <a href={href} target='_blank' rel='noopener noreferrer' {...props}>
                                  {children}
                                </a>
                              );
                            }

                            if (isApiPath) {
                              return (
                                <a
                                  href={href}
                                  data-track-category='xyne-ai'
                                  data-track-name='api-download'
                                  onClick={e => {
                                    e.preventDefault();
                                    window.location.href = href!;
                                  }}
                                  {...props}
                                >
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
                        {keyPoint.point}
                      </ReactMarkdown>
                      {keyPoint.citation &&
                        (keyPoint.citation.conversationId ||
                          keyPoint.citation.externalUrl ||
                          keyPoint.citation.canvasId ||
                          keyPoint.citation.entityType === 'recording' ||
                          keyPoint.citation.entityType === 'attachment' ||
                          keyPoint.citation.entityType === 'knowledge_base') &&
                        !message.isStreaming && (
                          <>
                            {' '}
                            <button
                              type='button'
                              onClick={(): void => {
                                if (keyPoint.citation) {
                                  onSummarizerCitationClick(keyPoint.citation);
                                }
                              }}
                              className="inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-muted text-muted-foreground font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-accent transition-colors cursor-pointer align-middle"
                              title={`Jump to ${keyPoint.citation.entityType || 'message'} ${keyPoint.citation.messageIndex}`}
                              data-track-category='XyneAI'
                              data-track-name='SUMMARIZER_CITATION_CLICK'
                              data-track-metadata={JSON.stringify({
                                messageIndex: keyPoint.citation.messageIndex,
                              })}
                            >
                              {displayLabels[index]}
                            </button>
                          </>
                        )}
                    </span>
                  </li>
                ),
              );
            })()}
          </ul>
        </div>
      )}
    </>
  );
};

// Genius key points rendering
const GeniusKeyPoints = ({
  parsedContent,
  message,
  resolveMention,
  onCitationClick,
}: GeniusKeyPointsProps): ReactElement => (
  <div className='space-y-2'>
    <h3 className='text-sm font-semibold text-muted-foreground'>Key Points</h3>
    <ul className='space-y-1.5'>
      {parsedContent.keypoints.map((point: string, index: number) => {
        const keypointNum = index + 1;
        const messageNumber = parsedContent.citations[keypointNum];
        const hasValidCitation =
          messageNumber &&
          message.conversationIdMapping &&
          (message.conversationIdMapping[String(messageNumber)] ||
            message.messageIdMapping?.[String(messageNumber)]);

        return (
          <li key={index} className='flex items-start'>
            <span className='text-foreground text-sm inline prose prose-sm max-w-none'>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => {
                    const processed = processNodeForUserTags(children, resolveMention);
                    return <span>{processed}</span>;
                  },
                  a: ({ href, children, ...props }) => {
                    // Check if URL is external
                    const isExternal = (() => {
                      if (!href) return false;
                      try {
                        const urlObj = new URL(href, window.location.origin);
                        return urlObj.origin !== window.location.origin;
                      } catch {
                        return true;
                      }
                    })();

                    const isApiPath = href?.startsWith('/api/');

                    if (isExternal) {
                      return (
                        <a href={href} target='_blank' rel='noopener noreferrer' {...props}>
                          {children}
                        </a>
                      );
                    }

                    if (isApiPath) {
                      return (
                        <a
                          href={href}
                          data-track-category='xyne-ai'
                          data-track-name='api-download'
                          onClick={e => {
                            e.preventDefault();
                            window.location.href = href!;
                          }}
                          {...props}
                        >
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
                {point}
              </ReactMarkdown>
              {hasValidCitation && messageNumber && !message.isStreaming && (
                <button
                  type='button'
                  onClick={(): void =>
                    onCitationClick(
                      messageNumber,
                      message.conversationIdMapping ?? {},
                      message.messageIdMapping ?? {},
                      message.channelIdMapping,
                    )
                  }
                  className="ml-1 inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-muted text-muted-foreground font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-accent transition-colors cursor-pointer align-middle"
                  title={`Jump to message ${keypointNum}`}
                  data-track-category='XyneAI'
                  data-track-name='KEY_POINT_CITATION_CLICK'
                  data-track-metadata={JSON.stringify({ keypointNum })}
                >
                  {keypointNum}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  </div>
);

// Avatar component that uses the useUser hook properly
const ParticipantAvatar: React.FC<{ participant: Participant }> = ({ participant }) => {
  const user = useUser(participant.id);
  const { url: pictureUrl } = useProfilePictureUrl(participant.id, user?.picture);
  const initials =
    participant.name
      ?.split(' ')
      .map(n => n[0])
      .join('') || '?';

  return (
    <div className='w-6 h-6 rounded-lg overflow-hidden ring-2 ring-background flex-shrink-0 bg-muted flex items-center justify-center'>
      {pictureUrl ? (
        <img src={pictureUrl} alt={participant.name} className='w-full h-full object-cover' />
      ) : (
        <span className='text-xs font-medium text-muted-foreground'>{initials}</span>
      )}
    </div>
  );
};

// Simple Participants Avatars component - inline in MessageItem
const ParticipantsAvatars: React.FC<{ participants: Participant[] }> = ({
  participants,
}: {
  participants: Participant[];
}) => {
  logger.info(LogEvent.INFO, {
    type: 'migrated_console_log',
    message: String('[ParticipantsAvatars] Rendering:'),
    context: [{ participants, count: participants?.length }],
  });

  // Deduplicate participants by ID
  const uniqueParticipants = React.useMemo(() => {
    const seen = new Set<string>();
    return participants.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [participants]);

  logger.info(LogEvent.INFO, {
    type: 'migrated_console_log',
    message: String('[ParticipantsAvatars] Unique participants:'),
    context: [
      {
        uniqueParticipants,
        count: uniqueParticipants.length,
      },
    ],
  });

  // Get top 3 unique participants
  const top3 = uniqueParticipants.slice(0, 3);
  const remaining = uniqueParticipants.length - 3;

  // Join all unique participant names with commas, limit to 20 users
  const MAX_USERS_TO_SHOW = 20;
  let displayNames: string;
  if (uniqueParticipants.length <= MAX_USERS_TO_SHOW) {
    displayNames = uniqueParticipants.map(p => p.name).join(', ');
  } else {
    const first20 = uniqueParticipants.slice(0, MAX_USERS_TO_SHOW);
    const remainingCount = uniqueParticipants.length - MAX_USERS_TO_SHOW;
    displayNames = `${first20.map(p => p.name).join(', ')} and ${remainingCount} others`;
  }

  // Dropdown content
  const dropdownContent = (
    <div className='bg-popover border border-border rounded-lg shadow-xl py-2 px-3 w-64 z-[99999]'>
      <div className='text-sm text-foreground break-words'>{displayNames}</div>
    </div>
  );

  return (
    <Tooltip content={dropdownContent} side='top' align='start' delayDuration={200} sideOffset={4}>
      <div
        className='flex items-center -space-x-1.5 cursor-pointer hover:opacity-80'
        title={`${uniqueParticipants.length} participant${uniqueParticipants.length > 1 ? 's' : ''}`}
      >
        {top3.map(p => (
          <ParticipantAvatar key={p.id} participant={p} />
        ))}
        {remaining > 0 && (
          <div
            className='w-6 h-6 rounded-lg bg-muted ring-2 ring-background flex items-center justify-center text-xs font-medium text-muted-foreground flex-shrink-0'
            title={`${remaining} more participant${remaining > 1 ? 's' : ''}`}
          >
            +{remaining}
          </div>
        )}
      </div>
    </Tooltip>
  );
};
// Message action buttons
const MessageActions = ({
  message,
  copied,
  onCopy,
  onFeedback,
  feedbackValue,
  isV2,
  onRatingChange,
  onRegenerate,
}: MessageActionsProps): ReactElement => (
  <div className='flex justify-between items-center gap-3'>
    <div className='flex items-center gap-1'>
      {/* Copy Button */}
      <button
        onClick={onCopy}
        className='p-1.5 rounded transition-colors hover:bg-accent'
        title={copied ? 'Copied!' : 'Copy'}
        data-track-category='XyneAI'
        data-track-name='COPY_MESSAGE'
      >
        {copied ? (
          <img src='/svgs/icons/check-success.svg' alt='Copied' width='16' height='16' />
        ) : (
          <img src='/svgs/icons/copy.svg' alt='Copy' width='16' height='16' />
        )}
      </button>

      {/* Regenerate Button - only on the latest bot message */}
      {onRegenerate && (
        <Button
          variant='ghost'
          onClick={onRegenerate}
          trackId='regenerate_message'
          className='p-1.5 rounded transition-colors hover:bg-accent'
          title='Regenerate response'
          data-track-category='XyneAI'
          data-track-name='REGENERATE_MESSAGE'
          data-track-metadata={JSON.stringify({ messageId: message.id })}
        >
          <RefreshCw size={16} className='text-current' />
        </Button>
      )}

      {isV2 ? (
        // v2 (claw): persist to agent_runs.rating (metrics + reload) with an
        // optional comment on 👎.
        <AskAiRatingButtons
          messageId={message.id}
          feedback={message.feedback}
          comment={message.ratingComment}
          onChange={(fb, c): void => onRatingChange?.(message.id, fb, c)}
        />
      ) : (
        <>
          {/* Like Button */}
          <Button
            variant='ghost'
            onClick={() => onFeedback(message.id, 'LIKE')}
            trackId='like_message'
            className='p-1.5 rounded transition-colors hover:bg-accent'
            title='Like'
            data-track-category='XyneAI'
            data-track-name='LIKE_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId: message.id })}
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='16'
              height='16'
              viewBox='0 0 16 16'
              fill='none'
            >
              <g clipPath='url(#clip0_9950_23975)'>
                <path
                  d='M9.99479 3.9187L9.32813 6.66536H13.2148C13.4218 6.66536 13.6259 6.71356 13.8111 6.80613C13.9962 6.8987 14.1573 7.0331 14.2815 7.1987C14.4057 7.36429 14.4896 7.55653 14.5266 7.76018C14.5636 7.96384 14.5528 8.17332 14.4948 8.37203L12.9415 13.7054C12.8607 13.9823 12.6923 14.2256 12.4615 14.3987C12.2307 14.5718 11.95 14.6654 11.6615 14.6654H2.66146C2.30784 14.6654 1.9687 14.5249 1.71865 14.2748C1.4686 14.0248 1.32813 13.6857 1.32812 13.332V7.9987C1.32812 7.64508 1.4686 7.30594 1.71865 7.05589C1.9687 6.80584 2.30784 6.66536 2.66146 6.66536H4.50146C4.74951 6.66523 4.99262 6.59591 5.20343 6.46518C5.41424 6.33445 5.58441 6.14751 5.69479 5.92536L7.99479 1.33203C8.30918 1.33592 8.61862 1.41081 8.89999 1.5511C9.18137 1.69138 9.42741 1.89344 9.61973 2.14217C9.81205 2.3909 9.94567 2.67987 10.0106 2.9875C10.0756 3.29513 10.0702 3.61345 9.99479 3.9187Z'
                  stroke='currentColor'
                  fill={feedbackValue === 'LIKE' ? 'currentColor' : 'none'}
                  strokeWidth='1.33333'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  fillOpacity={feedbackValue === 'LIKE' ? 0.3 : 1}
                />
                <path
                  d='M4.67188 6.66797V14.668'
                  stroke='currentColor'
                  strokeWidth='1.33333'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </g>
              <defs>
                <clipPath id='clip0_9950_23975'>
                  <rect width='16' height='16' fill='currentColor' />
                </clipPath>
              </defs>
            </svg>
          </Button>

          {/* Dislike Button */}
          <Button
            variant='ghost'
            onClick={() => onFeedback(message.id, 'DISLIKE')}
            trackId='dislike_message'
            className='p-1.5 rounded transition-colors hover:bg-accent'
            title='Dislike'
            data-track-category='XyneAI'
            data-track-name='DISLIKE_MESSAGE'
            data-track-metadata={JSON.stringify({ messageId: message.id })}
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='16'
              height='16'
              viewBox='0 0 16 16'
              fill='none'
            >
              <g clipPath='url(#clip0_9950_23979)'>
                <path
                  d='M6.00521 12.0813L6.67188 9.33464L2.78521 9.33464C2.57822 9.33464 2.37406 9.28644 2.18892 9.19387C2.00378 9.1013 1.84274 8.9669 1.71854 8.8013C1.59435 8.63571 1.51041 8.44347 1.47338 8.23982C1.43635 8.03616 1.44725 7.82668 1.50521 7.62797L3.05854 2.29464C3.13932 2.01768 3.30775 1.7744 3.53854 1.6013C3.76934 1.42821 4.05005 1.33464 4.33854 1.33464L13.3385 1.33464C13.6922 1.33464 14.0313 1.47511 14.2814 1.72516C14.5314 1.97521 14.6719 2.31435 14.6719 2.66797L14.6719 8.0013C14.6719 8.35493 14.5314 8.69406 14.2814 8.94411C14.0313 9.19416 13.6922 9.33464 13.3385 9.33464L11.4985 9.33464C11.2505 9.33477 11.0074 9.4041 10.7966 9.53482C10.5858 9.66555 10.4156 9.85249 10.3052 10.0746L8.00521 14.668C7.69082 14.6641 7.38138 14.5892 7.10001 14.4489C6.81863 14.3086 6.57259 14.1066 6.38027 13.8578C6.18795 13.6091 6.05433 13.3201 5.98938 13.0125C5.92444 12.7049 5.92985 12.3865 6.00521 12.0813Z'
                  stroke='currentColor'
                  fill={feedbackValue === 'DISLIKE' ? 'currentColor' : 'none'}
                  strokeWidth='1.33333'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  fillOpacity={feedbackValue === 'DISLIKE' ? 0.3 : 1}
                />
                <path
                  d='M11.3359 9.33203L11.3359 1.33203'
                  stroke='currentColor'
                  strokeWidth='1.33333'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </g>
              <defs>
                <clipPath id='clip0_9950_23979'>
                  <rect
                    width='16'
                    height='16'
                    fill='currentColor'
                    transform='translate(16 16) rotate(-180)'
                  />
                </clipPath>
              </defs>
            </svg>
          </Button>
        </>
      )}
      {/* Participants avatars - shown for Summarizer messages */}
      {(message.agentType === 'summarizer' || message.agentType === 'genius') &&
        message.participants &&
        message.participants.length > 0 && (
          <ParticipantsAvatars participants={message.participants} />
        )}
    </div>

    {/* Web Search Icon */}
    {message.toolOutputs?.some(
      output =>
        'toolName' in output &&
        output.toolName === 'web_search' &&
        'content' in output &&
        typeof output.content === 'string' &&
        (output.content.includes('Found') || output.content.includes('search results')),
    ) && (
      <Tooltip content='Powered By searXNG' side='left'>
        <a
          href='https://github.com/searxng/searxng'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-1 p-1.5 rounded-[11.345px] bg-gradient-to-br from-[#1E40AF] to-[#3B82F6] hover:opacity-80 transition-opacity'
        >
          <Globe className='w-2 h-2 text-primary-foreground' />
        </a>
      </Tooltip>
    )}

    {/* Genius Icon */}
    {message.isGeniusResponse && (
      <Tooltip content='Powered By Genius' side='left'>
        <div className='flex items-center gap-1 p-1.5 rounded-[11.345px] bg-gradient-to-br from-[#9747FF] to-[#1B85FF]'>
          <img src='/svgs/icons/genius-star-white.svg' alt='Genius' width='8' height='8' />
        </div>
      </Tooltip>
    )}
  </div>
);
