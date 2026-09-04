import React, { useState } from 'react';
import { CreateDocumentModal } from './CreateDocumentModal';
import { recordingService } from '../../../services/Recording/recordingService';
import { Loader2, ClipboardList, FileText } from 'lucide-react';
import { AudioPlayer } from '../AudioPlayer/AudioPlayer';
import { CanvasPreview } from '../../Canvas/CanvasPreview/CanvasPreview';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { CallMessageOverlay } from '../../Chat/CallMessageOverlay/CallMessageOverlay';
import { useGeneratePRD } from '../../../hooks/useGeneratePRD';
import { useGenerateDetailedSummary } from '../../../hooks/useGenerateDetailedSummary';
import { MessageMetadata } from './MessageBubble.utils';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { ENABLE_SUMMARY_ACTION_BUTTON } from '../../../config';

type AttachmentType = QueryResultType<
  typeof queries.conversationMessagesV2
>[number]['attachments'][number];

interface CallBubbleProps {
  message: {
    messageId: string;
    content: string;
    createdAt: number | Date;
    hasAttachment: boolean;
    metadata: MessageMetadata | null;
  };
  callId: string;
  isActiveCall: boolean;
  channelId?: string;
  conversationId?: string;
  senderName?: string;
  showAvatar?: boolean;
  context?: 'channel' | 'thread';
  attachments?: readonly AttachmentType[];
}

/**
 * Button component for generating PRD from call transcript
 */
export const GeneratePRDButton: React.FC<{
  callId: string;
  messageId: string;
  isCanvasCreated?: boolean;
}> = ({ callId, messageId, isCanvasCreated }) => {
  const { generatePRD, isLoading } = useGeneratePRD();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleGenerate = async (customPrompt?: string): Promise<void> => {
    setIsModalOpen(false);
    await generatePRD(callId, messageId, customPrompt);
  };

  return (
    <>
      <button
        type='button'
        onClick={() => setIsModalOpen(true)}
        data-track-category='MESSAGE'
        data-track-name='OPEN_CALL_DETAILS'
        disabled={isLoading}
        className='p-2 hover:bg-accent rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground'
        title={isCanvasCreated ? 'Generate Another PRD' : 'Generate PRD'}
      >
        {isLoading ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <ClipboardList className='h-4 w-4' />
        )}
      </button>

      <CreateDocumentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onGenerate={handleGenerate}
        isLoading={isLoading}
        title='Generate PRD'
        description='Choose how you want to generate the Product Requirements Document.'
        standardOptionLabel='Standard PRD'
        standardOptionSubtext='Generate a standard PRD based on the entire call transcript.'
        customOptionLabel='Custom Instructions'
        customOptionSubtext='Provide specific details or focus areas for the PRD.'
        customInputPlaceholder='E.g., Focus on the API authentication flow and error handling...'
      />
    </>
  );
};

/**
 * Button component for generating a detailed summary from call transcript
 */
const GenerateSummaryButton: React.FC<{
  callId: string;
  messageId: string;
  isCanvasCreated?: boolean;
}> = ({ callId, messageId, isCanvasCreated }) => {
  const { generateDetailedSummary, isLoading } = useGenerateDetailedSummary();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleGenerate = async (customPrompt?: string): Promise<void> => {
    setIsModalOpen(false);
    await generateDetailedSummary(callId, messageId, customPrompt);
  };

  return (
    <>
      <button
        type='button'
        onClick={() => setIsModalOpen(true)}
        data-track-category='MESSAGE'
        data-track-name='OPEN_CALL_DETAILS'
        disabled={isLoading}
        className='p-2 hover:bg-accent rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground'
        title={isCanvasCreated ? 'Generate Another Summary' : 'Generate Summary'}
      >
        {isLoading ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <FileText className='h-4 w-4' />
        )}
      </button>

      <CreateDocumentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onGenerate={handleGenerate}
        isLoading={isLoading}
        title='Generate Summary'
        description='Choose how you want to generate the detailed summary.'
        standardOptionLabel='Standard Summary'
        standardOptionSubtext='Generate a detailed summary based on the entire call transcript.'
        customOptionLabel='Custom Instructions'
        customOptionSubtext='Provide specific details or focus areas for the summary.'
        customInputPlaceholder='E.g., Focus on action items and decisions made...'
      />
    </>
  );
};

/**
 * Button component for chatting with Ask AI about the call transcript
 */
const ChatWithAskAIButton: React.FC<{
  channelId?: string | undefined;
  conversationId?: string | undefined;
  metadata?: MessageMetadata | null | undefined;
  attachments?: readonly AttachmentType[] | undefined;
}> = ({ channelId, conversationId, metadata, attachments }) => {
  const handleClick = (): void => {
    if (!channelId) return;

    // Get call title from metadata if available
    const callTitle = (metadata?.['callTitle'] as string) || 'Call Transcript';

    // Get attachment IDs from the call message (transcript)
    const attachmentIds = attachments?.map(att => att.id) || [];

    // Create thread info for the call transcript pill
    const threadInfo = {
      conversationId: conversationId || '',
      previewText: callTitle,
      ...(attachmentIds.length > 0 && { attachmentIds }),
    };

    // Open sidebar with thread info
    xyneAIActor.send({
      type: 'OPEN',
      channelId,
      threadInfo,
    });
  };

  return (
    <button
      type='button'
      onClick={handleClick}
      data-track-category='MESSAGE'
      data-track-name='CHAT_WITH_CALL_TRANSCRIPT'
      className='p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-foreground'
      title='Chat with Transcript'
    >
      <img alt='Ask AI' width='16' height='16' src='/svgs/icons/ai-bot-gradient-star.svg' />
    </button>
  );
};

/**
 * CallBubble component displays call-related messages with specialized UI.
 * Handles both active calls and ended calls with transcript generation options.
 * Note: Avatar and header are handled by parent MessageBubble component.
 */
export const CallBubble: React.FC<CallBubbleProps> = ({
  message,
  callId,
  isActiveCall,
  channelId,
  conversationId,
  context,
  attachments,
}) => {
  const metadata = message.metadata;

  // For headless recordings: show only the identified transcript (fall back to plain transcript
  // if identified is absent). For regular calls: hide the identified transcript attachment.
  // An identified attachment only exists when speakers were actually labelled (server
  // voiceprints or the desktop app's on-device diarization), so no feature flag is consulted.
  const isHeadless = (metadata as Record<string, unknown> | null)?.['isHeadlessRecording'] === true;
  const visibleAttachments = attachments?.filter(att => {
    const attMeta = att.metadata as Record<string, unknown> | null;
    const attType = attMeta?.['type'] as string | undefined;
    if (attType === 'whiteboard' && context !== 'thread') return false;

    if (isHeadless) {
      // Prefer identified_transcript; fall back to transcript only when no identified exists
      const hasIdentified = attachments.some(
        a => (a.metadata as Record<string, unknown> | null)?.['type'] === 'identified_transcript',
      );
      return hasIdentified ? attType === 'identified_transcript' : attType === 'transcript';
    }
    // Regular calls: never show the identified transcript attachment
    return attType !== 'identified_transcript';
  });

  // Recording attachments (audio or video) are excluded from inline display.
  // Audio recordings are surfaced via the AudioPlayer action icon instead.
  // Video/screen recordings are linked via a bot message in the thread.
  const isRecording = (a: AttachmentType): boolean =>
    (a.metadata as { type?: string } | null)?.type === 'recording';

  const isRecordingAudio = (a: AttachmentType): boolean =>
    a.mimetype === 'audio/mp4' && isRecording(a);

  const displayAttachments = (visibleAttachments ?? []).filter(a => !isRecording(a));
  const recordingAttachment = attachments?.find(isRecordingAudio);

  return (
    <div className='w-full flex flex-col gap-2'>
      {isActiveCall && channelId ? (
        <CallMessageOverlay callId={callId} channelId={channelId} />
      ) : (
        <>
          {/* AI description shown as message body once generated (callEndedText signals the swap happened) */}
          {metadata?.['callEndedText'] && message.content && (
            <div className='jp-message-html text-sm whitespace-pre-wrap'>{message.content}</div>
          )}

          {/* Detailed summary canvas preview */}
          {metadata?.['detailedSummaryCanvasUrl'] &&
            (() => {
              const url = String(metadata['detailedSummaryCanvasUrl']);
              const canvasId = url.split('/').pop();
              return canvasId ? (
                <div className='mt-1'>
                  <CanvasPreview canvasId={canvasId} />
                </div>
              ) : null;
            })()}

          {/* Attachments — recording audio excluded (shown via AudioPlayer in action icons) */}
          {displayAttachments.length > 0 && (
            <div className='mt-1'>
              <div className='flex flex-col gap-3'>
                {/* Videos first - each in separate row */}
                {displayAttachments
                  .filter(attachment => attachment.mimetype.startsWith('video/'))
                  .map(attachment => (
                    <div key={attachment.id} className='flex items-center gap-2 py-2 text-sm'>
                      <MessageAttachment attachment={attachment} />
                    </div>
                  ))}

                {/* Other attachments in one row */}
                {displayAttachments.filter(attachment => !attachment.mimetype.startsWith('video/'))
                  .length > 0 && (
                  <div className='flex gap-3 flex-wrap'>
                    {displayAttachments
                      .filter(attachment => !attachment.mimetype.startsWith('video/'))
                      .map((attachment, index) => {
                        const isImageOrText =
                          attachment.mimetype.startsWith('image/') ||
                          attachment.mimetype === 'text/plain';

                        // Only pass action icons to the first transcript attachment
                        const isTranscript =
                          attachment.mimetype === 'text/plain' ||
                          attachment.originalFilename.endsWith('.txt');
                        const callActionIcons =
                          !isActiveCall && message.hasAttachment && isTranscript && index === 0 ? (
                            <>
                              <GeneratePRDButton
                                callId={callId}
                                messageId={message.messageId}
                                isCanvasCreated={!!metadata?.prdCanvasUrl}
                              />
                              {ENABLE_SUMMARY_ACTION_BUTTON && (
                                <GenerateSummaryButton
                                  callId={callId}
                                  messageId={message.messageId}
                                  isCanvasCreated={!!metadata?.detailedSummaryCanvasUrl}
                                />
                              )}
                              <ChatWithAskAIButton
                                channelId={channelId}
                                conversationId={conversationId}
                                metadata={metadata}
                                attachments={attachments}
                              />
                              {recordingAttachment && (
                                <AudioPlayer
                                  onLoad={signal =>
                                    recordingService.downloadRecordingBlob(callId, signal)
                                  }
                                  trackCategory='CallBubble'
                                />
                              )}
                            </>
                          ) : undefined;

                        return (
                          <div
                            key={attachment.id}
                            className={`flex items-center gap-2 py-2 text-sm ${
                              !isImageOrText ? 'w-[256px] aspect-square' : ''
                            }`}
                          >
                            <MessageAttachment
                              attachment={attachment}
                              {...(callActionIcons && { extraActions: callActionIcons })}
                            />
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
