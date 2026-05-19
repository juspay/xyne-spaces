import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Mail,
  Ticket,
  FileText,
  Globe,
  Phone,
  Library,
  ExternalLink,
} from 'lucide-react';
import type { DraftSource } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { cn } from '../../../utils/classNames';
import { useParams } from 'react-router-dom';
import {
  attachmentViewerActor,
  type AttachmentRef,
} from '../../../machines/attachmentViewerMachine';
import { threadCitationStore } from '../ThreadCitationModal/ThreadCitationModal';

interface DraftSourcesPanelProps {
  sources: DraftSource[];
  defaultExpanded?: boolean;
  embedded?: boolean;
  highlightedRef?: string | null;
  loading?: boolean;
}

export function filterUsefulSources(sources: DraftSource[] | undefined): DraftSource[] {
  if (!sources || sources.length === 0) return [];
  const seen = new Set<string>();
  const out: DraftSource[] = [];
  for (const s of sources) {
    if (!s.prefixedRef || seen.has(s.prefixedRef)) continue;
    seen.add(s.prefixedRef);
    out.push(s);
  }
  return out;
}

const SOURCE_TYPE_ICONS: Record<NonNullable<DraftSource['entityType']>, typeof Mail> = {
  message: MessageSquare,
  attachment: FileText,
  call: Phone,
  recording: Phone,
  canvas: FileText,
  ticket: Ticket,
  web_search: Globe,
  knowledge_base: Library,
};

const SOURCE_TYPE_LABELS: Record<NonNullable<DraftSource['entityType']>, string> = {
  message: 'Message',
  attachment: 'Attachment',
  call: 'Call',
  recording: 'Recording',
  canvas: 'Canvas',
  ticket: 'Ticket',
  web_search: 'Web',
  knowledge_base: 'Knowledge base',
};

function cleanSnippetText(raw: string): string {
  return raw
    .replace(/<\/?hi\b[^>]*>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCanvasMetadata(text: string): string {
  let body = text;
  const contentIdx = body.indexOf('\nContent:\n');
  if (contentIdx !== -1) body = body.slice(contentIdx + '\nContent:\n'.length);
  return body.replace(/^Canvas:[\s\S]*?\nContent Status:[^\n]*\n\n/, '');
}

function describeSource(s: DraftSource): string {
  if (s.chunkText && s.chunkText.trim()) {
    const text = s.entityType === 'canvas' ? stripCanvasMetadata(s.chunkText) : s.chunkText;
    return cleanSnippetText(text).slice(0, 140);
  }
  if (s.fileName) return s.fileName;
  if (s.externalUrl) return s.externalUrl;
  if (s.entityId) return s.entityId;
  return s.prefixedRef;
}

function DraftSourceRow({
  source,
  isHighlighted = false,
  displayNumber,
}: {
  source: DraftSource;
  isHighlighted?: boolean;
  displayNumber?: number;
}): ReactElement {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isHighlighted) return;
    rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [isHighlighted]);

  const isTicket = source.entityType === 'ticket' && !!source.entityId;

  // Message citations carry conversationId/channelId from the backend
  // (transformMessageToEntity + search_relevant_content both populate them),
  // so no per-row refetch is needed — read straight off the source.
  const resolvedConversationId = source.conversationId || '';
  const resolvedChannelId = source.channelId || '';

  const url = ((): string | null => {
    if (source.isExternal && source.externalUrl) return source.externalUrl;
    if (source.entityType === 'web_search' && source.externalUrl) return source.externalUrl;
    if (source.entityType === 'canvas' && source.canvasId && workspaceId) {
      return `/${workspaceId}/chat/canvas/${source.canvasId}`;
    }
    return null;
  })();

  const isThreadClickable =
    (source.entityType === 'ticket' && !!source.entityId) ||
    (source.entityType === 'message' && !!resolvedConversationId);
  const openThreadModal = (): void => {
    if (source.entityType === 'ticket' && source.entityId) {
      threadCitationStore.open({
        ticketId: source.entityId,
        ...(source.channelId && { channelId: source.channelId }),
        ...(source.messageId && { messageId: source.messageId }),
      });
      return;
    }
    if (source.entityType === 'message' && resolvedConversationId) {
      threadCitationStore.open({
        conversationId: resolvedConversationId,
        ...(resolvedChannelId && { channelId: resolvedChannelId }),
        ...((source.messageId || source.entityId) && {
          messageId: source.messageId || source.entityId!,
        }),
      });
    }
  };

  const isAttachmentClickable = source.entityType === 'attachment' && !!source.entityId;
  const openAttachmentPreview = (): void => {
    if (!isAttachmentClickable) return;
    const pageMatch = source.chunkText?.match(/^\[Pages?\s+(\d+)/i);
    const initialPage = pageMatch?.[1] ? Number(pageMatch[1]) : source.chunkPos;
    const attachment: AttachmentRef = {
      attachmentId: source.entityId!,
      fileName: source.fileName ?? source.entityId!,
      fileUrl: `/attachments/${source.entityId}/download`,
      mimeType: source.mimeType ?? 'application/octet-stream',
      fileSize: 0,
      ...(initialPage !== null && { initialPage }),
    };
    attachmentViewerActor.send({
      type: 'OPEN',
      attachments: [attachment],
      startIndex: 0,
    });
  };

  const Icon = SOURCE_TYPE_ICONS[source.entityType ?? 'message'] ?? FileText;
  const typeLabel = SOURCE_TYPE_LABELS[source.entityType ?? 'message'] ?? 'Source';
  const preview = isTicket && source.ticketTitle ? source.ticketTitle : describeSource(source);
  const isInteractive = !!url || isAttachmentClickable || isThreadClickable;
  const Tag = url ? 'a' : isAttachmentClickable || isThreadClickable ? 'button' : 'div';

  return (
    <Tag
      {...(url
        ? {
            href: url,
            target: '_blank',
            rel: 'noopener noreferrer',
            'data-track-category': 'AIDraft',
            'data-track-name': 'OpenSource',
          }
        : isAttachmentClickable
          ? {
              type: 'button' as const,
              onClick: openAttachmentPreview,
              'data-track-category': 'AIDraft',
              'data-track-name': 'OpenAttachmentPreview',
            }
          : isThreadClickable
            ? {
                type: 'button' as const,
                onClick: openThreadModal,
                'data-track-category': 'AIDraft',
                'data-track-name': 'OpenThreadCitation',
              }
            : {})}
      ref={rowRef as never}
      className={cn(
        'group flex items-start gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-left text-xs transition-colors w-full',
        isInteractive &&
          'cursor-pointer hover:border-red-300 hover:bg-accent hover:text-accent-foreground',
        !isInteractive && 'opacity-70',
        isHighlighted && 'border-red-400 bg-red-50 dark:bg-red-950/40 ring-1 ring-red-300',
      )}
    >
      {displayNumber !== null ? (
        <span
          className='mt-0.5 flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-[10px] font-semibold tabular-nums'
          aria-label={`Citation ${displayNumber}`}
        >
          {displayNumber}
        </span>
      ) : (
        <Icon
          size={13}
          className='mt-0.5 flex-shrink-0 text-muted-foreground group-hover:text-red-600'
        />
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
          <span>{typeLabel}</span>
          <span className='font-mono normal-case opacity-60'>{source.prefixedRef}</span>
          {isTicket && source.ticketXyneId && (
            <span className='font-mono normal-case opacity-60'>· {source.ticketXyneId}</span>
          )}
          {source.entityType === 'message' && source.channelName && (
            <span className='normal-case opacity-60'>· #{source.channelName}</span>
          )}
          {source.chunkPos !== null && (
            <span className='font-mono normal-case opacity-60'>· p{source.chunkPos}</span>
          )}
        </div>
        {source.entityType === 'attachment' && source.fileName && (
          <p className='mt-0.5 text-foreground font-semibold line-clamp-1 break-words'>
            {source.fileName}
          </p>
        )}
        {source.entityType === 'canvas' && source.canvasTitle && (
          <p className='mt-0.5 text-foreground font-semibold line-clamp-1 break-words'>
            {source.canvasTitle}
          </p>
        )}
        <p className='mt-0.5 text-foreground/90 line-clamp-2 break-words'>{preview}</p>
      </div>
      {isInteractive && (
        <ExternalLink
          size={11}
          className='mt-1 flex-shrink-0 text-muted-foreground/50 group-hover:text-red-600'
        />
      )}
    </Tag>
  );
}

function SourcesSkeleton(): ReactElement {
  return (
    <ul className='flex flex-col gap-1.5 pb-1' aria-label='Loading sources'>
      {[0, 1, 2].map(i => (
        <li
          key={i}
          className='flex items-start gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5'
        >
          <div className='mt-0.5 h-[18px] w-[18px] flex-shrink-0 rounded-md bg-muted animate-pulse' />
          <div className='min-w-0 flex-1 space-y-1.5 py-0.5'>
            <div className='h-2.5 w-24 rounded bg-muted animate-pulse' />
            <div className='h-2.5 w-full rounded bg-muted animate-pulse' />
            <div className='h-2.5 w-2/3 rounded bg-muted animate-pulse' />
          </div>
        </li>
      ))}
    </ul>
  );
}

export const DraftSourcesPanel = ({
  sources,
  defaultExpanded = false,
  embedded = false,
  highlightedRef = null,
  loading = false,
}: DraftSourcesPanelProps): ReactElement | null => {
  const [expanded, setExpanded] = useState(embedded ? true : defaultExpanded);
  const dedupedSources = useMemo(() => filterUsefulSources(sources), [sources]);
  const visibleSources = dedupedSources;

  if (dedupedSources.length === 0) {
    // Embedded (Sources tab): distinguish "still hydrating" from "genuinely
    // empty" so a slow/failed fetch shows a skeleton, not a blank panel.
    if (!embedded) return null;
    if (loading) return <SourcesSkeleton />;
    return (
      <div className='flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground'>
        <FileText size={20} className='mb-2 opacity-40' />
        No sources found for this draft&apos;s citations.
      </div>
    );
  }

  const sourceList = (
    <ul
      className={cn(
        'flex flex-col gap-1.5',
        embedded ? 'pb-1' : 'px-4 pb-3 max-h-72 overflow-y-auto',
      )}
    >
      {visibleSources.map((source, idx) => (
        <DraftSourceRow
          key={`${source.prefixedRef}-${source.entityId ?? source.messageId ?? source.canvasId ?? ''}`}
          source={source}
          isHighlighted={source.prefixedRef === highlightedRef}
          displayNumber={idx + 1}
        />
      ))}
    </ul>
  );

  if (embedded) return sourceList;

  return (
    <div className='mb-4 rounded-xl border border-border/60 bg-muted/20'>
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
        className='flex w-full items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors'
        data-track-category='AIDraft'
        data-track-name='ToggleSources'
      >
        <span className='inline-flex items-center gap-1.5'>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          AI sources used ({dedupedSources.length})
        </span>
        <span className='text-[10px] font-normal text-muted-foreground/70'>
          Click any source to verify
        </span>
      </button>
      {expanded && sourceList}
    </div>
  );
};
