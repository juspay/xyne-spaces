import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Tooltip from '../Tooltip/Tooltip';
import { AvatarSize } from '../../UserAvatar/UserAvatar';
import * as Popover from '@radix-ui/react-popover';
import {
  MessageType,
  UserType,
  parsePreviewMd,
  parseForwardedMessageXml,
  isForwardedMessageXml,
  parseReactionsMd,
  ReactionsData,
  parseTicketMd,
} from '@xyne/shared';
import {
  formatFullTimestamp,
  formatTimeAmPm,
  formatThreadTimestamp,
  formatTime12HourNoAmPm,
  formatRelativeTimestamp,
} from '../../../utils/dateUtils';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { useQuery } from '../../../hooks/useQuery';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { UserHoverWrapper } from '../UserMentionPopover/UserMentionPopover';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { FilePill, HtmlPreviewCard } from '../files';
import { useReactions } from '../../../hooks/useReaction';
import { MessageBubbleProps } from './MessageBubble.types';
import { useAuth } from '../../../hooks/useAuth';
import { useTheme } from '../../../hooks/useTheme';
import { useChannel } from '../../../hooks/useChannels';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import ChatLock from '../../icons/ChatLock';
import { useDebugSettings } from '../../../hooks/useDebugSettings';
import { PinnedIcon } from '../../../assets/icons/PinnedIcon';
import { usePlatform } from '../../../hooks/usePlatform';
import { Bookmark, ChevronDown, ChevronRight, Hash, Trash2 } from 'lucide-react';
import { MobileMessageMyBubble } from './MobileMessageMyBubble';
import { Button } from '../Button/Button';
import EmojiPicker, { EmojiStyle, Theme as EmojiTheme } from 'emoji-picker-react';
import { BotBubble } from '../../Chat/BotBubble';
import { LinkPreview } from '../../Chat/LinkPreview/LinkPreview';
import { InternalMessagePreview } from '../../Chat/LinkPreview/InternalMessagePreview';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import {
  buildClawCitationToolNumbers,
  linkifyAndGroupClawCitations,
  stripCitationMarks,
} from '../TipTapExtensions/CitationMark';
import { registerClawIcons } from '../../Chat/XyneAISidebar/utils/clawCitationUrl';
import { isSlashCommandArtifactMessage } from '../../Chat/SlashCommandArtifacts';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { ExpandableMessage } from '../../Chat/ExpandableMessage/ExpandableMessage';
import { MessageMetadata } from './MessageBubble.utils';
import { MarkdownMessageRenderer } from './MarkdownMessageRenderer';
import { NonParticipantActions } from './NonParticipantActions';
import { PostedInLink } from './PostedInLink';
import { MessageHeader } from './MessageHeader';
import { RunOriginChip } from './RunOriginChip';
import HuddleIcon from '../../icons/HuddleIcon';
import { MicOn } from '@xyne/icons';
import workflowBotAvatar from './workflowBotAvatar.png';
import { downloadAttachment } from '../../Chat/MessageAttachment/utils';
import { PendingIcon } from '../../../assets/icons/WorkflowIcons';
import { useIsCallActive } from '../../../hooks/useCalls';
import { useUsers, useUser } from '../../../hooks/useUsers';
import { ThreadInfoIndicator, AlsoSentToChannelIndicator } from './ThreadMessageIndicators';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { StatusIndicator } from '../StatusIndicator';
import DOMPurify from 'dompurify';
import { CallBubble } from './CallBubble';
import { RecordingBubble } from './RecordingBubble';
import { CallShareBubble } from './CallShareBubble';
import { getEmojiDisplayName, renderEmoji } from '../../../utils/customEmojiUtils';
import { parseMarkdownWithTicketSuggestions } from '../../../utils/markdownTicketSuggestions';
import { TicketSuggestions } from './TicketSuggestions';
import { AppActions } from './AppActions';
import { parseMarkdownWithAppActions } from '../../../utils/markdownAppActions';
import { PulseTickets } from './PulseTickets';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { hasMessageContent } from '../../../utils/chatUtils';
import { SurfaceNudgeList } from '../../Chat/Nudges/SurfaceNudgeList';
import MobileReactionDrawer from './MobileReactionDrawer';
import { MobileAttachmentsGrid } from './MobileAttachmentsGrid';
import AddReactionDrawerMobile from '../../Chat/AddReactionDrawerMobile/AddReactionDrawerMobile';
import { AttachmentRef, attachmentViewerActor } from '../../../machines/attachmentViewerMachine';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { toast } from 'sonner';
import { isPreviewableDocument } from '../../../services/documentThumbnailService';
import { ChannelEmailCard } from './ChannelEmailCard';
import { AudioPlayer } from '../AudioPlayer/AudioPlayer';
import { recordingService } from '../../../services/Recording/recordingService';
import { InlineVideoPreview } from './InlineVideoPreview';
import { loadEmojiData } from '../../../utils/emojiLookup';
import { RecordingShareContent } from './RecordingShareContent';
import { useRecordingShareMessage } from './recordingShareMessage';

// ================== ATTACHMENTS BLOCK ==================
type AttachmentType = QueryResultType<
  typeof queries.conversationMessagesV2
>[number]['attachments'][number];

interface AttachmentsBlockProps {
  attachments: readonly AttachmentType[];
  isMobile: boolean;
  className?: string;
  conversationId?: string;
  channelId?: string;
  replyCount?: number;
  allThreadAttachments?: AttachmentRef[];
  parentMessage?: AttachmentRef['parentMessage'];
}

/**
 * Check if attachment has a document thumbnail (PDF with preview)
 */
const hasDocumentThumbnail = (attachment: AttachmentType): boolean => {
  return isPreviewableDocument(attachment.mimetype) && !!attachment.thumbnailUrl;
};

// HTML gets its own card that renders a glimpse of the document. `mimetype` is
// derived from the OS extension map at upload time and is not guaranteed, so
// the filename is checked too.
const isHtmlAttachment = (attachment: AttachmentType): boolean => {
  return attachment.mimetype === 'text/html' || /\.html?$/i.test(attachment.originalFilename);
};

/**
 * AttachmentsBlock renders message attachments with expand/collapse functionality.
 * Videos are rendered in separate rows first, then other attachments.
 * Non-image/video files without thumbnails use FilePill component.
 *
 * @param attachments - Array of attachment objects
 * @param isMobile - Whether the view is mobile
 * @param className - Optional wrapper class name
 */
const AttachmentsBlock: React.FC<AttachmentsBlockProps> = ({
  attachments,
  isMobile,
  className = '',
  conversationId,
  channelId,
  replyCount,
  allThreadAttachments,
  parentMessage,
}) => {
  const zero = useZero();
  const [isExpanded, setIsExpanded] = useState(true);

  if (attachments.length === 0) {
    return null;
  }

  const orderedAttachments = [...attachments].sort(
    (a, b) =>
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );

  // Separate attachments by deleted status first
  const activeAttachments = orderedAttachments.filter(
    a => !(a as { isDeleted?: boolean }).isDeleted,
  );
  const deletedAttachments = orderedAttachments.filter(
    a => (a as { isDeleted?: boolean }).isDeleted,
  );

  // Separate active attachments by type
  const videoAttachments = activeAttachments.filter(a => a.mimetype.startsWith('video/'));
  const imageAttachments = activeAttachments.filter(a => a.mimetype.startsWith('image/'));

  // HTML renders its own preview card, so it is pulled out before the pill
  // split below — otherwise it would count as a non-previewable file and demote
  // every sibling attachment to a pill.
  const htmlAttachments = activeAttachments.filter(a => isHtmlAttachment(a));

  // Files - separate into those with thumbnails (PDFs, Office docs) and those without
  const fileAttachments = activeAttachments.filter(
    a =>
      !a.mimetype.startsWith('image/') && !a.mimetype.startsWith('video/') && !isHtmlAttachment(a),
  );

  const previewableFiles = fileAttachments.filter(a => hasDocumentThumbnail(a));
  const nonPreviewableFiles = fileAttachments.filter(a => !hasDocumentThumbnail(a));

  // Check if we need to use FilePill for all files (mixed types)
  const useFilePillForAllFiles = nonPreviewableFiles.length > 0;

  const handleFileClick = (attachment: AttachmentType) => {
    // Build attachment refs for the viewer (same order as rendered)
    const allRefs: AttachmentRef[] = orderedAttachments.map(att => ({
      attachmentId: att.id,
      fileName: att.originalFilename,
      fileUrl: `/attachments/${att.id}/download`,
      mimeType: att.mimetype,
      fileSize: att.size,
      thumbnailUrl: att.thumbnailUrl,
      ...(conversationId && { conversationId }),
      ...(channelId && { channelId }),
      ...(replyCount !== undefined && { replyCount }),
    }));

    const startIndex = allRefs.findIndex(ref => ref.attachmentId === attachment.id);

    attachmentViewerActor.send({
      type: attachmentViewerActor.getSnapshot().value === 'closed' ? 'OPEN' : 'UPDATE',
      attachments: allRefs,
      startIndex: startIndex >= 0 ? startIndex : 0,
    });
  };

  const handleDelete = (attachmentId: string, fileName: string) => {
    try {
      zero.mutate(mutators.messageAttachment.delete({ attachmentId }));
      toast.success('Attachment deleted', {
        description: `${fileName} has been deleted successfully.`,
      });
    } catch (error) {
      toast.error(`Failed to delete ${fileName}`, {
        description: error instanceof Error ? error.message : 'Please try again later.',
      });
    }
  };

  return (
    <div className={className}>
      {/* Header row — only shown when there are active (non-deleted) attachments */}
      {activeAttachments.length > 0 && (
        <div className='flex items-center gap-3 text-xs font-medium'>
          <div className='flex items-center gap-1'>
            <span className='text-muted-foreground'>
              {activeAttachments.length > 1
                ? `${activeAttachments.length} files`
                : activeAttachments[0]?.originalFilename}
            </span>
            <button
              type='button'
              onClick={() => setIsExpanded(!isExpanded)}
              data-track-category='MESSAGE'
              data-track-name='TOGGLE_ATTACHMENT_LIST'
            >
              {isExpanded ? (
                <ChevronDown className='w-4 h-4 text-muted-foreground' />
              ) : (
                <ChevronRight className='w-4 h-4 text-muted-foreground' />
              )}
            </button>
          </div>

          {activeAttachments.length > 1 && (
            <>
              <span className='text-muted-foreground'>|</span>
              <button
                type='button'
                onClick={() => {
                  activeAttachments.forEach(attachment => {
                    void downloadAttachment(attachment.id, attachment.originalFilename);
                  });
                }}
                data-track-category='MESSAGE'
                data-track-name='DOWNLOAD_ALL_ATTACHMENTS'
                className='flex items-center gap-2 text-muted-foreground hover:text-foreground'
              >
                <span>Download all</span>
              </button>
            </>
          )}
        </div>
      )}

      {isExpanded && activeAttachments.length > 0 && (
        <div className='flex flex-col gap-3'>
          {/* Videos first - each in separate row */}
          {videoAttachments.map(attachment => (
            <div key={attachment.id} className='flex items-center gap-2 py-2 text-sm'>
              <MessageAttachment
                attachment={attachment}
                allAttachments={orderedAttachments}
                {...(conversationId && { conversationId })}
                {...(channelId && { channelId })}
                {...(replyCount !== undefined && { replyCount })}
                {...(allThreadAttachments && { allThreadAttachments })}
                {...(parentMessage && { parentMessage })}
              />
            </div>
          ))}

          {/* Images - use MessageAttachment with grid layout */}
          {imageAttachments.length > 0 && (
            <div
              className={`flex gap-3 ${isMobile ? 'overflow-x-auto flex-nowrap no-scrollbar' : 'flex-wrap'}`}
            >
              {imageAttachments.map(attachment => (
                <div
                  key={attachment.id}
                  className={`flex items-center gap-2 py-2 text-sm ${isMobile ? 'flex-shrink-0' : ''}`}
                >
                  <MessageAttachment
                    attachment={attachment}
                    allAttachments={orderedAttachments}
                    isInMultiImageGroup={imageAttachments.length > 1}
                    {...(conversationId && { conversationId })}
                    {...(channelId && { channelId })}
                    {...(replyCount !== undefined && { replyCount })}
                    {...(allThreadAttachments && { allThreadAttachments })}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Previewable files (PDFs, Office docs with thumbnails) - use MessageAttachment */}
          {!useFilePillForAllFiles && previewableFiles.length > 0 && (
            <div
              className={`flex gap-3 ${isMobile ? 'overflow-x-auto flex-nowrap no-scrollbar' : 'flex-wrap'}`}
            >
              {previewableFiles.map(attachment => (
                <div
                  key={attachment.id}
                  className={`flex items-center gap-2 py-2 text-sm ${isMobile ? 'flex-shrink-0' : ''}`}
                >
                  <MessageAttachment
                    attachment={attachment}
                    allAttachments={orderedAttachments}
                    {...(conversationId && { conversationId })}
                    {...(channelId && { channelId })}
                    {...(replyCount !== undefined && { replyCount })}
                    {...(allThreadAttachments && { allThreadAttachments })}
                  />
                </div>
              ))}
            </div>
          )}

          {/* HTML files - render a glimpse of the document */}
          {htmlAttachments.length > 0 && (
            <div className='flex flex-col gap-2'>
              {htmlAttachments.map(attachment => (
                <HtmlPreviewCard
                  key={attachment.id}
                  attachmentId={attachment.id}
                  fileName={attachment.originalFilename}
                  fileSize={attachment.size}
                  onOpen={() => handleFileClick(attachment)}
                />
              ))}
            </div>
          )}

          {/* Non-previewable files - use FilePill component */}
          {/* If useFilePillForAllFiles is true, show ALL files in FilePill format */}
          {(useFilePillForAllFiles ? fileAttachments : nonPreviewableFiles).length > 0 && (
            <div className='flex flex-col gap-2'>
              {(useFilePillForAllFiles ? fileAttachments : nonPreviewableFiles).map(attachment => (
                <FilePill
                  key={attachment.id}
                  fileName={attachment.originalFilename}
                  mimeType={attachment.mimetype}
                  fileSize={attachment.size}
                  fileId={attachment.id}
                  uploadedByUserId={attachment.uploadedByUserId}
                  onClick={() => handleFileClick(attachment)}
                  onDownload={() => {
                    void downloadAttachment(attachment.id, attachment.originalFilename);
                  }}
                  onDelete={() => handleDelete(attachment.id, attachment.originalFilename)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Single deleted attachment tombstone — shown only when ALL attachments in the message are deleted */}
      {deletedAttachments.length > 0 && activeAttachments.length === 0 && (
        <div className='mt-2'>
          <div className='flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 w-fit'>
            <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted'>
              <Trash2 className='h-4 w-4 text-muted-foreground' />
            </div>
            <span className='text-sm text-muted-foreground'>This file was deleted.</span>
          </div>
        </div>
      )}
    </div>
  );
};

const getMessageBubbleClassName = (
  shouldShowPending: boolean,
  variant?: MessageBubbleProps['variant'],
  isPinned?: boolean,
  isBookmarked?: boolean,
  isHighlighted?: boolean,
  isActiveCall?: boolean,
  isXyneBot?: boolean,
  isPrivateSystemNotice?: boolean,
  contentOnly?: boolean,
  isShowInChannel?: boolean,
  context?: 'channel' | 'thread',
  isFirstInThread?: boolean,
  isCallNoTranscript?: boolean,
  searchItemView?: boolean,
): string => {
  const classes = [
    isCallNoTranscript
      ? 'group flex items-center justify-center gap-2 px-4 py-1 relative'
      : 'group flex items-start justify-start gap-2 px-4 py-1 relative',
    variant !== 'pinned' &&
      !isActiveCall &&
      !isPrivateSystemNotice &&
      !isBookmarked &&
      !isShowInChannel &&
      !searchItemView &&
      // Press feedback for the message itself — but NOT when the press lands on
      // interactive content inside the bubble (e.g. flow-artifact buttons/links).
      // CSS :active propagates to ancestors regardless of JS event handling, so we
      // suppress it via :has() when an interactive descendant is the one being pressed.
      '[&:active:not(:has(:is(button,a,input,textarea,select,[role=button]):active))]:bg-accent/50 transition-colors',
    // Hover highlight lives on the ChatBubble root via `data-[hovered]:bg-...`
    // (stamped imperatively by the shared MessageHoverToolbar) so the bg and
    // the toolbar can never desync, and hovering never triggers a React
    // render. `shouldShowPending` force-applies the same highlight for unsent
    // own messages.
    variant !== 'pinned' &&
      !isActiveCall &&
      !isPrivateSystemNotice &&
      !isBookmarked &&
      !isShowInChannel &&
      !searchItemView &&
      shouldShowPending &&
      'bg-muted/50',
    isActiveCall && 'bg-stage-completed active-call-highlight rounded-md',
    isShowInChannel &&
      variant !== 'pinned' && [
        'bg-stage-completed rounded-sm',
        'before:content-[""] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-status-success',
      ],
    isPinned &&
      variant !== 'pinned' &&
      !isShowInChannel &&
      (context === 'channel' || (context === 'thread' && isFirstInThread)) && [
        'bg-stage-todo rounded-sm',
        'before:content-[""] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-status-pending',
      ],
    isBookmarked &&
      variant !== 'pinned' &&
      !isPinned &&
      !isShowInChannel && ['bg-blue-50/90 rounded-sm message-bookmarked-bg'],
    variant === 'pinned' && 'bg-background rounded-xl',
    isHighlighted && 'highlight-message',
    isXyneBot && 'pt-5',
    isPrivateSystemNotice && 'bg-muted pt-3',
    contentOnly && '!px-0',
  ]
    .flat()
    .filter(Boolean)
    .join(' ');

  return classes;
};

/**
 * MessageBubble component displays a single message in a conversation.
 * Supports user avatars, reactions, attachments, and custom action buttons.
 *
 * @param message - The message object to display (includes sender, content, reactions, attachments)
 * @param onUserClick - Optional callback when user avatar/name is clicked
 * @param renderActions - Optional function to render custom action buttons for the message
 * @param showAvatar - Whether to display the sender's avatar and name (default: true)
 * @returns Message bubble component with all message details
 */

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  renderActions,
  showAvatar = true,
  isPinned,
  isBookmarked,
  isReminderSet,
  reminderDueInLabel,
  variant = 'default',
  context,
  isHighlighted,
  channelId,
  conversation,
  contentOnly = false,
  onClick,
  threadInfo,
  channelScopeType,
  isFirstInThread = false,
  allThreadAttachments,
  workflowNumber,
  showLinkPreview: shouldRenderLinkPreview = true,
  searchItemView = false,
  afterTextContent,
  headerContent,
  onUserClick,
}) => {
  const navigate = useNavigate();
  const { toggleReaction } = useReactions();
  const attachments = message.attachments || [];
  const [showLinkPreview, setShowLinkPreview] = useState(true);

  const isSystemMessage = message.msgType === MessageType.SYSTEM;
  const isBotMessage = message.msgType === MessageType.BOT;
  const isForwardedMessage = message.msgType === MessageType.FORWARDED;
  const metadata = message.metadata as MessageMetadata | null;
  const previewResult = parsePreviewMd(message.link_preview_md);

  // Parse forwarded message XML content
  const forwardedMessageData = useMemo(() => {
    if (isForwardedMessage && isForwardedMessageXml(message.content)) {
      return parseForwardedMessageXml(message.content);
    }
    return null;
  }, [isForwardedMessage, message.content]);

  // Query the original conversation only when this is a forwarded desk-ticket
  // message with empty content (email body lives in the email table, not in
  // message.content). Use enabled:false otherwise to avoid unnecessary subscriptions.
  const needsForwardedConversationQuery =
    !!forwardedMessageData && !forwardedMessageData.content?.trim();
  const [forwardedOriginalConversation] = useQuery(
    queries.getConversationById({
      conversationId: forwardedMessageData?.originalConversationId ?? '',
    }),
    { enabled: needsForwardedConversationQuery },
  );

  // Resolve the displayable content for the forwarded message block.
  // If the XML content is empty (desk ticket case), fall back to the ticket title.
  const resolvedForwardedContent = useMemo(() => {
    if (!forwardedMessageData) return '';
    if (forwardedMessageData.content?.trim()) return forwardedMessageData.content;
    // Empty content — fall back to ticket title from original conversation's ticket_md
    if (forwardedOriginalConversation?.ticket_md) {
      const parsed = parseTicketMd(forwardedOriginalConversation.ticket_md);
      if (parsed?.title) return parsed.title;
    }
    return forwardedMessageData.content;
  }, [forwardedMessageData, forwardedOriginalConversation]);
  const recordingShare = useRecordingShareMessage(
    isForwardedMessage ? resolvedForwardedContent : message.content,
  );

  const systemMessageStyles: React.CSSProperties = {
    color: 'hsl(var(--muted-foreground))',
    opacity: 0.5,
  };
  const isWorkflowMessage =
    (isSystemMessage && metadata?.workflowId && metadata?.ticketId && !metadata?.messageSubtype) ||
    (isBotMessage && metadata?.xyneId && metadata?.ticketId);
  const isTicketCardMessage =
    !!conversation?.ticket_md &&
    conversation?.initialMessageId === message.messageId &&
    !isWorkflowMessage;
  const ticketAttachments = isTicketCardMessage ? (conversation?.ticket?.attachments ?? []) : [];
  const isCallMessage = metadata?.isCallMessage === true;
  const isActiveCall = useIsCallActive(metadata?.callId);
  // Anchor message for a headless recording started from a thread (see
  // RecordingBubble) — deliberately independent of isCallMessage so it never
  // picks up call-only behavior (transcript dimming, forwarding-as-call, PRD
  // buttons, etc).
  const isRecordingMessage = metadata?.['isRecordingMessage'] === true;
  // A regular call shared into a channel (recordingSharingService). Separate from
  // isCallMessage, which is the live call anchor in the call's own channel.
  const isCallShareMessage = metadata?.['isCallShareMessage'] === true;
  // Only live recording anchors use the system-style sender.
  const isHeadlessRecordingAnchor =
    isRecordingMessage && metadata?.['isHeadlessRecording'] === true;
  // Synchronous end-signal from the message's own metadata (stamped by
  // noteTakerCallRepository.updateThreadMessageOnEnd) — mirrors isActiveCall's
  // active/ended split for the avatar box below, without needing a live query
  // at this level (RecordingBubble already does that for its own rendering).
  const isRecordingEnded = metadata?.['operation'] === 'recording_ended';
  const hasTranscript = attachments.some(
    a =>
      a.mimetype === 'text/plain' ||
      a.originalFilename.endsWith('.txt') ||
      (a.metadata as Record<string, unknown> | null)?.['type'] === 'transcript' ||
      (a.metadata as Record<string, unknown> | null)?.['type'] === 'identified_transcript',
  );
  // The recording message carries its own attachment row (filtered out of the
  // attachments block below). Its id lets InlineVideoPreview stream the file
  // through the range-request endpoint instead of downloading it whole.
  const recordingAttachmentId =
    metadata?.messageSubtype === 'recording'
      ? attachments.find(a => {
          const attMeta = a.metadata as { type?: string; recordingId?: string } | null;
          if (attMeta?.type !== 'recording' || !a.mimetype.startsWith('video/')) return false;
          // Older messages predate recordingId on the metadata — match on type alone there.
          return !metadata?.recordingId || attMeta.recordingId === String(metadata.recordingId);
        })?.id
      : undefined;
  const isCallNoTranscript =
    isCallMessage && !isActiveCall && !isForwardedMessage && !hasTranscript;
  const isMentionUserAddition = metadata?.messageSubtype === 'user_not_in_channel';
  const isTicketNudge = metadata?.messageSubtype === 'ticket_nudge';
  const isPrivateSystemNotice = isMentionUserAddition || isTicketNudge;
  // Detect any message with markdown content format (call_summary, call_prd, etc.)
  const isMarkdownContent = metadata?.['contentFormat'] === 'markdown';
  const hasSuggestedTickets = metadata?.['hasSuggestedTickets'] === true;
  const parsedMarkdown = useMemo(() => {
    if (isMarkdownContent) {
      return parseMarkdownWithTicketSuggestions(message.content, hasSuggestedTickets);
    }
    return { ticketSuggestions: [], ticketsCreated: [], content: message.content };
  }, [isMarkdownContent, hasSuggestedTickets, message.content]);

  const ticketSuggestions = parsedMarkdown.ticketSuggestions;
  const ticketsCreated = parsedMarkdown.ticketsCreated;

  const { user } = useAuth();

  const searchChannel = useChannel(searchItemView ? channelId || '' : '');
  const searchChannelDisplay = useChannelDisplayName(searchChannel, user?.id ?? '');
  const isSearchPrivateChannel = searchChannel?.visibility === ChannelVisibility.PRIVATE;
  const isSearchDM = searchChannel?.scopeType === ChannelScopeType.DM;

  const hasAppActions = metadata?.['hasAppActions'] === true;
  const parsedAppActions = useMemo(() => {
    if (!hasAppActions) {
      return { appActions: [], actioned: [], content: message.content };
    }
    const parsed = parseMarkdownWithAppActions(message.content);
    // Only show active buttons to the intended user
    const visibleActions = parsed.appActions.filter(a => {
      const ctx = a.context ?? {};
      // Show to all if showToAll flag is set
      if (ctx['showToAll'] === true) return true;
      // Otherwise only show to the intended user
      return ctx['mentionedUserId'] === user?.id || ctx['userId'] === user?.id;
    });
    return { ...parsed, appActions: visibleActions };
  }, [hasAppActions, message.content, user?.id]);

  const isPulseActionablesMessage = metadata?.['messageSubtype'] === 'pulse_actionables';
  const isChannelEmailMessage = metadata?.['messageSubtype'] === 'channel_email';

  const { isMobile } = usePlatform();
  const sender = useUser(message.senderId);
  const originalSender = useUser(forwardedMessageData?.originalSenderId || '');
  const isMe = user?.id === message.senderId;
  const { baseRoute } = useRouteContext();
  const location = useLocation();
  const actionableCount = useMemo(
    () => (message.nudgeCounts ?? []).reduce((sum, row) => sum + row.nudgeCount, 0),
    [message.nudgeCounts],
  );
  const countRowIds = useMemo(
    () => Array.from(new Set((message.nudgeCounts ?? []).map(row => row.id))),
    [message.nudgeCounts],
  );

  const handleUserClick = (userId: string): void => {
    if (onUserClick) {
      onUserClick(userId);
      return;
    }
    const isFocusThread = new URLSearchParams(location.search).get('focusThread') === '1';
    const messageConversationId = conversation?.conversationId || message.conversationId;
    const threadSegment =
      (context === 'thread' || isFocusThread) && messageConversationId
        ? `/${messageConversationId}`
        : '';
    const focusThreadSearch = isFocusThread ? '?focusThread=1' : '';
    void navigate(
      `${baseRoute}/${channelId}${threadSegment}/profile/${userId}${focusThreadSearch}`,
    );
  };

  const handleTimestampClick = (e: React.MouseEvent | React.KeyboardEvent): void => {
    e.stopPropagation();
    const conversationId = conversation?.conversationId || message.conversationId;
    if (!conversationId || !channelId) return;
    const isThreadReply = conversation?.initialMessageId
      ? conversation.initialMessageId !== message.messageId
      : context === 'thread' && !isFirstInThread;
    if (window.location.pathname.includes('/chat/dir/threads')) {
      if (isThreadReply) {
        void navigate(
          `/chat/dir/threads/${channelId}/${conversationId}#origin=${conversationId}&messageId=${message.messageId}`,
        );
      } else {
        void navigate(`/chat/dir/${channelId}#origin=${conversationId}`);
      }
      return;
    }
    if (isThreadReply) {
      void navigate(
        `${baseRoute}/${channelId}/${conversationId}?focusThread=1#origin=${conversationId}&messageId=${message.messageId}`,
      );
    } else {
      void navigate(`${baseRoute}/${channelId}#origin=${conversationId}`);
    }
  };

  const { settings: debugSettings } = useDebugSettings();

  const shouldShowPending = useMemo(() => {
    return debugSettings.showSendIndicators && isMe && !message.isSent;
  }, [debugSettings.showSendIndicators, isMe, message.isSent]);

  // Claw agent citations baked into the reply metadata (by claw-auth at
  // reply-time) so this thread message can render clickable citation chips
  // without re-calling claw — re-opened threads are served straight from
  // Postgres and never hit the /messages sidebar path.
  const clawCitations = metadata?.['clawCitations'] as ToolInvocation[] | undefined;
  const clawCitationCtx = useMemo(() => {
    if (!isMarkdownContent || !clawCitations?.length) return undefined;
    // Register the de-duplicated icon bytes so chip icons resolve at render time
    // (mirrors the sidebar's registerClawIcons on the /messages `icons` map).
    registerClawIcons(metadata?.['clawCitationIcons']);
    const toolNumbers = buildClawCitationToolNumbers(parsedMarkdown.content);
    if (toolNumbers.size === 0) return undefined;
    return { toolInvocations: clawCitations, toolNumbers };
  }, [isMarkdownContent, clawCitations, metadata, parsedMarkdown.content]);

  // Linkify inline [clf-…#n] tokens into the synthetic cite:/cite-group: links
  // the `a` override turns into chips. When no citation metadata is present
  // (old messages, non-citing agents), strip the raw tokens + trailing
  // <citation> block so they never render as literal text.
  const citationContent = useMemo(() => {
    const raw = parsedMarkdown.content;
    if (!isMarkdownContent) return raw;
    if (raw.indexOf('clf-') === -1 && !/<citation\b/i.test(raw)) return raw;
    const linkified = clawCitationCtx
      ? linkifyAndGroupClawCitations(raw, clawCitationCtx.toolNumbers)
      : raw;
    return stripCitationMarks(linkified);
  }, [isMarkdownContent, parsedMarkdown.content, clawCitationCtx]);

  // Memoize markdown components to prevent re-renders on parent updates
  const markdownComponents = useMemo(
    () => createMarkdownComponents(message.messageId, clawCitationCtx),
    [message.messageId, clawCitationCtx],
  );

  if (!message) {
    return null;
  }

  // For mobile "my" messages, use the specialized mobile component
  const isSlashCommandArtifact = isSlashCommandArtifactMessage(message.content);

  if (isMobile && isMe && !isSlashCommandArtifact) {
    return (
      <MobileMessageMyBubble
        message={message}
        showAvatar={showAvatar}
        isPinned={isPinned ?? false}
        isBookmarked={isBookmarked ?? false}
        isReminderSet={isReminderSet ?? false}
        reminderDueInLabel={reminderDueInLabel}
        isHighlighted={isHighlighted ?? false}
        channelId={channelId}
        {...(conversation && { conversation })}
        context={context}
        contentOnly={contentOnly}
        threadInfo={threadInfo}
        channelScopeType={channelScopeType}
        isFirstInThread={isFirstInThread}
        workflowNumber={workflowNumber}
        {...(recordingShare && {
          recordingShare,
        })}
        {...(onClick && { onClick })}
      />
    );
  }

  const isXyneBot = message.msgType === MessageType.BOT;
  const isShowInChannelHighlight = context === 'thread' && message.showInChannel === true;

  const messageBubbleClassName = getMessageBubbleClassName(
    shouldShowPending,
    variant,
    isPinned,
    isBookmarked,
    isHighlighted,
    isActiveCall && isCallMessage,
    isXyneBot,
    isPrivateSystemNotice,
    contentOnly,
    isShowInChannelHighlight,
    context,
    isFirstInThread,
    isCallNoTranscript,
    searchItemView,
  );
  return (
    <>
      {isPinned &&
        variant !== 'pinned' &&
        (context === 'channel' || (context === 'thread' && isFirstInThread)) && (
          <div className='flex items-center gap-1 text-xs text-status-pending font-medium mb-1 ml-12'>
            <PinnedIcon className='w-4 h-4' />
            <span>Pinned</span>
          </div>
        )}
      {/* eslint-disable jsx-a11y/no-static-element-interactions*/}

      {isPrivateSystemNotice && (
        <MessageHeader
          svgBgColor='hsl(var(--muted))'
          icon='visibility'
          text='Only Visible to you'
          backgroundColor='bg-muted'
          textColor='text-foreground'
        />
      )}

      <div
        data-component='MessageBubble'
        className={messageBubbleClassName}
        onClick={onClick}
        {...(onClick
          ? {
              'data-track-category': 'MESSAGE',
              'data-track-name': 'OPEN_MESSAGE_BUBBLE',
              // Static label: the auto-label would capture message content.
              'data-track-label': 'message_bubble',
            }
          : {})}
        onKeyDown={
          onClick
            ? (e): void => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
                }
              }
            : undefined
        }
        style={{ cursor: onClick ? 'pointer' : undefined }}
      >
        {/* eslint-enable jsx-a11y/no-static-element-interactions */}

        {/* ================== LEFT AVATAR ================== */}
        {!contentOnly && (
          <div
            className={`w-8 h-full flex items-start justify-center ${showAvatar && !isWorkflowMessage && !isHeadlessRecordingAnchor ? 'pt-[4px]' : ''}`}
          >
            {message.isDeleted ? (
              <div className='w-8 h-8 rounded-md flex items-center justify-center bg-muted'>
                <Trash2 className='w-4 h-4 text-muted-foreground' />
              </div>
            ) : isWorkflowMessage ? (
              <img
                src={workflowBotAvatar}
                alt='No files shared in this channel yet.'
                width={32}
                height={32}
              />
            ) : showAvatar && isCallMessage && !isForwardedMessage ? (
              <div
                className={`w-8 h-8 rounded-md flex items-center justify-center ${isActiveCall ? 'bg-stage-completed' : 'bg-muted-foreground/10'}`}
              >
                <HuddleIcon
                  color={isActiveCall ? 'var(--status-success)' : 'hsl(var(--foreground) / 0.8)'}
                />
              </div>
            ) : showAvatar && isHeadlessRecordingAnchor && !isForwardedMessage ? (
              <div
                className={`w-8 h-8 rounded-md flex items-center justify-center self-center shrink-0 border ${isRecordingEnded ? 'bg-muted-foreground/10 border-border/25' : 'bg-status-failure/15 border-status-failure/30'}`}
              >
                <MicOn
                  size={16}
                  color={
                    isRecordingEnded ? 'hsl(var(--foreground) / 0.8)' : 'var(--status-failure)'
                  }
                />
              </div>
            ) : showAvatar && sender?.userType === UserType.APP ? (
              <div
                onClick={() => handleUserClick(sender.id)}
                data-track-category='MESSAGE'
                data-track-name='OPEN_SENDER_PROFILE_FROM_AVATAR'
                className='cursor-pointer'
                role='button'
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleUserClick(sender.id);
                  }
                }}
                aria-label={`View ${getUserDisplayName(sender) || 'app'} profile`}
              >
                {isMobile ? (
                  <UserAvatar
                    userId={sender.id}
                    size={AvatarSize.REGULAR}
                    showActiveStatus={false}
                  />
                ) : (
                  <UserHoverWrapper userId={sender.id} preserveThreadRoute={context === 'thread'}>
                    <UserAvatar userId={sender.id} size={AvatarSize.MD} showActiveStatus={false} />
                  </UserHoverWrapper>
                )}
              </div>
            ) : showAvatar && isXyneBot ? (
              <div className='flex items-center justify-center'>
                <svg
                  width='30'
                  height='30'
                  viewBox='0 0 20 20'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                >
                  <rect x='0.25' y='0.25' width='19.5' height='19.5' rx='9.75' fill='#0361E2' />
                  <rect
                    x='0.25'
                    y='0.25'
                    width='19.5'
                    height='19.5'
                    rx='9.75'
                    stroke='#E4E6E7'
                    strokeWidth='0.5'
                  />
                  <path
                    d='M10.2727 15.1761L10.2667 15.1771L10.2312 15.1946L10.2212 15.1966L10.2142 15.1946L10.1787 15.1766C10.1733 15.1753 10.1693 15.1763 10.1667 15.1796L10.1647 15.1846L10.1562 15.3986L10.1587 15.4086L10.1637 15.4151L10.2157 15.4521L10.2232 15.4541L10.2292 15.4521L10.2812 15.4151L10.2872 15.4071L10.2892 15.3986L10.2807 15.1851C10.2793 15.1798 10.2767 15.1768 10.2727 15.1761ZM10.4047 15.1196L10.3977 15.1206L10.3057 15.1671L10.3007 15.1721L10.2992 15.1776L10.3082 15.3926L10.3107 15.3986L10.3147 15.4026L10.4152 15.4486C10.4215 15.4503 10.4263 15.4489 10.4297 15.4446L10.4317 15.4376L10.4147 15.1306C10.413 15.1243 10.4097 15.1206 10.4047 15.1196ZM10.0472 15.1206C10.045 15.1193 10.0423 15.1188 10.0398 15.1194C10.0373 15.1199 10.0351 15.1214 10.0337 15.1236L10.0307 15.1306L10.0137 15.4376C10.014 15.4436 10.0168 15.4476 10.0222 15.4496L10.0297 15.4486L10.1302 15.4021L10.1352 15.3981L10.1367 15.3926L10.1457 15.1776L10.1442 15.1716L10.1392 15.1666L10.0472 15.1206Z'
                    fill='#A0A7AB'
                  />
                  <path
                    d='M8.52963 6.27088C8.82863 5.39588 10.0376 5.36938 10.3921 6.19138L10.4221 6.27138L10.8256 7.45138C10.9181 7.72199 11.0675 7.96963 11.2638 8.17759C11.4602 8.38554 11.6988 8.54898 11.9636 8.65688L12.0721 8.69737L13.2521 9.10038C14.1271 9.39937 14.1536 10.6084 13.3321 10.9629L13.2521 10.9929L12.0721 11.3964C11.8014 11.4888 11.5537 11.6382 11.3456 11.8345C11.1376 12.0308 10.9741 12.2695 10.8661 12.5344L10.8256 12.6424L10.4226 13.8229C10.1236 14.6979 8.91463 14.7244 8.56063 13.9029L8.52963 13.8229L8.12663 12.6429C8.03422 12.3722 7.88481 12.1244 7.6885 11.9164C7.49218 11.7083 7.25352 11.5448 6.98863 11.4369L6.88063 11.3964L5.70063 10.9934C4.82513 10.6944 4.79863 9.48537 5.62063 9.13137L5.70063 9.10038L6.88063 8.69737C7.15124 8.6049 7.39888 8.45547 7.60684 8.25916C7.81479 8.06285 7.97823 7.82422 8.08613 7.55937L8.12663 7.45138L8.52963 6.27088ZM9.47613 6.59387L9.07313 7.77388C8.93232 8.18653 8.70326 8.56353 8.40189 8.87862C8.10053 9.19372 7.7341 9.43934 7.32813 9.59837L7.20313 9.64388L6.02313 10.0469L7.20313 10.4499C7.61578 10.5907 7.99278 10.8197 8.30787 11.1211C8.62297 11.4225 8.86859 11.7889 9.02763 12.1949L9.07313 12.3199L9.47613 13.4999L9.87913 12.3199C10.0199 11.9072 10.249 11.5302 10.5504 11.2151C10.8517 10.9 11.2182 10.6544 11.6241 10.4954L11.7491 10.4504L12.9291 10.0469L11.7491 9.64388C11.3365 9.50307 10.9595 9.27401 10.6444 8.97264C10.3293 8.67128 10.0837 8.30485 9.92463 7.89888L9.87963 7.77388L9.47613 6.59387ZM13.4761 4.54688C13.5697 4.54687 13.6613 4.57311 13.7407 4.62261C13.8201 4.67211 13.884 4.74288 13.9251 4.82688L13.9491 4.88538L14.1241 5.39838L14.6376 5.57338C14.7314 5.60522 14.8135 5.66418 14.8737 5.74278C14.9339 5.82138 14.9694 5.91608 14.9758 6.01489C14.9821 6.11369 14.9589 6.21214 14.9092 6.29777C14.8595 6.3834 14.7855 6.45234 14.6966 6.49588L14.6376 6.51988L14.1246 6.69488L13.9496 7.20837C13.9177 7.30209 13.8587 7.38422 13.7801 7.44437C13.7015 7.50452 13.6067 7.53997 13.5079 7.54624C13.4091 7.5525 13.3107 7.5293 13.2251 7.47956C13.1395 7.42983 13.0706 7.35581 13.0271 7.26688L13.0031 7.20837L12.8281 6.69537L12.3146 6.52038C12.2209 6.48853 12.1387 6.42957 12.0785 6.35097C12.0183 6.27237 11.9828 6.17767 11.9765 6.07886C11.9702 5.98006 11.9933 5.88161 12.043 5.79598C12.0927 5.71035 12.1667 5.64141 12.2556 5.59788L12.3146 5.57388L12.8276 5.39888L13.0026 4.88538C13.0363 4.78659 13.1001 4.70083 13.185 4.64012C13.27 4.57942 13.3717 4.54681 13.4761 4.54688Z'
                    fill='white'
                  />
                  <defs>
                    <linearGradient
                      id='paint0_linear_6453_10193'
                      x1='11.1905'
                      y1='12'
                      x2='1.16709'
                      y2='1.73796'
                      gradientUnits='userSpaceOnUse'
                    >
                      <stop stopColor='#FF4F4F' />
                      <stop offset='1' stopColor='#D77F7F' />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            ) : isPrivateSystemNotice ? (
              <div
                className={`w-8 h-8 flex items-center justify-center bg-muted-foreground/20 rounded-lg`}
              >
                <svg
                  width='16'
                  height='16'
                  viewBox='0 0 16 16'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                >
                  <g clipPath='url(#clip0_1872_7937)'>
                    <path
                      d='M7.99967 10.6663C9.47243 10.6663 10.6663 9.47243 10.6663 7.99967C10.6663 6.52692 9.47243 5.33301 7.99967 5.33301C6.52692 5.33301 5.33301 6.52692 5.33301 7.99967C5.33301 9.47243 6.52692 10.6663 7.99967 10.6663Z'
                      stroke='#1D1E1F'
                      strokeWidth='1.33333'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                    <path
                      d='M10.6663 5.33301V8.66635C10.6663 9.19678 10.8771 9.70549 11.2521 10.0806C11.6272 10.4556 12.1359 10.6663 12.6663 10.6663C13.1968 10.6663 13.7055 10.4556 14.0806 10.0806C14.4556 9.70549 14.6663 9.19678 14.6663 8.66635V7.99968C14.6663 6.49788 14.1593 5.04008 13.2273 3.86246C12.2953 2.68484 10.993 1.8564 9.53137 1.51135C8.06975 1.16631 6.53444 1.32488 5.17419 1.96138C3.81395 2.59788 2.70846 3.67501 2.03683 5.01826C1.36521 6.3615 1.1668 7.89217 1.47375 9.36227C1.7807 10.8324 2.57503 12.1558 3.72803 13.118C4.88104 14.0803 6.32518 14.6251 7.82647 14.6641C9.32776 14.7031 10.7982 14.2341 11.9997 13.333'
                      stroke='#1D1E1F'
                      strokeWidth='1.33333'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                  </g>
                  <defs>
                    <clipPath id='clip0_1872_7937'>
                      <rect width='16' height='16' fill='white' />
                    </clipPath>
                  </defs>
                </svg>
              </div>
            ) : showAvatar && sender ? (
              <div
                onClick={() => handleUserClick(sender.id)}
                data-track-category='MESSAGE'
                data-track-name='OPEN_SENDER_PROFILE_FROM_AVATAR'
                className='cursor-pointer'
                role='button'
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleUserClick(sender.id);
                  }
                }}
                aria-label={`View ${getUserDisplayName(sender) || 'user'} profile`}
              >
                {isMobile ? (
                  <UserAvatar
                    userId={sender.id}
                    size={AvatarSize.REGULAR}
                    showActiveStatus={false}
                  />
                ) : (
                  <UserHoverWrapper userId={sender.id} preserveThreadRoute={context === 'thread'}>
                    <UserAvatar userId={sender.id} size={AvatarSize.MD} showActiveStatus={false} />
                  </UserHoverWrapper>
                )}
              </div>
            ) : (
              <div
                className={`text-[10px] text-muted-foreground flex items-center gap-1 cursor-pointer hover:underline pt-[5px] ${shouldShowPending ? '' : 'opacity-0 group-hover:opacity-100'} visual-regression-hide`}
              >
                {formatTime12HourNoAmPm(message.createdAt)}
                {shouldShowPending && (
                  <Tooltip content={'Sending message..'} side='top'>
                    <div className='inline-flex items-center'>
                      {' '}
                      <PendingIcon size={12} className='cursor-pointer' />{' '}
                    </div>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================== RIGHT SIDE ================== */}
        <div className='flex-1 flex flex-col min-w-0'>
          {isBookmarked && variant !== 'pinned' && (
            <div className='inline-flex items-center gap-1 text-blue-700 dark:text-blue-200 text-[11px] font-medium'>
              <Bookmark className='w-3 h-3 fill-current' />
              <span>
                {isReminderSet
                  ? `Reminder Set${reminderDueInLabel ? ` • ${reminderDueInLabel}` : ''}`
                  : 'Bookmark'}
              </span>
            </div>
          )}

          {showAvatar && !isWorkflowMessage && (
            <div className='w-full flex items-baseline gap-2 min-h-4 '>
              {isCallMessage && !isForwardedMessage ? (
                <h3
                  className={`text-sm font-medium text-foreground${isCallNoTranscript ? ' opacity-60' : ''}`}
                >
                  {isActiveCall
                    ? 'A call is going on'
                    : (metadata?.['callEndedText'] as string) ||
                      message.content ||
                      'A call happened'}
                </h3>
              ) : isHeadlessRecordingAnchor && !isForwardedMessage ? (
                <h3 className='text-sm font-medium text-foreground'>Recording</h3>
              ) : isXyneBot ? (
                <h3 className='text-sm font-medium text-foreground'>
                  {getUserDisplayName(sender) || 'AI Assistant'}
                </h3>
              ) : isPrivateSystemNotice ? (
                <div className=''>
                  <h3 className='text-sm font-medium text-foreground'>System</h3>
                  {isMentionUserAddition && (
                    <div className='gap-2 mt-1'>
                      <NonParticipantActions
                        messageId={message.messageId}
                        content={message.content}
                        metadata={metadata}
                        conversationId={message.conversationId}
                        showText={true}
                      />
                    </div>
                  )}
                </div>
              ) : isTicketNudge ? (
                <h3 className='text-sm font-medium text-foreground'>System</h3>
              ) : sender ? (
                isMobile ? (
                  <span className='flex items-center gap-1'>
                    <Button
                      variant='ghost'
                      onClick={() => handleUserClick(sender.id)}
                      data-track-category='MESSAGE'
                      data-track-name='OPEN_SENDER_PROFILE_FROM_NAME'
                      className={`${isMobile ? 'text-[15px] leading-tight font-semibold tracking-tight' : 'text-sm font-medium'} text-foreground hover:underline p-0 h-auto min-w-0`}
                      aria-label={`View ${getUserDisplayName(sender) || 'user'} profile`}
                    >
                      <span className='flex items-center gap-1'>{getUserDisplayName(sender)}</span>
                    </Button>
                    <StatusIndicator
                      statusEmoji={sender?.statusEmoji}
                      statusContent={sender?.statusContent}
                      statusExpiryAt={sender?.statusExpiryAt}
                      size='sm'
                      showOnHover={true}
                    />
                  </span>
                ) : (
                  <span className='flex items-center gap-1'>
                    <UserHoverWrapper userId={sender.id} preserveThreadRoute={context === 'thread'}>
                      <div className='flex items-center gap-1.5'>
                        <Button
                          variant='ghost'
                          onClick={() => handleUserClick(sender.id)}
                          data-track-category='MESSAGE'
                          data-track-name='OPEN_SENDER_PROFILE_FROM_NAME'
                          className='text-sm font-semibold text-foreground hover:underline p-0 h-auto min-w-0'
                          aria-label={`View ${getUserDisplayName(sender) || 'user'} profile`}
                        >
                          <span className='flex items-center gap-1'>
                            {getUserDisplayName(sender)}
                          </span>
                        </Button>
                      </div>
                    </UserHoverWrapper>
                    <StatusIndicator
                      statusEmoji={sender?.statusEmoji}
                      statusContent={sender?.statusContent}
                      statusExpiryAt={sender?.statusExpiryAt}
                      size='sm'
                      showOnHover={true}
                    />
                  </span>
                )
              ) : (
                <h3 className='text-sm font-medium text-foreground cursor-pointer hover:underline'>
                  {'User'}
                </h3>
              )}

              {searchItemView && searchChannel && (
                <span
                  className={`${isMobile ? 'text-[12px]' : 'text-xs'} text-muted-foreground inline-flex items-center gap-1 truncate min-w-0`}
                >
                  {!isSearchDM &&
                    (isSearchPrivateChannel ? (
                      <ChatLock color='hsl(var(--muted-foreground))' />
                    ) : (
                      <Hash size={12} className='shrink-0' />
                    ))}
                  <span className='truncate'>{searchChannelDisplay.displayName}</span>
                </span>
              )}

              <Tooltip content={formatFullTimestamp(message.createdAt)} side='top'>
                <h3
                  onClick={searchItemView ? undefined : handleTimestampClick}
                  data-track-category='MESSAGE'
                  data-track-name='OPEN_THREAD_FROM_TIMESTAMP'
                  onKeyDown={
                    searchItemView
                      ? undefined
                      : e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleTimestampClick(e);
                          }
                        }
                  }
                  className={`${isMobile ? 'text-[12px]' : 'text-xs'} text-muted-foreground cursor-pointer hover:underline transition-all duration-150 visual-regression-hide ${searchItemView ? 'ml-auto shrink-0' : ''}`}
                >
                  {searchItemView || context === 'thread'
                    ? formatThreadTimestamp(message.createdAt)
                    : formatTimeAmPm(message.createdAt)}
                </h3>
              </Tooltip>
              {metadata?.['clawRunOrigin'] ? (
                <RunOriginChip origin={metadata['clawRunOrigin']} />
              ) : null}
              {headerContent}
            </div>
          )}

          {/* ================== THREAD INFO (replied to a thread) ================== */}
          {threadInfo && channelId && (
            <ThreadInfoIndicator
              threadInfo={threadInfo}
              channelId={channelId}
              messageId={message.messageId}
            />
          )}

          {/* Show "Also sent to channel/DM" indicator in thread view */}
          {context === 'thread' &&
            message.showInChannel &&
            channelId &&
            message.childConversationId && (
              <AlsoSentToChannelIndicator
                channelId={channelId}
                childConversationId={message.childConversationId}
                {...(channelScopeType && { channelScopeType })}
              />
            )}

          {/* ================== MESSAGE CONTENT ================== */}
          {isCallShareMessage && !isForwardedMessage && !message.isDeleted ? (
            <CallShareBubble message={{ content: message.content, metadata }} />
          ) : isRecordingMessage &&
            metadata?.callId &&
            !isForwardedMessage &&
            !message.isDeleted ? (
            <RecordingBubble
              message={{
                messageId: message.messageId,
                content: message.content,
                createdAt: message.createdAt,
                metadata,
              }}
              callId={metadata.callId}
            />
          ) : isCallMessage && metadata?.callId && !isForwardedMessage ? (
            <CallBubble
              message={{
                messageId: message.messageId,
                content: message.content,
                createdAt: message.createdAt,
                hasAttachment: message.hasAttachment,
                metadata,
              }}
              callId={metadata.callId}
              isActiveCall={isActiveCall}
              {...(channelId && { channelId })}
              {...(message.conversationId && { conversationId: message.conversationId })}
              {...(sender && { senderName: getUserDisplayName(sender) })}
              showAvatar={showAvatar}
              {...(context && { context })}
              attachments={attachments}
            />
          ) : (
            <div className='w-full flex flex-col gap-1 '>
              {message.isDeleted ? (
                <div className='text-sm text-muted-foreground italic'>This message was deleted</div>
              ) : isMentionUserAddition ? (
                <NonParticipantActions
                  messageId={message.messageId}
                  content={message.content}
                  metadata={metadata}
                  conversationId={message.conversationId}
                  showButton={true}
                />
              ) : isPulseActionablesMessage && metadata?.callId ? (
                <PulseTickets
                  content={message.content}
                  callId={metadata?.callId}
                  conversationId={message.conversationId}
                  messageId={message.messageId}
                />
              ) : isChannelEmailMessage ? (
                <ChannelEmailCard
                  subject={typeof metadata?.['subject'] === 'string' ? metadata['subject'] : ''}
                  from={typeof metadata?.['from'] === 'string' ? metadata['from'] : ''}
                  to={typeof metadata?.['to'] === 'string' ? metadata['to'] : ''}
                  cc={Array.isArray(metadata?.['cc']) ? (metadata?.['cc'] as string[]) : []}
                  bcc={Array.isArray(metadata?.['bcc']) ? (metadata?.['bcc'] as string[]) : []}
                  body={message.content}
                  emailId={message.messageId}
                  attachments={attachments}
                />
              ) : recordingShare && !isForwardedMessage ? (
                <RecordingShareContent
                  recordingShare={recordingShare}
                  renderNote={noteHtml => (
                    <div
                      className={`jp-message-html whitespace-pre-wrap break-all-words inline-block ${getEmojiFontSizeClass(noteHtml)}`}
                    >
                      <RenderMessageWithHTML
                        message={noteHtml}
                        showEdited={message.edited}
                        messageId={message.messageId}
                        conversationId={message.conversationId}
                        preserveThreadRoute={context === 'thread'}
                      />
                    </div>
                  )}
                  afterContent={afterTextContent}
                />
              ) : isMarkdownContent ? (
                <>
                  <MarkdownMessageRenderer
                    content={citationContent}
                    markdownComponents={markdownComponents}
                    messageSubtype={metadata?.messageSubtype}
                  />
                  {metadata?.messageSubtype === 'recording' &&
                    metadata?.callId &&
                    (metadata?.['recordingType'] && metadata['recordingType'] !== 'AUDIO_ONLY' ? (
                      <InlineVideoPreview
                        callId={String(metadata.callId)}
                        {...(metadata?.recordingId
                          ? { recordingId: String(metadata.recordingId) }
                          : {})}
                        {...(recordingAttachmentId ? { attachmentId: recordingAttachmentId } : {})}
                      />
                    ) : (
                      <div className='mt-2'>
                        <AudioPlayer
                          onLoad={signal =>
                            metadata?.recordingId
                              ? recordingService.downloadCallRecordingBlob(
                                  String(metadata.callId),
                                  String(metadata.recordingId),
                                  signal,
                                )
                              : recordingService.downloadRecordingBlob(
                                  String(metadata.callId),
                                  signal,
                                )
                          }
                          trackCategory='RecordingLinkReply'
                          showToastOnError
                        />
                      </div>
                    ))}
                  {(ticketSuggestions.length > 0 || ticketsCreated.length > 0) && channelId && (
                    <TicketSuggestions
                      suggestions={ticketSuggestions}
                      ticketsCreated={ticketsCreated}
                      channelId={channelId}
                      messageId={message.messageId}
                      conversationId={message.conversationId}
                    />
                  )}
                  {(parsedAppActions.appActions.length > 0 ||
                    parsedAppActions.actioned.length > 0) && (
                    <AppActions
                      appActions={parsedAppActions.appActions}
                      actioned={parsedAppActions.actioned}
                      messageId={message.messageId}
                      conversationId={message.conversationId}
                    />
                  )}
                </>
              ) : isForwardedMessage && forwardedMessageData ? (
                // Forwarded message display (parsed from XML)
                <div className='flex flex-col gap-2'>
                  {/* Optional message from forwarder */}
                  {forwardedMessageData.optionalText && (
                    <div
                      className={`jp-message-html whitespace-pre-wrap break-all-words inline-block ${getEmojiFontSizeClass(forwardedMessageData.optionalText)}`}
                    >
                      {isMobile ? (
                        <ExpandableMessage
                          message={forwardedMessageData.optionalText}
                          showEdited={message.edited}
                          maxHeight={500}
                        />
                      ) : (
                        <div className='jp-message-html inline-block'>
                          <RenderMessageWithHTML
                            message={DOMPurify.sanitize(forwardedMessageData.optionalText)}
                            showEdited={message.edited}
                            preserveThreadRoute={context === 'thread'}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {/* Forwarded message content with left border */}
                  <div className='border-l-4 border-border pl-3'>
                    <div className='flex items-center gap-2 mb-1'>
                      {forwardedMessageData.originalSenderName === 'Xyne Call' ? (
                        <div className='w-5 h-5 rounded-md flex items-center justify-center bg-muted'>
                          <HuddleIcon color='hsl(var(--muted-foreground))' size={14} />
                        </div>
                      ) : (
                        forwardedMessageData.originalSenderId && (
                          <UserAvatar
                            userId={forwardedMessageData.originalSenderId}
                            size={AvatarSize.SM}
                            showActiveStatus={false}
                          />
                        )
                      )}
                      {forwardedMessageData.originalSenderId ? (
                        <button
                          type='button'
                          onClick={() => handleUserClick(forwardedMessageData.originalSenderId)}
                          data-track-category='MESSAGE'
                          data-track-name='OPEN_ORIGINAL_SENDER_PROFILE'
                          className='text-xs font-medium text-foreground hover:underline cursor-pointer bg-transparent border-0 p-0'
                        >
                          {getUserDisplayName(originalSender) ||
                            forwardedMessageData.originalSenderName ||
                            'Unknown User'}
                        </button>
                      ) : (
                        <span className='text-xs font-medium text-foreground'>
                          {forwardedMessageData.originalSenderName || 'Unknown User'}
                        </span>
                      )}
                      {forwardedMessageData.originalCreatedAt && (
                        <span className='text-xs text-muted-foreground visual-regression-hide'>
                          {formatRelativeTimestamp(forwardedMessageData.originalCreatedAt)}
                        </span>
                      )}
                    </div>
                    {recordingShare ? (
                      <RecordingShareContent
                        recordingShare={recordingShare}
                        renderNote={noteHtml => (
                          <div
                            className={`jp-message-html whitespace-pre-wrap break-all-words inline-block text-muted-foreground ${getEmojiFontSizeClass(noteHtml)}`}
                          >
                            {isMobile ? (
                              <ExpandableMessage
                                message={noteHtml}
                                showEdited={false}
                                maxHeight={500}
                              />
                            ) : (
                              <RenderMessageWithHTML
                                message={noteHtml}
                                showEdited={false}
                                preserveThreadRoute={context === 'thread'}
                              />
                            )}
                          </div>
                        )}
                      />
                    ) : metadata?.isCallMessage && metadata?.callId ? (
                      <>
                        <CallBubble
                          message={{
                            messageId: message.messageId,
                            content: forwardedMessageData.content,
                            createdAt: forwardedMessageData.originalCreatedAt || message.createdAt,
                            hasAttachment: message.hasAttachment,
                            metadata,
                          }}
                          callId={metadata.callId}
                          isActiveCall={isActiveCall}
                          {...(channelId && { channelId })}
                          showAvatar={false}
                          {...(context && { context })}
                          attachments={attachments}
                        />
                      </>
                    ) : (
                      <>
                        <div
                          className={`jp-message-html whitespace-pre-wrap break-all-words inline-block text-muted-foreground ${getEmojiFontSizeClass(resolvedForwardedContent)}`}
                        >
                          {isMobile ? (
                            <ExpandableMessage
                              message={resolvedForwardedContent}
                              showEdited={false}
                              maxHeight={500}
                            />
                          ) : (
                            <div className='jp-message-html inline-block'>
                              <RenderMessageWithHTML
                                message={resolvedForwardedContent}
                                showEdited={false}
                                preserveThreadRoute={context === 'thread'}
                              />
                            </div>
                          )}
                        </div>
                        {/* Attachments inside the forwarded message border */}
                        <AttachmentsBlock
                          attachments={attachments}
                          isMobile={isMobile}
                          className='mt-2'
                          {...(message.conversationId && {
                            conversationId: message.conversationId,
                          })}
                          {...(channelId && { channelId })}
                          {...(conversation?.replyCount !== undefined && {
                            replyCount: conversation.replyCount,
                          })}
                          {...(allThreadAttachments && { allThreadAttachments })}
                        />
                      </>
                    )}
                    {/* Posted in link for forwarded messages */}
                    {forwardedMessageData?.originalChannelId &&
                      forwardedMessageData?.originalConversationId && (
                        <PostedInLink
                          originalChannelId={forwardedMessageData.originalChannelId}
                          originalConversationId={forwardedMessageData.originalConversationId}
                          originalMessageId={forwardedMessageData.originalMessageId}
                        />
                      )}
                  </div>
                </div>
              ) : (
                <>
                  {hasMessageContent(message.content) && (
                    <div
                      className={`jp-message-html whitespace-pre-wrap break-all-words inline-block ${getEmojiFontSizeClass(message.content)}`}
                      style={isSystemMessage ? systemMessageStyles : undefined}
                    >
                      {isMobile ? (
                        <ExpandableMessage
                          message={isWorkflowMessage ? 'Workflow created' : message.content}
                          showEdited={message.edited}
                          maxHeight={500}
                          isSystemMessage={isSystemMessage}
                          messageId={message.messageId}
                          conversationId={message.conversationId}
                          slashCommandArtifactContext={{
                            ...(channelId && { channelId }),
                            senderId: message.senderId,
                            createdAt: message.createdAt,
                            surface: context === 'thread' ? 'thread' : 'channel',
                          }}
                        />
                      ) : (
                        <div className='jp-message-html inline-block'>
                          <RenderMessageWithHTML
                            message={isWorkflowMessage ? 'Workflow created' : message.content}
                            showEdited={message.edited}
                            isSystemMessage={isSystemMessage}
                            messageId={message.messageId}
                            conversationId={message.conversationId}
                            preserveThreadRoute={context === 'thread'}
                            slashCommandArtifactContext={{
                              ...(channelId && { channelId }),
                              senderId: message.senderId,
                              createdAt: message.createdAt,
                              surface: context === 'thread' ? 'thread' : 'channel',
                            }}
                          />
                        </div>
                      )}
                      {afterTextContent}
                    </div>
                  )}
                </>
              )}

              {isTicketCardMessage && ticketAttachments && ticketAttachments.length > 0 && (
                <div className='mb-2 flex flex-wrap gap-2'>
                  {ticketAttachments.map(attachment => (
                    <MessageAttachment
                      key={attachment.id}
                      attachment={attachment}
                      allAttachments={ticketAttachments}
                      compact
                    />
                  ))}
                </div>
              )}

              {conversation && conversation.ticket_md && !isWorkflowMessage && (
                <BotBubble
                  context={context}
                  messageId={message.messageId}
                  {...(channelId && { channelId: channelId })}
                  {...(conversation && { conversation: conversation })}
                />
              )}

              {!isForwardedMessage && (
                <>
                  {isMobile ? (
                    <MobileAttachmentsGrid
                      attachments={
                        metadata?.messageSubtype === 'recording'
                          ? attachments.filter(a => !a.mimetype.startsWith('video/'))
                          : attachments
                      }
                      {...(message.conversationId && { conversationId: message.conversationId })}
                      {...(channelId && { channelId })}
                    />
                  ) : (
                    <AttachmentsBlock
                      attachments={
                        metadata?.messageSubtype === 'recording'
                          ? attachments.filter(a => !a.mimetype.startsWith('video/'))
                          : attachments
                      }
                      isMobile={isMobile}
                      {...(message.conversationId && { conversationId: message.conversationId })}
                      {...(channelId && { channelId })}
                      {...(conversation?.replyCount !== undefined && {
                        replyCount: conversation.replyCount,
                      })}
                      {...(allThreadAttachments && { allThreadAttachments })}
                      parentMessage={message}
                    />
                  )}
                </>
              )}

              {shouldRenderLinkPreview && showLinkPreview && previewResult && !recordingShare && (
                <div className='mt-2 max-w-full'>
                  {previewResult.type === 'message_preview' ? (
                    <InternalMessagePreview
                      metadata={{
                        type: 'internal_message',
                        ...previewResult.data,
                      }}
                      onClose={() => setShowLinkPreview(false)}
                    />
                  ) : (
                    <LinkPreview
                      metadata={previewResult.data}
                      onClose={() => setShowLinkPreview(false)}
                    />
                  )}
                </div>
              )}

              {!contentOnly && (
                <SurfaceNudgeList
                  messageId={message.messageId}
                  actionableCount={actionableCount}
                  countRowIds={countRowIds}
                  channelId={channelId}
                  contentOnly={contentOnly}
                  isMobile={isMobile}
                  messageType={message.msgType}
                  isDeleted={message.isDeleted}
                />
              )}
              {!contentOnly && (
                <ReactionView
                  reactionsMd={message.reactions_md}
                  toggleReaction={toggleReaction}
                  messageId={message.messageId}
                />
              )}
            </div>
          )}
        </div>

        {renderActions && (
          <div className='absolute -top-2 right-4 flex items-center gap-1 bg-background border border-border rounded-lg p-1 shadow-lg z-10'>
            {renderActions(message)}
          </div>
        )}
      </div>
    </>
  );
};

export interface GroupedReaction {
  emojiName: string;
  count: number;
  users: Array<{ userId: string; name: string }>;
  userHasReacted: boolean;
  orderIndex: number;
}

const MAX_TOOLTIP_REACTOR_NAMES = 50;

const formatReactorNames = (
  users: GroupedReaction['users'],
  currentUserId: string | undefined,
): string => {
  const names = users.map(u => (u.userId === currentUserId ? 'You' : u.name));
  const selfIndex = currentUserId ? users.findIndex(u => u.userId === currentUserId) : -1;
  if (selfIndex > 0) {
    names.unshift(...names.splice(selfIndex, 1));
  }

  const overflow = names.length - MAX_TOOLTIP_REACTOR_NAMES;
  if (overflow > 0) {
    const shown = names.slice(0, MAX_TOOLTIP_REACTOR_NAMES).join(', ');
    return `${shown} and ${overflow} ${overflow === 1 ? 'other' : 'others'}`;
  }

  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/**
 * Displays reaction emojis for a message with user tooltips.
 * Each reaction is clickable to toggle the reaction.
 * Reactions are grouped by emoji and show count + all users who reacted.
 *
 * @param reactions - Array of reaction objects with emoji and user info
 * @param toggleReaction - Function to toggle a reaction on/off
 * @param messageId - ID of the message these reactions belong to
 * @returns Reaction buttons component or null if no reactions
 *
 * @todo can we make this into a standalone component that can support reactions for other use cases like comments, tickets, etc.
 */
export const ReactionView = ({
  reactionsMd,
  toggleReaction,
  messageId,
}: {
  reactionsMd: string | null | undefined;
  toggleReaction: (params: { messageId: string; emoji: string; hasReacted: boolean }) => void;
  messageId: string;
}): React.ReactNode => {
  const { user } = useAuth();
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [isReactionDrawerOpen, setIsReactionDrawerOpen] = useState(false);
  const users = useUsers();
  const { data: customEmojis } = useCustomEmojis();
  const { isMobile } = usePlatform();
  const { theme } = useTheme();
  const emojiPickerTheme = theme === 'midnight' ? EmojiTheme.DARK : EmojiTheme.LIGHT;

  // Touch handling refs for long press detection
  const pressTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const isScrollingRef = React.useRef(false);

  const usersById = useMemo(() => {
    const map = new Map<string, { name: string }>();
    for (const u of users) {
      map.set(u.id, { name: getUserDisplayName(u) });
    }
    return map;
  }, [users]);

  const reactionsData: ReactionsData = parseReactionsMd(reactionsMd);
  const emojiOrder = Object.keys(reactionsData);
  const [, setEmojiNamesReady] = useState(false);

  useEffect(() => {
    if (!emojiOrder.some(emoji => !emoji.startsWith('custom:'))) return undefined;

    let active = true;
    void loadEmojiData().then(() => {
      if (active) setEmojiNamesReady(true);
    });

    return () => {
      active = false;
    };
  }, [reactionsMd]);

  if (emojiOrder.length === 0) {
    return null;
  }

  const groupedReactions = emojiOrder.reduce(
    (acc, emoji, index) => {
      const userIds = reactionsData[emoji] ?? [];
      const usersForEmoji = userIds.map(userId => ({
        userId,
        name: usersById.get(userId)?.name || 'Unknown User',
      }));

      acc[emoji] = {
        emojiName: emoji,
        count: userIds.length,
        users: usersForEmoji,
        userHasReacted: !!user && userIds.includes(user.id),
        orderIndex: index,
      };

      return acc;
    },
    {} as Record<string, GroupedReaction>,
  );

  const groupedReactionsArray = Object.values(groupedReactions).sort((a, b) => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.orderIndex - b.orderIndex;
  });

  const handleReactionDrawerOpenChange = (open: boolean): void => {
    setIsReactionDrawerOpen(open);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }

    // Dismiss keyboard when opening the drawer on mobile
    if (open && isMobile) {
      const activeElement = document.activeElement as HTMLElement;
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.isContentEditable)
      ) {
        activeElement.blur();
      }
    }
  };

  return (
    <>
      <div className='flex items-center gap-1 flex-wrap'>
        {groupedReactionsArray.map(reaction => {
          const userNames = formatReactorNames(reaction.users, user?.id);
          const verb = reaction.users.length === 1 && !reaction.userHasReacted ? 'has' : 'have';
          // For custom emojis, show the emoji name instead of the full ID
          const displayEmojiName = getEmojiDisplayName(reaction.emojiName);
          const tooltipContent = (
            <div className='flex max-w-full flex-col items-center gap-2'>
              {renderEmoji(reaction.emojiName, 'size-16', 'text-5xl')}
              <span>
                {userNames} {verb} reacted with {displayEmojiName}
              </span>
            </div>
          );

          return (
            <Tooltip
              key={reaction.emojiName}
              content={tooltipContent}
              side='top'
              showArrow={false}
              className='w-max max-w-[calc(100vw-2rem)] whitespace-normal break-words border border-border bg-popover text-center text-popover-foreground text-wrap shadow-md sm:max-w-md'
            >
              <button
                type='button'
                data-testid='message-reaction-chip'
                className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-sm cursor-pointer transition-all duration-150 ${
                  reaction.userHasReacted
                    ? 'bg-accent border border-action-primary hover:bg-accent/80'
                    : 'bg-muted hover:bg-accent'
                }`}
                onClick={e => {
                  toggleReaction({
                    messageId: messageId,
                    emoji: reaction.emojiName,
                    hasReacted: reaction.userHasReacted,
                  });
                  e.stopPropagation();
                }}
                data-track-category='MESSAGE'
                data-track-name='TOGGLE_REACTION'
                onTouchStart={e => {
                  if (isMobile) {
                    e.stopPropagation();
                    isScrollingRef.current = false;

                    pressTimerRef.current = setTimeout(() => {
                      if (!isScrollingRef.current) {
                        handleReactionDrawerOpenChange(true);
                        isScrollingRef.current = false;
                      }
                    }, 600);
                  }
                }}
                onTouchMove={() => {
                  if (isMobile) {
                    isScrollingRef.current = true;
                    if (pressTimerRef.current) {
                      clearTimeout(pressTimerRef.current);
                      pressTimerRef.current = null;
                    }
                  }
                }}
                onTouchEnd={() => {
                  if (pressTimerRef.current) {
                    clearTimeout(pressTimerRef.current);
                    pressTimerRef.current = null;
                  }
                }}
                onTouchCancel={() => {
                  if (pressTimerRef.current) {
                    clearTimeout(pressTimerRef.current);
                    pressTimerRef.current = null;
                  }
                }}
              >
                {renderEmoji(reaction.emojiName)}
                {reaction.count > 1 && (
                  <span className='text-xs font-medium text-foreground'>{reaction.count}</span>
                )}
              </button>
            </Tooltip>
          );
        })}

        {/* Add Reaction */}
        {isMobile ? (
          <AddReactionDrawerMobile
            messageId={messageId}
            user={user}
            reactionsMd={reactionsMd}
            toggleReaction={toggleReaction}
            customEmojis={customEmojis}
          />
        ) : (
          <Popover.Root open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen} modal={true}>
            <Popover.Trigger asChild>
              <button
                type='button'
                className='inline-flex items-center justify-center w-6 h-6 rounded-full text-muted-foreground bg-muted hover:bg-accent cursor-pointer transition-all duration-150'
                onClick={e => e.stopPropagation()}
                data-track-category='MESSAGE'
                data-track-name='OPEN_EMOJI_PICKER'
              >
                <span className='text-sm font-medium'>+</span>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <>
                {emojiPickerOpen && <div className='fixed inset-0 z-40' />}
                <Popover.Content
                  side='top'
                  align='start'
                  sideOffset={4}
                  collisionPadding={16}
                  avoidCollisions={true}
                  className='z-50 bg-background rounded-lg shadow-lg'
                >
                  <EmojiPicker
                    emojiStyle={EmojiStyle.NATIVE}
                    theme={emojiPickerTheme}
                    style={{
                      ['--epr-emoji-size' as string]: '22px',
                      ['--epr-emoji-gap' as string]: '4px',
                    }}
                    onEmojiClick={emoji => {
                      // For custom emojis, store the emojiId with a prefix
                      const emojiName = emoji.isCustom
                        ? `custom:${emoji.emoji}:${emoji.names[0] || 'custom'}`
                        : emoji.emoji;
                      // Check if the user has already reacted with this emoji
                      const hasReacted =
                        !!user && (reactionsData[emojiName] || []).includes(user.id);

                      toggleReaction({
                        messageId: messageId,
                        emoji: emojiName,
                        hasReacted,
                      });
                      setEmojiPickerOpen(false);
                    }}
                    customEmojis={customEmojis || []}
                    previewConfig={{ showPreview: true }}
                  />
                </Popover.Content>
              </>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>

      {/* Mobile Reaction Drawer */}
      {isMobile && (
        <MobileReactionDrawer
          isOpen={isReactionDrawerOpen}
          setIsOpen={handleReactionDrawerOpenChange}
          reactionsMd={reactionsMd}
        />
      )}
    </>
  );
};
