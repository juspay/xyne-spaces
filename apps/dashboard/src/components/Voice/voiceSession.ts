import { useEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  micErrorMessage,
  startUtterance,
  type Utterance,
} from '../../services/VoiceInput/voiceCapture';
import { xyneAIStreamManager, type StreamState } from '../../services/XyneAI';
import { splitSentences, flushRemainder, toSpokenText } from './voiceSentences';
import { voiceLevel } from './voiceLevel';
import { DIAGNOSE_ENABLED, type VoiceDiagnostic } from './diagnoseLog';
import { getVoiceSettings, subscribeVoiceSettings } from './voiceSettings';
import { createSpeechQueue } from './speechQueue';

export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

// What was said this session, for the captions.
export interface VoiceTurn {
  id: string;
  speaker: 'you' | 'xyne';
  text: string;
}

export interface VoiceSessionState {
  phase: VoicePhase;
  // Live transcript of the current utterance while listening/transcribing, '' otherwise.
  liveText: string;
  turns: VoiceTurn[];
  // What happened, step by step; empty unless diagnostics are enabled (see diagnoseLog).
  diagnostics: VoiceDiagnostic[];
  // The browser refused to start audio without a user gesture; resumePlayback retries inside a click.
  playbackBlocked: boolean;
}

/** What the surface hosting voice mode (sidebar, /ai composer) provides to the session. */
export interface VoiceHost {
  submit: (text: string) => void;
  ownsStream: (state: StreamState) => boolean;
  // A reply to speak, '' when the assistant took the text but has nothing to say, or null to submit it.
  answer?: ((text: string) => Promise<string | null>) | undefined;
  // Cancels what lives outside the session when the user taps Stop: Auto routing and the LLM request.
  onStop?: (() => void) | undefined;
  // Leaves voice mode: the user went back to chat, or another surface took the session over.
  onExit: () => void;
}

const MAX_TURNS = 20;
const MAX_DIAGNOSTICS = 200;
const LIVE_PHASES: VoicePhase[] = ['listening', 'transcribing'];

const IDLE: VoiceSessionState = {
  phase: 'idle',
  liveText: '',
  turns: [],
  diagnostics: [],
  playbackBlocked: false,
};

// The session lives here, not in a component, so it survives the surface that started it being
// replaced (the /ai landing page becoming the thread) and only the stage re-renders as it changes.
let state = IDLE;
const listeners = new Set<() => void>();

function setState(patch: Partial<VoiceSessionState>): void {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}

const setPhase = (phase: VoicePhase): void => {
  if (phase !== state.phase) {
    setState({ phase, ...(!LIVE_PHASES.includes(phase) && { liveText: '' }) });
  }
};

// Bumped when the session ends, so replies still in flight are dropped.
let session = 0;
let host: VoiceHost | null = null;
let unsubscribe: (() => void) | null = null;
let utterance: Utterance | null = null;
let turnSeq = 0;
let diagnosticSeq = 0;
let holdStart: number | null = null;

// The turn being followed: what has been spoken of the streamed reply, and which stream it is.
let turnActive = false;
let consumed = 0;
let activeStreamId: string | null = null;

function log(step: string, detail = ''): void {
  if (!DIAGNOSE_ENABLED) return;
  const now = performance.now();
  holdStart ??= now;
  const event = {
    id: diagnosticSeq++,
    at: new Date(),
    ms: Math.round(now - holdStart),
    step,
    detail,
  };
  setState({ diagnostics: [...state.diagnostics, event].slice(-MAX_DIAGNOSTICS) });
}

function appendTurn(speaker: VoiceTurn['speaker'], text: string): void {
  const { turns } = state;
  const last = turns[turns.length - 1];
  // Reply sentences arrive one by one and read as a single caption.
  if (speaker === 'xyne' && last?.speaker === 'xyne') {
    setState({ turns: [...turns.slice(0, -1), { ...last, text: `${last.text} ${text}` }] });
    return;
  }
  setState({ turns: [...turns, { id: `turn-${turnSeq++}`, speaker, text }].slice(-MAX_TURNS) });
}

const speech = createSpeechQueue({
  log,
  onSpeaking: () => setPhase('speaking'),
  // A streamed reply may still add sentences, so running dry mid-reply is not the end.
  onDrained: () => {
    if (!turnActive && state.phase === 'speaking') setPhase('idle');
  },
  onBlocked: playbackBlocked => {
    if (playbackBlocked !== state.playbackBlocked) setState({ playbackBlocked });
  },
});

// Ends the turn being followed and silences what is being said.
function interrupt(): void {
  turnActive = false;
  activeStreamId = null;
  speech.cancel();
}

function enqueue(sentences: string[]): void {
  if (sentences.length === 0) return;
  const text = sentences.join(' ');
  appendTurn('xyne', text);
  log('Reply queued', `“${text}”`);
  // Muted: the reply only shows as a caption. While a reply streams, its end resets the phase.
  if (!getVoiceSettings().speakReplies) {
    if (!turnActive) setPhase('idle');
    return;
  }
  speech.enqueue(sentences);
}

// Queues text to be spoken like an assistant reply.
function speak(text: string): void {
  const { sentences, rest } = splitSentences(toSpokenText(text));
  enqueue([...sentences, ...flushRemainder(rest)]);
}

function processReply(fullText: string, done: boolean): void {
  if (done) {
    const tail = flushRemainder(fullText.slice(consumed));
    consumed = fullText.length;
    enqueue(tail);
    if (!speech.isBusy()) setPhase('idle');
    return;
  }
  const { sentences, rest } = splitSentences(fullText.slice(consumed));
  if (sentences.length > 0) {
    consumed = fullText.length - rest.length;
    enqueue(sentences);
  }
}

function latestBotContent(messages: StreamState['messages']): string | null {
  const bot = [...messages].reverse().find(m => m.type === 'bot');
  if (!bot) return null;
  if (bot.parsedContent?.summary) return bot.parsedContent.summary;
  const stream = bot.streamingContent || bot.content || '';
  const head = stream.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return null;
  return stream || null;
}

// Speaks the reply of the submitted turn as it streams in.
function followReply(stream: StreamState): void {
  if (!turnActive || !host) return;
  // Picked up by owner, then followed by id: the slot key moves to the session id mid-stream.
  if (activeStreamId === null) {
    if (!host.ownsStream(stream) || stream.status !== 'streaming') return;
    activeStreamId = stream.streamId;
  } else if (stream.streamId !== activeStreamId) {
    return;
  }
  const content = latestBotContent(stream.messages);
  const done = stream.status !== 'streaming';
  if (content !== null) processReply(content, done);
  else if (done && !speech.isBusy()) setPhase('idle');
  if (done) {
    turnActive = false;
    activeStreamId = null;
  }
}

/**
 * Decides what a finished utterance does: the one place a transcript is interpreted. The host's
 * `answer` may reply locally or take it; otherwise it is submitted to Ask AI and its reply is
 * followed. Anything that should intercept the next transcript (say, a pending confirmation)
 * belongs here, before `answer`.
 */
async function handleTranscript(rawText: string): Promise<void> {
  const current = session;
  try {
    const text = rawText.trim();
    if (!text) {
      log('Transcript', 'empty');
      setPhase('idle');
      return;
    }
    log('Transcript', `“${text}”`);
    appendTurn('you', text);
    setPhase('thinking');
    const reply = (await host?.answer?.(text)) ?? null;
    if (session !== current || !host) return;
    if (reply === '') {
      log('Routing', 'handled locally, nothing to say');
      setPhase('idle');
      return;
    }
    if (reply !== null) {
      log('Routing', `local reply “${reply}”`);
      speak(reply);
      return;
    }
    log('Routing', 'sent to Ask AI');
    consumed = 0;
    activeStreamId = null;
    turnActive = true;
    host.submit(text);
  } catch (err) {
    if (session !== current) return;
    const description = err instanceof Error ? err.message : 'Unknown error';
    log('Error', `transcription failed: ${description}`);
    toast.error('Voice transcription failed', { description });
    setPhase('idle');
  }
}

function startRecording(): void {
  if (utterance) return;
  holdStart = null;
  log('Hold start');
  // Talking over the answer ends that turn, so the rest of it is not spoken.
  interrupt();
  const mine = startUtterance({
    commit: 'manual',
    deviceId: getVoiceSettings().micId,
    onLevel: voiceLevel.set,
    onPartial: (text, committed) => {
      if (!state.liveText) log('First partial', `“${text}”`);
      setState({ liveText: `${committed} ${text}`.trim() });
    },
    onFinal: (_text, committed) => setState({ liveText: committed }),
  });
  utterance = mine;
  mine.ready.then(
    label => {
      log('Mic ready', label || 'unnamed device');
      setState({ liveText: '', phase: 'listening' });
    },
    (error: unknown) => {
      utterance = null;
      log('Error', `microphone: ${error instanceof Error ? error.message : 'access denied'}`);
      toast.error(micErrorMessage(error));
      setPhase('idle');
    },
  );
  mine.ended.then(
    text => {
      utterance = null;
      // The server can end the stream first (e.g. an upstream error) while still listening.
      if (state.phase === 'listening') setPhase('idle');
      else void handleTranscript(text);
    },
    (error: Error) => {
      utterance = null;
      log('Error', error.message);
      toast.error('Voice transcription failed', { description: error.message });
      setPhase('idle');
    },
  );
}

function stopRecording(): void {
  if (!utterance) return;
  // Released before the microphone was granted, so nothing was said.
  if (state.phase !== 'listening') {
    utterance.cancel();
    utterance = null;
    return;
  }
  log('Release');
  utterance.stop();
  setPhase('transcribing');
}

// Ends the current turn without leaving voice mode: silences speech and cancels routing and the LLM request.
function stop(): void {
  log('Stopped');
  interrupt();
  host?.onStop?.();
  setPhase('idle');
}

// Drops everything of the session: the microphone, the speech, the turn and what was shown.
function reset(): void {
  session++;
  utterance?.cancel();
  utterance = null;
  interrupt();
  holdStart = null;
  state = IDLE;
  listeners.forEach(listener => listener());
}

// Muting silences the reply being spoken.
function onSettingsChange(): void {
  if (!getVoiceSettings().speakReplies) speech.cancel();
}

function activate(): void {
  if (unsubscribe) return;
  const stopStream = xyneAIStreamManager.subscribe(followReply);
  const stopSettings = subscribeVoiceSettings(onSettingsChange);
  unsubscribe = (): void => {
    stopStream();
    stopSettings();
  };
}

function deactivate(): void {
  unsubscribe?.();
  unsubscribe = null;
  reset();
}

/**
 * Makes `next` the surface voice mode runs on; the returned function lets go of it. Only one
 * surface has the session: claiming it from another one sends that one out of voice mode.
 * Letting go of the last surface ends the session, unless another claims it right away (the
 * /ai landing page handing over to its thread), which keeps the turn going.
 */
function claim(next: VoiceHost): () => void {
  const previous = host;
  host = next;
  activate();
  if (previous && previous !== next) {
    previous.onExit();
    reset();
  }
  return (): void => {
    if (host !== next) return;
    host = null;
    queueMicrotask(() => {
      if (!host) deactivate();
    });
  };
}

export const voiceSession = {
  startRecording,
  stopRecording,
  stop,
  speak,
  resumePlayback: (): void => speech.resume(),
  exit: (): void => host?.onExit(),
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

/** The session as the stage shows it; re-renders only the components that read it. */
export const useVoiceSession = (): VoiceSessionState =>
  useSyncExternalStore(subscribe, () => state);

/** Runs voice mode on the calling surface while `enabled`. */
export function useVoiceHost(enabled: boolean, surface: VoiceHost): void {
  // Read at call time, so the session keeps its claim as the surface re-renders.
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  useEffect(() => {
    if (!enabled) return undefined;
    return claim({
      submit: text => surfaceRef.current.submit(text),
      ownsStream: stream => surfaceRef.current.ownsStream(stream),
      answer: async text => (await surfaceRef.current.answer?.(text)) ?? null,
      onStop: () => surfaceRef.current.onStop?.(),
      onExit: () => surfaceRef.current.onExit(),
    });
  }, [enabled]);
}
