/**
 * A run seen as a conversation, one turn at a time: what the person is asked
 * now, how they can answer, and what happened since their last answer.
 *
 * Pure, and read entirely from the run's own records — the paused step's
 * `pauseState` (its prompt and form), a pending `resumePayload` (a reply given
 * but not yet applied), a WAIT's recorded `resumeData`, a router's response, the
 * conversation's own result. A turn is identified by the paused step's node
 * path, so answering it is an ordinary resume of that step.
 *
 * Works for any workflow that pauses with a form. A conversational flow also
 * gets its screens — and because the config is the tree, a record's path says
 * which screen it belongs to (`paths.ts`), however many frames deep it ran.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import { promptLines } from '../types/pause-state.js';
import type { BusEvent } from '../events/types.js';
import { readConversationalFlow } from './read.js';
import { roundsIn, screenAtPath } from './paths.js';
import { ancestorsOf } from './tree.js';
import {
  END_MESSAGE_KEY,
  type Call,
  type ConversationalFlow,
  type Prompt,
  type Question,
  type QuestionField,
  type Screen,
  type ScreenKind,
} from './types.js';

// ─── The contract ───

/**
 * `handed_off`: a person has the conversation, in the integrator's own system.
 * The turn stays open until they are done: answering it with a Finish closes
 * the conversation, with a screen hands it back to the flow.
 */
export type TurnStatus = 'awaiting_reply' | 'working' | 'finished' | 'handed_off' | 'failed' | 'ended';

export interface TurnMessage {
  role: 'assistant';
  /** `agent` when an agent wrote it; `flow` when the author did. */
  source: 'flow' | 'agent';
  text: string;
  /** The heading shown above it, e.g. "Payments › Charges". */
  header?: string;
}

export interface TurnOption {
  id: string;
  label: string;
  /** `back` returns to a screen above; `finish` ends the conversation; `next` goes on. */
  kind: 'next' | 'back' | 'finish';
}

/** A form field that is neither the options nor the typed reply, as the step declared it. */
export type TurnField = Record<string, unknown> & { name: string; type: string };

export interface TurnReply {
  options: TurnOption[];
  /**
   * Whether a plain `text` answer is taken, and what the box is for.
   *
   * `allowed` means exactly that — not where it goes. On a screen that routes
   * typing it reaches the router; on one that asks for something it fills the
   * field `fills` names, which is the same thing as sending that field in
   * `values`. A client draws one box either way.
   */
  text: { allowed: boolean; label?: string; fills?: string };
  /**
   * What this turn asks for, as the flow declared it. The field `text.fills`
   * names is in here too — it is one field, offered two ways to answer.
   */
  fields?: TurnField[];
  /**
   * What the answers are for, in the author's own word — `feedback` is the
   * common one. The field names are the same in every workflow while the
   * meaning is not, so this is what tells one question from another: a 1–5 pick
   * worth drawing as stars from a 1–5 pick of reasons. It comes back on the
   * `answered` event beside the same fields, so a client renders by it and
   * records by it. Absent when the author set none, and never read by the
   * engine.
   */
  purpose?: string;
}

export type TurnEvent =
  | { type: 'tapped'; optionId: string; label: string }
  | { type: 'typed'; text: string }
  | { type: 'routed'; to?: string; title?: string; reason?: string; confidence?: number; by?: string }
  /** Something was fetched on the way in. */
  | { type: 'looked_up'; name: string; ok: boolean; status?: number; ms?: number }
  /**
   * What they gave when a screen asked for something — a rating, an explanation,
   * a file. One event for the whole question, because it was one answer.
   *
   * An attachment is reported by what it is, not by its handle: a handle means
   * nothing outside the host that minted it.
   */
  | { type: 'answered'; purpose?: string; fields: Array<{ name: string; label?: string; value: unknown }> }
  /** The person who had it was done: sent back to a screen, or closed at a Finish. */
  | { type: 'handed_back'; to: string; title?: string };

export interface TurnScreen {
  id: string;
  title: string;
  kind: ScreenKind;
  /** Titles from the first screen down to this one. */
  path: string[];
}

/** A conversation passed to a person: what happened until then, for whoever takes it. */
export interface TurnHandoff {
  context: TranscriptEntry[];
}

export interface Turn {
  conversationId: string;
  /** The step waiting for this reply. Answer with it; null when nothing is asked. */
  turnId: string | null;
  status: TurnStatus;
  screen?: TurnScreen;
  messages: TurnMessage[];
  reply?: TurnReply;
  /** What happened since the last reply: what they tapped or typed, how it was routed. */
  events: TurnEvent[];
  /** What the conversation concluded, once finished. */
  outcome?: Record<string, unknown>;
  /** Set when `status` is `handed_off`: the conversation so far, for the person who takes it. */
  handoff?: TurnHandoff;
  error?: { code: string; message: string };
  /** When still working: how soon asking again is worthwhile. */
  retryAfterMs?: number;
}

export type TranscriptEntry = { type: 'asked'; turnId: string; text: string; screen?: string } | TurnEvent;

export interface Transcript {
  conversationId: string;
  status: TurnStatus;
  entries: TranscriptEntry[];
  outcome?: Record<string, unknown>;
}

/** An answer to a turn: an option, typed text, other form values — or several. */
export interface TurnAnswer {
  choice?: string;
  text?: string;
  values?: Record<string, unknown>;
}

/**
 * What the conversation's stream sends: a `turn` on connecting and each time it
 * moves on, and in between what is happening now. The previews are a preview
 * only — the next `turn` always carries the finished message.
 */
export type ConversationStreamEvent =
  | { type: 'turn'; turn: Turn }
  | { type: 'working'; kind: 'router' | 'agent' | 'step'; step: string; title?: string }
  | { type: 'text'; delta: string }
  | { type: 'thinking' }
  | { type: 'tool'; tool: string; phase: 'start' | 'end' }
  /**
   * Something went wrong after the stream had already answered 200. A status
   * code is no longer available, so a failure says so in the stream itself —
   * and a client that handles every event handles this one too.
   */
  | { type: 'error'; code: string; message: string };

/** The answer doesn't fit what the turn asks for. */
export class TurnAnswerError extends Error {
  override readonly name = 'TurnAnswerError';
}

// ─── The run, as far as a turn needs it ───

export interface RunStepView {
  /** The step's node path. */
  stepName: string;
  status: string;
  /** `conditional` for control steps (CYCLE, SWITCH, …), whose records only mark the way to a gate. */
  executorType?: string;
  /** JSON: `{ output?, error?, pauseState?, resumePayload?, … }`. */
  data: string | null;
}

export interface RunView {
  id: string;
  status: string;
  steps: readonly RunStepView[];
  config?: WorkflowConfig | undefined;
}

export const RETRY_AFTER_MS = 1000;

/** A step waiting for the person: a paused step, or one waiting for review. */
const WAITING = new Set(['EXTERNAL_WAIT', 'REVIEW_WAIT']);

/** `<node path>#t<turn>` — one turn of an agent step's conversation (`waitForReply`). */
const CONVERSATION_TURN = /^(.*)#t(\d+)$/;

const TERMINAL: Readonly<Record<string, TurnStatus>> = { COMPLETED: 'finished', FAILED: 'failed', CANCELLED: 'ended' };

type Rec = Record<string, unknown>;

interface Row {
  index: number;
  step: RunStepView;
  data: Rec;
  /** The form a paused step shows, when it shows one. */
  fields: Rec[];
  pause: Rec;
  screen?: Screen;
  stepId?: string;
  prompt?: Prompt;
  /** Set on the WAIT a section asks on the way in: everything on it is an answer. */
  question?: Question;
  call?: Call;
  askAi: boolean;
  /** Set on an agent step that waits for replies: where its conversation stands. */
  conversation?: { turn: number; reply?: string; waiting: string };
}

// ─── Reading ───

export function readTurn(run: RunView): Turn {
  const flow = run.config ? readConversationalFlow(run.config) : null;
  const rows = readRows(run, flow);
  const base = { conversationId: run.id };

  const terminal = TERMINAL[run.status];
  if (terminal) {
    const turn: Turn = { ...base, turnId: null, status: terminal, messages: [], events: eventsSince(rows, flow, rows.length) };
    const outcome = terminal === 'finished' && flow ? outcomeOf(rows, flow) : undefined;
    if (outcome) turn.outcome = outcome;
    // What the Finish said as it closed, when its author gave it something to say.
    const farewell = str(outcome?.[END_MESSAGE_KEY]);
    if (farewell) turn.messages.push({ role: 'assistant', source: 'flow', text: farewell });
    if (terminal === 'failed') turn.error = errorOf(rows);
    return turn;
  }

  // Open only once the run itself is paused — what a resume requires. The step
  // is marked waiting a moment before the run is.
  const open =
    run.status === 'EXTERNAL_WAIT'
      ? rows.find((r) => isGate(r) && WAITING.has(r.step.status) && asks(r) && r.data['resumePayload'] === undefined)
      : undefined;
  if (!open) {
    return { ...base, turnId: null, status: 'working', messages: [], events: eventsSince(rows, flow, rows.length), retryAfterMs: RETRY_AFTER_MS };
  }

  const handedOff = open.screen?.kind === 'handoff';
  const turn: Turn = {
    ...base,
    turnId: turnIdOf(open),
    status: handedOff ? 'handed_off' : 'awaiting_reply',
    messages: [],
    reply: replyOf(open, flow),
    // A later turn of a conversation opens on the reply that started it.
    events: open.conversation?.reply ? [{ type: 'typed', text: open.conversation.reply }] : eventsSince(rows, flow, open.index),
  };
  if (handedOff) turn.handoff = { context: entriesOf(rows.slice(0, open.index), flow) };

  // An agent waiting for a reply shows its answer; its pause reason is not for the person.
  const agent = open.conversation !== undefined;
  const header = agent ? undefined : str(open.pause['reason']);
  for (const [at, text] of promptLines(open.pause).entries()) {
    const message: TurnMessage = { role: 'assistant', source: open.askAi || agent ? 'agent' : 'flow', text };
    // The heading sits above what the screen says, not above each line of it.
    if (header !== undefined && at === 0) message.header = header;
    turn.messages.push(message);
  }
  if (open.screen && flow) {
    turn.screen = screenOf(open.screen, flow);
  }
  return turn;
}

/** Everything asked and answered so far, in order. */
export function readTranscript(run: RunView): Transcript {
  const flow = run.config ? readConversationalFlow(run.config) : null;
  const entries = entriesOf(readRows(run, flow), flow);
  const turn = readTurn(run);
  return {
    conversationId: run.id,
    status: turn.status,
    entries,
    ...(turn.outcome ? { outcome: turn.outcome } : {}),
  };
}

function entriesOf(rows: Row[], flow: ConversationalFlow | null): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const row of rows) {
    if (row.conversation?.reply) entries.push({ type: 'typed', text: row.conversation.reply });
    if (isAsk(row)) {
      // An agent's answer is its prompt while it waits, its output once it is done.
      // A screen that says several things is several entries: the transcript is
      // what was said, and joining them would invent a message nobody saw.
      const said = promptLines(row.pause);
      const answered = row.askAi ? answerText(row.data) : undefined;
      const texts = said.length > 0 ? said : answered !== undefined ? [answered] : (row.prompt?.says ?? []);
      for (const text of texts) {
        if (text) entries.push({ type: 'asked', turnId: turnIdOf(row), text, ...(row.screen ? { screen: row.screen.id } : {}) });
      }
    }
    entries.push(...rowEvents(row, flow));
  }
  return entries;
}

// ─── Streaming ───

/** Steps that move the conversation along rather than do work worth announcing. */
const QUIET_STEPS = new Set(['CYCLE', 'SWITCH', 'CONDITIONAL', 'GO_TO', 'FINISH', 'WAIT', 'LOOP', 'PARALLEL', 'MAP']);

/**
 * What a run's live event means for the person waiting on it, if anything:
 * which step is working, and what an agent is writing, thinking or using.
 */
export function streamEventOf(event: BusEvent, flow: ConversationalFlow | null): ConversationStreamEvent | null {
  const routers = new Map((flow?.screens ?? []).filter((s) => s.router).map((s) => [s.router!.stepId, s]));
  const askAi = (stepId: string) => flow?.screens.find((s) => s.askAi?.stepId === stepId);
  const fetching = (stepId: string) => flow?.screens.flatMap((s) => s.calls).find((c) => c.id === stepId);

  if (event.event === 'step_started') {
    const { stepName, stepType } = event.data;
    const step = lastSegment(stepName);
    const routing = routers.get(step);
    if (routing) return { type: 'working', kind: 'router', step, title: routing.title };
    const screen = askAi(step);
    if (screen) return { type: 'working', kind: 'agent', step, title: screen.title };
    const call = fetching(step);
    if (call) return { type: 'working', kind: 'step', step, title: call.title };
    return QUIET_STEPS.has(stepType) ? null : { type: 'working', kind: 'step', step };
  }

  if (event.event === 'step_progress') {
    if (routers.has(lastSegment(event.data.stepName))) return null;
    const payload = rec(event.data['payload']);
    switch (event.data['type']) {
      case 'substep':
        return payload['type'] === 'message' && typeof payload['content'] === 'string' && payload['content']
          ? { type: 'text', delta: payload['content'] }
          : null;
      case 'thinking':
        return { type: 'thinking' };
      case 'tool_call':
        return typeof payload['tool'] === 'string'
          ? { type: 'tool', tool: payload['tool'], phase: payload['phase'] === 'end' ? 'end' : 'start' }
          : null;
    }
  }
  return null;
}

// ─── Answering ───

/**
 * How to answer the open turn `turnId`: which step to resume, and with what.
 *
 * Throws `TurnAnswerError` when the answer doesn't fit what is asked.
 */
export function answerFor(run: RunView, turnId: string, answer: TurnAnswer): { nodePath: string; payload: Rec } {
  const flow = run.config ? readConversationalFlow(run.config) : null;
  const row = readRows(run, flow).find((r) => isGate(r) && asks(r) && turnIdOf(r) === turnId);
  if (!row) throw new TurnAnswerError(`Nothing is asked at “${turnId}”.`);
  const reply = replyOf(row, flow);
  const typed = answer.text ?? '';
  const given = answer.choice !== undefined || typed !== '' || Object.keys(answer.values ?? {}).length > 0;
  if (!given) throw new TurnAnswerError('Answer with a choice, some text, or form values.');
  if (answer.choice !== undefined && !reply.options.some((o) => o.id === answer.choice)) {
    throw new TurnAnswerError(`“${answer.choice}” isn’t one of the options.`);
  }
  const { select, text } = formParts(row.fields, row.prompt, row.question);
  if (typed !== '' && !reply.text.allowed) throw new TurnAnswerError('This turn doesn’t take typed text.');
  // Which box a typed reply fills is the turn's own answer to that question —
  // `replyOf` has already given it, so it is not worked out a second time here.
  const fills = reply.text.fills === undefined ? undefined : row.fields.find((f) => f['name'] === reply.text.fills);

  if (row.conversation) {
    if (answer.values && Object.keys(answer.values).length > 0) throw new TurnAnswerError('This turn takes a choice or a reply, not form values.');
    // A reply is the core's text input (`feedback`); a way out is `choice`.
    const payload = answer.choice !== undefined ? { action: 'approve', data: { choice: answer.choice } } : { action: 'approve', feedback: typed };
    return { nodePath: row.step.stepName, payload };
  }

  const data: Rec = {};
  // Both are always sent, empty when unused: a flow tells a tap from typing by
  // whether the text is empty.
  if (select) data[String(select['name'])] = answer.choice ?? '';
  if (text) data[String(text['name'])] = typed;
  else if (fills && typed !== '') data[String(fills['name'])] = typed;
  for (const [name, value] of Object.entries(answer.values ?? {})) {
    if (!row.fields.some((f) => f['name'] === name)) throw new TurnAnswerError(`The form has no field “${name}”.`);
    data[name] = value;
  }

  // A field a question's author marked required is one the screen inside counts
  // on, and nothing else enforces it: the form's schema carries no `required`.
  // Only a question's own fields, so a WAIT written anywhere else answers
  // exactly as it did before. And taking an option is not answering the
  // question — it is leaving it — so nothing is demanded on the way out.
  const leaving = answer.choice !== undefined && answer.choice !== '';
  const missing = leaving ? [] : (row.question?.asks ?? []).filter((ask) => ask.required && blank(data[ask.name]));
  if (missing.length > 0) {
    const named = missing.map((ask) => `“${ask.label}”`).join(', ');
    throw new TurnAnswerError(`${named} ${missing.length === 1 ? 'is' : 'are'} needed to go on.`);
  }
  return { nodePath: row.step.stepName, payload: { action: 'approve', data } };
}

/**
 * Whether `turnId` was already answered with this same answer — a retried
 * request, not a second reply. Undefined when that turn has no answer recorded.
 */
export function answeredWith(run: RunView, turnId: string, answer: TurnAnswer): boolean | undefined {
  const turnOf = CONVERSATION_TURN.exec(turnId);
  const nodePath = turnOf ? turnOf[1]! : turnId;
  const step = run.steps.find((s) => s.stepName === nodePath);
  if (!step) return undefined;
  const data = parse(step.data);

  if (turnOf) {
    const turn = Number(turnOf[2]);
    const state = rec(data['conversation']);
    const pending = data['resumePayload'] !== undefined ? rec(data['resumePayload']) : undefined;
    if (state['turn'] === turn && pending) {
      return answer.choice !== undefined ? rec(pending['data'])['choice'] === answer.choice : pending['feedback'] === answer.text;
    }
    if (state['turn'] === turn + 1) return answer.choice === undefined && state['reply'] === answer.text;
    if (step.status === 'COMPLETED') return rec(data['output'])['choice'] === answer.choice;
    return undefined;
  }

  const recorded = recordedAnswer(data);
  if (!recorded) return undefined;
  const given = [answer.choice, answer.text, ...Object.values(answer.values ?? {})];
  return sameValues(Object.values(recorded), given);
}

/** A turn is its step; an agent's conversation has one turn per answer, all at the same step. */
function turnIdOf(row: Row): string {
  return row.conversation ? `${row.step.stepName}#t${String(row.conversation.turn)}` : row.step.stepName;
}

function answerText(data: Rec): string | undefined {
  return str(rec(data['output'])['response']);
}

// ─── Rows ───

/**
 * The run in the order it happened.
 *
 * Hosts don't promise to return records in the order they were written, so the
 * order is rebuilt from the paths: by the rounds they ran in, outermost first —
 * round 2 of the conversation is after round 1 whatever happened inside either —
 * and then shallower before deeper, so a question comes before what it opened.
 */
function chronological(steps: readonly RunStepView[]): RunStepView[] {
  return steps
    .map((step, i) => ({ step, i, rounds: roundsIn(step.stepName), depth: step.stepName.split('/').length }))
    .sort((a, b) => compare(a.rounds, b.rounds) || a.depth - b.depth || a.i - b.i)
    .map((x) => x.step);
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const difference = (a[at] ?? -1) - (b[at] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

function readRows(run: RunView, flow: ConversationalFlow | null): Row[] {
  const config = run.config;
  return chronological(run.steps).map((step, index) => {
    const data = parse(step.data);
    const pause = rec(data['pauseState']);
    const row: Row = { index, step, data, pause, fields: arr(rec(pause['form'])['fields']).map(rec), askAi: false };
    const conversation = rec(data['conversation']);
    if (typeof conversation['turn'] === 'number') {
      row.conversation = {
        turn: conversation['turn'],
        waiting: String(conversation['waiting'] ?? ''),
        ...(typeof conversation['reply'] === 'string' ? { reply: conversation['reply'] } : {}),
      };
    }

    // A question asked on the way in runs outside the frame its screen owns, so
    // it is found by its own id rather than by the case the step ran in.
    const stepId = lastSegment(step.stepName);
    const asked = flow?.screens.flatMap((s) => s.questions).find((q) => q.id === stepId);
    if (asked) row.question = asked;

    const screen = flow && config ? screenAtPath(config, flow, step.stepName) : undefined;
    if (screen) {
      row.screen = screen;
      row.stepId = stepId;
      const prompt = screen.prompts.find((p) => p.id === stepId);
      if (prompt) row.prompt = prompt;
      const call = screen.calls.find((c) => c.id === stepId);
      if (call) row.call = call;
      row.askAi = screen.askAi?.stepId === stepId;
    }
    return row;
  });
}

/** The step's own id, out of the path that says where it ran. */
function lastSegment(nodePath: string): string {
  return nodePath.split('/').pop()!.replace(/#\d+$/, '').replace(/^.*:/, '');
}

/** A step that can itself be answered — not a control step marking the way to one. */
function isGate(row: Row): boolean {
  return row.step.executorType !== 'conditional';
}

/** A waiting step the person can answer: one showing a form. */
function asks(row: Row): boolean {
  return row.fields.length > 0;
}

/** A step that asks the person something. */
function isAsk(row: Row): boolean {
  return isGate(row) && (row.fields.length > 0 || row.prompt !== undefined || row.askAi);
}

/** Events recorded from `rows`, starting at the last answered question before `until`. */
function eventsSince(rows: Row[], flow: ConversationalFlow | null, until: number): TurnEvent[] {
  let from = 0;
  for (const row of rows) {
    if (row.index >= until) break;
    if (isAsk(row) && recordedAnswer(row.data)) from = row.index;
  }
  return rows.filter((r) => r.index >= from && r.index < until).flatMap((r) => rowEvents(r, flow));
}

function rowEvents(row: Row, flow: ConversationalFlow | null): TurnEvent[] {
  if (row.askAi || row.conversation) return conversationEvents(row);
  const out: TurnEvent[] = [];

  // What a question asked for, once they have given it, and where it took them.
  // It runs outside the frame its screen owns, so there is no screen to go by.
  if (row.question) {
    const given = recordedAnswer(row.data);
    const fields = given === undefined ? [] : answeredFields(row.question.asks, given);
    if (fields.length > 0) {
      out.push({ type: 'answered', ...(row.question.purpose ? { purpose: row.question.purpose } : {}), fields });
    }
    const picked = given && row.question.choiceField ? given[row.question.choiceField] : undefined;
    if (typeof picked === 'string' && picked) {
      out.push({ type: 'tapped', optionId: picked, label: row.question.options.find((o) => o.value === picked)?.label ?? picked });
    }
  }
  if (!flow || !row.screen) return out;
  const answer = row.prompt ? recordedAnswer(row.data) : undefined;

  if (row.prompt && answer && row.screen.kind === 'handoff') {
    const to = row.prompt.choiceField ? answer[row.prompt.choiceField] : undefined;
    if (typeof to === 'string' && to) {
      const title = flow.screens.find((s) => s.id === to)?.title;
      out.push({ type: 'handed_back', to, ...(title ? { title } : {}) });
    }
  } else if (row.prompt && answer) {
    const typed = row.prompt.textField ? answer[row.prompt.textField] : undefined;
    const picked = row.prompt.choiceField ? answer[row.prompt.choiceField] : undefined;
    if (typeof typed === 'string' && typed.trim()) out.push({ type: 'typed', text: typed });
    else if (typeof picked === 'string' && picked) {
      out.push({ type: 'tapped', optionId: picked, label: row.prompt.options.find((o) => o.value === picked)?.label ?? picked });
    }
  }

  if (row.call && row.step.status !== 'RUNNING') {
    // A call that never came back has no output at all; that is what `ok` says.
    const output = rec(row.data['output']);
    const status = typeof output['status'] === 'number' ? output['status'] : undefined;
    const ms = typeof output['duration'] === 'number' ? output['duration'] : undefined;
    out.push({
      type: 'looked_up',
      name: row.call.title,
      ok: output['ok'] === true,
      ...(status !== undefined ? { status } : {}),
      ...(ms !== undefined ? { ms } : {}),
    });
  }

  if (row.screen.router?.stepId === row.stepId && row.step.status === 'COMPLETED') {
    // An agent answers `{ screen, reason }`; a classifier answers a class and how sure it was.
    const output = rec(row.data['output']);
    const response = rec(output['response']);
    const to = str(response[flow.routeKey]) ?? str(output['class']);
    const reason = str(response['reason']);
    const confidence = typeof output['confidence'] === 'number' ? output['confidence'] : undefined;
    const title = to ? flow.screens.find((s) => s.id === to)?.title : undefined;
    out.push({
      type: 'routed',
      ...(to ? { to } : {}),
      ...(title ? { title } : {}),
      ...(reason ? { reason } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      // Which router chose, since a flow may have one per section.
      by: row.screen.title,
    });
  }
  return out;
}

/** An agent's conversation: a reply waiting to be sent is typed; a choice ends it. */
function conversationEvents(row: Row): TurnEvent[] {
  const labelOf = (id: string) => row.screen?.askAi?.exits.find((o) => o.value === id)?.label ?? id;
  const pending = row.data['resumePayload'] !== undefined ? rec(row.data['resumePayload']) : undefined;
  const reply = str(pending?.['feedback']);
  if (reply) return [{ type: 'typed', text: reply }];
  const choice = pending ? rec(pending['data'])['choice'] : rec(row.data['output'])['choice'];
  return typeof choice === 'string' && choice ? [{ type: 'tapped', optionId: choice, label: labelOf(choice) }] : [];
}

/** The answer a step holds: given and waiting to be applied, or applied and recorded. */
/** What was given, field by field, with a file reported by what it is. */
function answeredFields(
  asks: readonly QuestionField[],
  given: Rec,
): Array<{ name: string; label?: string; value: unknown }> {
  const out: Array<{ name: string; label?: string; value: unknown }> = [];
  for (const ask of asks) {
    const value = given[ask.name];
    if (blank(value)) continue;
    out.push({
      name: ask.name,
      ...(ask.label && ask.label !== ask.name ? { label: ask.label } : {}),
      value: ask.kind === 'attachment' ? described(value) : value,
    });
  }
  return out;
}

/** An attachment as a caller can use it: what it is called and what it is. */
function described(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(described);
  const file = rec(value);
  const name = str(file['name']);
  const mimeType = str(file['mimeType']);
  return name === undefined && mimeType === undefined
    ? value
    : { ...(name !== undefined ? { name } : {}), ...(mimeType !== undefined ? { mimeType } : {}) };
}

function recordedAnswer(data: Rec): Rec | undefined {
  const pending = data['resumePayload'];
  if (pending !== undefined) {
    return { ...rec(rec(pending)['data']), ...(typeof rec(pending)['feedback'] === 'string' ? { feedback: rec(pending)['feedback'] } : {}) };
  }
  const output = rec(data['output']);
  if (typeof output['choice'] === 'string') return { choice: output['choice'] };
  const applied = output['resumeData'];
  return applied === undefined ? undefined : rec(rec(applied)['data']);
}

const ASK_AGAIN = 'Ask something else';

function replyOf(row: Row, flow: ConversationalFlow | null): TurnReply {
  if (row.conversation && row.askAi && row.screen?.askAi) {
    // After an answer: leave by one of the screen's ways out, or ask again.
    return {
      options: row.screen.askAi.exits.map((o) => ({ id: o.value, label: o.label, kind: o.back ? 'back' : ends(flow).has(o.value) ? 'finish' : 'next' })),
      text: { allowed: true, label: ASK_AGAIN },
    };
  }
  const { select, text, rest } = formParts(row.fields, row.prompt, row.question);
  const endIds = ends(flow);
  const reply: TurnReply = {
    options: options(select).map(({ id, label }) => {
      const known = (row.prompt?.options ?? row.question?.options ?? (row.askAi ? row.screen?.askAi?.exits : undefined))?.find(
        (o) => o.value === id,
      );
      const kind: TurnOption['kind'] = known?.back ? 'back' : endIds.has(id) ? 'finish' : 'next';
      return { id, label, kind };
    }),
    // A question with a box to type in takes typed text, whatever routes it:
    // saying otherwise and then accepting it is a contract that lies.
    text: typedReply(text, rest),
  };
  if (rest.length > 0) reply.fields = rest.map((f) => ({ ...f, name: String(f['name']), type: String(f['type']) }));
  // The question's own word, forward as well as back: deciding how to draw a
  // question is the one moment it is needed, and the event comes too late.
  if (row.question?.purpose) reply.purpose = row.question.purpose;
  return reply;
}

function ends(flow: ConversationalFlow | null): Set<string> {
  return new Set(flow?.screens.filter((s) => s.kind === 'end').map((s) => s.id) ?? []);
}

function screenOf(screen: Screen, flow: ConversationalFlow): TurnScreen {
  const titles = new Map(flow.screens.map((s) => [s.id, s.title]));
  const path = [...ancestorsOf(flow, screen.id)].reverse().map((id) => titles.get(id) ?? id);
  return { id: screen.id, title: screen.title, kind: screen.kind, path: [...path, screen.title] };
}

/**
 * What the conversation concluded: the value its Finish carried, recorded as the
 * result of the cycle the conversation itself is.
 */
function outcomeOf(rows: Row[], flow: ConversationalFlow): Record<string, unknown> | undefined {
  const cycle = rows.find((r) => r.step.stepName === flow.rootScreen);
  const output = rec(cycle?.data['output']);
  return output['exit'] === 'finish' ? rec(output['result']) : undefined;
}

function errorOf(rows: Row[]): { code: string; message: string } {
  const failed = rows.find((r) => r.step.status === 'FAILED');
  return { code: 'run_failed', message: str(failed?.data['error']) ?? 'The run failed.' };
}

// ─── Form helpers ───

function formParts(
  fields: Rec[],
  prompt: Prompt | undefined,
  question?: Question,
): { select: Rec | undefined; text: Rec | undefined; rest: Rec[] } {
  const named = (name: string | undefined): Rec | undefined =>
    name === undefined ? undefined : fields.find((f) => f['name'] === name);
  // A question asked on the way in navigates by the ways out it offers, and
  // everything else on it was asked for its own sake.
  if (question) {
    const select = named(question.choiceField);
    const text = named(question.routedField);
    return { select, text, rest: fields.filter((f) => f !== select && f !== text && typeof f['name'] === 'string') };
  }
  // What navigates is what the flow reads, and `Prompt` has already settled it:
  // the field a jump carries, and the box a gate routes. Everything else on the
  // form is an answer, which reaches the caller as a field rather than a reply.
  // Without a flow to read — a WAIT outside a conversation — type is all there is.
  const select = prompt ? named(prompt.choiceField) : fields.find((f) => f['type'] === 'select');
  const text = prompt
    ? prompt.freeText !== undefined
      ? named(prompt.textField)
      : undefined
    : fields.find((f) => f['type'] === 'text' || f['type'] === 'textarea');
  return { select, text, rest: fields.filter((f) => f !== select && f !== text && typeof f['name'] === 'string') };
}

/**
 * Whether this turn takes typed text, and what the box is for: the routed box
 * when there is one, otherwise the one thing it asks them to type.
 */
function typedReply(routed: Rec | undefined, rest: Rec[]): TurnReply['text'] {
  const box = routed ?? soleTyping(rest);
  if (!box) return { allowed: false };
  return {
    allowed: true,
    ...(str(box['label']) ? { label: str(box['label'])! } : {}),
    // Named when the box is one of the things it asks for, so a client knows
    // the composer and that field are the same box and draws it once.
    ...(routed ? {} : { fills: String(box['name']) }),
  };
}

/** The one box a channel's typed reply can fill: a single answer typed into. */
function soleTyping(rest: Rec[]): Rec | undefined {
  const typing = rest.filter((f) => f['type'] === 'text' || f['type'] === 'textarea');
  return typing.length === 1 ? typing[0] : undefined;
}

/** Whether nothing at all was given for a field. */
function blank(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function options(select: Rec | undefined): Array<{ id: string; label: string }> {
  return arr(select?.['options']).map(rec).map((o) => {
    const id = String(o['value'] ?? '');
    return { id, label: String(o['label'] ?? id) };
  });
}

function sameValues(a: unknown[], b: unknown[]): boolean {
  const norm = (xs: unknown[]) => xs.filter((x) => x !== undefined && x !== null && x !== '').map((x) => JSON.stringify(x)).sort();
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

function parse(data: string | null): Rec {
  if (!data) return {};
  try {
    return rec(JSON.parse(data));
  } catch {
    return {};
  }
}

function rec(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}
