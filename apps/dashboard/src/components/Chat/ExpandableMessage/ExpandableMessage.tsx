import React, { useState, useRef, useEffect } from 'react';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { MaximizeTwoArrow } from '@xyne/icons';
import useMeasure from '../../../hooks/useMeasure';

interface ExpandableMessageProps {
  message: string;
  showEdited?: boolean;
  maxHeight?: number; // in pixels, default 500
  className?: string;
  isSystemMessage?: boolean;
  messageId?: string;
  conversationId?: string;
  slashCommandArtifactContext?: {
    channelId?: string;
    senderId?: string;
    createdAt?: number;
    surface?: 'channel' | 'thread';
  };
}

export const ExpandableMessage: React.FC<ExpandableMessageProps> = ({
  message,
  showEdited = false,
  maxHeight = 500,
  className = '',
  isSystemMessage = false,
  messageId,
  conversationId,
  slashCommandArtifactContext,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [shouldShowButton, setShouldShowButton] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Use ResizeObserver via useMeasure hook for reliable size detection
  const { height: contentHeight } = useMeasure({ ref: contentRef, observeResize: true });

  useEffect(() => {
    if (contentRef.current) {
      const fullHeight = contentRef.current.scrollHeight;
      // Add a small buffer to account for rounding errors
      setShouldShowButton(fullHeight > maxHeight + 10);
    }
  }, [contentHeight, message, maxHeight]);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={`expandable-message relative ${className}`}>
      <div
        ref={contentRef}
        className='transition-all duration-300 ease-in-out overflow-hidden'
        style={{
          maxHeight: isExpanded ? 'none' : `${maxHeight}px`,
        }}
      >
        <div className='jp-message-html whitespace-pre-wrap break-all-words'>
          <RenderMessageWithHTML
            message={message}
            showEdited={showEdited}
            isSystemMessage={isSystemMessage}
            {...(messageId !== undefined && { messageId })}
            {...(conversationId !== undefined && { conversationId })}
            {...(slashCommandArtifactContext !== undefined && { slashCommandArtifactContext })}
          />
        </div>
      </div>

      {shouldShowButton && (
        <div
          className={
            isExpanded
              ? 'flex justify-center pt-2'
              : 'pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pt-8 pb-3'
          }
          style={
            isExpanded
              ? undefined
              : {
                  backgroundImage:
                    'linear-gradient(to bottom, transparent, hsl(var(--background)))',
                }
          }
        >
          <button
            type='button'
            onClick={toggleExpanded}
            className='expand-toggle-pill pointer-events-auto flex items-center gap-1 rounded-full bg-background px-2.5 py-1.5 text-[13px] leading-none text-foreground transition-colors hover:bg-muted cursor-pointer'
            data-track-category='ChatMessage'
            data-track-name='TOGGLE_EXPAND_MESSAGE'
            data-track-metadata={JSON.stringify({ isExpanded, message: message.length })}
          >
            <MaximizeTwoArrow size={16} className={isExpanded ? 'rotate-180' : undefined} />
            <span>{isExpanded ? 'Show less' : 'Show more'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
