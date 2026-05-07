import { ReactElement, useCallback, useEffect, useState } from 'react';
import { ChevronUp, ChevronsDownUp, X } from 'lucide-react';
import { EmailComposer } from './EmailComposer';

interface ComposeEmailModalProps {
  open: boolean;
  channelId: string;
  channelName: string;
  resetKey?: number;
  minimized?: boolean;
  onMinimizedChange?: (next: boolean) => void;
  onClose: () => void;
  /**
   * Unique identifier for this compose instance, used to scope the
   * localStorage draft key. When not provided, the draft is keyed by
   * channelId (legacy single-compose behaviour).
   */
  draftId?: string;
}

const COMPOSE_HEIGHT_KEY = 'support-compose-height-vh';
export const COMPOSE_WINDOW_WIDTH_PX = 560;

const MIN_VH = 35;
const MAX_VH = 95;
const DEFAULT_VH = 40;

const readSavedHeight = (): number => {
  if (typeof window === 'undefined') return DEFAULT_VH;
  const saved = window.localStorage.getItem(COMPOSE_HEIGHT_KEY);
  const parsed = saved ? Number(saved) : NaN;
  return Number.isFinite(parsed) && parsed >= MIN_VH && parsed <= MAX_VH ? parsed : DEFAULT_VH;
};

/**
 * A single compose window rendered as a flex child inside the parent's
 * horizontally-scrollable strip. Positioning (fixed, bottom, right) is
 * owned by the strip container in SupportScreen — this component is purely
 * responsible for its own height and internal layout.
 */
export const ComposeEmailModal = ({
  open,
  channelId,
  channelName,
  resetKey,
  minimized: minimizedProp,
  onMinimizedChange,
  onClose,
  draftId,
}: ComposeEmailModalProps): ReactElement | null => {
  const [internalMinimized, setInternalMinimized] = useState(false);
  const isControlled = typeof minimizedProp === 'boolean';
  const minimized = isControlled ? minimizedProp : internalMinimized;
  const setMinimized = useCallback(
    (next: boolean | ((prev: boolean) => boolean)): void => {
      const value = typeof next === 'function' ? next(minimized) : next;
      if (isControlled) {
        onMinimizedChange?.(value);
      } else {
        setInternalMinimized(value);
      }
    },
    [isControlled, minimized, onMinimizedChange],
  );
  const [heightVh, setHeightVh] = useState<number>(readSavedHeight);

  // Persist height across sessions
  useEffect(() => {
    try {
      localStorage.setItem(COMPOSE_HEIGHT_KEY, String(heightVh));
    } catch {
      /* ignore quota */
    }
  }, [heightVh]);

  useEffect(() => {
    if (!open && !isControlled) setInternalMinimized(false);
  }, [open, isControlled]);

  const startResize = useCallback((startY: number, startVh: number): void => {
    const onMove = (e: MouseEvent): void => {
      const dy = startY - e.clientY; // dragging up = bigger
      const vhDelta = (dy / window.innerHeight) * 100;
      const next = Math.max(MIN_VH, Math.min(MAX_VH, startVh + vhDelta));
      setHeightVh(next);
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  if (!open) return null;

  return (
    <div
      className='flex-shrink-0 pointer-events-auto bg-background border border-border rounded-t-xl shadow-2xl flex flex-col self-end transition-[width] duration-200'
      style={{
        width: minimized ? '260px' : `${COMPOSE_WINDOW_WIDTH_PX}px`,
        ...(minimized ? {} : { height: `${heightVh}vh` }),
      }}
      role='dialog'
      aria-label={`Compose new email — ${channelName}`}
      aria-modal='true'
    >
      {/* Top-edge drag handle — only visible when expanded */}
      {!minimized && (
        <button
          type='button'
          className='group h-2.5 w-full cursor-row-resize flex-shrink-0 flex items-center justify-center hover:bg-primary/10 transition-colors p-0 border-0 bg-transparent'
          onMouseDown={e => {
            e.preventDefault();
            startResize(e.clientY, heightVh);
          }}
          aria-label='Resize compose window'
          title='Drag to resize'
          data-track-category='Support'
          data-track-name='ResizeComposeModal'
        >
          <span className='block h-1 w-12 rounded-full bg-muted-foreground/30 group-hover:bg-muted-foreground/60 transition-colors' />
        </button>
      )}
      {/* Header bar — clicking it expands a minimized modal */}
      <div
        className={`flex items-center justify-between px-4 py-2 bg-muted/40 border-b border-border rounded-t-xl ${minimized ? 'cursor-pointer' : ''}`}
        onClick={() => {
          if (minimized) setMinimized(false);
        }}
        role={minimized ? 'button' : undefined}
        tabIndex={minimized ? 0 : undefined}
        onKeyDown={e => {
          if (!minimized) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setMinimized(false);
          }
        }}
        data-track-category='Support'
        data-track-name='ExpandComposeFromHeader'
      >
        <span className='text-sm font-medium truncate'>New message — {channelName}</span>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              setMinimized(v => !v);
            }}
            className='p-1 hover:bg-accent rounded'
            aria-label={minimized ? 'Expand compose' : 'Minimize compose'}
            title={minimized ? 'Expand' : 'Minimize'}
            data-track-category='Support'
            data-track-name='ToggleComposeMinimizeButton'
          >
            {minimized ? <ChevronUp size={14} /> : <ChevronsDownUp size={14} />}
          </button>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              onClose();
            }}
            className='p-1 hover:bg-accent rounded'
            aria-label='Close compose'
            title='Close'
            data-track-category='Support'
            data-track-name='CloseComposeModal'
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {!minimized && (
        <div className='flex-1 min-h-0 flex flex-col'>
          <EmailComposer
            key={`${resetKey}-${draftId ?? channelId}`}
            mode='compose'
            channelId={channelId}
            onClose={onClose}
            {...(draftId ? { composeDraftId: draftId } : {})}
          />
        </div>
      )}
    </div>
  );
};
