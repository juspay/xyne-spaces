import React, { useState, useRef, useEffect, useMemo } from 'react';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { ExpandableMessageContext } from './ExpandableMessageContext';
import { MaximizeTwoArrow } from '@xyne/icons';

interface ExpandableMessageProps {
  message?: string;
  children?: React.ReactNode;
  showEdited?: boolean;
  maxHeight?: number; // in pixels, default 500
  className?: string;
  fadeColor?: string;
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
  children,
  showEdited = false,
  maxHeight = 500,
  className = '',
  fadeColor = 'hsl(var(--background))',
  isSystemMessage = false,
  messageId,
  conversationId,
  slashCommandArtifactContext,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [shouldShowButton, setShouldShowButton] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Measure only after layout: a sync read here forced a style recalc per mounted message.
  // Re-subscribing on `message` re-measures, since `observe()` delivers an initial entry.
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver((): void => {
      // Add a small buffer to account for rounding errors
      setShouldShowButton(node.scrollHeight > maxHeight + 10);
    });
    observer.observe(node);
    return (): void => observer.disconnect();
  }, [message, maxHeight]);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Blocks inside the message that collapse themselves (long code blocks) report
  // when the user expands them. That already expands the message, so don't clip
  // it or show a second toggle while any of them is open.
  const [expandedChildCount, setExpandedChildCount] = useState(0);
  const childContext = useMemo(
    () => ({
      setChildExpanded: (expanded: boolean) =>
        setExpandedChildCount(count => Math.max(0, count + (expanded ? 1 : -1))),
    }),
    [],
  );
  const hasExpandedChild = expandedChildCount > 0;

  const content = (
    <div className={`expandable-message relative ${className}`}>
      <div
        ref={contentRef}
        className='overflow-hidden'
        style={{
          maxHeight: isExpanded || hasExpandedChild ? 'none' : `${maxHeight}px`,
        }}
      >
        {children !== undefined ? (
          children
        ) : (
          <div className='jp-message-html whitespace-pre-wrap break-all-words'>
            <RenderMessageWithHTML
              message={message ?? ''}
              showEdited={showEdited}
              isSystemMessage={isSystemMessage}
              {...(messageId !== undefined && { messageId })}
              {...(conversationId !== undefined && { conversationId })}
              {...(slashCommandArtifactContext !== undefined && { slashCommandArtifactContext })}
            />
          </div>
        )}
      </div>

      {shouldShowButton && !hasExpandedChild && (
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
                  backgroundImage: `linear-gradient(to bottom, transparent, ${fadeColor})`,
                }
          }
        >
          <button
            type='button'
            onClick={toggleExpanded}
            className='expand-toggle-pill pointer-events-auto flex items-center gap-1 rounded-full bg-background px-2.5 py-1.5 text-[13px] leading-none text-foreground transition-colors hover:bg-muted cursor-pointer'
            data-track-category='ChatMessage'
            data-track-name='TOGGLE_EXPAND_MESSAGE'
            data-track-metadata={JSON.stringify({ isExpanded, message: message?.length ?? 0 })}
          >
            <MaximizeTwoArrow size={16} className={isExpanded ? 'rotate-180' : undefined} />
            <span>{isExpanded ? 'Show less' : 'Show more'}</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <ExpandableMessageContext.Provider value={childContext}>
      {content}
    </ExpandableMessageContext.Provider>
  );
};
