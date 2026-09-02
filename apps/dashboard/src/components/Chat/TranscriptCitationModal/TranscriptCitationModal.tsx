import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { fetchTranscriptCached } from './transcriptCache';
import { TranscriptSidePanel, type TranscriptTargetHighlight } from './TranscriptSidePanel';

export interface TranscriptCitationRef {
  callId: string;
  timestamp?: string;
  speaker?: string;
  segment?: string;
  /**
   * Offset from the first transcript line. Canvas citations resolve by `segment`,
   * but a timeline marker only knows its offset, so the panel falls back to the
   * nearest line at or before this.
   */
  timestampSeconds?: number;
  /** Line treatment. Defaults to the neutral citation block. */
  highlight?: TranscriptTargetHighlight;
  /** Moment offsets drawn as dividers, so the panel matches the timeline it came from. */
  markedTimestampsSeconds?: readonly number[];
}

type Listener = () => void;
type CitationHandler = (ref: TranscriptCitationRef) => boolean;

interface StoreState {
  isOpen: boolean;
  ref: TranscriptCitationRef | null;
  nonce: number;
}

class TranscriptCitationStore {
  private state: StoreState = { isOpen: false, ref: null, nonce: 0 };
  private listeners = new Set<Listener>();
  private handler: CitationHandler | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   Let inline transcript screens handle citations in their own panel, falling back to the modal when needed.
   */
  setHandler(handler: CitationHandler): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  getSnapshot(): StoreState {
    return this.state;
  }

  open(ref: TranscriptCitationRef): void {
    if (this.handler?.(ref)) return;
    this.state = { isOpen: true, ref, nonce: this.state.nonce + 1 };
    this.notify();
  }

  close(): void {
    this.state = { ...this.state, isOpen: false };
    this.notify();
  }
}

export const transcriptCitationStore = new TranscriptCitationStore();

function useStore(): StoreState {
  const [snap, setSnap] = useState(() => transcriptCitationStore.getSnapshot());
  useEffect(() => {
    return transcriptCitationStore.subscribe(() => setSnap(transcriptCitationStore.getSnapshot()));
  }, []);
  return snap;
}

export function TranscriptCitationModal(): ReactElement | null {
  const { isOpen, ref, nonce } = useStore();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedCallId = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !ref?.callId) return;
    let cancelled = false;
    const sameCall = loadedCallId.current === ref.callId;
    if (!sameCall) {
      setText(null);
      setLoading(true);
    }
    setError(null);
    fetchTranscriptCached(ref.callId)
      .then(data => {
        if (!cancelled) {
          setText(data ?? '');
          loadedCallId.current = ref.callId;
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the transcript for this call.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, ref?.callId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') transcriptCitationStore.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen || !ref) return null;

  const close = (): void => transcriptCitationStore.close();

  return createPortal(
    <div className='fixed inset-0 z-[70]' role='dialog' aria-modal='true' aria-label='Transcript'>
      <button
        type='button'
        aria-label='Close transcript'
        className='absolute inset-0 cursor-default bg-black/25 backdrop-blur-[1px]'
        onClick={close}
        data-track-category='TranscriptPanel'
        data-track-name='close_transcript_backdrop'
      />
      <TranscriptSidePanel
        transcript={text ?? ''}
        target={{
          ...(ref.timestamp ? { timestamp: ref.timestamp } : {}),
          ...(ref.speaker ? { speaker: ref.speaker } : {}),
          ...(ref.segment ? { segment: ref.segment } : {}),
          ...(ref.timestampSeconds !== undefined ? { timestampSeconds: ref.timestampSeconds } : {}),
          ...(ref.highlight ? { highlight: ref.highlight } : {}),
        }}
        {...(ref.markedTimestampsSeconds
          ? { markedTimestampsSeconds: ref.markedTimestampsSeconds }
          : {})}
        openNonce={nonce}
        isLoading={loading}
        error={error}
        onClose={close}
        className='absolute inset-y-0 right-0 z-10 w-full md:w-[560px]'
      />
    </div>,
    document.body,
  );
}
