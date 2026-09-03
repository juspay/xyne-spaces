import { logger, Event as LogEvent } from '../../../utils/logger';
import { ReactElement, useState, useEffect, useCallback, useRef } from 'react';
import { xyneAIActor, type SelectionInfo } from '../../../machines/xyneAIMachine';

interface SelectionAskAIProps {
  canvasTitle?: string;
  canvasId?: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface SelectionPosition {
  top: number;
  left: number;
  show: boolean;
}

export const SelectionAskAI = ({
  canvasTitle,
  canvasId,
  containerRef,
}: SelectionAskAIProps): ReactElement | null => {
  const [selectionPosition, setSelectionPosition] = useState<SelectionPosition>({
    top: 0,
    left: 0,
    show: false,
  });
  const [selectedText, setSelectedText] = useState<string>('');
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSelectionChange = useCallback(() => {
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      // Add a small delay before hiding to allow clicking the button
      hideTimeoutRef.current = setTimeout(() => {
        setSelectionPosition(prev => ({ ...prev, show: false }));
        setSelectedText('');
      }, 200);
      return;
    }

    // Check if selection is within the container
    const container = containerRef.current;
    if (container) {
      // Guard against empty selection ranges
      if (selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      const containerRect = container.getBoundingClientRect();
      const selectionRect = range.getBoundingClientRect();

      // Check if selection is within the container bounds
      if (
        selectionRect.top < containerRect.top ||
        selectionRect.bottom > containerRect.bottom ||
        selectionRect.left < containerRect.left ||
        selectionRect.right > containerRect.right
      ) {
        setSelectionPosition(prev => ({ ...prev, show: false }));
        setSelectedText('');
        return;
      }

      const text = selection.toString().trim();

      // Only show if there's meaningful selected text (at least 3 characters)
      if (text.length < 3) {
        setSelectionPosition(prev => ({ ...prev, show: false }));
        setSelectedText('');
        return;
      }

      // Position the button at bottom-right of selection
      // Using fixed positioning relative to viewport
      setSelectionPosition({
        top: selectionRect.bottom + 8, // 8px below selection
        left: selectionRect.right - 100, // Align to right edge of selection (button is ~100px wide)
        show: true,
      });
      setSelectedText(text);
    }
  }, [containerRef]);

  const handleAskAI = useCallback(() => {
    if (!selectedText) return;

    // CRITICAL: canvasId is required for proper hierarchy in canvasContexts
    // Without it, selections cannot be properly associated with a canvas
    if (!canvasId) {
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('[SelectionAskAI] Cannot create selection without canvasId'),
      });
      return;
    }

    // Create preview (first 50 chars)
    const preview = selectedText.length > 50 ? `${selectedText.substring(0, 50)}...` : selectedText;

    // Create selection info for pill display
    const selectionInfo: SelectionInfo = {
      text: selectedText,
      preview,
      canvasId,
      ...(canvasTitle && { canvasTitle }),
    };

    // Open XyneAI with canvas context and selection info
    xyneAIActor.send({
      type: 'OPEN',
      canvasInfo: {
        canvasId,
        ...(canvasTitle ? { title: canvasTitle } : {}),
      },
      selectionInfo,
    });

    // Clear browser selection to avoid confusion
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    // Hide the button after clicking
    setSelectionPosition(prev => ({ ...prev, show: false }));
    setSelectedText('');
  }, [selectedText, canvasId, canvasTitle]);

  useEffect(() => {
    // Listen for selection changes
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [handleSelectionChange]);

  // Don't render if not visible
  if (!selectionPosition.show || !selectedText) {
    return null;
  }

  return (
    <div
      className='fixed z-50 animate-in fade-in-0 zoom-in-95 duration-150'
      style={{
        top: selectionPosition.top,
        left: selectionPosition.left,
      }}
    >
      <button
        onClick={handleAskAI}
        className='flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg shadow-lg hover:bg-accent transition-colors text-sm font-medium text-foreground'
        onMouseDown={e => {
          // Prevent the button click from clearing the selection
          e.preventDefault();
        }}
        data-track-category='CANVAS'
        data-track-name='Selection_Ask_AI'
        data-track-metadata={JSON.stringify({
          canvasId,
          textLength: selectedText.length,
        })}
      >
        <img alt='AI' width='14' height='14' src='/svgs/icons/ai-bot-gradient-star.svg' />
        <span>Ask AI</span>
      </button>
    </div>
  );
};
