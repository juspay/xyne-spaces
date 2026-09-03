import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ChevronBigDown,
  ChevronBigUp,
  FileText,
  FolderDefault,
  Globe,
  Hashtag,
  LockClose,
  MultipleCrossCancelDefault,
  Notebook,
  PhoneDefault,
  TicketToken,
} from '@xyne/icons';
import { AudioLines } from 'lucide-react';
import { motion } from 'framer-motion';
import Avatar from '../../../ui/Avatar/Avatar';
import useMeasure from '../../../../hooks/useMeasure';
import { ContextPicker } from './ContextPicker';
import type { ThreadInfo, CanvasInfo, SelectionInfo } from '../../../../machines/xyneAIMachine';
import type { UserActivity } from '../../../../hooks/useUserActivity';
import type { Attachment, BrowserContext } from './XyneAIInputBox';
import type {
  SelectedChannel,
  SelectedTicket,
  SelectedCanvas,
  SelectedTranscript,
  SelectedRecording,
} from './ContextPickerPanel';

/** A pill kind keyed only by `id` + display name. */
interface NamedItem {
  id: string;
  name: string;
}

/**
 * Context pill chrome — Figma node 1500:25901. The pills are borderless and
 * transparent so they read as labels sitting on the composer surface rather
 * than as chips; every kind (channel, file, ticket, …) uses the same shell so
 * they stay a single visual family.
 */
// `group` on the shell rather than on the inner buttons: the × sits *after* the
// label, so `peer-hover:` (forward-only) can't reach back to it. Hovering
// anywhere on a pill brightens the whole pill together.
const CONTEXT_PILL_CLASS =
  'group flex py-1 px-1.5 justify-center items-center gap-1 rounded-lg flex-shrink-0';
// `group-hover:` only resolves under a `.group` ancestor — the clickable pill
// triggers below — so labels and icons in static pills stay muted while a
// trigger's contents brighten with it. No pill chrome changes background.
const CONTEXT_PILL_LABEL_CLASS =
  "text-muted-foreground group-hover:text-foreground transition-colors font-['Inter'] text-sm font-[450] leading-none whitespace-nowrap";
const CONTEXT_PILL_ICON_CLASS =
  'w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors';
const CONTEXT_PILL_REMOVE_CLASS =
  'rounded p-0.5 flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors';
const CONTEXT_PILL_TRIGGER_CLASS =
  'flex items-center gap-1.5 cursor-pointer bg-transparent border-0 p-0';

/**
 * Icon + label for the list-driven pills, wrapped in a click target only when
 * the pill actually has somewhere to go. Pills whose stored selection predates
 * the navigation fields — or whose search result never carried them — stay
 * inert `div`s rather than advertising a click that would go nowhere.
 */
const pillContent = (
  content: ReactNode,
  action?: { onClick: () => void; ariaLabel: string; trackName: string; trackMetadata: string },
): ReactElement =>
  action ? (
    <button
      type='button'
      onClick={action.onClick}
      className={CONTEXT_PILL_TRIGGER_CLASS}
      aria-label={action.ariaLabel}
      data-track-category='XyneAI'
      data-track-name={action.trackName}
      data-track-metadata={action.trackMetadata}
    >
      {content}
    </button>
  ) : (
    <div className='flex items-center gap-1.5'>{content}</div>
  );

/**
 * Horizontal gap between pills, in px. Figma node 1500:25898 butts them up
 * against each other (their own px-1.5 supplies the visual separation), but the
 * overflow maths has to know the value either way — keep this in sync with the
 * `gap-*` utility on the pill row.
 */
const PILL_GAP = 0;

/**
 * Dev-only fixtures for the context pill row. Flip this to `true` to render one
 * pill of every list-driven kind without having to attach real context, so the
 * row can be styled in isolation. Fixtures are held in local state, so their ×
 * buttons work; the real removal callbacks still fire alongside, and are no-ops
 * against context that was never attached. Delete this block once the pill
 * redesign settles.
 */
const DEBUG_CONTEXT_PILLS = false;

const DEBUG_PILLS: {
  channels: SelectedChannel[];
  tickets: SelectedTicket[];
  canvases: SelectedCanvas[];
  transcripts: SelectedTranscript[];
  recordings: SelectedRecording[];
  collections: NamedItem[];
  fileScopes: NamedItem[];
  folderScopes: NamedItem[];
} = {
  channels: [
    { id: 'dbg-ch-public', name: 'general', isPrivate: false },
    { id: 'dbg-ch-private', name: 'designteam', isPrivate: true },
    { id: 'dbg-ch-dm', name: 'Harsh Sharma', isPrivate: true },
  ],
  tickets: [{ id: 'dbg-ticket', title: 'Ask AI composer revamp', xyneId: 'XYNE-54443' }],
  canvases: [{ id: 'dbg-canvas', title: 'Q3 Launch Plan' }],
  transcripts: [{ id: 'dbg-transcript', title: 'Standup — Jul 24' }],
  recordings: [{ id: 'dbg-recording', title: 'Design review' }],
  collections: [{ id: 'dbg-collection', name: 'Engineering Handbook' }],
  fileScopes: [{ id: 'dbg-filescope', name: 'architecture-overview.md' }],
  folderScopes: [{ id: 'dbg-folderscope', name: 'design-docs' }],
};

type DebugPillKind = keyof typeof DEBUG_PILLS;

export interface ContextPillRowProps {
  /** Hides the row entirely during the onboarding composer. */
  isOnboarding?: boolean;
  /** Drives the card's top radius so it matches the composer shell beneath it. */
  isMobile?: boolean;
  /** Shows the inline context picker below the pills — toolbar "/" or ⌘+/ toggles it. */
  showContextPicker?: boolean;
  /** Close the picker (Escape / ⌘+/ inside it). */
  onCloseContextPicker?: () => void;
  /** Toggle a channel into/out of the attached context. */
  onPickerToggleChannel?: ComponentProps<typeof ContextPicker>['onToggleChannel'];
  /** Toggle a backend result into/out of the attached context. */
  onPickerToggleResult?: ComponentProps<typeof ContextPicker>['onToggleResult'];

  threadInfo: ThreadInfo | null;
  onThreadClick: () => void;
  onRemoveThread: (e: React.MouseEvent) => void;

  canvasInfo: CanvasInfo | null;
  onCanvasInfoClick: () => void;
  onRemoveCanvasInfo: (e: React.MouseEvent) => void;

  selectionInfos: SelectionInfo[];
  onSelectionClick: (selection: SelectionInfo) => void;
  onRemoveSelection: (index: number) => void;

  browserContext: BrowserContext | null;
  onBrowserContextClick: () => void;
  onRemoveBrowserContext: (e: React.MouseEvent) => void;

  channels: SelectedChannel[];
  onRemoveChannel?: (id: string) => void;

  fileScopes: NamedItem[];
  onFileScopesChange?: (fileScopes: NamedItem[]) => void;

  folderScopes?: NamedItem[];
  onFolderScopesChange?: (folderScopes: NamedItem[]) => void;

  collections: NamedItem[];
  onRemoveCollection: (id: string) => void;

  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;

  tickets: SelectedTicket[];
  onRemoveTicket?: (id: string) => void;

  canvases: SelectedCanvas[];
  onRemoveCanvas?: (id: string) => void;
  /** Opens the canvas. */
  onCanvasClick?: (canvas: SelectedCanvas) => void;

  transcripts: SelectedTranscript[];
  onRemoveTranscript?: (id: string) => void;
  /** Opens the conversation the call transcript was shared in. */
  onTranscriptClick?: (transcript: SelectedTranscript) => void;

  recordings: SelectedRecording[];
  onRemoveRecording?: (id: string) => void;
  /** Opens the recording, or the conversation it was shared in. */
  onRecordingClick?: (recording: SelectedRecording) => void;

  activities: UserActivity[];
  onActivitiesChange?: (activities: UserActivity[]) => void;
}

/** One rendered pill, keyed so the visible slice and the measuring layer agree. */
interface RenderedPill {
  key: string;
  node: ReactNode;
}

/**
 * The context pills that sit above the Ask AI composer.
 *
 * Renders as a card floating clear of the composer rather than as a row inside
 * it: an anchor strip pinned to the composer's top edge holds a bottom-anchored
 * container that grows *upward* as pills are added. Height is animated to the
 * measured content, so the card opens and closes smoothly without the composer
 * itself resizing.
 *
 * The row never scrolls — it shows as many pills as fit and collapses the rest
 * into a "+N more" pill. See `visibleCount` for how that's measured.
 *
 * Returns `null` when there is no context — leaving it mounted would paint the
 * card's 2px of border as a sliver above the composer.
 */
export const ContextPillRow = ({
  isOnboarding = false,
  isMobile = false,
  showContextPicker = false,
  onCloseContextPicker,
  onPickerToggleChannel,
  onPickerToggleResult,
  threadInfo,
  onThreadClick,
  onRemoveThread,
  canvasInfo,
  onCanvasInfoClick,
  onRemoveCanvasInfo,
  selectionInfos,
  onSelectionClick,
  onRemoveSelection,
  browserContext,
  onBrowserContextClick,
  onRemoveBrowserContext,
  channels,
  onRemoveChannel,
  fileScopes,
  onFileScopesChange,
  folderScopes = [],
  onFolderScopesChange,
  collections,
  onRemoveCollection,
  attachments,
  onRemoveAttachment,
  tickets,
  onRemoveTicket,
  canvases,
  onRemoveCanvas,
  onCanvasClick,
  transcripts,
  onRemoveTranscript,
  onTranscriptClick,
  recordings,
  onRemoveRecording,
  onRecordingClick,
  activities,
  onActivitiesChange,
}: ContextPillRowProps): ReactElement | null => {
  const contentRef = useRef<HTMLDivElement>(null);
  const { height: contentHeight } = useMeasure({ ref: contentRef, observeResize: true });

  const [debugPills, setDebugPills] = useState(DEBUG_PILLS);
  const removeDebugPill = useCallback((kind: DebugPillKind, id: string) => {
    setDebugPills(
      prev =>
        ({
          ...prev,
          [kind]: (prev[kind] as { id: string }[]).filter(item => item.id !== id),
        }) as typeof prev,
    );
  }, []);

  // Only the rendered lists swap to fixtures — the removal callbacks still point
  // at real state, so a fixture pill can never corrupt attached context.
  const rowChannels = DEBUG_CONTEXT_PILLS ? debugPills.channels : channels;
  const rowTickets = DEBUG_CONTEXT_PILLS ? debugPills.tickets : tickets;
  const rowCanvases = DEBUG_CONTEXT_PILLS ? debugPills.canvases : canvases;
  const rowTranscripts = DEBUG_CONTEXT_PILLS ? debugPills.transcripts : transcripts;
  const rowRecordings = DEBUG_CONTEXT_PILLS ? debugPills.recordings : recordings;
  const rowCollections = DEBUG_CONTEXT_PILLS ? debugPills.collections : collections;
  const rowFileScopes = DEBUG_CONTEXT_PILLS ? debugPills.fileScopes : fileScopes;
  const rowFolderScopes = DEBUG_CONTEXT_PILLS ? debugPills.folderScopes : folderScopes;

  // Flattened so the row can slice by "how many fit" without caring which kind
  // each pill is. Order is the display order.
  const pills: RenderedPill[] = [];

  if (threadInfo) {
    pills.push({
      key: 'thread',
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <button
            type='button'
            onClick={onThreadClick}
            className={CONTEXT_PILL_TRIGGER_CLASS}
            aria-label={
              threadInfo.senderName
                ? `Navigate to thread from ${threadInfo.senderName}`
                : 'Navigate to thread'
            }
            {...(threadInfo.senderName && { title: threadInfo.senderName })}
            data-track-category='XyneAI'
            data-track-name='ClickThreadContextPill'
            data-track-metadata={JSON.stringify({ thread: threadInfo })}
          >
            {/* The avatar stands in for the sender's name — no presence dot, it
                reads as noise at pill scale. Contexts without a sender (tickets,
                calls, recordings) and sessions persisted before `senderId`
                existed fall back to the name prefix. */}
            {threadInfo.senderId && (
              <Avatar
                userId={threadInfo.senderId}
                size='xs'
                rounded
                showActiveStatus={false}
                className='flex-shrink-0'
              />
            )}
            <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[200px] truncate`}>
              {!threadInfo.senderId && threadInfo.senderName ? `${threadInfo.senderName} • ` : ''}
              {threadInfo.previewText}
            </span>
          </button>
          <button
            type='button'
            onClick={onRemoveThread}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label='Remove thread context'
            data-track-category='XyneAI'
            data-track-name='RemoveThreadContext'
            data-track-metadata={JSON.stringify({ thread: threadInfo })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  }

  if (canvasInfo) {
    pills.push({
      key: 'canvas-info',
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <button
            type='button'
            onClick={onCanvasInfoClick}
            className={CONTEXT_PILL_TRIGGER_CLASS}
            aria-label={`Navigate to canvas: ${canvasInfo.title || 'Untitled Canvas'}`}
            data-track-category='XyneAI'
            data-track-name='ClickCanvasContextPill'
            data-track-metadata={JSON.stringify({ canvasId: canvasInfo.canvasId })}
          >
            <FileText className={CONTEXT_PILL_ICON_CLASS} />
            <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[200px] truncate`}>
              {canvasInfo.title || 'Untitled Canvas'}
            </span>
          </button>
          <button
            type='button'
            onClick={onRemoveCanvasInfo}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label='Remove canvas context'
            data-track-category='XyneAI'
            data-track-name='RemoveCanvasContext'
            data-track-metadata={JSON.stringify({ canvasId: canvasInfo.canvasId })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  }

  selectionInfos.forEach((selection, index) => {
    pills.push({
      key: `selection-${selection.canvasId}-${index}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <button
            type='button'
            onClick={() => onSelectionClick(selection)}
            className={CONTEXT_PILL_TRIGGER_CLASS}
            aria-label={`Navigate to canvas with selection: ${selection.preview}`}
            data-track-category='XyneAI'
            data-track-name='ClickSelectionContextPill'
            data-track-metadata={JSON.stringify({ canvasId: selection.canvasId })}
          >
            <FileText className={CONTEXT_PILL_ICON_CLASS} />
            <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[150px] truncate`}>
              {selection.preview}
            </span>
          </button>
          <button
            type='button'
            onClick={() => onRemoveSelection(index)}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label='Remove selection context'
            data-track-category='XyneAI'
            data-track-name='RemoveSelectionContext'
            data-track-metadata={JSON.stringify({ canvasId: selection.canvasId })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  });

  if (browserContext) {
    pills.push({
      key: 'browser',
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <button
            type='button'
            onClick={onBrowserContextClick}
            className={CONTEXT_PILL_TRIGGER_CLASS}
            aria-label={`Open ${browserContext.domain}`}
            title={`${browserContext.title}\n${browserContext.url}`}
            data-track-category='XyneAI'
            data-track-name='ClickBrowserContextPill'
            data-track-metadata={JSON.stringify({
              url: browserContext.url,
              domain: browserContext.domain,
            })}
          >
            <Globe className={`${CONTEXT_PILL_ICON_CLASS} flex-shrink-0`} />
            <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[200px] truncate`}>
              {browserContext.text.slice(0, 50)}
              {browserContext.text.length > 50 ? '...' : ''} • {browserContext.domain}
            </span>
          </button>
          <button
            type='button'
            onClick={onRemoveBrowserContext}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label='Remove browser context'
            data-track-category='XyneAI'
            data-track-name='RemoveBrowserContext'
            data-track-metadata={JSON.stringify({ url: browserContext.url })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  }

  rowChannels.forEach(channel => {
    pills.push({
      key: `channel-${channel.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <div className='flex items-center gap-1.5'>
            <div className='flex-shrink-0'>
              {channel.isPrivate ? (
                <LockClose className={CONTEXT_PILL_ICON_CLASS} />
              ) : (
                // The hashtag glyph reads a touch heavier than the other pill
                // icons at a matched box, so it runs 1px smaller.
                <Hashtag className='w-[15px] h-[15px] text-muted-foreground group-hover:text-foreground transition-colors' />
              )}
            </div>
            <span className={CONTEXT_PILL_LABEL_CLASS}>{channel.name}</span>
          </div>
          <button
            onClick={() => {
              removeDebugPill('channels', channel.id);
              onRemoveChannel?.(channel.id);
            }}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label={`Remove ${channel.name}`}
            data-track-category='XyneAI'
            data-track-name='REMOVE_CHANNEL'
            data-track-metadata={JSON.stringify({ channelId: channel.id })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  });

  rowFileScopes.forEach(fs => {
    pills.push({
      key: `fs-${fs.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <div className='flex items-center gap-1.5'>
            <div className='flex-shrink-0'>
              <FileText className={CONTEXT_PILL_ICON_CLASS} />
            </div>
            <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[160px] truncate`}>{fs.name}</span>
          </div>
          {(DEBUG_CONTEXT_PILLS || onFileScopesChange) && (
            <button
              onClick={() => {
                removeDebugPill('fileScopes', fs.id);
                onFileScopesChange?.(fileScopes.filter(f => f.id !== fs.id));
              }}
              className={CONTEXT_PILL_REMOVE_CLASS}
              aria-label={`Remove file scope ${fs.name}`}
              data-track-category='XyneAI'
              data-track-name='REMOVE_FILE_SCOPE'
            >
              <MultipleCrossCancelDefault className='w-3 h-3' />
            </button>
          )}
        </div>
      ),
    });
  });

  rowFolderScopes.forEach(fo => {
    pills.push({
      key: `fo-${fo.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <div className='flex items-center gap-1.5'>
            <div className='flex-shrink-0'>
              <FolderDefault className={CONTEXT_PILL_ICON_CLASS} />
            </div>
            <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[160px] truncate`}>{fo.name}</span>
          </div>
          {(DEBUG_CONTEXT_PILLS || onFolderScopesChange) && (
            <button
              onClick={() => {
                removeDebugPill('folderScopes', fo.id);
                onFolderScopesChange?.(folderScopes.filter(f => f.id !== fo.id));
              }}
              className={CONTEXT_PILL_REMOVE_CLASS}
              aria-label={`Remove folder scope ${fo.name}`}
              data-track-category='XyneAI'
              data-track-name='REMOVE_FOLDER_SCOPE'
            >
              <MultipleCrossCancelDefault className='w-3 h-3' />
            </button>
          )}
        </div>
      ),
    });
  });

  rowCollections.forEach(collection => {
    pills.push({
      key: `collection-${collection.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <div className='flex items-center gap-1.5'>
            <div className='flex-shrink-0'>
              <Notebook className={CONTEXT_PILL_ICON_CLASS} />
            </div>
            <span className={CONTEXT_PILL_LABEL_CLASS}>{collection.name}</span>
          </div>
          <button
            onClick={() => {
              removeDebugPill('collections', collection.id);
              onRemoveCollection(collection.id);
            }}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label={`Remove ${collection.name}`}
            data-track-category='XyneAI'
            data-track-name='REMOVE_COLLECTION'
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  });

  attachments.forEach(attachment => {
    pills.push({
      key: `attachment-${attachment.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <div className='flex items-center gap-1.5'>
            <div className='flex-shrink-0'>
              <FileText className={CONTEXT_PILL_ICON_CLASS} />
            </div>
            <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[120px] truncate`}>
              {attachment.name}
            </span>
          </div>
          <button
            onClick={() => onRemoveAttachment(attachment.id)}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label={`Remove ${attachment.name}`}
            data-track-category='XyneAI'
            data-track-name='REMOVE_ATTACHMENT'
            data-track-metadata={JSON.stringify({ attachmentId: attachment.id })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  });

  rowTickets.forEach(ticket => {
    pills.push({
      key: `ticket-${ticket.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <div className='flex items-center gap-1.5'>
            <div className='flex-shrink-0'>
              <TicketToken className={CONTEXT_PILL_ICON_CLASS} />
            </div>
            <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[120px] truncate`}>
              {ticket.xyneId ? `${ticket.xyneId}` : ticket.title}
            </span>
          </div>
          <button
            onClick={() => {
              removeDebugPill('tickets', ticket.id);
              onRemoveTicket?.(ticket.id);
            }}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label={`Remove ticket ${ticket.title}`}
            data-track-category='XyneAI'
            data-track-name='REMOVE_TICKET'
            data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  });

  rowCanvases.forEach(canvas => {
    pills.push({
      key: `canvas-${canvas.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          {pillContent(
            <>
              <div className='flex-shrink-0'>
                <FileText className={CONTEXT_PILL_ICON_CLASS} />
              </div>
              <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[120px] truncate`}>
                {canvas.title}
              </span>
            </>,
            onCanvasClick && {
              onClick: (): void => onCanvasClick(canvas),
              ariaLabel: `Open canvas ${canvas.title}`,
              trackName: 'CLICK_CANVAS_CONTEXT_PILL',
              trackMetadata: JSON.stringify({ canvasId: canvas.canvasId ?? canvas.id }),
            },
          )}
          <button
            onClick={() => {
              removeDebugPill('canvases', canvas.id);
              onRemoveCanvas?.(canvas.id);
            }}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label={`Remove canvas ${canvas.title}`}
            data-track-category='XyneAI'
            data-track-name='REMOVE_CANVAS'
            data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  });

  rowTranscripts.forEach(transcript => {
    pills.push({
      key: `transcript-${transcript.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          {pillContent(
            <>
              <div className='flex-shrink-0'>
                <PhoneDefault className={CONTEXT_PILL_ICON_CLASS} />
              </div>
              <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[120px] truncate`}>
                {transcript.title}
              </span>
            </>,
            // No channel means no conversation to open — the transcript's only
            // navigable home.
            onTranscriptClick && transcript.channelId
              ? {
                  onClick: (): void => onTranscriptClick(transcript),
                  ariaLabel: `Open conversation for ${transcript.title}`,
                  trackName: 'CLICK_TRANSCRIPT_CONTEXT_PILL',
                  trackMetadata: JSON.stringify({ transcriptId: transcript.id }),
                }
              : undefined,
          )}
          <button
            onClick={() => {
              removeDebugPill('transcripts', transcript.id);
              onRemoveTranscript?.(transcript.id);
            }}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label={`Remove transcript ${transcript.title}`}
            data-track-category='XyneAI'
            data-track-name='REMOVE_TRANSCRIPT'
            data-track-metadata={JSON.stringify({ transcriptId: transcript.id })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  });

  rowRecordings.forEach(recording => {
    pills.push({
      key: `recording-${recording.id}`,
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          {pillContent(
            <>
              <div className='flex-shrink-0'>
                <AudioLines className={CONTEXT_PILL_ICON_CLASS} />
              </div>
              <span className={`${CONTEXT_PILL_LABEL_CLASS} max-w-[120px] truncate`}>
                {recording.title}
              </span>
            </>,
            onRecordingClick && (recording.externalId || recording.channelId)
              ? {
                  onClick: (): void => onRecordingClick(recording),
                  ariaLabel: recording.externalId
                    ? `Open transcript for ${recording.title}`
                    : `Open recording ${recording.title}`,
                  trackName: 'CLICK_RECORDING_CONTEXT_PILL',
                  trackMetadata: JSON.stringify({ recordingId: recording.id }),
                }
              : undefined,
          )}
          <button
            onClick={() => {
              removeDebugPill('recordings', recording.id);
              onRemoveRecording?.(recording.id);
            }}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label={`Remove recording ${recording.title}`}
            data-track-category='XyneAI'
            data-track-name='REMOVE_RECORDING'
            data-track-metadata={JSON.stringify({ recordingId: recording.id })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  });

  if (activities.length > 0) {
    pills.push({
      key: 'activities',
      node: (
        <div className={CONTEXT_PILL_CLASS}>
          <div className='flex items-center gap-1.5'>
            <span className={CONTEXT_PILL_LABEL_CLASS}>
              {activities.length} {activities.length === 1 ? 'activity' : 'activities'}
            </span>
          </div>
          <button
            onClick={() => onActivitiesChange?.([])}
            className={CONTEXT_PILL_REMOVE_CLASS}
            aria-label='Remove all activities'
            data-track-category='XyneAI'
            data-track-name='RemoveAllActivities'
            data-track-metadata={JSON.stringify({ activityCount: activities.length })}
          >
            <MultipleCrossCancelDefault className='w-3 h-3' />
          </button>
        </div>
      ),
    });
  }

  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const { width: trackWidth } = useMeasure({ ref: trackRef, observeResize: true });
  // The measuring layer is `w-max`, so its own width changes whenever any pill's
  // label does — using it as an effect dep re-runs the fit maths on content
  // changes, not just container resizes.
  const { width: measuredWidth } = useMeasure({ ref: measureRef, observeResize: true });

  const [visibleCount, setVisibleCount] = useState(pills.length);
  // Expanded, the track wraps to as many lines as the pills need; the card's
  // animated height follows because it tracks the measured content.
  const [expanded, setExpanded] = useState(false);

  // Growing eases, shrinking snaps. Whenever the content gets shorter — a pill
  // removed, the row collapsed, the picker closed — it reflows in a single
  // frame, and because the card is bottom-anchored the surviving content is
  // already sitting at its final position. A tween would then only shrink dead
  // space *above* settled content, which reads as the card lagging behind.
  const prevContentHeight = useRef(contentHeight);
  const shrinking = contentHeight < prevContentHeight.current;
  useEffect(() => {
    prevContentHeight.current = contentHeight;
  }, [contentHeight]);

  // Walks the off-screen copy of the row (which always holds every pill at its
  // natural width) and counts how many fit in the visible track. When they don't
  // all fit, room is reserved for the "+N more" pill by dropping pills from the
  // end until it fits too.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el || trackWidth <= 0) return;

    const children = Array.from(el.children) as HTMLElement[];
    // Last child is the "+N more" sample, not a real pill.
    const moreWidth = children[children.length - 1]?.getBoundingClientRect().width ?? 0;
    const widths = children.slice(0, -1).map(child => child.getBoundingClientRect().width);

    let used = 0;
    let count = 0;
    for (const width of widths) {
      const next = used + width + (count > 0 ? PILL_GAP : 0);
      if (next > trackWidth) break;
      used = next;
      count += 1;
    }

    if (count < widths.length) {
      while (count > 0 && used + PILL_GAP + moreWidth > trackWidth) {
        count -= 1;
        used -= (widths[count] ?? 0) + (count > 0 ? PILL_GAP : 0);
      }
    }

    setVisibleCount(count);
  }, [trackWidth, measuredWidth, pills.length]);

  const hasPills = pills.length > 0;
  const shownCount = expanded ? pills.length : Math.min(visibleCount, pills.length);
  const hiddenCount = pills.length - shownCount;

  const expand = (): void => setExpanded(true);
  const toggleExpanded = (): void => setExpanded(!expanded);

  // The picker keeps the card open on its own — it can be opened before any
  // context is attached.
  if (isOnboarding || (!hasPills && !showContextPicker)) return null;

  const morePill = (count: number): ReactElement => (
    <button
      type='button'
      onClick={expand}
      className={`${CONTEXT_PILL_CLASS} cursor-pointer bg-transparent border-0`}
      aria-label={`Show ${count} more context ${count === 1 ? 'item' : 'items'}`}
      data-track-category='XyneAI'
      data-track-name='EXPAND_CONTEXT_PILLS'
    >
      <span className={CONTEXT_PILL_LABEL_CLASS}>+{count} more</span>
    </button>
  );

  return (
    // Sits outside the composer shell, flush with its top edge — the shell is
    // overflow-hidden, so anything inside it gets clipped and inset by the 1px
    // border.
    <div className='absolute top-0 left-0 right-0 h-px'>
      {/* Bottom-anchored 12px BELOW the 1px strip, so it grows upward from that
          offset. Height tracks the measured content plus the child's 12px margin
          and this box's 2px of border, neither of which
          getBoundingClientRect reports. */}
      <motion.div
        className={`absolute -bottom-[12px] left-0 right-0 overflow-hidden border border-chat-composer-border ${
          showContextPicker ? 'bg-background' : 'bg-muted/10 backdrop-blur-md'
        } ${isMobile ? 'rounded-t-[26px]' : 'rounded-t-2xl'}`}
        animate={{ height: contentHeight + 14 }}
        initial={false}
        transition={{ duration: shrinking ? 0 : 0.18, ease: 'easeOut' }}
      >
        {/* The measured element. Pinned to the bottom so content stays put while
            the container grows upward; absolute + left/right-0 still sizes its
            height to its own content. */}
        <div ref={contentRef} className='absolute bottom-0 mb-[12px] left-0 right-0'>
          {hasPills && (
            <div className='flex items-start justify-between min-w-0 px-3 pt-2 pb-1'>
              <div
                ref={trackRef}
                className={`relative flex items-center flex-1 min-w-0 ${
                  expanded ? 'flex-wrap gap-y-2' : 'flex-nowrap overflow-hidden'
                }`}
              >
                {/* Off-screen twin: every pill at natural width, plus a worst-case
                  "+N more" so the reserve is never under-measured. `invisible`
                  rather than `hidden` — it still needs layout to be measurable —
                  and absolute so it contributes nothing to the track's size. */}
                <div
                  ref={measureRef}
                  aria-hidden
                  className='absolute left-0 top-0 flex items-center flex-nowrap w-max invisible pointer-events-none'
                >
                  {pills.map(pill => (
                    <Fragment key={pill.key}>{pill.node}</Fragment>
                  ))}
                  {morePill(pills.length)}
                </div>

                {pills.slice(0, shownCount).map(pill => (
                  <Fragment key={pill.key}>{pill.node}</Fragment>
                ))}
                {hiddenCount > 0 && morePill(hiddenCount)}
              </div>

              <button
                type='button'
                onClick={toggleExpanded}
                className={`${CONTEXT_PILL_CLASS} text-muted-foreground hover:text-foreground transition-colors`}
                aria-label={expanded ? 'Collapse context' : 'Expand context'}
                aria-expanded={expanded}
                data-track-category='XyneAI'
                data-track-name={expanded ? 'COLLAPSE_CONTEXT_PILLS' : 'EXPAND_CONTEXT_PILLS'}
              >
                {expanded ? (
                  <ChevronBigDown className='w-4 h-4' />
                ) : (
                  <ChevronBigUp className='w-4 h-4' />
                )}
              </button>
            </div>
          )}

          {showContextPicker && (
            <ContextPicker
              selectedIds={{
                channels: new Set(rowChannels.map(c => c.id)),
                tickets: new Set(rowTickets.map(t => t.id)),
                canvases: new Set(rowCanvases.map(c => c.id)),
                transcripts: new Set(rowTranscripts.map(t => t.id)),
                recordings: new Set(rowRecordings.map(r => r.id)),
              }}
              {...(onPickerToggleChannel && { onToggleChannel: onPickerToggleChannel })}
              {...(onPickerToggleResult && { onToggleResult: onPickerToggleResult })}
              {...(onCloseContextPicker && { onClose: onCloseContextPicker })}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
};
