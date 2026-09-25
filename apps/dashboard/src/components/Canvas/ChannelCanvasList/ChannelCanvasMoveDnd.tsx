import React, { useRef } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import type { Canvas } from '../Canvas.types';

const channelCanvasCollisionDetection: CollisionDetection = args => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

interface ChannelCanvasMoveDndProviderProps {
  children: React.ReactNode;
  onMoveCanvas?: ((canvas: Canvas, folderId: string | null) => Promise<void>) | undefined;
}

export const ChannelCanvasMoveDndProvider: React.FC<ChannelCanvasMoveDndProviderProps> = ({
  children,
  onMoveCanvas,
}) => {
  const isMovingRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    if (!event.over || !onMoveCanvas || isMovingRef.current) return;

    const canvas = event.active.data.current?.['canvas'] as Canvas | undefined;
    const targetFolderId = event.over.data.current?.['folderId'] as string | null | undefined;
    if (!canvas || targetFolderId === undefined || (canvas.folderId ?? null) === targetFolderId) {
      return;
    }

    isMovingRef.current = true;
    void onMoveCanvas(canvas, targetFolderId).finally(() => {
      isMovingRef.current = false;
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={channelCanvasCollisionDetection}
      onDragEnd={handleDragEnd}
    >
      {children}
    </DndContext>
  );
};

interface ChannelCanvasDropTargetProps {
  id: string;
  folderId: string | null;
  disabled?: boolean;
  children: (isOver: boolean) => React.ReactNode;
}

export const ChannelCanvasDropTarget: React.FC<ChannelCanvasDropTargetProps> = ({
  id,
  folderId,
  disabled = false,
  children,
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: { folderId },
    disabled,
  });

  return <div ref={setNodeRef}>{children(isOver)}</div>;
};

interface DraggableChannelCanvasProps {
  canvas: Canvas;
  disabled?: boolean;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}

export const DraggableChannelCanvas: React.FC<DraggableChannelCanvasProps> = ({
  canvas,
  disabled = false,
  children,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `channel-canvas:${canvas.id}`,
    data: { canvas },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(isDragging && 'relative z-50 opacity-70')}
    >
      {children(
        disabled ? null : (
          <button
            type='button'
            className='flex shrink-0 cursor-grab items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing sm:hidden sm:group-hover:flex'
            aria-label={`Move ${canvas.title || 'Untitled canvas'}`}
            title='Drag to move canvas'
            onClick={event => event.stopPropagation()}
            data-track-category='CANVAS'
            data-track-name='DRAG_CHANNEL_CANVAS'
            {...attributes}
            {...listeners}
          >
            <GripVertical className='size-4' />
          </button>
        ),
      )}
    </div>
  );
};
