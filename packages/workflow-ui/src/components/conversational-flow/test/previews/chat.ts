/**
 * What every preview works from: one conversation, read the way a chat client
 * reads it — a list of bubbles, the quick replies attached to the last one,
 * whether typing is allowed, and what the other side is doing right now.
 *
 * The turn is the same for all of them; only the drawing differs.
 */
import { useEffect, useRef, useState } from 'react';
import type { TurnField } from '@xyne/workflow-sdk/conversational-flow';
import type { ConversationRun } from '../useConversation.js';

export interface ChatOption {
  id: string;
  label: string;
  /** `back` goes up, `finish` ends it, `next` goes on — what a form draws as Send. */
  kind: 'next' | 'back' | 'finish';
}

export interface Chat {
  run: ConversationRun;
  /** The conversation so far: the person's, the assistant's, and the odd note. */
  lines: ConversationRun['lines'];
  text: string;
  setText: (t: string) => void;
  send: () => void;
  /** Quick replies for the message just shown. Empty when there is nothing to tap. */
  options: ChatOption[];
  choose: (o: ChatOption) => void;
  /** What this turn asks for beyond where to go next. Empty on an ordinary screen. */
  fields: TurnField[];
  /** Whether this turn asks for something, rather than just offering options. */
  asking: boolean;
  /** What they have filled in so far, by field name. */
  answer: Record<string, unknown>;
  setAnswer: (name: string, value: unknown) => void;
  /** Send the whole question: what they typed, picked and attached. */
  give: () => void;
  canGive: boolean;
  /**
   * Whether the composer's send can fire. A question goes whole, so anything
   * filled in is enough — what they typed is only one part of it, and asking
   * for a word before it will go is how a pick becomes unsendable.
   */
  canSend: boolean;
  /** The conversation is with a person now; Test answers on their behalf. */
  handedOff: boolean;
  canType: boolean;
  placeholder: string;
  /** "typing…", where a chat app shows it. Null when the flow is idle. */
  activity: string | null;
  /** An agent's answer as it is being written. */
  streaming: string | null;
  endRef: React.RefObject<HTMLDivElement | null>;
}

export function useChat(run: ConversationRun): Chat {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<Record<string, unknown>>({});
  const endRef = useRef<HTMLDivElement>(null);
  // Block body on purpose: scroll methods return a Promise in current browsers,
  // and an effect must return nothing but a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [run.lines.length, run.state, run.live?.text]);

  const turn = run.turn;
  const open = turn?.status === 'awaiting_reply' || turn?.status === 'handed_off' ? turn : null;
  const typing = open?.reply?.text;
  const busy = run.state === 'thinking' || run.state === 'starting';

  /**
   * What a question asks for, answered the way a chat app answers it: the box
   * that is already there is the box they type in, what they can pick sits
   * above it, and Send carries the lot. So there is one place to type and one
   * thing to press, whatever the question happens to ask for.
   */
  const asked = open?.reply?.fields ?? [];
  // The turn says which field the box is, so the composer and that field are
  // never drawn as two boxes.
  const typed = typing?.fills === undefined ? undefined : asked.find((f) => f.name === typing.fills);
  const canType = typing?.allowed === true;
  const missing = asked.filter((f) => f['required'] === true && blank(f === typed ? text : answer[f.name]));

  const given = Object.entries(answer).filter(([, value]) => !blank(value));
  const canGive = !busy && missing.length === 0 && (given.length > 0 || text.trim() !== '');

  const give = (): void => {
    if (busy || missing.length > 0) return;
    const values: Record<string, unknown> = Object.fromEntries(given);
    if (typed && text.trim()) values[typed.name] = text.trim();
    if (Object.keys(values).length === 0) return;
    void run.reply({ values, label: said(asked, values) });
    setAnswer({});
    setText('');
  };

  return {
    run,
    lines: run.lines,
    text,
    setText,
    send: () => {
      // A question that asks for things is sent whole; anything else is a reply.
      if (asked.length > 0) {
        give();
        return;
      }
      const trimmed = text.trim();
      if (!trimmed || !canType) return;
      void run.reply({ text: trimmed });
      setText('');
    },
    options: (open?.reply?.options ?? []).map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
    choose: (o) => void run.reply({ choice: o.id, label: o.label }),
    asking: asked.length > 0,
    // The box they type in is the composer, so it is not drawn twice.
    fields: asked.filter((f) => f !== typed),
    answer,
    setAnswer: (name, value) => { setAnswer((a) => ({ ...a, [name]: value })); },
    give,
    canGive,
    handedOff: turn?.status === 'handed_off',
    canType,
    // Only where they can type at all: where they cannot, the question draws its
    // own Send and this one stays out of the way rather than doubling it.
    canSend: canType && (asked.length > 0 ? canGive : text.trim() !== ''),
    // Say what the box is for: the one thing asked for, a reply, or nothing yet.
    // The field comes first because it is the more particular of the two — a box
    // that fills one says what it wants, and only a box that routes says
    // "Message". Taking typing as the answer first left that unsaid.
    placeholder: typed
      ? String(typed['label'] ?? typed['placeholder'] ?? 'Your answer')
      : typing?.allowed
        ? 'Message'
        : open
          ? 'Choose an option'
          : 'Waiting…',
    activity: busy ? (run.state === 'starting' ? 'connecting…' : (run.live?.status ?? 'typing…')) : null,
    streaming: run.live?.text ?? null,
    endRef,
  };
}

/** Nothing was given for this field. */
function blank(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** What the person's line reads as, once they have sent it. */
function said(fields: TurnField[], values: Record<string, unknown>): string {
  return fields
    .map((f) => [String(f['label'] ?? f.name), values[f.name]] as const)
    .filter(([, v]) => !blank(v))
    .map(([label, v]) => `${label}: ${typeof v === 'object' && v !== null ? String((v as Record<string, unknown>)['name'] ?? '…') : String(v)}`)
    .join(' · ');
}
