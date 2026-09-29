import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VoiceStreamMessage,
  VoiceStreamSession,
} from '../../../services/VoiceInput/voiceInputService';
import { LAST_WORDS_MS, liveTranscript } from './liveTranscript';

/** A stream the test drives by hand: what the server says, and when it closes. */
function stream() {
  let onMessage = (_message: VoiceStreamMessage): void => undefined;
  let onClose = (): void => undefined;
  let onError = (_event: Event): void => undefined;
  const session: VoiceStreamSession = {
    sendChunk: vi.fn(),
    endAudio: vi.fn(),
    close: vi.fn(() => onClose()),
    onMessage: handler => {
      onMessage = handler;
    },
    onClose: handler => {
      onClose = handler;
    },
    onError: handler => {
      onError = handler;
    },
  };
  return {
    session,
    says: (message: VoiceStreamMessage) => onMessage(message),
    closes: () => onClose(),
    breaks: () => onError({} as Event),
  };
}

describe('hearing speech while the user talks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('joins the phrases heard, in order, once the stream closes', async () => {
    const server = stream();
    const live = liveTranscript(server.session);
    server.says({ type: 'partial', text: 'tell' });
    server.says({ type: 'final', text: 'Tell Priya' });

    const heard = live.finish();
    server.says({ type: 'final', text: ' the build is green. ' });
    server.closes();

    expect(server.session.endAudio).toHaveBeenCalledTimes(1);
    expect(await heard).toBe('Tell Priya the build is green.');
  });

  it('keeps the last words even when they were never settled', async () => {
    const server = stream();
    const live = liveTranscript(server.session);
    server.says({ type: 'final', text: 'Open' });
    server.says({ type: 'partial', text: 'the design' });
    server.says({ type: 'partial', text: 'the design channel' });

    const heard = live.finish();
    server.closes();

    expect(await heard).toBe('Open the design channel');
  });

  it('has nothing to say when the stream reports an error', async () => {
    const server = stream();
    const live = liveTranscript(server.session);
    server.says({ type: 'final', text: 'Tell Priya' });

    const heard = live.finish();
    server.says({ type: 'error', message: 'Streaming STT requires Google' });
    server.closes();

    expect(await heard).toBeNull();
  });

  it('has nothing to say when the stream ended before the audio did', async () => {
    const server = stream();
    const live = liveTranscript(server.session);
    server.says({ type: 'final', text: 'Tell Priya' });
    server.breaks();
    server.closes();

    expect(await live.finish()).toBeNull();
    expect(server.session.endAudio).not.toHaveBeenCalled();
  });

  it('stops waiting when the last words do not arrive in time', async () => {
    const server = stream();
    const live = liveTranscript(server.session);
    server.says({ type: 'final', text: 'Tell Priya' });

    const heard = live.finish();
    vi.advanceTimersByTime(LAST_WORDS_MS);

    expect(await heard).toBeNull();
    expect(server.session.close).toHaveBeenCalledTimes(1);
  });
});
