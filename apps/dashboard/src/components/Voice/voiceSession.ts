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
import { voiceDebug, type VoiceDebugStage } from '../../services/VoiceInput/voiceDebug';
import { getVoiceSettings, subscribeVoiceSettings } from './voiceSettings';
import { createSpeechQueue } from './speechQueue';

// 'understanding' is Auto routing deciding what to do with the request; 'asking' is the request
// sent to Ask AI, from submit until its answer starts being spoken.
export type VoicePhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'understanding'
  | 'asking'
  | 'speaking';

// What was said this session, for the captions.
export interface VoiceTurn {
  id: string;
  speaker: 'you' | 'xyne';
  text: string;
}

export interface VoiceSessionState {
  phase: VoicePhase;
  // The current line: what you are saying while listening, then Xyne's reply as it streams in and is spoken.
  liveText: string;
  turns: VoiceTurn[];
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
  // The session on this surface is over: drop anything left waiting on the user's next words.
  onEnd?: (() => void) | undefined;
}

const MAX_TURNS = 20;
// A held orb whose microphone has not started by then is reported instead of waiting silently.
const MIC_START_TIMEOUT_MS = 8_000;
// Working out what to do with a transcript (routing, acting on the screen) is given up after this.
const UNDERSTAND_TIMEOUT_MS = 30_000;
const TAP_HINT = 'Keep holding the orb while you speak';
// Ask AI gets 15s to start answering and 45s between updates before the turn is given up.
const START_TIMEOUT_MS = 15_000;
const STALL_TIMEOUT_MS = 45_000;
const ASK_AI_FAILED = "Xyne AI couldn't answer this. Try again.";
// The phases that keep the current line: it carries over from live speech to reply to speech.
const TEXT_PHASES: VoicePhase[] = ['listening', 'transcribing', 'asking', 'speaking'];

const IDLE: VoiceSessionState = {
  phase: 'idle',
  liveText: '',
  turns: [],
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
    voiceDebug.log('session', 'Phase', `${state.phase} → ${phase}`);
    setState({ phase, ...(!TEXT_PHASES.includes(phase) && { liveText: '' }) });
  }
};

// Bumped when the session ends, so replies still in flight are dropped.
let session = 0;
let host: VoiceHost | null = null;
let unsubscribe: (() => void) | null = null;
let utterance: Utterance | null = null;
let turnSeq = 0;
let holdStartedAt = 0;
let micWatchdog: ReturnType<typeof setTimeout> | undefined;

// The turn being followed: when it was submitted, what has been spoken of the streamed reply, and
// which stream it is. `watchdog` gives the turn up when Ask AI goes quiet.
let turnActive = false;
let askedAt = 0;
let gotText = false;
let consumed = 0;
let activeStreamId: string | null = null;
let watchdog: ReturnType<typeof setTimeout> | undefined;

const log = (stage: VoiceDebugStage, step: string, detail = ''): void =>
  voiceDebug.log(stage, step, detail);
const logError = (stage: VoiceDebugStage, step: string, detail = ''): void =>
  voiceDebug.log(stage, step, detail, { level: 'error' });

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
  log: (step, detail) => log('tts', step, detail),
  onSpeaking: sentence => setState({ phase: 'speaking', liveText: sentence }),
  // A streamed reply may still add sentences, so running dry mid-reply is not the end.
  onDrained: () => {
    if (!turnActive && state.phase === 'speaking') setPhase('idle');
  },
  onBlocked: playbackBlocked => {
    if (playbackBlocked !== state.playbackBlocked) setState({ playbackBlocked });
  },
});

function endTurn(): void {
  turnActive = false;
  activeStreamId = null;
  clearTimeout(watchdog);
}

// Ends the turn being followed and silences what is being said.
function interrupt(): void {
  endTurn();
  speech.cancel();
}

// Ends the turn with a message when Ask AI errored or went quiet.
function failTurn(detail: string): void {
  logError('ask', 'Ask AI failed', detail);
  interrupt();
  speak(ASK_AI_FAILED);
  // Muted, the message would only be a caption in the transcript, so it also stays on the stage.
  if (state.phase === 'idle') setState({ liveText: ASK_AI_FAILED });
}

// Gives the turn up unless Ask AI shows progress within `ms`; an answer still being spoken is not stalled.
function watch(ms: number): void {
  clearTimeout(watchdog);
  watchdog = setTimeout(
    () => (speech.isBusy() ? watch(ms) : failTurn(`no progress for ${ms / 1000}s`)),
    ms,
  );
}

function enqueue(sentences: string[]): void {
  if (sentences.length === 0) return;
  const text = sentences.join(' ');
  appendTurn('xyne', text);
  log('tts', 'Reply queued', `“${text}”`);
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

const latestBot = (
  messages: StreamState['messages'],
): StreamState['messages'][number] | undefined =>
  [...messages].reverse().find(m => m.type === 'bot');

function latestBotContent(messages: StreamState['messages']): string | null {
  const bot = latestBot(messages);
  if (!bot) return null;
  if (bot.parsedContent?.summary) return bot.parsedContent.summary;
  const stream = bot.streamingContent || bot.content || '';
  const head = stream.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return null;
  return stream || null;
}

// The sentence being written or, between sentences, the last one finished.
function latestSentence(markdown: string): string {
  const { sentences, rest } = splitSentences(toSpokenText(markdown));
  return rest.trim() || (sentences.at(-1) ?? '');
}

// Speaks the reply of the submitted turn as it streams in.
function followReply(stream: StreamState): void {
  if (!turnActive || !host) return;
  // Picked up by owner as soon as it appears, whatever its status, then followed by id: the slot
  // key moves to the session id mid-stream. A stream older than the submit is a previous turn's.
  if (activeStreamId === null) {
    if (stream.startedAt < askedAt || !host.ownsStream(stream)) return;
    activeStreamId = stream.streamId;
  } else if (stream.streamId !== activeStreamId) {
    return;
  }
  // Aborted only ever means someone stopped it, so it ends quietly; an error gets a message.
  if (stream.status === 'aborted') {
    log('ask', 'Stopped');
    interrupt();
    setPhase('idle');
    return;
  }
  if (stream.status === 'error') {
    failTurn(stream.error ?? latestBot(stream.messages)?.errorInfo?.message ?? stream.status);
    return;
  }
  watch(STALL_TIMEOUT_MS);
  const content = latestBotContent(stream.messages);
  const done = stream.status !== 'streaming';
  if (content !== null) {
    if (!gotText) {
      gotText = true;
      log('ask', 'First text', `after ${Date.now() - askedAt}ms`);
    }
    if (state.phase === 'asking') setState({ liveText: latestSentence(content) });
    processReply(content, done);
  } else if (done && !speech.isBusy()) setPhase('idle');
  if (done) {
    log('ask', 'Done');
    endTurn();
  }
}

// The host's answer, given up after UNDERSTAND_TIMEOUT_MS so the orb never stays busy.
async function understand(text: string): Promise<string | null> {
  if (!host?.answer) {
    log('route', 'No router on this surface', 'sending to Ask AI');
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), UNDERSTAND_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([host.answer(text), timeout]);
    if (result !== 'timeout') return result;
    logError('route', 'Timed out', `no decision after ${UNDERSTAND_TIMEOUT_MS / 1000}s`);
    host.onStop?.();
    return 'That took too long. Try again.';
  } finally {
    clearTimeout(timer);
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
      voiceDebug.log('stt', 'Empty transcript', 'nothing was heard', { level: 'warn' });
      setPhase('idle');
      setState({ liveText: "I didn't catch that. Try again." });
      return;
    }
    log('stt', 'Transcript', `“${text}”`);
    appendTurn('you', text);
    setPhase('understanding');
    const routeStarted = performance.now();
    const reply = await understand(text);
    if (session !== current || !host) return;
    const took = `${Math.round(performance.now() - routeStarted)}ms`;
    if (reply === '') {
      log('route', 'Handled, nothing to say', took);
      setPhase('idle');
      return;
    }
    if (reply !== null) {
      log('route', 'Replied', `${took}: “${reply}”`);
      speak(reply);
      return;
    }
    log('route', 'Sent to Ask AI', took);
    consumed = 0;
    activeStreamId = null;
    turnActive = true;
    gotText = false;
    askedAt = Date.now();
    setPhase('asking');
    log('ask', 'Request sent');
    watch(START_TIMEOUT_MS);
    host.submit(text);
  } catch (err) {
    if (session !== current) return;
    const description = err instanceof Error ? err.message : 'Unknown error';
    logError('route', 'Failed', description);
    toast.error('Voice transcription failed', { description });
    setPhase('idle');
  }
}

// The browser's microphone permission, for the debugger; Safari has no query for it.
async function logPermission(): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    voiceDebug.setStatus({ permission: status.state });
    if (status.state === 'denied') {
      voiceDebug.log('mic', 'Permission denied', 'allow the microphone in the site settings', {
        level: 'error',
      });
    }
  } catch {
    voiceDebug.setStatus({ permission: 'unavailable' });
  }
}

function startRecording(): void {
  if (utterance) {
    voiceDebug.log('input', 'Hold ignored', 'a recording is already running', { level: 'warn' });
    return;
  }
  voiceDebug.startTurn();
  holdStartedAt = performance.now();
  log('input', 'Hold start', `phase ${state.phase}`);
  void logPermission();
  // Talking over the answer ends that turn, so the rest of it is not spoken.
  interrupt();
  const mine = startUtterance({
    commit: 'manual',
    // Detection mixed in Hindi for English speech ("और अंडमान" for "random"), which then went into
    // forms as typed; the assistant and the app's controls are in English.
    language: 'en',
    deviceId: getVoiceSettings().micId,
    onLevel: voiceLevel.set,
    onPartial: (text, committed) => {
      if (!state.liveText) log('stt', 'First partial', `“${text}”`);
      setState({ liveText: `${committed} ${text}`.trim() });
    },
    onFinal: (_text, committed) => setState({ liveText: committed }),
  });
  utterance = mine;
  clearTimeout(micWatchdog);
  micWatchdog = setTimeout(() => {
    if (utterance !== mine || state.phase === 'listening') return;
    logError('mic', 'Did not start', `still waiting after ${MIC_START_TIMEOUT_MS / 1000}s`);
    toast.error(
      'The microphone did not start. If the browser asks for permission, allow it and hold again.',
    );
    mine.cancel();
    utterance = null;
    setPhase('idle');
  }, MIC_START_TIMEOUT_MS);
  mine.ready.then(
    label => {
      clearTimeout(micWatchdog);
      log(
        'mic',
        'Ready',
        `${label || 'unnamed device'} after ${Math.round(performance.now() - holdStartedAt)}ms`,
      );
      setState({ liveText: '', phase: 'listening' });
    },
    (error: unknown) => {
      clearTimeout(micWatchdog);
      utterance = null;
      logError(
        'mic',
        'Failed',
        error instanceof Error ? `${error.name}: ${error.message}` : 'access denied',
      );
      toast.error(micErrorMessage(error));
      setPhase('idle');
    },
  );
  mine.ended.then(
    text => {
      utterance = null;
      // The server can end the stream first (e.g. an upstream error) while still listening.
      if (state.phase === 'listening') {
        voiceDebug.log('socket', 'Ended while listening', 'the server closed the stream', {
          level: 'warn',
        });
        setPhase('idle');
      } else void handleTranscript(text);
    },
    (error: Error) => {
      utterance = null;
      logError('stt', 'Stream failed', error.message);
      toast.error('Voice transcription failed', { description: error.message });
      setPhase('idle');
    },
  );
}

function stopRecording(): void {
  // Already released: the transcript is on its way.
  if (!utterance || state.phase === 'transcribing') return;
  // Released before the microphone was granted, so nothing was said.
  if (state.phase !== 'listening') {
    const held = Math.round(performance.now() - holdStartedAt);
    voiceDebug.log(
      'input',
      'Released too early',
      `after ${held}ms, before the microphone was ready`,
      {
        level: 'warn',
      },
    );
    clearTimeout(micWatchdog);
    utterance.cancel();
    utterance = null;
    setState({ liveText: TAP_HINT });
    return;
  }
  log('input', 'Release', `held ${Math.round(performance.now() - holdStartedAt)}ms`);
  utterance.stop();
  setPhase('transcribing');
}

// Ends the current turn without leaving voice mode: silences speech and cancels routing and the LLM request.
function stop(): void {
  log('session', 'Stopped by user');
  interrupt();
  host?.onStop?.();
  setPhase('idle');
}

// Drops everything of the session: the microphone, the speech, the turn and what was shown.
function reset(): void {
  session++;
  clearTimeout(micWatchdog);
  utterance?.cancel();
  utterance = null;
  interrupt();
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
    previous.onEnd?.();
    previous.onExit();
    reset();
  }
  return (): void => {
    if (host !== next) return;
    next.onEnd?.();
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
      onEnd: () => surfaceRef.current.onEnd?.(),
    });
  }, [enabled]);
}
