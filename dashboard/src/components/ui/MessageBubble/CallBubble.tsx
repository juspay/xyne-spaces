import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { downloadAttachment } from '../../Chat/MessageAttachment/utils';
import { CallMessageOverlay } from '../../Chat/CallMessageOverlay/CallMessageOverlay';
import { useGeneratePRD } from '../../../hooks/useGeneratePRD';
import { useGenerateDetailedSummary } from '../../../hooks/useGenerateDetailedSummary';
import { MessageMetadata } from './MessageBubble.utils';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';

type AttachmentType = QueryResultType<
  typeof queries.conversationMessages
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
  showAvatar?: boolean;
  context?: 'channel' | 'thread';
  attachments?: readonly AttachmentType[];
}

/**
 * Button component for generating PRD from call transcript
 */
const GeneratePRDButton: React.FC<{ callId: string; messageId: string }> = ({
  callId,
  messageId,
}) => {
  const { generatePRD, isLoading } = useGeneratePRD();

  const handleClick = (): void => {
    void generatePRD(callId, messageId);
  };

  return (
    <button
      type='button'
      onClick={handleClick}
      disabled={isLoading}
      className='inline-flex items-center gap-1.5 text-sm font-medium hover:underline transition-all disabled:opacity-50 disabled:cursor-not-allowed'
      style={{ color: '#0077FF' }}
    >
      {isLoading ? (
        <>
          <Loader2 className='w-4 h-4 animate-spin' />
          <span>Generating...</span>
        </>
      ) : (
        <>
          <span>Generate PRD</span>
        </>
      )}
    </button>
  );
};

/**
 * Button component for opening existing PRD canvas
 */
const OpenPRDButton: React.FC<{ canvasUrl: string }> = ({ canvasUrl }) => {
  const navigate = useNavigate();

  const handleClick = (): void => {
    // Extract canvas ID from URL: https://spaces.xyne.juspay.net/chat/canvas/{id}
    const canvasId = canvasUrl.split('/').pop();
    if (canvasId) {
      void navigate(`/chat/canvas/${canvasId}`);
    }
  };

  return (
    <button
      type='button'
      onClick={handleClick}
      className='inline-flex items-center gap-1.5 text-sm font-medium hover:underline transition-all'
      style={{ color: '#0077FF' }}
    >
      <span>Open PRD</span>
    </button>
  );
};

/**
 * Button component for generating detailed summary from call transcript
 */
const GenerateDetailedSummaryButton: React.FC<{ callId: string; messageId: string }> = ({
  callId,
  messageId,
}) => {
  const { generateDetailedSummary, isLoading } = useGenerateDetailedSummary();

  const handleClick = (): void => {
    void generateDetailedSummary(callId, messageId);
  };

  return (
    <button
      type='button'
      onClick={handleClick}
      disabled={isLoading}
      className='inline-flex items-center gap-1.5 text-sm font-medium hover:underline transition-all disabled:opacity-50 disabled:cursor-not-allowed'
      style={{ color: '#0077FF' }}
    >
      {isLoading ? (
        <>
          <Loader2 className='w-4 h-4 animate-spin' />
          <span>Generating...</span>
        </>
      ) : (
        <>
          <span>Create Detailed Summary</span>
        </>
      )}
    </button>
  );
};

/**
 * Button component for opening existing detailed summary canvas
 */
const OpenDetailedSummaryButton: React.FC<{ canvasUrl: string }> = ({ canvasUrl }) => {
  const navigate = useNavigate();

  const handleClick = (): void => {
    const canvasId = canvasUrl.split('/').pop();
    if (canvasId) {
      void navigate(`/chat/canvas/${canvasId}`);
    }
  };

  return (
    <button
      type='button'
      onClick={handleClick}
      className='inline-flex items-center gap-1.5 text-sm font-medium hover:underline transition-all'
      style={{ color: '#0077FF' }}
    >
      <span>Open Detailed Summary</span>
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
  showAvatar: _showAvatar = true,
  context: _context,
  attachments = [],
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
            <div className='text-sm text-gray-600 visual-regression-hide'>{message.content}</div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div>
              <div className='flex items-center gap-3 text-xs font-medium'>
                <div className='flex items-center gap-1'>
                  <span className='text-gray-500'>
                    {attachments.length > 1
                      ? `${attachments.length} files`
                      : attachments[0]?.originalFilename}
                  </span>
                  <button type='button' onClick={() => setIsExpanded(!isExpanded)}>
                    {isExpanded ? (
                      <ChevronDown className='w-4 h-4 text-gray-500' />
                    ) : (
                      <ChevronRight className='w-4 h-4 text-gray-500' />
                    )}
                  </button>
                </div>

                {attachments.length > 1 && (
                  <>
                    <span className='text-gray-400'>|</span>
                    <button
                      type='button'
                      onClick={() => {
                        attachments.forEach(attachment => {
                          void downloadAttachment(attachment.id, attachment.originalFilename);
                        });
                      }}
                      className='flex items-center gap-2 text-gray-600 hover:text-gray-900'
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

          {/* Generate PRD and Detailed Summary buttons for ended calls with transcript */}
          {!isActiveCall && message.hasAttachment && (
            <div className='flex flex-wrap items-center gap-2 mt-2'>
              {/* PRD Button */}
              {metadata?.prdCanvasUrl ? (
                <OpenPRDButton canvasUrl={metadata.prdCanvasUrl} />
              ) : (
                <GeneratePRDButton callId={callId} messageId={message.messageId} />
              )}

              {/* Separator */}
              <span className='text-gray-400'>•</span>

              {/* Detailed Summary Button */}
              {metadata?.detailedSummaryCanvasUrl ? (
                <OpenDetailedSummaryButton canvasUrl={metadata.detailedSummaryCanvasUrl} />
              ) : (
                <GenerateDetailedSummaryButton callId={callId} messageId={message.messageId} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
