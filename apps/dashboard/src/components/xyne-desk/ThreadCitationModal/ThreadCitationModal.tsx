import { useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';
import ThreadMessages from '../../Chat/ThreadPannel';

// ----------------------------------------------------------------- store

interface ThreadCitationRef {
  ticketId?: string;
  channelId?: string;
  conversationId?: string;
  messageId?: string;
}

type Listener = () => void;

class ThreadCitationStore {
  private state: { isOpen: boolean; ref: ThreadCitationRef | null } = {
    isOpen: false,
    ref: null,
  };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  getSnapshot(): { isOpen: boolean; ref: ThreadCitationRef | null } {
    return this.state;
  }

  open(ref: ThreadCitationRef): void {
    this.state = { isOpen: true, ref };
    this.notify();
  }

  close(): void {
    this.state = { isOpen: false, ref: this.state.ref };
    this.notify();
  }
}

export const threadCitationStore = new ThreadCitationStore();

function useStore(): { isOpen: boolean; ref: ThreadCitationRef | null } {
  const [snap, setSnap] = useState(() => threadCitationStore.getSnapshot());
  useEffect(() => {
    return threadCitationStore.subscribe(() => setSnap(threadCitationStore.getSnapshot()));
  }, []);
  return snap;
}

// ----------------------------------------------------------------- modal

export function ThreadCitationModal(): ReactElement | null {
  const { isOpen, ref } = useStore();
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!isOpen) {
      setHostRect(null);
      return;
    }
    const host = document.querySelector<HTMLElement>('[data-thread-citation-host]');
    if (!host) return;
    const update = (): void => setHostRect(host.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return (): void => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen]);

  // Close on Esc.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') threadCitationStore.close();
    };
    window.addEventListener('keydown', handler);
    return (): void => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !ref?.conversationId || !ref?.messageId) return;
    const targetId = `thread-message-${ref.conversationId}-${ref.messageId}`;
    const start = Date.now();
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-message');
        window.setTimeout(() => el.classList.remove('highlight-message'), 3600);
        return;
      }
      if (Date.now() - start > 2500) return;
      window.setTimeout(tick, 100);
    };
    tick();
    return (): void => {
      cancelled = true;
    };
  }, [isOpen, ref]);

  if (!isOpen || !ref) return null;

  const close = (): void => threadCitationStore.close();

  const modalCard = (
    <div className='flex flex-col w-full h-full bg-background dark:bg-[#1E1E1E] rounded-xl shadow-2xl border border-border/60 overflow-hidden'>
      <div className='flex items-center justify-between px-3 py-2 border-b border-border/60 flex-shrink-0'>
        <button
          type='button'
          onClick={close}
          className='inline-flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
          aria-label='Back'
          data-track-category='AIDraft'
          data-track-name='ThreadCitationBack'
        >
          <ArrowLeft size={16} />
        </button>
        <span className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
          Source preview
        </span>
        <button
          type='button'
          onClick={close}
          className='inline-flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
          aria-label='Close source preview'
          data-track-category='AIDraft'
          data-track-name='ThreadCitationClose'
        >
          <X size={16} />
        </button>
      </div>
      <div className='flex-1 min-h-0 overflow-hidden'>
        <ThreadMessages
          {...(ref.ticketId && { ticketId: ref.ticketId })}
          {...(ref.channelId && { channelId: ref.channelId })}
          {...(ref.conversationId && { conversationId: ref.conversationId })}
          underTicketView
          hideTabBar
          onClose={close}
        />
      </div>
    </div>
  );

  if (hostRect) {
    const inset = 8;
    const modalStyle = {
      position: 'fixed' as const,
      top: hostRect.top + inset,
      left: hostRect.left + inset,
      width: hostRect.width - inset * 2,
      height: hostRect.height - inset * 2,
      zIndex: 60,
    };
    return createPortal(
      <>
        <button
          type='button'
          aria-label='Close source preview'
          className='fixed inset-0 z-[55] bg-black/40 backdrop-blur-[3px] cursor-default'
          onClick={close}
          data-track-category='AIDraft'
          data-track-name='CloseThreadCitationBackdrop'
        />
        <div style={modalStyle}>{modalCard}</div>
      </>,
      document.body,
    );
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <button
        type='button'
        aria-label='Close source preview'
        className='absolute inset-0 bg-black/40 backdrop-blur-[3px] cursor-default'
        onClick={close}
        data-track-category='AIDraft'
        data-track-name='CloseThreadCitationBackdrop'
      />
      <div className='relative w-[80vw] max-w-[1100px] h-[85vh]'>{modalCard}</div>
    </div>
  );
}
