import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Message } from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import type {
  AgentCreateChatPatch,
  AgentCreateField,
  AgentCreateFormState,
  AgentCreatePhase,
} from './types';
import {
  fieldsForScriptedPatch,
  followupInstructionsPatch,
  hubRowPatches,
  identityPatch,
  prefersReducedScriptedMotion,
  SCRIPTED_ASK,
  SCRIPTED_CHAT_NAME,
  SCRIPTED_DUAL_CONTROL_REPLY,
  SCRIPTED_REPLIES,
  SCRIPTED_TURNS,
  SCRIPTED_USER_NAME,
  sliceScriptedPatch,
  type ScriptedChatPatch,
  type ScriptedCreateStep,
} from './scriptedCreateDemo';

function timings() {
  const reduce = prefersReducedScriptedMotion();
  return {
    typeMs: reduce ? 8 : 26,
    pauseBeforeSendMs: reduce ? 80 : 280,
    thinkMs: reduce ? 180 : 1800,
    tokenMs: reduce ? 10 : 34,
    writeMs: reduce ? 260 : 1250,
    identityCaretMs: reduce ? 400 : 2000,
    followupCaretMs: reduce ? 360 : 1800,
    hubRowMs: reduce ? 320 : 1500,
    dualControlMs: reduce ? 400 : 2000,
    askPauseMs: reduce ? 160 : 640,
    resolvePauseMs: reduce ? 200 : 900,
    chinMs: reduce ? 240 : 1400,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toChatPatch(patch: ScriptedChatPatch): AgentCreateChatPatch {
  return patch as AgentCreateChatPatch;
}

function userMessage(text: string): Message {
  return {
    id: newId('scripted-user'),
    type: 'user',
    content: text,
    timestamp: new Date(),
    stableKey: newId('scripted-user-key'),
  };
}

function botMessage(text: string, streaming: boolean): Message {
  return {
    id: newId('scripted-bot'),
    type: 'bot',
    content: text,
    streamingContent: text,
    isStreaming: streaming,
    timestamp: new Date(),
    stableKey: newId('scripted-bot-key'),
    ...(streaming && text.trim().length === 0 ? { statusMessage: 'Thinking…' } : {}),
  };
}

interface PlayerForm {
  applyChatPatch: (
    sourceId: string,
    incoming: AgentCreateChatPatch,
    options?: { highlight?: boolean },
  ) => AgentCreateField[];
  setWritingField: (field: AgentCreateField | null) => void;
  clearHighlights: () => void;
  patchForm: (patch: Partial<AgentCreateFormState>, field?: AgentCreateField) => void;
  resetFrom: (next: AgentCreateFormState, sourceId?: string) => void;
  resolveConflict: (field: AgentCreateField, choice: 'mine' | 'chat') => void;
}

export interface UseScriptedCreatePlayerArgs {
  enabled: boolean;
  emptyForm: AgentCreateFormState;
  form: PlayerForm;
  setPhase: Dispatch<SetStateAction<AgentCreatePhase>>;
  setSkeletonIdentity: Dispatch<SetStateAction<boolean>>;
  seedHub: () => void;
}

export function useScriptedCreatePlayer({
  enabled,
  emptyForm,
  form,
  setPhase,
  setSkeletonIdentity,
  seedHub,
}: UseScriptedCreatePlayerArgs): {
  step: ScriptedCreateStep;
  ready: boolean;
  playing: boolean;
  typing: boolean;
  draft: string;
  messages: Message[];
  engageComposer: () => void;
  replay: () => void;
} {
  const [step, setStep] = useState<ScriptedCreateStep>('idle');
  const [ready, setReady] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [playNonce, setPlayNonce] = useState(0);
  const shouldPlayRef = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;
  const seedHubRef = useRef(seedHub);
  seedHubRef.current = seedHub;
  const abortRef = useRef<AbortController | null>(null);

  const resetCanvas = useCallback((): void => {
    formRef.current.resetFrom(emptyForm, `scripted-reset-${Date.now()}`);
    formRef.current.clearHighlights();
    setPhase('empty');
    setSkeletonIdentity(false);
    setMessages([]);
    setDraft('');
    setTyping(false);
    setStep('idle');
    setReady(true);
  }, [emptyForm, setPhase, setSkeletonIdentity]);

  const writeFields = useCallback(
    async (
      patch: ScriptedChatPatch,
      signal: AbortSignal,
      dwellMs: number,
      onField?: (field: AgentCreateField) => Promise<void>,
    ): Promise<void> => {
      const current = formRef.current;
      const fields = fieldsForScriptedPatch(patch);
      const sourceId = `scripted-${Date.now()}`;
      current.clearHighlights();
      for (const field of fields) {
        if (signal.aborted) return;
        const slice = sliceScriptedPatch(patch, field);
        if (Object.keys(slice).length === 0) continue;
        const changed = current.applyChatPatch(`${sourceId}-${field}`, toChatPatch(slice), {
          highlight: false,
        });
        if (!changed.includes(field)) continue;
        current.setWritingField(field);
        const writing = document.querySelector('[data-agent-writing="true"]');
        writing?.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: prefersReducedScriptedMotion() ? 'auto' : 'smooth',
        });
        if (onField) {
          await onField(field);
        } else {
          await sleep(dwellMs, signal);
        }
      }
      current.setWritingField(null);
      setPhase('draft');
    },
    [setPhase],
  );

  const typeUserLine = useCallback(async (text: string, signal: AbortSignal): Promise<void> => {
    const { typeMs, pauseBeforeSendMs } = timings();
    setTyping(true);
    let acc = '';
    for (const char of text) {
      if (signal.aborted) return;
      acc += char;
      setDraft(acc);
      await sleep(typeMs, signal);
    }
    await sleep(pauseBeforeSendMs, signal);
    setDraft('');
    setTyping(false);
    setMessages(prev => [...prev, userMessage(text)]);
  }, []);

  const thinkThenStream = useCallback(async (text: string, signal: AbortSignal): Promise<void> => {
    const { thinkMs, tokenMs } = timings();
    const seed = botMessage('', true);
    setMessages(prev => [...prev, seed]);
    await sleep(thinkMs, signal);
    const chunks = text.split(/(\s+)/).filter(chunk => chunk.length > 0);
    let acc = '';
    for (const chunk of chunks) {
      if (signal.aborted) return;
      acc += chunk;
      const next = acc;
      setMessages(prev =>
        prev.map(message => {
          if (message.id !== seed.id) return message;
          const streamed: Message = {
            ...message,
            content: next,
            streamingContent: next,
            isStreaming: true,
          };
          delete streamed.statusMessage;
          return streamed;
        }),
      );
      await sleep(Math.min(56, tokenMs + chunk.length * 2), signal);
    }
    setMessages(prev =>
      prev.map(message => {
        if (message.id !== seed.id) return message;
        const done: Message = {
          ...message,
          content: text,
          streamingContent: text,
          isStreaming: false,
        };
        delete done.statusMessage;
        return done;
      }),
    );
  }, []);

  const playStory = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const t = timings();
      seedHubRef.current();
      setPlaying(true);
      setReady(false);

      await typeUserLine(SCRIPTED_TURNS.thinA, signal);
      await thinkThenStream(SCRIPTED_REPLIES.thinA, signal);
      const identity = identityPatch();
      await writeFields(identity, signal, t.writeMs, async field => {
        if (field === 'name') {
          setStep('identity');
          setReady(true);
          await sleep(t.identityCaretMs, signal);
          setReady(false);
          return;
        }
        await sleep(t.writeMs, signal);
      });

      await sleep(t.askPauseMs, signal);
      await thinkThenStream(SCRIPTED_ASK, signal);
      await typeUserLine(SCRIPTED_TURNS.followup, signal);
      await thinkThenStream(SCRIPTED_REPLIES.followup, signal);
      await writeFields(followupInstructionsPatch(), signal, t.followupCaretMs, async () => {
        setStep('followup');
        setReady(true);
        await sleep(t.followupCaretMs, signal);
        setReady(false);
      });

      seedHubRef.current();
      await typeUserLine(SCRIPTED_TURNS.discover, signal);
      await thinkThenStream(SCRIPTED_REPLIES.discover, signal);
      const rows = hubRowPatches();
      for (const [index, row] of rows.entries()) {
        await writeFields(row, signal, t.hubRowMs, async () => {
          setStep('hub');
          if (index === rows.length - 1) {
            setReady(true);
            await sleep(t.hubRowMs, signal);
            setReady(false);
            return;
          }
          await sleep(t.hubRowMs, signal);
        });
      }

      formRef.current.setWritingField(null);
      let painted = '';
      for (const char of SCRIPTED_USER_NAME) {
        if (signal.aborted) return;
        painted += char;
        formRef.current.patchForm({ name: painted }, 'name');
        await sleep(Math.max(12, t.typeMs), signal);
      }
      await sleep(t.askPauseMs, signal);
      await thinkThenStream(SCRIPTED_DUAL_CONTROL_REPLY, signal);
      formRef.current.applyChatPatch(
        `scripted-dual-${Date.now()}`,
        { name: SCRIPTED_CHAT_NAME },
        { highlight: false },
      );
      setStep('dual-control');
      setReady(true);
      await sleep(t.dualControlMs, signal);
      formRef.current.resolveConflict('name', 'mine');
      await sleep(t.resolvePauseMs, signal);
      setReady(false);

      setStep('chin');
      setReady(true);
      await sleep(t.chinMs, signal);
      setStep('done');
      setReady(true);
      setPlaying(false);
    },
    [thinkThenStream, typeUserLine, writeFields],
  );

  useEffect(() => {
    if (!enabled) {
      shouldPlayRef.current = false;
      abortRef.current?.abort();
      return;
    }
    if (!shouldPlayRef.current) {
      resetCanvas();
      setPlaying(false);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    resetCanvas();
    void playStory(ac.signal).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPlaying(false);
      setTyping(false);
    });

    return () => {
      ac.abort();
    };
  }, [enabled, playNonce, playStory, resetCanvas]);

  const engageComposer = useCallback((): void => {
    if (!enabled || playing || step !== 'idle' || shouldPlayRef.current) return;
    shouldPlayRef.current = true;
    setPlayNonce(value => value + 1);
  }, [enabled, playing, step]);

  const replay = useCallback((): void => {
    if (!enabled || playing) return;
    shouldPlayRef.current = true;
    setPlayNonce(value => value + 1);
  }, [enabled, playing]);

  return {
    step,
    ready,
    playing,
    typing,
    draft,
    messages,
    engageComposer,
    replay,
  };
}
