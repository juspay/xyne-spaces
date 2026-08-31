import { useRef, useState, useEffect, useCallback } from 'react';
import { usePlatform } from './usePlatform';

// Interface for the InputBox imperative API
export interface InputBoxHandle {
  addFiles: (files: File[]) => void;
  clearContent: () => void;
  clearTextOnly: () => void;
  insertContent: (content: string) => void;
  isSuggestionOpen: () => boolean;
  focus: () => void;
  getHtml?: () => string;
  getUserTags?: () => Record<string, { name: string; userId: string }>;
}

interface UseDragAndDropAreaRefReturn {
  dragAndDropAreaRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<InputBoxHandle | null>;
  isDragging: boolean;
}

/**
 * Hook for drag and drop file attachment functionality
 *
 * Usage:
 * const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(channelId);
 *
 * <div ref={dragAndDropAreaRef}>
 *   {isDragging && <DragAndDropOverlay />}
 *   <ChatInput ref={inputRef} />
 * </div>
 */
export const useDragAndDropAreaRef = (resetKey?: string): UseDragAndDropAreaRefReturn => {
  const dragAndDropAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputBoxHandle>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const { isMobile } = usePlatform();

  /**
   * Check if the drag event contains files
   */
  const hasFiles = useCallback((event: DragEvent): boolean => {
    if (!event.dataTransfer) return false;

    // Check if any of the dragged items are files
    const types = event.dataTransfer.types;
    return types.includes('Files');
  }, []);

  /**
   * Handle drag enter - start tracking drag state
   */
  const handleDragEnter = useCallback(
    (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      // Only process if dragging files
      if (!hasFiles(event)) return;

      dragCounter.current++;

      // Set dragging state on first enter
      if (dragCounter.current === 1) {
        setIsDragging(true);
      }
    },
    [hasFiles],
  );

  /**
   * Handle drag over - required to allow drop
   */
  const handleDragOver = useCallback(
    (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      // Only process if dragging files
      if (!hasFiles(event)) return;

      // Set the drop effect to copy
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    },
    [hasFiles],
  );

  /**
   * Handle drag leave - stop tracking when leaving the area
   */
  const handleDragLeave = useCallback(
    (event: DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      // Only process if dragging files
      if (!hasFiles(event)) return;

      dragCounter.current--;

      // Only set dragging to false when completely leaving the area
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    },
    [hasFiles],
  );

  /**
   * Handle file drop - extract files and attach to input
   */
  const handleDrop = useCallback((event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();

    // Reset drag state
    dragCounter.current = 0;
    setIsDragging(false);

    // Extract files from the drop event
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Convert FileList to File array
    const fileArray = Array.from(files);

    // Filter out any non-file items and validate
    const validFiles = fileArray.filter(file => file instanceof File);

    if (validFiles.length > 0) {
      // Attach files to the input via the ref
      inputRef.current?.addFiles(validFiles);
    }
  }, []);

  /**
   * Set up event listeners on the drag area
   * Handlers are wrapped in useCallback to ensure stable references
   */
  useEffect(() => {
    const element = dragAndDropAreaRef.current;
    if (!element) return;

    // Disable drag and drop on mobile devices
    if (isMobile) {
      return;
    }

    // Reset state when resetKey changes (channel switch)
    dragCounter.current = 0;
    setIsDragging(false);

    // Add event listeners
    element.addEventListener('dragenter', handleDragEnter);
    element.addEventListener('dragover', handleDragOver);
    element.addEventListener('dragleave', handleDragLeave);
    element.addEventListener('drop', handleDrop);

    // Cleanup function
    return (): void => {
      // Reset state on cleanup
      dragCounter.current = 0;
      setIsDragging(false);

      element.removeEventListener('dragenter', handleDragEnter);
      element.removeEventListener('dragover', handleDragOver);
      element.removeEventListener('dragleave', handleDragLeave);
      element.removeEventListener('drop', handleDrop);
    };
  }, [resetKey, handleDragEnter, handleDragOver, handleDragLeave, handleDrop, isMobile]);

  return {
    dragAndDropAreaRef,
    inputRef,
    isDragging,
  };
};
