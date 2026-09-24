import { useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, type PanInfo } from 'framer-motion';
import { cn } from '../../../utils/classNames';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';

type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

const CORNER_CLASSES: Record<Corner, string> = {
  topLeft: 'left-6 top-6 sm:left-8 sm:top-8',
  topRight: 'right-6 top-6 sm:right-8 sm:top-8',
  bottomLeft: 'bottom-6 left-6 sm:bottom-8 sm:left-8',
  bottomRight: 'bottom-6 right-6 sm:bottom-8 sm:right-8',
};

const STORAGE_KEY = 'call.selfViewCorner';

function readSavedCorner(): Corner {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in CORNER_CLASSES) return saved as Corner;
  } catch {
    // Storage can be blocked (private window, site data off) — fall back to the default.
  }
  return 'bottomRight';
}

function saveCorner(corner: Corner): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, corner);
  } catch {
    // Non-essential convenience; ignore.
  }
}

interface FloatingSelfViewProps {
  participant: ParticipantInfo;
  /** The stage the tile may be dragged within. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  aiController: { id: string; name: string } | null;
  requestedAiController: boolean;
  isHandRaised: boolean;
  onToggleHandRaise?: (() => void) | undefined;
  onPin: () => void;
}

/**
 * Your own camera as a picture-in-picture in 1:1 calls. Drag it anywhere on the
 * stage; on release it snaps to the nearest corner (Meet's behaviour), and the
 * corner is remembered for next time on this device.
 */
export function FloatingSelfView({
  participant,
  containerRef,
  aiController,
  requestedAiController,
  isHandRaised,
  onToggleHandRaise,
  onPin,
}: FloatingSelfViewProps): React.ReactElement {
  const [corner, setCorner] = useState<Corner>(readSavedCorner);
  const tileRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Once the corner class has moved the box to where the tile already sits
  // visually, drop the drag offset — before paint, so there's no one-frame jump.
  const isSettlingRef = useRef(false);
  useLayoutEffect(() => {
    if (!isSettlingRef.current) return;
    isSettlingRef.current = false;
    x.set(0);
    y.set(0);
  }, [corner, x, y]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo): void => {
    const tile = tileRef.current;
    const stage = containerRef.current;
    if (!tile || !stage) return;

    const stageRect = stage.getBoundingClientRect();
    const isLeft = info.point.x < stageRect.left + stageRect.width / 2;
    const isTop = info.point.y < stageRect.top + stageRect.height / 2;
    const next: Corner = isTop
      ? isLeft
        ? 'topLeft'
        : 'topRight'
      : isLeft
        ? 'bottomLeft'
        : 'bottomRight';

    // Resting box (offsets ignore the drag transform) and the corner inset it uses.
    const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = tile;
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const isCurrentLeft = corner === 'topLeft' || corner === 'bottomLeft';
    const isCurrentTop = corner === 'topLeft' || corner === 'topRight';
    const insetX = isCurrentLeft ? offsetLeft : stageWidth - offsetLeft - offsetWidth;
    const insetY = isCurrentTop ? offsetTop : stageHeight - offsetTop - offsetHeight;
    const targetLeft = isLeft ? insetX : stageWidth - insetX - offsetWidth;
    const targetTop = isTop ? insetY : stageHeight - insetY - offsetHeight;

    // Glide there with the drag offset, then hand over to the corner class.
    // Deferred a frame so it supersedes framer's own post-drag constraint
    // animation, which would otherwise re-apply the offset after the corner moves.
    requestAnimationFrame(() => {
      const spring = { type: 'spring', stiffness: 500, damping: 40 } as const;
      void Promise.all([
        animate(x, targetLeft - offsetLeft, spring),
        animate(y, targetTop - offsetTop, spring),
      ]).then(() => {
        if (next === corner) {
          x.set(0);
          y.set(0);
          return;
        }
        isSettlingRef.current = true;
        setCorner(next);
        saveCorner(next);
      });
    });
  };

  return (
    <motion.div
      ref={tileRef}
      drag
      dragConstraints={containerRef}
      dragElastic={0}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      style={{ x, y }}
      whileDrag={{ scale: 1.03 }}
      className={cn(
        'absolute z-20 aspect-video w-[34%] min-w-[150px] max-w-[300px] touch-none',
        'cursor-grab rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] active:cursor-grabbing',
        CORNER_CLASSES[corner],
      )}
      data-testid='floating-self-view'
      data-track-category='CALLS'
      data-track-name='Drag_Self_View'
    >
      <ParticipantTile
        participant={participant}
        avatarSize='medium'
        className='h-full w-full'
        aiController={aiController}
        requestedAiController={requestedAiController}
        isHandRaised={isHandRaised}
        onToggleHandRaise={onToggleHandRaise}
        onExpand={onPin}
      />
    </motion.div>
  );
}
