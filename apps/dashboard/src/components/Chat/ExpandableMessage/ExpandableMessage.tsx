import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import useMeasure from '../../../hooks/useMeasure';

interface ExpandableMessageProps {
  message: string;
  showEdited?: boolean;
  maxHeight?: number; // in pixels, default 500
  className?: string;
  isSystemMessage?: boolean;
  messageId?: string;
  conversationId?: string;
}

export const ExpandableMessage: React.FC<ExpandableMessageProps> = ({
  message,
  showEdited = false,
  maxHeight = 500,
  className = '',
  isSystemMessage = false,
  messageId,
  conversationId,
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
    <div className={`expandable-message ${className}`}>
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
          />
        </div>
      </div>

      {shouldShowButton && (
        <button
          type='button'
          onClick={toggleExpanded}
          className='flex items-center gap-1 mt-1 text-sm text-primary hover:text-primary/80 font-medium cursor-pointer bg-none border-none p-0 transition-colors duration-150'
          data-track-category='ChatMessage'
          data-track-name='TOGGLE_EXPAND_MESSAGE'
          data-track-metadata={JSON.stringify({ isExpanded, message: message.length })}
        >
          <span>{isExpanded ? 'View Less' : 'View More'}</span>
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      )}
    </div>
  );
};
