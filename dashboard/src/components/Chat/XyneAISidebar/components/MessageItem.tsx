import { ReactElement, useState, useMemo, useEffect } from 'react';
import { Globe, Pencil, RefreshCw, ChevronLeft, ChevronRight, Download, Check } from 'lucide-react';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { createMarkdownComponents } from '../../../../utils/markdownComponents';
import { genericInstance } from '../../../../services/clients/genericClient';
import type { Components } from 'react-markdown';
import {
  SingleStat,
  Table,
  Highchart,
  HighBarChart1D,
  VolumeChartRenderer,
  type ToolOutput as GeniusToolOutput,
} from 'cosmic-ai-genius';
import { Tooltip } from '../../../ui/Tooltip';
import { UserHoverWrapper } from '../../../ui/UserMentionPopover/UserMentionPopover';
import { useAuth } from '../../../../hooks/useAuth';
import { useUser } from '../../../../hooks/useUsers';
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
} from '../utils/XyneAITypes';

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
        console.error('Failed to download image:', error);
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
      <img
        src={src}
        alt={alt}
        className={className || 'max-w-full h-auto rounded-lg'}
        loading='lazy'
      />
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

// Memoized UserTag Component to prevent unnecessary re-renders
const UserTagComponent = React.memo(({ userTag }: { userTag: UserTag }) => {
  const { user: currentUser } = useAuth();
  const isCurrentUser = currentUser?.id === userTag.userId;
  const displayName = userTag.name;
  const mentionDisplay = `${displayName}`;

  const className = isCurrentUser
    ? 'mention-text !bg-muted !text-primary cursor-pointer hover:underline'
    : 'mention-text cursor-pointer hover:underline';

  console.log('[UserTagComponent] Rendering:', {
    userTag,
    userId: userTag.userId,
    hasUserId: !!userTag.userId,
  });

  return userTag.userId ? (
    <UserHoverWrapper userId={userTag.userId}>
      <span className={className}>{mentionDisplay}</span>
    </UserHoverWrapper>
  ) : (
    <span className={className}>{mentionDisplay}</span>
  );
});

UserTagComponent.displayName = 'UserTagComponent';

/**
 * Process a string to replace user tags with UserTag components
 * Handles both formats:
 * - `@Username` format (from TipTap editor plain text output for user messages)
 * - `<Username>` format (from bot responses)
 */
const processStringForUserTags = (
  str: string,
  userTags?: Record<string, UserTag>,
): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Create a combined regex that matches both @Username and <Username> formats
  // @Username format - @ followed by word characters and spaces until a non-word character
  // <Username> format - content inside angle brackets
  const tagRegex = /@([\w\s]+(?=\s|$|[^\w]))|<([^>]+)>/g;

  while ((match = tagRegex.exec(str)) !== null) {
    const startIndex = match.index;

    if (startIndex > lastIndex) {
      parts.push(str.slice(lastIndex, startIndex));
    }

    // Determine which format was matched
    const isAtFormat = match[1] !== undefined; // @Username format
    const username = isAtFormat ? match[1]!.trim() : match[2]!.trim();
    const fullMatch = match[0];

    // Try to find userTag - check both possible key formats
    const keyForAtFormat = `<${username}>`;
    const userTag = userTags?.[keyForAtFormat];

    if (userTag) {
      // Full userTag available - render with hover
      parts.push(<UserTagComponent key={`${fullMatch}-${startIndex}`} userTag={userTag} />);
    } else {
      // No userTag - render as plain text without hover
      parts.push(
        <span
          key={`${fullMatch}-${startIndex}`}
          className='mention-text cursor-pointer hover:underline text-primary'
        >
          {username}
        </span>,
      );
    }

    lastIndex = tagRegex.lastIndex;
  }

  if (lastIndex < str.length) {
    parts.push(str.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [str];
};

/**
 * Process React node recursively to replace user tags
 */
const processNodeForUserTags = (
  node: React.ReactNode,
  userTags?: Record<string, UserTag>,
): React.ReactNode => {
  if (typeof node === 'string') {
    const parts = processStringForUserTags(node, userTags);
    return parts.length === 1 ? parts[0] : parts;
  }

  if (Array.isArray(node)) {
    return node.map((child: React.ReactNode, idx) => (
      <React.Fragment key={`user-tag-${idx}`}>
        {processNodeForUserTags(child, userTags)}
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
        ? processNodeForUserTags(children as React.ReactNode, userTags)
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
  onRegenerate?: (() => void) | undefined;
  onEditSubmit?: ((newContent: string) => void) | undefined;
  onEditMobile?: (() => void) | undefined;
  isLatestBotMessage?: boolean | undefined;
  branchInfo?: { index: number; total: number } | undefined;
  onBranchNavigate?: ((direction: 'prev' | 'next') => void) | undefined;
}

// Attachment preview component
const AttachmentPreview = ({ attachment }: { attachment: MessageAttachment }): ReactElement => {
  const isImage = attachment.mimeType.startsWith('image/');

  return (
    <div className='flex items-center gap-2 p-2 rounded-lg bg-card border border-border'>
      {isImage ? (
        <div className='relative w-full max-w-[200px] rounded overflow-hidden'>
          <img
            src={`data:${attachment.mimeType};base64,${attachment.data}`}
            alt={attachment.filename}
            className='w-full h-auto'
          />
        </div>
      ) : (
        <div className='flex items-center gap-2'>
          <div className='flex-shrink-0 w-8 h-8 flex items-center justify-center bg-muted rounded'>
            <FileDocumentIcon color='currentColor' size={20} className='text-muted-foreground' />
          </div>
          <div className='flex flex-col overflow-hidden'>
            <span className="text-sm font-medium text-foreground font-['Inter'] truncate">
              {attachment.filename}
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
      className='flex items-center gap-2 p-2 rounded-lg bg-muted border border-border hover:bg-accent transition-colors w-full text-left'
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

export const MessageItem = React.memo(
  ({
    message,
    onFeedback,
    onCitationClick,
    onSummarizerCitationClick,
    feedbackValue,
    onRegenerate,
    onEditSubmit,
    onEditMobile,
    isLatestBotMessage,
    branchInfo,
    onBranchNavigate,
  }: MessageItemProps): ReactElement => {
    const [copied, setCopied] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState('');
    const editTextareaRef = React.useRef<HTMLTextAreaElement>(null);
    const navigate = useNavigate();

    // Rotating status for long-running tools (research_agent, create_ppt)
    const [rotatingIndex, setRotatingIndex] = useState(0);
    const statusPhrases = Array.isArray(message.statusMessage) ? message.statusMessage : null;
    const displayStatus = statusPhrases
      ? statusPhrases[rotatingIndex % statusPhrases.length]
      : (message.statusMessage as string | undefined);

    useEffect(() => {
      if (!statusPhrases || !message.isStreaming) return;
      setRotatingIndex(0);
      const interval = setInterval(() => {
        setRotatingIndex(prev => (prev + 1) % statusPhrases.length);
      }, 4000);
      return () => clearInterval(interval);
    }, [statusPhrases, message.isStreaming]);

    // Handle clicking selection context to navigate to canvas
    const handleSelectionContextClick = (canvasViewAccessId: string): void => {
      void navigate(`/chat/canvas/${canvasViewAccessId}`);
    };

    // Display streaming content directly without character reveal slicing.
    // Append a trailing newline during streaming so remark-breaks flushes the
    // current incomplete line and markdown constructs (headings, lists, code
    // blocks) render correctly before the closing token arrives.
    const displayContent = useMemo(() => {
      const raw =
        message.type === 'bot' && message.isStreaming && message.streamingContent
          ? message.streamingContent
          : message.content || message.streamingContent || '';
      return message.isStreaming ? raw + '\n' : raw;
    }, [message.type, message.isStreaming, message.streamingContent, message.content]);

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
        className={`group/message flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
      >
        {message.type === 'bot' && (
          <div className='flex-shrink-0 mt-2.5'>
            <img src='/svgs/icons/ai-bot-gradient-star.svg' alt='AI' width='16' height='16' />
          </div>
        )}

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
          {/* Streaming status indicator - shows inline with icon when no content */}
          {message.type === 'bot' && message.isStreaming && displayStatus && !displayContent ? (
            <div className='flex items-center gap-0.5 mt-1'>
              <span className="text-xs text-muted-foreground font-['Inter'] italic">
                {displayStatus}
              </span>
              <span className='inline-flex gap-0.5'>
                <span
                  className='animate-bounce text-xs text-muted-foreground'
                  style={{ animationDelay: '0ms', animationDuration: '1s' }}
                >
                  .
                </span>
                <span
                  className='animate-bounce text-xs text-muted-foreground'
                  style={{ animationDelay: '200ms', animationDuration: '1s' }}
                >
                  .
                </span>
                <span
                  className='animate-bounce text-xs text-muted-foreground'
                  style={{ animationDelay: '400ms', animationDuration: '1s' }}
                >
                  .
                </span>
              </span>
            </div>
          ) : (
            <>
              <div
                className={`${
                  message.type === 'user'
                    ? isEditing
                      ? 'rounded-2xl bg-muted p-3'
                      : 'flex flex-col items-start gap-3 p-2 [border-radius:16px_4px_16px_16px] bg-[var(--chat-mobile-my-bubble)] text-foreground md:block md:rounded-2xl md:bg-muted md:text-foreground md:px-4 md:py-2 md:w-fit'
                    : 'rounded-2xl bg-transparent text-foreground max-w-full'
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
                      <button
                        onClick={() => {
                          if (editText.trim()) {
                            onEditSubmit?.(editText.trim());
                            setIsEditing(false);
                          }
                        }}
                        disabled={!editText.trim()}
                        className="px-3 py-1.5 text-xs font-medium rounded-full bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 font-['Inter']"
                        data-track-category='XyneAI'
                        data-track-name='EDIT_SUBMIT'
                      >
                        Send
                      </button>
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
                            onClick={() =>
                              handleSelectionContextClick(selection.canvasViewAccessId)
                            }
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
                            const processed = processNodeForUserTags(children, message.userTags);
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
                    onCitationClick={onCitationClick}
                    onSummarizerCitationClick={onSummarizerCitationClick}
                  />
                )}
              </div>

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

              {/* Streaming status indicator - shows below content when there's content */}
              {message.type === 'bot' && message.isStreaming && displayStatus && displayContent && (
                <div className='mt-2'>
                  <span className="text-xs text-muted-foreground font-['Inter'] italic flex items-center gap-0.5">
                    {displayStatus}
                    <span className='inline-flex gap-0.5'>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '0ms', animationDuration: '1s' }}
                      >
                        .
                      </span>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '200ms', animationDuration: '1s' }}
                      >
                        .
                      </span>
                      <span
                        className='animate-bounce'
                        style={{ animationDelay: '400ms', animationDuration: '1s' }}
                      >
                        .
                      </span>
                    </span>
                  </span>
                </div>
              )}

              {/* Branch navigator + Copy/Regenerate/Like/Dislike Buttons */}
              {message.type === 'bot' && !message.isStreaming && !message.isAborted && (
                <div className='flex items-center justify-between mt-4'>
                  {branchInfo && onBranchNavigate ? (
                    <BranchNavigator
                      index={branchInfo.index}
                      total={branchInfo.total}
                      onNavigate={onBranchNavigate}
                    />
                  ) : (
                    <div />
                  )}
                  <MessageActions
                    message={message}
                    copied={copied}
                    onCopy={handleCopy}
                    onFeedback={onFeedback}
                    feedbackValue={feedbackValue}
                    onRegenerate={isLatestBotMessage ? onRegenerate : undefined}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (prev.message === next.message && prev.feedbackValue === next.feedbackValue) return true;
    if (!next.message.isStreaming && !prev.message.isStreaming) {
      return (
        prev.message.id === next.message.id &&
        prev.message.content === next.message.content &&
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
      prev.feedbackValue === next.feedbackValue
    );
  },
);

MessageItem.displayName = 'MessageItem';

// Message content rendering component
const MessageContent = ({
  message,
  displayContent,
  hasKeypoints,
  parsedContent,
  onCitationClick,
  onSummarizerCitationClick,
}: MessageContentProps): ReactElement => {
  // Memoize markdown components to prevent re-renders on parent updates
  const markdownComponents = useMemo(() => createMarkdownComponents(message.id), [message.id]);

  // Extend markdown components with image download button for sidebar
  const sidebarMarkdownComponents = useMemo<Components>(() => {
    return {
      ...markdownComponents,
      img: props => <ImageWithDownload {...props} />,
    };
  }, [markdownComponents]);

  return (
    <div className='space-y-4 max-w-full'>
      {/* Tool Outputs */}
      {message.toolOutputs && message.toolOutputs.length > 0 && (
        <ToolOutputsSection toolOutputs={message.toolOutputs} />
      )}

      {/* Genius: Summary text */}
      {(!message.agentType || message.agentType === 'genius') && displayContent && (
        <div className="bot-markdown-content xyne-ai-markdown text-sm font-['Inter'] leading-6 font-normal">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={{
              ...sidebarMarkdownComponents,
              p: ({ children }) => {
                const processed = processNodeForUserTags(children, message.userTags);
                return <p className='mb-2 last:mb-0'>{processed}</p>;
              },
              li: ({ children, ...props }) => {
                const processed = processNodeForUserTags(children, message.userTags);
                return <li {...props}>{processed}</li>;
              },
              td: ({ children, ...props }) => {
                const processed = processNodeForUserTags(children, message.userTags);
                return <td {...props}>{processed}</td>;
              },
              th: ({ children, ...props }) => {
                const processed = processNodeForUserTags(children, message.userTags);
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
            {displayContent}
          </ReactMarkdown>
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
          onCitationClick={onCitationClick}
        />
      )}
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
              options={{}}
              enableGroupby={true}
              rawChartData={toolOutput.rawChartData}
              groupbyConfig={toolOutput.groupbyConfig}
              selectedMetrics={toolOutput.selectedMetrics}
              showCardinalityControl={true}
              dimensionLabelMapper={(label: string) =>
                label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              }
              isMobile={true}
              isExpanded={false}
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

        {toolOutput.singleStat && <SingleStatSection singleStat={toolOutput.singleStat} />}

        {/* Table Data */}

        {toolOutput.tableData && Array.isArray(toolOutput.tableData) && (
          <div className='w-full max-w-full overflow-x-auto'>
            <Table data={toolOutput.tableData} />
          </div>
        )}
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
              components={{
                ...sidebarMarkdownComponents,
                p: ({ children }) => {
                  const processed = processNodeForUserTags(children, message.userTags);
                  return <p className='mb-2 last:mb-0'>{processed}</p>;
                },
                li: ({ children, ...props }) => {
                  const processed = processNodeForUserTags(children, message.userTags);
                  return <li {...props}>{processed}</li>;
                },
                td: ({ children, ...props }) => {
                  const processed = processNodeForUserTags(children, message.userTags);
                  return <td {...props}>{processed}</td>;
                },
                th: ({ children, ...props }) => {
                  const processed = processNodeForUserTags(children, message.userTags);
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
                            const processed = processNodeForUserTags(children, message.userTags);
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
                          keyPoint.citation.entityType === 'attachment') &&
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
                    const processed = processNodeForUserTags(children, message.userTags);
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
  console.log('[ParticipantsAvatars] Rendering:', { participants, count: participants?.length });

  // Deduplicate participants by ID
  const uniqueParticipants = React.useMemo(() => {
    const seen = new Set<string>();
    return participants.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [participants]);

  console.log('[ParticipantsAvatars] Unique participants:', {
    uniqueParticipants,
    count: uniqueParticipants.length,
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
        <button
          onClick={onRegenerate}
          className='p-1.5 rounded transition-colors hover:bg-accent'
          title='Regenerate response'
          data-track-category='XyneAI'
          data-track-name='REGENERATE_MESSAGE'
          data-track-metadata={JSON.stringify({ messageId: message.id })}
        >
          <RefreshCw size={16} className='text-current' />
        </button>
      )}

      {/* Like Button */}
      <button
        onClick={() => onFeedback(message.id, 'LIKE')}
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
      </button>

      {/* Dislike Button */}
      <button
        onClick={() => onFeedback(message.id, 'DISLIKE')}
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
      </button>
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
