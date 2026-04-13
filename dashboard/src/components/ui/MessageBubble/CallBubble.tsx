import React, { useState } from 'react';
import { CreateDocumentModal } from './CreateDocumentModal';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { downloadAttachment } from '../../Chat/MessageAttachment/utils';
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
        disabled={isLoading}
        className='inline-flex items-center gap-1.5 text-sm font-medium hover:underline transition-all disabled:opacity-50 disabled:cursor-not-allowed'
        style={{ color: 'var(--call-action-button-color, #0077FF)' }}
      >
        {isLoading ? (
          <>
            <Loader2 className='w-4 h-4 animate-spin' />
            <span>Generating...</span>
          </>
        ) : (
          <span>{isCanvasCreated ? 'Generate Another PRD' : 'Generate PRD'}</span>
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
        disabled={isLoading}
        className='inline-flex items-center gap-1.5 text-sm font-medium hover:underline transition-all disabled:opacity-50 disabled:cursor-not-allowed'
        style={{ color: 'var(--call-action-button-color, #0077FF)' }}
      >
        {isLoading ? (
          <>
            <Loader2 className='w-4 h-4 animate-spin' />
            <span>Generating...</span>
          </>
        ) : (
          <span>{isCanvasCreated ? 'Generate Another Summary' : 'Generate Summary'}</span>
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
      className='inline-flex items-center gap-1.5 text-sm font-medium hover:underline transition-all'
      style={{ color: 'var(--call-action-button-color, #0077FF)' }}
    >
      <span>Chat with Transcript</span>
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
  attachments,
}) => {
  const metadata = message.metadata;
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className='w-full flex flex-col gap-1'>
      {isActiveCall && channelId ? (
        <CallMessageOverlay callId={callId} channelId={channelId} />
      ) : (
        <>
          {/* Call ended message content */}
          {message.content && (
            <div className='text-sm text-muted-foreground visual-regression-hide'>
              {message.content}
            </div>
          )}

          {/* Attachments */}
          {attachments && attachments.length > 0 && (
            <div>
              <div className='flex items-center gap-3 text-xs font-medium'>
                <div className='flex items-center gap-1'>
                  <span className='text-muted-foreground'>
                    {attachments.length > 1
                      ? `${attachments.length} files`
                      : attachments[0]?.originalFilename}
                  </span>
                  <button type='button' onClick={() => setIsExpanded(!isExpanded)}>
                    {isExpanded ? (
                      <ChevronDown className='w-4 h-4 text-muted-foreground' />
                    ) : (
                      <ChevronRight className='w-4 h-4 text-muted-foreground' />
                    )}
                  </button>
                </div>

                {attachments.length > 1 && (
                  <>
                    <span className='text-muted-foreground'>|</span>
                    <button
                      type='button'
                      onClick={() => {
                        attachments.forEach(attachment => {
                          void downloadAttachment(attachment.id, attachment.originalFilename);
                        });
                      }}
                      className='flex items-center gap-2 text-muted-foreground hover:text-foreground'
                    >
                      <span>Download all</span>
                    </button>
                  </>
                )}
              </div>
              {isExpanded && (
                <div className='flex flex-col gap-3'>
                  {/* Videos first - each in separate row */}
                  {attachments
                    .filter(attachment => attachment.mimetype.startsWith('video/'))
                    .map(attachment => (
                      <div key={attachment.id} className='flex items-center gap-2 py-2 text-sm'>
                        <MessageAttachment attachment={attachment} />
                      </div>
                    ))}

                  {/* Other attachments in one row */}
                  {attachments.filter(attachment => !attachment.mimetype.startsWith('video/'))
                    .length > 0 && (
                    <div className='flex gap-3 flex-wrap'>
                      {attachments
                        .filter(attachment => !attachment.mimetype.startsWith('video/'))
                        .map(attachment => {
                          const isImageOrText =
                            attachment.mimetype.startsWith('image/') ||
                            attachment.mimetype === 'text/plain';

                          return (
                            <div
                              key={attachment.id}
                              className={`flex items-center gap-2 py-2 text-sm ${
                                !isImageOrText ? 'w-[256px] aspect-square' : ''
                              }`}
                            >
                              <MessageAttachment attachment={attachment} />
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Action buttons for ended calls with transcript */}
          {!isActiveCall && message.hasAttachment && (
            <div className='flex flex-wrap items-center gap-2 mt-2'>
              {/* Generate PRD Button — always visible */}
              <GeneratePRDButton
                callId={callId}
                messageId={message.messageId}
                isCanvasCreated={!!metadata?.prdCanvasUrl}
              />

              {/* Generate Summary Button — only shown when VITE_ENABLE_SUMMARY_ACTION_BUTTON=true */}
              {ENABLE_SUMMARY_ACTION_BUTTON && (
                <>
                  <span className='text-muted-foreground'>•</span>
                  <GenerateSummaryButton
                    callId={callId}
                    messageId={message.messageId}
                    isCanvasCreated={!!metadata?.detailedSummaryCanvasUrl}
                  />
                </>
              )}

              {/* Separator */}
              <span className='text-muted-foreground'>•</span>

              {/* Chat with Transcript Button — always visible */}
              <ChatWithAskAIButton
                channelId={channelId}
                conversationId={conversationId}
                metadata={metadata}
                attachments={attachments}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};
