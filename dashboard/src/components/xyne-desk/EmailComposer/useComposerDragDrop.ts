import { useRef, useState } from 'react';

interface DragDropHandlers {
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}

interface UseComposerDragDropReturn {
  isDraggingFiles: boolean;
  dragHandlers: DragDropHandlers;
}

/**
 * Composer-level drag-and-drop. Filters non-file drags (text/HTML drags
 * from inside the editor pass through), uses a depth counter so flickers
 * across nested children don't toggle the overlay, and routes dropped
 * files through `onAddFiles`.
 */
export const useComposerDragDrop = (
  onAddFiles: (files: File[]) => void,
): UseComposerDragDropReturn => {
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);
  const dragDepthRef = useRef<number>(0);

  const isFileDrag = (e: React.DragEvent<HTMLDivElement>): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onAddFiles(files);
  };

  return {
    isDraggingFiles,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
};
