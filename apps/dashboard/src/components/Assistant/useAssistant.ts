import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { EntityRef, TurnInput, TurnResponse } from '@xyne/shared/assistant';
import { assistantService } from '../../services/assistantService';
import { getApiErrorMessage } from '../../utils/apiError';
import { createVoiceLevelStore, type VoiceLevelStore } from './audio/levelStore';
import {
  appendTrace,
  describeInput,
  describeReply,
  describeDebug,
  describeResults,
  type TraceEntry,
} from './diagnostics';
import { useHoldToTalk, type HoldState } from './audio/useHoldToTalk';
import { useSpeech } from './audio/useSpeech';
import { runPlan } from './planRunner';
import { chipsFor, type AssistantPhase, type AssistantTurn, type Chip } from './transcript';
import { useAppActions } from './useAppActions';

export interface Assistant {
  /** A session is running in the panel; typed text goes to the assistant. */
  open: boolean;
  /** The orb (`voice`) or the transcript (`text`). */
  view: 'voice' | 'text';
  phase: AssistantPhase;
  turns: AssistantTurn[];
  speaksReplies: boolean;
  levelStore: VoiceLevelStore;
  /** The Diagnose log. */
  trace: TraceEntry[];
  start: () => void;
  end: () => void;
  /** Starts voice mode, or ends it when it is on. */
  toggle: () => void;
  setView: (view: 'voice' | 'text') => void;
  send: (text: string) => void;
  choose: (chip: Chip) => void;
  /** Hold to talk. */
  press: () => void;
  release: () => void;
  /** Stops speaking, or stops recording without sending. */
  interrupt: () => void;
  setSpeaksReplies: (on: boolean) => void;
  /** Forgets the conversation, for a new Ask AI chat. */
  reset: () => void;
}

const PREFS_KEY = 'xyne-assistant-speaks-replies';
const NOTHING_ON_SCREEN: readonly EntityRef[] = [];

/**
 * The assistant in the Ask AI panel. Every understanding and decision happens in the backend;
 * this hook sends what the user said or tapped, shows and speaks the reply, and runs the plan
 * the backend sends with the user's own session. Turns go one at a time, in order.
 */
export function useAssistant({
  onAskAI,
  onScreen = NOTHING_ON_SCREEN,
}: {
  /** Sends a question to Xyne AI's chat. Without it, questions are not offered to Xyne AI. */
  onAskAI?: (question: string) => void;
  /** What is open on the left, so "here" means it. The backend checks each one by id. */
  onScreen?: readonly EntityRef[];
} = {}): Assistant {
  const appActions = useAppActions();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'voice' | 'text'>('voice');
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [speaksReplies, setSpeaksRepliesState] = useState(readSpeaksReplies);
  const [levelStore] = useState(createVoiceLevelStore);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const sessionIdRef = useRef(uuidv4());
  const onAskAIRef = useRef(onAskAI);
  const onScreenRef = useRef(onScreen);
  useEffect(() => {
    onAskAIRef.current = onAskAI;
    onScreenRef.current = onScreen;
  }, [onAskAI, onScreen]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const note = useCallback((step: string, detail: string): void => {
    setTrace(previous => appendTrace(previous, step, detail));
  }, []);

  const {
    speaking,
    speak,
    cancel: stopSpeaking,
  } = useSpeech({
    enabled: open && view === 'voice' && speaksReplies,
    onTrace: note,
  });

  const addTurn = useCallback((turn: Omit<AssistantTurn, 'id' | 'at'>): string => {
    const id = uuidv4();
    setTurns(previous => [...previous, { ...turn, id, at: new Date() }]);
    return id;
  }, []);

  const reply = useCallback(
    (response: TurnResponse): void => {
      const { handoff } = response;
      const chips = [
        ...chipsFor(response.display),
        ...(handoff && onAskAIRef.current
          ? [{ id: 'ask-ai', label: 'Ask Xyne AI', askAI: handoff.text }]
          : []),
      ];
      if (!response.say && chips.length === 0) return;
      addTurn({
        role: 'assistant',
        text: response.say,
        ...(response.tone ? { tone: response.tone } : {}),
        ...(response.expectsReply ? { expectsReply: true } : {}),
        ...(chips.length ? { chips } : {}),
      });
      speak(response.say);
    },
    [addTurn, speak],
  );

  /** One turn, and the plan it carries: run it and report the results in a follow-up turn. */
  const exchange = useCallback(
    async (input: TurnInput): Promise<void> => {
      const sessionId = sessionIdRef.current;
      let next: TurnInput | null = input;
      while (next) {
        note('Sent', describeInput(next));
        const sentAt = performance.now();
        const response = await assistantService.turn({
          sessionId,
          requestId: uuidv4(),
          input: next,
          context: { onScreen: [...onScreenRef.current] },
        });
        if (sessionId !== sessionIdRef.current) return;
        note('Reply', `${Math.round(performance.now() - sentAt)} ms · ${describeReply(response)}`);
        if (response.debug) note('Understood', describeDebug(response.debug));
        reply(response);
        if (!response.run) return;
        const ranAt = performance.now();
        const stepsTurn = addTurn({ role: 'assistant', text: '', steps: [] });
        const results = await runPlan(response.run.plan, appActions, steps => {
          setTurns(previous =>
            previous.map(turn => (turn.id === stepsTurn ? { ...turn, steps } : turn)),
          );
        });
        note(
          'Plan ran',
          `${Math.round(performance.now() - ranAt)} ms · ${describeResults(results)}`,
        );
        next = { kind: 'planResult', runId: response.run.runId, results };
      }
    },
    [addTurn, appActions, note, reply],
  );

  const enqueue = useCallback(
    (input: TurnInput): void => {
      stopSpeaking();
      const sessionId = sessionIdRef.current;
      queueRef.current = queueRef.current.then(async () => {
        setWaiting(true);
        try {
          await exchange(input);
        } catch (error) {
          const status = (error as { response?: { status?: number } }).response?.status;
          note(
            'Turn failed',
            `${status ?? 'no response'} · ${getApiErrorMessage(error, 'unknown')}`,
          );
          if (sessionId === sessionIdRef.current) {
            addTurn({
              role: 'assistant',
              text: getApiErrorMessage(error, 'I couldn’t reach the assistant. Please try again.'),
              tone: 'error',
            });
          }
        } finally {
          setWaiting(false);
        }
      });
    },
    [addTurn, exchange, note, stopSpeaking],
  );

  const send = useCallback(
    (text: string, via: 'typed' | 'voice' = 'typed'): void => {
      const said = text.trim();
      if (!said) return;
      addTurn({ role: 'user', text: said });
      enqueue({ kind: 'text', text: said, via });
    },
    [addTurn, enqueue],
  );

  const sendSpoken = useCallback((text: string): void => send(text, 'voice'), [send]);
  const sayProblem = useCallback(
    (message: string): void => {
      addTurn({ role: 'assistant', text: message, tone: 'error' });
      speak(message);
    },
    [addTurn, speak],
  );
  const {
    state: holdState,
    press,
    release,
    cancel: stopRecording,
  } = useHoldToTalk({ levelStore, onText: sendSpoken, onProblem: sayProblem, onTrace: note });

  /** Talking over a spoken reply stops it. */
  const pressToTalk = useCallback((): void => {
    stopSpeaking();
    press();
  }, [press, stopSpeaking]);

  const interrupt = useCallback((): void => {
    stopSpeaking();
    stopRecording();
  }, [stopRecording, stopSpeaking]);

  const start = useCallback((): void => {
    setView('voice');
    setOpen(true);
  }, []);

  const end = useCallback((): void => {
    interrupt();
    setOpen(false);
  }, [interrupt]);

  const toggle = open ? end : start;

  const choose = useCallback(
    (chip: Chip): void => {
      if (chip.askAI) {
        // Xyne AI answers in its chat, so voice mode steps aside for it.
        end();
        onAskAIRef.current?.(chip.askAI);
        return;
      }
      if (chip.text) {
        send(chip.text);
        return;
      }
      addTurn({ role: 'user', text: chip.label });
      enqueue({ kind: 'choose', optionId: chip.id });
    },
    [addTurn, end, enqueue, send],
  );

  const reset = useCallback((): void => {
    end();
    sessionIdRef.current = uuidv4();
    setTurns([]);
    setTrace([]);
  }, [end]);

  const setSpeaksReplies = useCallback((on: boolean): void => {
    setSpeaksRepliesState(on);
    try {
      localStorage.setItem(PREFS_KEY, String(on));
    } catch {
      // Storage can be unavailable (private windows); the choice then lasts for this page.
    }
  }, []);

  const phase = phaseOf(open, holdState, waiting, speaking);

  return useMemo(
    () => ({
      open,
      view,
      phase,
      turns,
      speaksReplies,
      levelStore,
      trace,
      start,
      end,
      toggle,
      setView,
      send,
      choose,
      press: pressToTalk,
      release,
      interrupt,
      setSpeaksReplies,
      reset,
    }),
    [
      open,
      view,
      phase,
      turns,
      speaksReplies,
      levelStore,
      trace,
      start,
      end,
      toggle,
      send,
      choose,
      pressToTalk,
      release,
      interrupt,
      setSpeaksReplies,
      reset,
    ],
  );
}

/** What the orb shows. Once voice mode ends nothing is busy, even if a last reply is on its way. */
function phaseOf(
  open: boolean,
  hold: HoldState,
  waiting: boolean,
  speaking: boolean,
): AssistantPhase {
  if (!open) return 'idle';
  if (hold !== 'idle') return hold;
  if (waiting) return 'thinking';
  return speaking ? 'speaking' : 'idle';
}

function readSpeaksReplies(): boolean {
  try {
    return localStorage.getItem(PREFS_KEY) !== 'false';
  } catch {
    return true;
  }
}
