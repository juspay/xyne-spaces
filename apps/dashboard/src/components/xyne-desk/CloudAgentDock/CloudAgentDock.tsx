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
import { toast } from 'sonner';
import {
  getSoftphone,
  linkCall,
  TELEPHONY_QUERY_KEYS,
  type SoftphoneConnection,
  type SoftphoneInfo,
} from '../../../services/clients/telephonyApi';
import { parseSoftphoneMessage, type SoftphoneCall } from './softphones';
import Tooltip from '../../ui/Tooltip';
import { PhoneDefault } from '@xyne/icons';

/**
 * Embeds a call provider's hosted softphone (Ozonetel's CloudAgent toolbar) in a floating panel.
 * The toolbar handles live call control, and the agent must be logged into it for outbound
 * click-to-call. Each opened connection keeps its iframe mounted, so switching between
 * connections keeps their logins and any live call. Renders nothing without a toolbar URL.
 */
interface CloudAgentDockProps {
  /** The desk on screen; its own connection opens first. */
  channelId?: string | null;
  mode?: 'button' | 'inline';
  onClose?: () => void;
  buttonBehavior?: 'popover' | 'floating';
}

const FLOATING_WIDTH_PX = 360;
const FLOATING_HEIGHT_PX = 560;
const FLOATING_POSITION_KEY = 'support-ozonetel-floating-position';
const LAST_CONNECTION_KEY = 'support-softphone-last-connection';

let closeActiveFloatingPanel: (() => void) | null = null;

type FloatingDockState = {
  isOpen: boolean;
  activeId: string | null;
  /** Connections whose softphone was opened; their iframes stay mounted. */
  opened: SoftphoneConnection[];
  /** Connections the panel can switch to. */
  available: SoftphoneConnection[];
  onClose?: () => void;
};

let floatingDockState: FloatingDockState = {
  isOpen: false,
  activeId: null,
  opened: [],
  available: [],
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

// By content: each open builds new arrays.
function sameConnections(a: SoftphoneConnection[], b: SoftphoneConnection[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (connection, index) =>
        connection.id === b[index]?.id &&
        connection.url === b[index]?.url &&
        connection.name === b[index]?.name,
    )
  );
}

function setFloatingDockState(next: FloatingDockState): void {
  const current = floatingDockState;
  // Nothing changed: keep the same snapshot so the dock doesn't re-render.
  if (
    current.isOpen === next.isOpen &&
    current.activeId === next.activeId &&
    current.onClose === next.onClose &&
    sameConnections(current.opened, next.opened) &&
    sameConnections(current.available, next.available)
  ) {
    return;
  }
  floatingDockState = next;
  emitFloatingDockChange();
}

function readLastConnectionId(): string | null {
  try {
    return window.localStorage.getItem(LAST_CONNECTION_KEY);
  } catch {
    return null;
  }
}

function rememberConnectionId(id: string): void {
  try {
    window.localStorage.setItem(LAST_CONNECTION_KEY, id);
  } catch {
    /* ignore storage errors */
  }
}

/** The softphone to open: the desk's own connection, else the one in use, else the last used. */
export function pickSoftphoneConnection(
  info: SoftphoneInfo | undefined,
): SoftphoneConnection | null {
  const connections = info?.connections ?? [];
  const byId = (id: string | null | undefined): SoftphoneConnection | undefined =>
    id ? connections.find(connection => connection.id === id) : undefined;
  return (
    byId(info?.deskConnectionId) ??
    byId(floatingDockState.activeId) ??
    byId(readLastConnectionId()) ??
    connections[0] ??
    null
  );
}

// The softphone's own dial sends no ticket id, so a reported call is linked to the ticket open on
// screen: the one shown last of those still shown (a Desk ticket and one in full-page search's side
// panel can both be), so one going hands back to the one shown before it.
interface OpenTicket {
  ticketId: string;
  numbers: string[];
}
const shownTickets: OpenTicket[] = [];
// A softphone can report the same call more than once; act on each call once.
const handledCallIds = new Set<string>();

/** `ticket` is on screen: calls are linked to it until another is shown. Returns its hiding. */
export function showCloudAgentOpenTicket(ticket: OpenTicket): () => void {
  const shown = { ...ticket };
  shownTickets.push(shown);
  return (): void => {
    const at = shownTickets.indexOf(shown);
    if (at !== -1) shownTickets.splice(at, 1);
  };
}

function lastDigits(value: string): string {
  return value.replace(/\D/g, '').slice(-10);
}

function linkCallToOpenTicket(connectionId: string, call: SoftphoneCall): void {
  const openTicket = shownTickets[shownTickets.length - 1];
  const handledKey = `${connectionId}:${call.callId}`;
  if (!openTicket || handledCallIds.has(handledKey)) return;
  handledCallIds.add(handledKey);

  const dialled = lastDigits(call.dialledNumber);
  if (!dialled || !openTicket.numbers.some(number => lastDigits(number) === dialled)) {
    toast.warning('This call is not logged to the open ticket', {
      description: "It went to a number that isn't on the ticket.",
    });
    return;
  }

  linkCall({
    connectionId,
    ticketId: openTicket.ticketId,
    monitorUcid: call.callId,
    ...(call.altCallId ? { ucid: call.altCallId } : {}),
  }).catch(() => {
    toast.error('Could not log this call to the ticket');
  });
}

export function openFloatingDock(
  target: SoftphoneConnection,
  available: SoftphoneConnection[] = [target],
  onClose?: () => void,
): void {
  rememberConnectionId(target.id);
  const alreadyOpen = floatingDockState.opened.some(
    connection => connection.id === target.id && connection.url === target.url,
  );
  setFloatingDockState({
    isOpen: true,
    activeId: target.id,
    opened: alreadyOpen
      ? floatingDockState.opened
      : [...floatingDockState.opened.filter(connection => connection.id !== target.id), target],
    available: available.length > 0 ? available : [target],
    ...(onClose ? { onClose } : {}),
  });
}

function closeFloatingDock(): void {
  setFloatingDockState({ ...floatingDockState, isOpen: false });
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
    <Tooltip side='bottom' delayDuration={300} content='Open call toolbar'>
      <button
        type='button'
        className='flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-md shadow-emerald-500/20 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-400/50'
        aria-label='Open call toolbar'
        data-track-category='Support'
        data-track-name='OpenOzonetelToolbar'
        onClick={onClick}
      >
        <PhoneDefault size={16} className='shrink-0' />
      </button>
    </Tooltip>
  );
}

function FloatingCloudAgentPanel({
  opened,
  activeId,
  available,
  isOpen,
  onClose,
  onRequestClose,
}: {
  opened: SoftphoneConnection[];
  activeId: string;
  available: SoftphoneConnection[];
  isOpen: boolean;
  onClose?: () => void;
  onRequestClose: () => void;
}): ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState(readSavedFloatingPosition);
  const positionRef = useRef(position);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const iframesRef = useRef(new Map<string, HTMLIFrameElement>());
  const openedRef = useRef(opened);
  const active = opened.find(connection => connection.id === activeId);

  useEffect(() => {
    openedRef.current = opened;
  }, [opened]);

  // Softphones post with targetOrigin "*", so trust only our own iframes; the frame says which connection.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const connection = openedRef.current.find(
        candidate => iframesRef.current.get(candidate.id)?.contentWindow === event.source,
      );
      if (!connection || !event.source) return;
      const call = parseSoftphoneMessage(connection.provider, event.data);
      if (call) linkCallToOpenTicket(connection.id, call);
    };
    window.addEventListener('message', onMessage);
    return (): void => window.removeEventListener('message', onMessage);
  }, []);

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

  const switchTo = (connectionId: string): void => {
    const target = available.find(connection => connection.id === connectionId);
    if (target) openFloatingDock(target, available, onClose);
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
        display: isOpen ? undefined : 'none',
      }}
    >
      <div className='flex min-h-0 w-full flex-col'>
        <div className='flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5'>
          <button
            type='button'
            className='flex min-w-0 flex-1 cursor-move select-none items-center gap-2 text-left'
            aria-label='Move call toolbar'
            data-track-category='Support'
            data-track-name='DragOzonetelToolbar'
            onMouseDown={startDragging}
          >
            <span className='text-muted-foreground'>::</span>
            {available.length <= 1 ? (
              <span className='truncate text-sm font-semibold text-foreground'>
                {active?.name ?? 'Call toolbar'}
              </span>
            ) : null}
          </button>
          {available.length > 1 ? (
            <select
              value={activeId}
              onChange={event => switchTo(event.target.value)}
              onMouseDown={event => event.stopPropagation()}
              aria-label='Call connection'
              className='max-w-[200px] truncate rounded-md border border-border bg-background px-2 py-1 text-sm font-medium text-foreground'
              data-track-category='Support'
              data-track-name='SwitchSoftphoneConnection'
            >
              {available.map(connection => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type='button'
            className='rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            aria-label='Close call toolbar'
            title='Close'
            data-track-category='Support'
            data-track-name='CloseOzonetelToolbar'
            onMouseDown={event => event.stopPropagation()}
            onClick={close}
          >
            ×
          </button>
        </div>
        {opened.map(connection => (
          <iframe
            key={connection.id}
            ref={frame => {
              if (frame) iframesRef.current.set(connection.id, frame);
              else iframesRef.current.delete(connection.id);
            }}
            title={`${connection.name} toolbar`}
            src={connection.url}
            allow='microphone'
            loading='eager'
            className='min-h-0 flex-1 border-0 bg-white'
            style={{ display: connection.id === activeId ? undefined : 'none' }}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}

export const CloudAgentDock = ({
  channelId,
  mode = 'button',
  onClose,
  buttonBehavior: _buttonBehavior = 'floating',
}: CloudAgentDockProps): ReactElement | null => {
  const { data } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.softphone(channelId),
    queryFn: () => getSoftphone(channelId),
  });

  const target = pickSoftphoneConnection(data);
  if (!data || !target) return null;

  if (mode === 'inline') {
    return (
      <div className='overflow-hidden rounded-2xl border border-border bg-background shadow-lg'>
        <div className='flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5'>
          <div className='relative flex h-2.5 w-2.5 shrink-0'>
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75' />
            <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500' />
          </div>
          <PhoneDefault size={15} className='text-emerald-600' />
          <span className='text-sm font-semibold text-foreground'>{target.name}</span>
        </div>
        <iframe
          title={`${target.name} toolbar`}
          src={target.url}
          allow='microphone'
          className='h-[320px] w-full border-0 bg-white'
        />
      </div>
    );
  }

  return (
    <ToolbarButton
      onClick={() =>
        openFloatingDock(pickSoftphoneConnection(data) ?? target, data.connections, onClose)
      }
    />
  );
};

export function CloudAgentFloatingHost(): ReactElement | null {
  const floatingState = useSyncExternalStore(
    subscribeToFloatingDock,
    getFloatingDockSnapshot,
    getFloatingDockSnapshot,
  );

  // Stay mounted after close so each toolbar iframe keeps its login and any live call.
  if (floatingState.opened.length === 0 || !floatingState.activeId) return null;

  return (
    <FloatingCloudAgentPanel
      opened={floatingState.opened}
      activeId={floatingState.activeId}
      available={floatingState.available}
      isOpen={floatingState.isOpen}
      {...(floatingState.onClose ? { onClose: floatingState.onClose } : {})}
      onRequestClose={closeFloatingDock}
    />
  );
}
