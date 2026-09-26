import {
  advance,
  type ActionCatalog,
  type ActionDefinition,
  type PlanRun,
  type TurnEvent,
  type TurnInput,
  type TurnResponse,
} from '@xyne/shared/assistant';
import type { JevAnswer, JevQuestion, JevState } from '@/services/queryIntent/jevClient';
import { NO_DETAILS, type ReadDetails } from './details';
import { toFieldUpdates } from './fieldUpdates';
import { buildIntentQuestions, continuesProbability, decideIntent, rankActions } from './intent';
import { quickChoice, quickText, type QuickReply } from './quickReplies';
import type { RecordFinder } from './records';
import {
  reminderFor,
  replyForActionChoice,
  replyForError,
  replyForNothingFits,
  replyForStep,
  type Reply,
} from './reply';
import type { AssistantSession, SessionIdentity, SessionStore } from './session';

/**
 * One turn of the conversation, start to finish:
 *
 *   load the session → answer instantly if the reply needs no model
 *   → otherwise ask Jev which action (and, in parallel, read the details with LiteLLM)
 *   → find the records the user named → let the engine decide the next step
 *   → reply with words, buttons, a preview, or a plan → save the session.
 *
 * Every outside service is passed in, so the whole flow can be tested with fakes.
 */
export interface TurnServices {
  catalog: ActionCatalog;
  sessions: SessionStore;
  records: RecordFinder;
  askJev: (
    state: JevState,
    questions: Record<string, JevQuestion>,
  ) => Promise<Record<string, JevAnswer> | null>;
  readDetails: (
    text: string,
    candidates: readonly ActionDefinition[],
    inProgress: { action: string; asking: string | null } | null,
  ) => Promise<ReadDetails>;
  newId: () => string;
}

/** Treat a sentence as part of the request in progress when Jev is at least this sure. */
const CONTINUE_PROBABILITY = 0.5;

interface Outcome {
  session: AssistantSession;
  reply: Reply;
  run?: PlanRun;
}

export async function handleTurn(
  input: TurnInput,
  identity: SessionIdentity,
  services: TurnServices,
): Promise<TurnResponse> {
  const session = await services.sessions.load(identity);
  const outcome = await respond(input, session, services);
  await services.sessions.save(identity, outcome.session);
  const { conversation } = outcome.session;
  return {
    turnId: services.newId(),
    say: outcome.reply.say,
    ...(outcome.reply.display ? { display: outcome.reply.display } : {}),
    ...(outcome.run ? { run: outcome.run } : {}),
    expectsReply: outcome.reply.expectsReply,
    session: { hasDraft: Boolean(conversation.active), parked: conversation.parked.length },
    ...(outcome.reply.tone ? { tone: outcome.reply.tone } : {}),
  };
}

async function respond(
  input: TurnInput,
  session: AssistantSession,
  services: TurnServices,
): Promise<Outcome> {
  switch (input.kind) {
    case 'planResult':
      return finishRun(input.runId, input.results, session);
    case 'choose': {
      const quick = quickChoice(input.optionId, session.question);
      return quick
        ? applyQuickReply(quick, session, services)
        : { session, reply: replyForError('That choice is no longer available.') };
    }
    case 'text': {
      const quick = quickText(input.text, session.question);
      return quick
        ? applyQuickReply(quick, session, services)
        : understand(input.text, session, services);
    }
  }
}

async function applyQuickReply(
  quick: QuickReply,
  session: AssistantSession,
  services: TurnServices,
): Promise<Outcome> {
  if (quick.kind === 'event') return applyEvent(quick.event, session, services);
  // "Did you mean …?" answered: read the original words again for the chosen action.
  const text = session.question?.kind === 'action' ? session.question.text : '';
  return startAction(quick.action, text, session, services, null);
}

/** A sentence that needs understanding: Jev picks the action while LiteLLM reads the details. */
async function understand(
  text: string,
  session: AssistantSession,
  services: TurnServices,
): Promise<Outcome> {
  const { catalog } = services;
  const draft = session.conversation.active;
  const { state, questions } = buildIntentQuestions(text, catalog, draft);
  // Details are read for every action while Jev decides, so neither waits for the other. Only
  // the answers that need details wait for them; "nothing fits" replies as soon as Jev does.
  const inProgress = draft && { action: draft.action, asking: draft.asking };
  const pendingDetails = services
    .readDetails(text, [...catalog.values()], inProgress)
    .catch((): ReadDetails => NO_DETAILS);
  const answers = await services.askJev(state, questions);
  if (!answers) {
    return { session, reply: replyForError('I couldn’t work that out just now. Please try again.') };
  }

  if (draft && inProgress && (continuesProbability(answers) ?? 0) >= CONTINUE_PROBABILITY) {
    const words = await wordsFor(draft.action, text, await pendingDetails, services, inProgress);
    const action = catalog.get(draft.action);
    if (!action) return { session, reply: replyForError('That request is no longer available.') };
    const updates = await toFieldUpdates(action, words, services.records, true);
    return applyEvent({ type: 'details', updates }, session, services);
  }

  const decision = decideIntent(rankActions(answers, catalog));
  switch (decision.kind) {
    case 'none':
      return withReply(session, replyForNothingFits(catalog));
    case 'ask':
      return withReply(session, replyForActionChoice(decision.actions, catalog, text));
    case 'act':
      return startAction(decision.action, text, session, services, await pendingDetails);
  }
}

/** A new request for `actionId`, with whatever details the sentence carried. */
async function startAction(
  actionId: string,
  text: string,
  session: AssistantSession,
  services: TurnServices,
  details: ReadDetails | null,
): Promise<Outcome> {
  const action = services.catalog.get(actionId);
  if (!action) return withReply(session, replyForError('I can’t do that yet.'));
  const words = text ? await wordsFor(actionId, text, details, services, null) : {};
  const updates = await toFieldUpdates(action, words, services.records, true);
  return applyEvent({ type: 'request', action: actionId, updates }, session, services);
}

/**
 * The details for `actionId`: reused when LiteLLM already read them for that action, read
 * again for just that action otherwise.
 */
async function wordsFor(
  actionId: string,
  text: string,
  details: ReadDetails | null,
  services: TurnServices,
  inProgress: { action: string; asking: string | null } | null,
): Promise<ReadDetails['fields']> {
  if (details?.action === actionId) return details.fields;
  const action = services.catalog.get(actionId);
  if (!action) return {};
  return (await services.readDetails(text, [action], inProgress)).fields;
}

/** Runs one engine event and turns the step into a reply, or into a plan to run. */
function applyEvent(event: TurnEvent, session: AssistantSession, services: TurnServices): Outcome {
  const { state, step, notes } = advance(session.conversation, event, services.catalog);
  const next: AssistantSession = { ...session, conversation: state };
  if (step.kind !== 'run') return withReply(next, replyForStep(step, notes));

  const runId = services.newId();
  const after = reminderFor(notes);
  return {
    session: {
      ...next,
      question: null,
      run: { runId, action: step.action, done: step.done, ...(after ? { after } : {}) },
    },
    reply: { say: '', question: null, expectsReply: false },
    run: { runId, plan: step.plan },
  };
}

/** The dashboard ran the plan: say the action's final words, or what went wrong. */
function finishRun(
  runId: string,
  results: ReadonlyArray<{ ok: boolean; error?: string | undefined }>,
  session: AssistantSession,
): Outcome {
  const { run } = session;
  if (!run || run.runId !== runId) {
    return { session, reply: replyForError('That result doesn’t match anything I’m running.') };
  }
  const cleared: AssistantSession = { ...session, run: null };
  const failed = results.find(result => !result.ok);
  if (failed || results.length === 0) {
    const reason = failed?.error ? `: ${failed.error}` : '.';
    return { session: cleared, reply: replyForError(`That didn’t finish${reason}`) };
  }
  const say = [run.done, run.after].filter(Boolean).join(' ');
  return { session: cleared, reply: { say, question: null, expectsReply: false } };
}

function withReply(session: AssistantSession, reply: Reply): Outcome {
  return { session: { ...session, question: reply.question }, reply };
}
