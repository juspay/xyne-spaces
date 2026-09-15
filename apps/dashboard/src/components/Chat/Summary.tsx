import { logger, Event as LogEvent } from '../../utils/logger';
/**
 * Unified Summary Component
 * Handles both thread and channel summarization with shared UI and logic
 */
import { useState, useEffect, useCallback, useMemo, useRef, ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Users, MessageSquare, Hash, Sparkles, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { BASE_URL } from '../../services/clients/apiClient';
import { useSummaryCache } from '../../hooks/useSummaryQuery';
import { sanitizeHtmlString } from '../../utils/sanitizer';
import { ChannelScopeType } from '@xyne/shared';

// AI keypoints are markdown; convert **bold** → <strong>, then run through the
// shared allowlist sanitizer so any HTML smuggled into the (prompt-injection-
// reachable) summary can't run via the dangerouslySetInnerHTML below.
export const sanitizeBoldMarkdown = (text: string): string =>
  sanitizeHtmlString(text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'));

// ============================================================================
// Type Definitions
// ============================================================================

interface Citation {
  messageIndex: number;
  messageId: string;
}

interface KeyPointWithCitation {
  point: string;
  citation: Citation;
}

interface TopicSection {
  heading: string;
  keyPoints: KeyPointWithCitation[];
}

interface SummaryOutput {
  summary: string;
  topicSections?: TopicSection[];
  keyPoints?: KeyPointWithCitation[];
  participantCount: number;
  messageCount: number;
  topicsTouched?: string[];
}

// Common props for both summary types
interface BaseSummaryProps {
  channelName: string;
  onClose: () => void;
  scopeType?: string;
}

// Thread-specific props
interface ThreadSummaryProps extends BaseSummaryProps {
  type: 'thread';
  conversationId: string;
  channelId?: never;
  dateFrom?: never;
  dateTo?: never;
}

// Channel-specific props
interface ChannelSummaryProps extends BaseSummaryProps {
  type: 'channel';
  channelId: string;
  conversationId?: never;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export type SummaryProps = ThreadSummaryProps | ChannelSummaryProps;

type SummaryState = 'loading' | 'streaming' | 'complete' | 'error' | 'no_messages';

// SSE Event Types
interface SSEStartEvent {
  type: 'start';
  conversationIdMapping?: Record<string, string>;
  messageIdMapping?: Record<string, string>;
  messageCount?: number;
  participantCount?: number;
  participants?: Array<{ id: string; name: string; email: string }>;
  dateFrom?: string;
  dateTo?: string;
}

interface SSEDeltaEvent {
  type: 'delta';
  content?: string;
}

interface SSECompleteEvent {
  type: 'complete';
  output?: SummaryOutput;
  conversationIdMapping?: Record<string, string>;
  messageIdMapping?: Record<string, string>; // For thread summaries
}

interface SSEErrorEvent {
  type: 'error';
  error?: string;
}

interface SSENoMessagesEvent {
  type: 'no_messages';
  message?: string;
  totalMessages?: number;
}

interface SSEEndEvent {
  type: 'end';
}

type SSEEvent =
  | SSEStartEvent
  | SSEDeltaEvent
  | SSECompleteEvent
  | SSEErrorEvent
  | SSENoMessagesEvent
  | SSEEndEvent;

// Type guard
function isValidSSEEvent(data: unknown): data is SSEEvent {
  if (typeof data !== 'object' || data === null) return false;
  const event = data as { type?: unknown };
  return (
    event.type === 'start' ||
    event.type === 'delta' ||
    event.type === 'complete' ||
    event.type === 'error' ||
    event.type === 'no_messages' ||
    event.type === 'end'
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

interface StreamingParsedContent {
  summary: string;
  keypoints: string[];
  citations: Record<number, number>;
  isComplete: boolean;
}

export function parseStreamingContent(content: string): StreamingParsedContent {
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<think>[\s\S]*/gi, '');
  cleaned = cleaned.replace(/```json\s*/gi, '');
  cleaned = cleaned.replace(/```\s*/gi, '');

  let summary = '';
  const keypoints: string[] = [];
  let citations: Record<number, number> = {};

  const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]*)(")?/);
  if (summaryMatch && summaryMatch[1]) {
    summary = summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  const keypointsMatch = cleaned.match(/"keypoints"\s*:\s*"([^"]*)(")?/);
  if (keypointsMatch && keypointsMatch[1]) {
    const keypointsStr = keypointsMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');

    const points = keypointsStr
      .split('\n')
      .map(p => p.replace(/^[•\-*]\s*/, '').trim())
      .filter(p => p.length > 0);

    keypoints.push(...points);
  }

  const citationsMatch = cleaned.match(/"citations"\s*:\s*\{([^}]*)\}/);
  if (citationsMatch && citationsMatch[1]) {
    try {
      const citationsStr = `{${citationsMatch[1]}}`;
      citations = JSON.parse(citationsStr) as Record<number, number>;
    } catch {
      const citationContent = citationsMatch[1];
      const pairMatches = citationContent.matchAll(/(\d+)\s*:\s*(\d+)/g);
      for (const match of pairMatches) {
        if (match[1] && match[2]) {
          citations[parseInt(match[1], 10)] = parseInt(match[2], 10);
        }
      }
    }
  }

  const isComplete = cleaned.includes('"citations"') && cleaned.includes('}');
  return { summary, keypoints, citations, isComplete };
}

// ============================================================================
// Components
// ============================================================================

// Copy icon matching the provided design
const CopyIcon = (): ReactElement => (
  <div className='w-3.5 h-3.5 relative overflow-hidden'>
    <div className='w-2 h-2 left-[5px] top-[5px] absolute outline outline-1 outline-offset-[-0.58px] outline-muted-foreground rounded-[1px]' />
    <div className='w-2 h-2 left-[1.25px] top-[1.25px] absolute outline outline-1 outline-offset-[-0.58px] outline-muted-foreground rounded-[1px] bg-muted' />
  </div>
);

const SkeletonLoader = (): ReactElement => (
  <div className='flex w-80 flex-col items-start gap-2'>
    <div className='self-stretch h-6 skeleton-pulse' />
    <div className='self-stretch h-6 skeleton-pulse-delay-1' />
    <div className='self-stretch h-6 skeleton-pulse-delay-2' />
  </div>
);

// ============================================================================
// Main Component
// ============================================================================

export const Summary = (props: SummaryProps): ReactElement => {
  const { type, channelName, onClose } = props;
  const isThread = type === 'thread';
  const id = isThread ? props.conversationId : props.channelId;
  const dateFrom = isThread ? undefined : props.dateFrom;
  const dateTo = isThread ? undefined : props.dateTo;

  const navigate = useNavigate();

  // Cache store
  const { getThreadSummary, setThreadSummary, getChannelSummary, setChannelSummary } =
    useSummaryCache();

  const [state, setState] = useState<SummaryState>('loading');
  const [summary, setSummary] = useState<SummaryOutput | null>(null);
  const [rawStreamingContent, setRawStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noMessagesInfo, setNoMessagesInfo] = useState<{
    message: string;
    totalMessages: number;
  } | null>(null);
  const [visibleChars, setVisibleChars] = useState(0);
  const [messageIdMapping, setMessageIdMapping] = useState<Record<string, string>>({});
  const [conversationIdMapping, setConversationIdMapping] = useState<Record<string, string>>({});
  const [metadata, setMetadata] = useState<{ messageCount: number; participantCount: number }>({
    messageCount: 0,
    participantCount: 0,
  });
  const [threadDateRange, setThreadDateRange] = useState<{
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
  }>({});
  const [copied, setCopied] = useState(false);

  const loadedFromCache = useRef(false);
  const currentIdRef = useRef(id);
  const abortControllerRef = useRef<AbortController | null>(null);
  const metadataRef = useRef<{ messageCount: number; participantCount: number }>({
    messageCount: 0,
    participantCount: 0,
  });
  const rawStreamingContentRef = useRef('');
  const threadDateRangeRef = useRef<{ dateFrom?: string | undefined; dateTo?: string | undefined }>(
    {},
  );

  // Parse streaming content
  const streamingParsed = useMemo((): StreamingParsedContent => {
    return parseStreamingContent(rawStreamingContent);
  }, [rawStreamingContent]);

  const cleanedContent = useMemo((): string => {
    return streamingParsed.summary;
  }, [streamingParsed]);

  // Character reveal
  const contentLength = cleanedContent.length;
  useEffect(() => {
    if (state === 'streaming' && contentLength > 0 && visibleChars < contentLength) {
      const timer = setTimeout(() => {
        const charsToReveal = Math.min(3, contentLength - visibleChars);
        setVisibleChars(prev => prev + charsToReveal);
      }, 10);
      return (): void => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [state, contentLength, visibleChars]);

  useEffect(() => {
    if (rawStreamingContent === '') setVisibleChars(0);
  }, [rawStreamingContent]);

  const displayStreamingContent = useMemo((): string => {
    return cleanedContent.slice(0, visibleChars);
  }, [cleanedContent, visibleChars]);

  const fetchSummary = useCallback(
    async (forceRefresh = false, targetId?: string): Promise<void> => {
      const fetchId = targetId || id;

      // Check cache
      if (!forceRefresh) {
        const cached = isThread
          ? getThreadSummary(fetchId)
          : getChannelSummary(fetchId, dateFrom ?? '', dateTo ?? '');
        if (cached) {
          if (currentIdRef.current === fetchId) {
            setSummary(cached.summary as SummaryOutput);
            if (cached.conversationIdMapping)
              setConversationIdMapping(cached.conversationIdMapping);
            if (cached.messageIdMapping) setMessageIdMapping(cached.messageIdMapping);
            setMetadata({
              messageCount: cached.summary.messageCount ?? 0,
              participantCount: cached.summary.participantCount ?? 0,
            });
            if (isThread && cached.dateFrom) {
              setThreadDateRange({
                dateFrom: cached.dateFrom,
                dateTo: cached.dateTo,
              });
            }
            setState('complete');
            loadedFromCache.current = true;
          }
          return;
        }
      }

      // Cancel ongoing
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Reset state
      loadedFromCache.current = false;
      setState('loading');
      setError(null);
      setRawStreamingContent('');
      rawStreamingContentRef.current = '';
      metadataRef.current = { messageCount: 0, participantCount: 0 };
      setSummary(null);
      setNoMessagesInfo(null);
      setMessageIdMapping({});
      setConversationIdMapping({});

      try {
        // Build URL
        let url = isThread
          ? `${BASE_URL}/summarize/thread/${fetchId}`
          : `${BASE_URL}/summarize/channel/${fetchId}`;
        if (!isThread && (dateFrom || dateTo)) {
          const params = new URLSearchParams();
          if (dateFrom) params.append('dateFrom', dateFrom);
          if (dateTo) params.append('dateTo', dateTo);
          if (params.toString()) url += `?${params.toString()}`;
        }

        // eslint-disable-next-line local-rules/no-fetch-use-axios
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          credentials: 'include',
          signal: abortController.signal,
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No response body');

        let buffer = '';
        let hasReceivedNoMessages = false;
        let hasReceivedComplete = false;
        let receivedConversationIdMapping: Record<string, string> = {};
        let receivedMessageIdMapping: Record<string, string> = {};

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
        while (true) {
          if (abortController.signal.aborted) {
            void reader.cancel();
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (currentIdRef.current !== fetchId) {
            void reader.cancel();
            return;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed: unknown = JSON.parse(line.slice(6));
                if (currentIdRef.current !== fetchId) {
                  void reader.cancel();
                  return;
                }
                if (!isValidSSEEvent(parsed)) continue;

                const data = parsed;
                switch (data.type) {
                  case 'start': {
                    if (data.messageIdMapping) {
                      receivedMessageIdMapping = data.messageIdMapping;
                      setMessageIdMapping(data.messageIdMapping);
                    }
                    if (data.conversationIdMapping) {
                      receivedConversationIdMapping = data.conversationIdMapping;
                      setConversationIdMapping(data.conversationIdMapping);
                    }

                    const newMeta = {
                      messageCount: data.messageCount ?? 0,
                      participantCount: data.participantCount ?? data.participants?.length ?? 0,
                    };
                    metadataRef.current = newMeta;
                    setMetadata(newMeta);

                    if (data.dateFrom || data.dateTo) {
                      const dateRange = {
                        dateFrom: data.dateFrom,
                        dateTo: data.dateTo,
                      };
                      threadDateRangeRef.current = dateRange;
                      setThreadDateRange(dateRange);
                    }

                    setState('streaming');
                    break;
                  }

                  case 'delta':
                    if (data.content) {
                      setState('streaming');
                      rawStreamingContentRef.current += data.content;
                      setRawStreamingContent(prev => prev + data.content);
                    }
                    break;

                  case 'complete':
                    if (data.output) {
                      if (data.messageIdMapping) {
                        receivedMessageIdMapping = data.messageIdMapping;
                        setMessageIdMapping(data.messageIdMapping);
                      }
                      if (data.conversationIdMapping) {
                        receivedConversationIdMapping = data.conversationIdMapping;
                        setConversationIdMapping(data.conversationIdMapping);
                      }

                      const finalParsed = parseStreamingContent(rawStreamingContentRef.current);
                      const keyPointsFromStream: KeyPointWithCitation[] = finalParsed.keypoints.map(
                        (point, idx) => {
                          const keypointNum = idx + 1;
                          const messageNumber = finalParsed.citations[keypointNum] || 0;
                          const refId = receivedMessageIdMapping[String(messageNumber)] || '';
                          return {
                            point,
                            citation: { messageIndex: messageNumber, messageId: refId },
                          };
                        },
                      );

                      const finalKeyPoints =
                        keyPointsFromStream.length > 0
                          ? keyPointsFromStream
                          : data.output.keyPoints || [];

                      const completeOutput: SummaryOutput = {
                        summary: finalParsed.summary || data.output.summary || '',
                        messageCount:
                          metadataRef.current.messageCount || data.output.messageCount || 0,
                        participantCount:
                          metadataRef.current.participantCount || data.output.participantCount || 0,
                        ...(finalKeyPoints.length > 0 ? { keyPoints: finalKeyPoints } : {}),
                        ...(data.output.topicSections
                          ? { topicSections: data.output.topicSections }
                          : {}),
                      };

                      setSummary(completeOutput);
                      setState('complete');
                      hasReceivedComplete = true;

                      if (isThread) {
                        setThreadSummary(fetchId, {
                          summary: completeOutput,
                          conversationIdMapping: receivedConversationIdMapping,
                          messageIdMapping: receivedMessageIdMapping,
                          dateFrom: threadDateRangeRef.current.dateFrom,
                          dateTo: threadDateRangeRef.current.dateTo,
                          cachedAt: Date.now(),
                        });
                      } else {
                        setChannelSummary(fetchId, dateFrom ?? '', dateTo ?? '', {
                          summary: completeOutput,
                          conversationIdMapping: receivedConversationIdMapping,
                          messageIdMapping: receivedMessageIdMapping,
                          cachedAt: Date.now(),
                        });
                      }
                    }
                    break;

                  case 'error':
                    setError(data.error || 'An error occurred');
                    setState('error');
                    break;

                  case 'no_messages':
                    setNoMessagesInfo({
                      message: data.message || 'No messages found',
                      totalMessages: data.totalMessages || 0,
                    });
                    setState('no_messages');
                    hasReceivedNoMessages = true;
                    break;

                  case 'end':
                    if (!hasReceivedNoMessages && !hasReceivedComplete) setState('complete');
                    break;
                }
              } catch {
                /* Ignore parse errors */
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error fetching summary:'),
          error: err,
        });
        if (currentIdRef.current === fetchId) {
          setError(err instanceof Error ? err.message : 'Failed to fetch summary');
          setState('error');
        }
      }
    },
    [
      id,
      isThread,
      dateFrom,
      dateTo,
      getThreadSummary,
      setThreadSummary,
      getChannelSummary,
      setChannelSummary,
    ],
  );

  // Effect to fetch on mount/id change
  useEffect(() => {
    currentIdRef.current = id;

    const cached = isThread
      ? getThreadSummary(id)
      : getChannelSummary(id, dateFrom ?? '', dateTo ?? '');
    if (cached) {
      setSummary(cached.summary as SummaryOutput);
      if (cached.conversationIdMapping) setConversationIdMapping(cached.conversationIdMapping);
      if (cached.messageIdMapping) setMessageIdMapping(cached.messageIdMapping);
      setMetadata({
        messageCount: cached.summary.messageCount ?? 0,
        participantCount: cached.summary.participantCount ?? 0,
      });
      if (isThread && cached.dateFrom) {
        setThreadDateRange({
          dateFrom: cached.dateFrom,
          dateTo: cached.dateTo,
        });
      }
      setState('complete');
      loadedFromCache.current = true;
      return;
    }

    setState('loading');
    setSummary(null);
    setRawStreamingContent('');
    setVisibleChars(0);
    setError(null);
    setNoMessagesInfo(null);

    void fetchSummary(false, id);

    return (): void => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [id, isThread, dateFrom, dateTo]);

  const handleRefresh = (): void => {
    void fetchSummary(true);
  };

  // Copy summary text (excluding citations)
  const handleCopy = useCallback((): void => {
    const summaryText = summary?.summary || streamingParsed.summary || '';
    const useStreamedKeypoints = streamingParsed.keypoints.length > 0;
    const backendKeypoints = summary?.topicSections?.[0]?.keyPoints || summary?.keyPoints || [];
    const keypointsToRender = useStreamedKeypoints
      ? streamingParsed.keypoints
      : backendKeypoints.map(kp => (typeof kp === 'string' ? kp : kp.point));

    // Format the text for clipboard
    let textToCopy = summaryText;
    if (keypointsToRender.length > 0) {
      textToCopy += '\n\nKey Points:\n';
      textToCopy += keypointsToRender.map(point => `• ${point}`).join('\n');
    }

    void navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [summary, streamingParsed]);

  const handleCitationClick = (messageNumber: number): void => {
    const convId = conversationIdMapping[String(messageNumber)];
    const msgId = messageIdMapping[String(messageNumber)];

    if (!convId) return;

    onClose();

    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const channelId = pathParts[1] || '';

    if (msgId) {
      void navigate(`/chat/dir/${channelId}/${convId}#origin=${convId}&messageId=${msgId}`);
    } else {
      void navigate(`/chat/dir/${channelId}/${convId}`);
    }
  };

  const isDM = props.scopeType === ChannelScopeType.DM;
  const isGroupDM = props.scopeType === ChannelScopeType.GROUP_DM;
  const isDMType = isDM || isGroupDM;
  const dmLabel = isGroupDM ? 'Group DM' : 'DM';
  const title = isThread
    ? `Summary of thread in #${channelName}`
    : isDMType
      ? `Summary of ${dmLabel}`
      : `Summary of channel #${channelName}`;
  const loadingText = isThread
    ? isDMType
      ? `Summarizing thread in ${dmLabel}`
      : 'Summarizing thread in '
    : isDMType
      ? `Summarizing ${dmLabel}`
      : 'Summarizing channel';

  return (
    <div className='w-full h-full bg-background shadow-[-1px_0px_6px_0px_rgba(0,0,0,0.05)] border-l border-border flex flex-col overflow-hidden'>
      <div
        className={
          isThread
            ? state === 'streaming' || state === 'complete'
              ? 'h-[88px] px-4 py-[21px] flex items-start gap-2 self-stretch border-b border-border'
              : 'h-14 p-4 flex items-center gap-2 self-stretch'
            : 'h-[88px] px-4 py-[21px] flex items-start gap-2 self-stretch border-b border-border'
        }
      >
        <div
          className={
            isThread && state !== 'streaming' && state !== 'complete'
              ? 'flex items-center'
              : 'pt-1 flex justify-start items-center gap-2.5'
          }
        >
          <Sparkles className='w-4 h-4 text-foreground' />
        </div>
        <div
          className={
            isThread && state !== 'streaming' && state !== 'complete'
              ? 'flex-1'
              : 'flex-1 flex flex-col justify-start items-start gap-1'
          }
        >
          <div className="self-stretch justify-start text-foreground text-base font-semibold font-['Inter'] line-clamp-1">
            {isThread ? 'Xyne AI' : title}
          </div>
          {/* Show metadata bar for both thread and channel when streaming/complete */}
          {(state === 'streaming' || state === 'complete') && (
            <div className='inline-flex justify-start items-center gap-2.5'>
              {/* Date range - for both thread and channel summaries */}
              {(() => {
                const displayDateFrom = isThread ? threadDateRange.dateFrom : dateFrom;
                const displayDateTo = isThread ? threadDateRange.dateTo : dateTo;

                if (!displayDateFrom && !displayDateTo) return null;

                return (
                  <>
                    <div className="justify-start text-muted-foreground text-sm font-normal font-['Inter'] leading-4 line-clamp-1">
                      {displayDateFrom && displayDateTo
                        ? (() => {
                            const fromDate = new Date(displayDateFrom);
                            const toDate = new Date(displayDateTo);
                            const fromStr = fromDate.toLocaleDateString('en-US', {
                              day: 'numeric',
                              month: 'short',
                            });
                            const toStr = toDate.toLocaleDateString('en-US', {
                              day: 'numeric',
                              month: 'short',
                            });
                            // If same date, show single date
                            return fromStr === toStr ? fromStr : `${fromStr} - ${toStr}`;
                          })()
                        : displayDateFrom
                          ? `From ${new Date(displayDateFrom).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`
                          : `Until ${new Date(displayDateTo!).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`}
                    </div>
                    <div className='w-[3px] h-[3px] bg-muted-foreground rounded-full' />
                  </>
                );
              })()}
              {/* Message count */}
              <div className='flex justify-start items-center gap-1'>
                <MessageSquare className='w-3.5 h-3.5 text-muted-foreground' />
                <div className="justify-start text-muted-foreground text-sm font-normal font-['Inter'] leading-4 line-clamp-1">
                  {metadata.messageCount || summary?.messageCount || 0}
                </div>
              </div>
              <div className='w-[3px] h-[3px] bg-muted-foreground rounded-full' />
              {/* Participant count */}
              <div className='flex justify-start items-center gap-1'>
                <Users className='w-3.5 h-3.5 text-muted-foreground' />
                <div className="justify-start text-muted-foreground text-sm font-normal font-['Inter'] leading-4 line-clamp-1">
                  {metadata.participantCount || summary?.participantCount || 0}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className='flex justify-start items-center gap-2'>
          <button
            onClick={onClose}
            className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-input flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
            data-track-category='CHAT_SUMMARY'
            data-track-name='Close_Summary'
          >
            <X className='w-4 h-4 text-foreground' />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-auto relative'>
        {/* Loading skeleton - show until we have visible content to display */}
        {(state === 'loading' || (state === 'streaming' && visibleChars === 0)) && (
          <div className='absolute inset-0 flex items-center justify-center'>
            <div className='w-80 flex flex-col justify-start items-start gap-4'>
              <div className='w-full flex flex-col justify-start items-start gap-1.5'>
                <div className='self-stretch flex flex-col justify-center items-start gap-1'>
                  <div className="justify-start text-foreground text-base font-semibold font-['Inter'] line-clamp-1">
                    {loadingText}
                  </div>
                  {!isDMType && (
                    <div className='inline-flex justify-start items-center gap-1'>
                      <Hash className='w-4 h-4 text-foreground' />
                      <div className='flex justify-start items-center gap-2'>
                        <div className="justify-start text-foreground text-base font-semibold font-['Inter'] line-clamp-1">
                          {channelName}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="self-stretch justify-start text-muted-foreground text-sm font-normal font-['Inter'] leading-5">
                  Going through messages...
                </div>
              </div>
              <SkeletonLoader />
            </div>
            <div className='absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-gray-50 to-transparent pointer-events-none' />
          </div>
        )}

        {/* Streaming content - show when we have visible characters to display */}
        {state === 'streaming' && visibleChars > 0 && !summary && (
          <div className='space-y-4 p-4'>
            <div className='text-foreground leading-relaxed'>
              <p className='whitespace-pre-wrap'>{displayStreamingContent}</p>
            </div>
            {streamingParsed.keypoints.length > 0 && (
              <div className='space-y-2 mt-4'>
                <h3 className='text-sm font-semibold text-muted-foreground'>Key Points</h3>
                <ul className='space-y-1.5'>
                  {streamingParsed.keypoints.map((point, index) => (
                    <li key={index} className='flex items-start gap-2'>
                      <span className='text-primary mt-0.5'>•</span>
                      <span
                        className='text-foreground text-sm'
                        dangerouslySetInnerHTML={{
                          __html: sanitizeBoldMarkdown(point),
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Complete */}
        {state === 'complete' && (
          <div className='space-y-6 p-4'>
            <div className='text-foreground leading-relaxed'>
              {summary?.summary || streamingParsed.summary || 'No summary available'}
            </div>

            {(() => {
              const useStreamedKeypoints = streamingParsed.keypoints.length > 0;
              const backendKeypoints =
                summary?.topicSections?.[0]?.keyPoints || summary?.keyPoints || [];
              const keypointsToRender = useStreamedKeypoints
                ? streamingParsed.keypoints
                : backendKeypoints.map(kp => (typeof kp === 'string' ? kp : kp.point));

              if (keypointsToRender.length === 0) return null;

              return (
                <div className='space-y-3'>
                  <h3 className='text-sm font-semibold text-muted-foreground'>Key Points</h3>
                  <ul className='space-y-2'>
                    {keypointsToRender.map((point, index) => {
                      const keypointNum = index + 1;
                      let messageNumber: number | undefined;

                      if (useStreamedKeypoints) {
                        messageNumber = streamingParsed.citations[keypointNum];
                      } else {
                        const backendKp = backendKeypoints[index];
                        if (backendKp && typeof backendKp === 'object' && backendKp.citation) {
                          messageNumber = backendKp.citation.messageIndex;
                        }
                      }
                      const hasValidCitation =
                        messageNumber &&
                        (conversationIdMapping[String(messageNumber)] ||
                          messageIdMapping[String(messageNumber)]);
                      const formattedPoint = sanitizeBoldMarkdown(point);

                      return (
                        <li key={index} className='flex items-start gap-2'>
                          <span className='text-primary'>•</span>
                          <span className='text-foreground'>
                            <span dangerouslySetInnerHTML={{ __html: formattedPoint }} />
                            {hasValidCitation && messageNumber && (
                              <button
                                type='button'
                                onClick={(): void => handleCitationClick(messageNumber)}
                                className="ml-1 inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-muted-foreground/20 text-foreground font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-muted-foreground/30 transition-colors cursor-pointer align-middle"
                                title={`Jump to message ${keypointNum}`}
                                data-track-category='CHAT_SUMMARY'
                                data-track-name='Jump_To_Citation'
                                data-track-metadata={JSON.stringify({ messageNumber })}
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
            })()}

            <div className='flex items-center justify-between pt-4 border-t border-border'>
              <p className='text-xs text-muted-foreground'>AI-generated messages may be wrong.</p>
              <button
                type='button'
                onClick={handleCopy}
                className='p-1.5 rounded hover:bg-muted-foreground/20 transition-colors cursor-pointer'
                title={copied ? 'Copied!' : 'Copy summary'}
                data-track-category='CHAT_SUMMARY'
                data-track-name='Copy_Summary'
              >
                {copied ? <Check className='w-3.5 h-3.5 text-green-600' /> : <CopyIcon />}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className='flex flex-col items-center justify-center h-full gap-4 text-muted-foreground'>
            <p className='text-red-500'>{error}</p>
            <Button
              variant='secondary'
              onClick={handleRefresh}
              trackId='retry_summary'
              data-track-category='CHAT_SUMMARY'
              data-track-name='Retry_Summary'
            >
              Try Again
            </Button>
          </div>
        )}

        {/* No messages */}
        {state === 'no_messages' && noMessagesInfo && (
          <div className='flex flex-col items-center justify-center h-full gap-4 text-center'>
            <div className='w-16 h-16 rounded-full bg-muted flex items-center justify-center'>
              <MessageSquare size={32} className='text-muted-foreground' />
            </div>
            <div className='space-y-2'>
              <h3 className='text-lg font-semibold text-foreground'>No Messages to Summarize</h3>
              <p className='text-sm text-muted-foreground max-w-xs'>{noMessagesInfo.message}</p>
            </div>
            {noMessagesInfo.totalMessages > 0 && (
              <p className='text-xs text-muted-foreground'>Try selecting a different date range</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Re-export for backwards compatibility
export const ThreadSummary = (props: Omit<ThreadSummaryProps, 'type'>) => (
  <Summary type='thread' {...props} />
);

export const ChannelSummary = (props: Omit<ChannelSummaryProps, 'type'>) => (
  <Summary type='channel' {...props} />
);
