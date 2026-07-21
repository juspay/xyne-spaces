import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { getOzonetelConfig } from '../../../services/clients/telephonyApi';
import Tooltip from '../../ui/Tooltip';

/**
 * Embeds Ozonetel's hosted CloudAgent toolbar as a header-triggered iframe.
 * The toolbar handles live call control (answer/hold/transfer/dialpad) and the
 * agent must be logged into it for outbound click-to-call to bridge their leg.
 * Renders nothing if the workspace has no toolbar URL configured.
 */
interface CloudAgentDockProps {
  mode?: 'button' | 'inline';
  onClose?: () => void;
  buttonBehavior?: 'popover' | 'floating';
}

const FLOATING_WIDTH_PX = 360;
const FLOATING_HEIGHT_PX = 560;
const FLOATING_POSITION_KEY = 'support-ozonetel-floating-position';

let closeActiveFloatingPanel: (() => void) | null = null;

type FloatingDockState = {
  isOpen: boolean;
  url: string | null;
  onClose?: () => void;
};

let floatingDockState: FloatingDockState = {
  isOpen: false,
  url: null,
};

const floatingDockListeners = new Set<() => void>();

function emitFloatingDockChange(): void {
  for (const listener of floatingDockListeners) {
    listener();
  }
}

function subscribeToFloatingDock(listener: () => void): () => void {
  floatingDockListeners.add(listener);
  return () => {
    floatingDockListeners.delete(listener);
  };
}

function getFloatingDockSnapshot(): FloatingDockState {
  return floatingDockState;
}

function setFloatingDockState(next: FloatingDockState): void {
  if (
    floatingDockState.isOpen === next.isOpen &&
    floatingDockState.url === next.url &&
    floatingDockState.onClose === next.onClose
  ) {
    return;
  }
  floatingDockState = next;
  emitFloatingDockChange();
}

function openFloatingDock(url: string, onClose?: () => void): void {
  setFloatingDockState({
    isOpen: true,
    url,
    ...(onClose ? { onClose } : {}),
  });
}

function closeFloatingDock(): void {
  setFloatingDockState({ isOpen: false, url: null });
}

function getDefaultFloatingPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  return {
    x: Math.max(12, window.innerWidth - FLOATING_WIDTH_PX - 24),
    y: Math.max(12, window.innerHeight - FLOATING_HEIGHT_PX - 24),
  };
}

function clampFloatingPosition(position: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === 'undefined') return position;
  return {
    x: Math.max(12, Math.min(window.innerWidth - FLOATING_WIDTH_PX - 12, position.x)),
    y: Math.max(12, Math.min(window.innerHeight - FLOATING_HEIGHT_PX - 12, position.y)),
  };
}

function readSavedFloatingPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') return getDefaultFloatingPosition();
  try {
    const raw = window.localStorage.getItem(FLOATING_POSITION_KEY);
    if (!raw) return getDefaultFloatingPosition();
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return clampFloatingPosition({ x: parsed.x, y: parsed.y });
    }
  } catch {
    /* ignore parse errors */
  }
  return getDefaultFloatingPosition();
}

function persistFloatingPosition(position: { x: number; y: number }): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FLOATING_POSITION_KEY, JSON.stringify(position));
  } catch {
    /* ignore quota errors */
  }
}

function ToolbarButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <Tooltip side='bottom' delayDuration={300} content='Open Ozonetel toolbar'>
      <button
        type='button'
        className='relative flex items-center gap-2 rounded-full border border-emerald-200 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 px-3 py-1.5 text-white shadow-md shadow-emerald-500/20 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-400/50'
        aria-label='Open Ozonetel toolbar'
        data-track-category='Support'
        data-track-name='OpenOzonetelToolbar'
        onClick={onClick}
      >
        <span className='absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5'>
          <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-200 opacity-75' />
          <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-white' />
        </span>
        <Phone size={16} className='shrink-0' />
        <span className='text-xs font-semibold tracking-wide'>Ozonetel</span>
      </button>
    </Tooltip>
  );
}

function FloatingCloudAgentPanel({
  url,
  onClose,
  onRequestClose,
}: {
  url: string;
  onClose?: () => void;
  onRequestClose: () => void;
}): ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState(readSavedFloatingPosition);
  const positionRef = useRef(position);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  const close = useCallback(() => {
    onRequestClose();
    onClose?.();
  }, [onClose, onRequestClose]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    closeActiveFloatingPanel?.();
    closeActiveFloatingPanel = close;
    return () => {
      cleanupDragRef.current?.();
      if (closeActiveFloatingPanel === close) {
        closeActiveFloatingPanel = null;
      }
    };
  }, [close]);

  const startDragging = (event: ReactMouseEvent<HTMLElement>): void => {
    event.preventDefault();
    cleanupDragRef.current?.();

    dragOffsetRef.current = {
      x: event.clientX - positionRef.current.x,
      y: event.clientY - positionRef.current.y,
    };

    const onMove = (moveEvent: MouseEvent): void => {
      const dragOffset = dragOffsetRef.current;
      if (!dragOffset) return;
      const next = clampFloatingPosition({
        x: moveEvent.clientX - dragOffset.x,
        y: moveEvent.clientY - dragOffset.y,
      });
      positionRef.current = next;
      setPosition(next);
      persistFloatingPosition(next);
    };

    const stopDragging = (): void => {
      dragOffsetRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stopDragging);
      cleanupDragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopDragging);
    cleanupDragRef.current = stopDragging;
  };

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className='fixed z-[70] flex overflow-hidden rounded-2xl border border-border bg-background shadow-2xl'
      style={{
        width: FLOATING_WIDTH_PX,
        height: FLOATING_HEIGHT_PX,
        left: position.x,
        top: position.y,
      }}
    >
      <div className='flex min-h-0 w-full flex-col'>
        <div className='flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5'>
          <button
            type='button'
            className='flex flex-1 cursor-move select-none items-center gap-2 text-left'
            aria-label='Move Ozonetel panel'
            data-track-category='Support'
            data-track-name='DragOzonetelToolbar'
            onMouseDown={startDragging}
          >
            <span className='text-muted-foreground'>::</span>
            <span className='text-sm font-semibold text-foreground'>Ozonetel</span>
          </button>
          <button
            type='button'
            className='rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            aria-label='Close Ozonetel panel'
            title='Close'
            data-track-category='Support'
            data-track-name='CloseOzonetelToolbar'
            onMouseDown={event => event.stopPropagation()}
            onClick={close}
          >
            ×
          </button>
        </div>
        <iframe
          title='Ozonetel CloudAgent'
          src={url}
          allow='microphone'
          loading='eager'
          className='min-h-0 flex-1 border-0 bg-white'
        />
      </div>
    </div>,
    document.body,
  );
}

export const CloudAgentDock = ({
  mode = 'button',
  onClose,
  buttonBehavior: _buttonBehavior = 'floating',
}: CloudAgentDockProps): ReactElement | null => {
  const { data } = useQuery({
    queryKey: ['workspace-ozonetel-config'],
    queryFn: () => getOzonetelConfig(),
  });

  const url = data?.toolbarUrl ?? null;

  if (!url) return null;

  if (mode === 'inline') {
    return (
      <div className='overflow-hidden rounded-2xl border border-border bg-background shadow-lg'>
        <div className='flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5'>
          <div className='relative flex h-2.5 w-2.5 shrink-0'>
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75' />
            <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500' />
          </div>
          <Phone size={15} className='text-emerald-600' />
          <span className='text-sm font-semibold text-foreground'>Ozonetel</span>
        </div>
        <iframe
          title='Ozonetel CloudAgent'
          src={url}
          allow='microphone'
          className='h-[320px] w-full border-0 bg-white'
        />
      </div>
    );
  }

  return <ToolbarButton onClick={() => openFloatingDock(url, onClose)} />;
};

export function CloudAgentFloatingHost(): ReactElement | null {
  const floatingState = useSyncExternalStore(
    subscribeToFloatingDock,
    getFloatingDockSnapshot,
    getFloatingDockSnapshot,
  );

  if (!floatingState.isOpen || !floatingState.url) return null;

  return (
    <FloatingCloudAgentPanel
      url={floatingState.url}
      {...(floatingState.onClose ? { onClose: floatingState.onClose } : {})}
      onRequestClose={closeFloatingDock}
    />
  );
}
