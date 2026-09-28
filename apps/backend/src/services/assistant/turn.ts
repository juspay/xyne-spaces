import {
  advance,
  type ActionCatalog,
  type ActionDefinition,
  type ClientContext,
  type EntityRef,
  type FieldUpdate,
  type PlanRun,
  type TurnDebug,
  type TurnEvent,
  type TurnInput,
  type TurnResponse,
} from '@xyne/shared/assistant';
import type { JevAnswer, JevQuestion, JevState } from '@/services/queryIntent/jevClient';
import { toFieldUpdates } from './fieldUpdates';
import { MAX_VALUE_WORDS, readingFor, type FieldWords } from './fields';
import { readSentence, type RankedAction, type SentenceKind, type Understanding } from './intent';
import { quickChoice, quickText, type QuickReply } from './quickReplies';
import { withScreen, type RecordFinder } from './records';
import {
  replyForActionChoice,
  replyForAside,
  replyForError,
  replyForKind,
  replyForNothingFits,
  replyForQuestion,
  replyForStep,
  type Reply,
} from './reply';
import type { AssistantSession, SessionIdentity, SessionStore } from './session';

/**
 * One turn of the conversation, start to finish:
 *
 *   load the session → answer instantly if the reply needs no model
 *   → otherwise ask Jev, in one request, which action and which words are its details
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
    questions: Record<string, JevQuestion>
  ) => Promise<Record<string, JevAnswer> | null>;
  newId: () => string;
  /** Adds how each sentence was understood to the response, for the Diagnose log. */
  debug: boolean;
}

/** Treat a sentence as part of the request in progress when Jev is at least this sure. */
const CONTINUE_PROBABILITY = 0.5;
/** Actions offered when nothing fits, closest first. */
const MAX_SUGGESTIONS = 4;

interface Outcome {
  session: AssistantSession;
  reply: Reply;
  run?: PlanRun;
  debug?: TurnDebug;
}

export async function handleTurn(
  input: TurnInput,
  identity: SessionIdentity,
  services: TurnServices,
  context: ClientContext
): Promise<TurnResponse> {
  const session = await services.sessions.load(identity);
  const records = withScreen(services.records, context.onScreen);
  const outcome = await respond(input, session, { ...services, records }, context.onScreen);
  await services.sessions.save(identity, outcome.session);
  return {
    turnId: services.newId(),
    say: outcome.reply.say,
    ...(outcome.reply.display ? { display: outcome.reply.display } : {}),
    ...(outcome.run ? { run: outcome.run } : {}),
    expectsReply: outcome.reply.expectsReply,
    ...(outcome.reply.tone ? { tone: outcome.reply.tone } : {}),
    ...(outcome.reply.handoff ? { handoff: outcome.reply.handoff } : {}),
    ...(services.debug && outcome.debug ? { debug: outcome.debug } : {}),
  };
}

async function respond(
  input: TurnInput,
  session: AssistantSession,
  services: TurnServices,
  onScreen: readonly EntityRef[]
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
        : understand(input.text, session, services, onScreen);
    }
  }
}

async function applyQuickReply(
  quick: QuickReply,
  session: AssistantSession,
  services: TurnServices
): Promise<Outcome> {
  if (quick.kind === 'event') return applyEvent(quick.event, session, services);
  // "Did you mean …?" answered: read the original words again for the chosen action.
  const text = session.question?.kind === 'action' ? session.question.text : '';
  return startAction(quick.action, text, session, services);
}

/** A sentence that needs understanding: one Jev request reads the action and its details. */
async function understand(
  text: string,
  session: AssistantSession,
  services: TurnServices,
  onScreen: readonly EntityRef[]
): Promise<Outcome> {
  const { catalog } = services;
  const draft = session.conversation.active;
  const screen = await channelName(onScreen, services.records);
  const reading = readSentence(text, catalog, { draft, ...(screen ? { screen } : {}) });
  const answers = await services.askJev(reading.state, reading.questions);
  if (!answers) {
    return {
      session,
      reply: replyForError('I couldn’t work that out just now. Please try again.'),
    };
  }

  const heard = reading.read(answers);
  const { kind, decision, ranked } = heard;
  const continues = (heard.continues ?? 0) >= CONTINUE_PROBABILITY;
  const debug: TurnDebug = {
    ...(answers.kind?.type === 'choice' ? { kind: answers.kind.probabilities } : {}),
    actions: ranked.slice(0, 3),
    ...(heard.continues !== null ? { continues: heard.continues } : {}),
  };
  const withDebug = (outcome: Outcome): Outcome => ({ ...outcome, debug });

  const action = draft && catalog.get(draft.action);
  if (draft && action) {
    const asking = draft.awaiting?.kind === 'field' ? draft.awaiting.field : null;
    // Help or a question mid-request is answered, and the request's question asked again.
    if (asking && !continues && (kind === 'help' || kind === 'question')) {
      const openQuestion = await applyEvent({ type: 'details', updates: [] }, session, services);
      return withDebug({
        ...openQuestion,
        reply: replyForAside(kind, text, catalog, openQuestion.reply),
      });
    }
    // Otherwise it continues the request when Jev says so, or when a question is open: then
    // anything but a clear new request is its answer ("Random." when asked for a name).
    if (continues || (asking && decision.kind !== 'act')) {
      const words = heard.words(action) ?? (await wordsFor(action, text, services));
      // Answering "which one?" with more details ("the one with Meera") looks again with the
      // same words, narrowed by the new ones.
      const [name] = draft.open;
      if (name?.options.length && !words[name.field]) words[name.field] = name.said;
      const answer = asking && !words[asking] ? { [asking]: bareAnswer(text) } : {};
      const updates = await toFieldUpdates(
        action,
        { ...words, ...answer },
        services.records,
        true,
        draft.values,
        text
      );
      return withDebug(
        await applyEvent(
          { type: 'details', updates: requireLongTextPreview(action, text, updates) },
          session,
          services
        )
      );
    }
  }

  switch (decision.kind) {
    case 'act':
      return withDebug(await startAction(decision.action, text, session, services, heard));
    case 'ask':
      return withDebug(withReply(session, replyForActionChoice(decision.actions, catalog, text)));
    case 'none':
      return withDebug(withReply(session, replyWhenNothingFits(kind, text, ranked, catalog)));
  }
}

/** The name of the channel open on screen, read again under the user's access. */
async function channelName(
  onScreen: readonly EntityRef[],
  records: RecordFinder
): Promise<string | undefined> {
  const open = onScreen.find((ref) => ref.kind === 'channel');
  return open ? (await records.get('channel', open.id))?.record.name : undefined;
}

/** No action fits: reply to what kind of sentence it was. */
function replyWhenNothingFits(
  kind: SentenceKind,
  text: string,
  ranked: readonly RankedAction[],
  catalog: ActionCatalog
): Reply {
  switch (kind) {
    case 'question':
      return replyForQuestion(text);
    case 'action': {
      // A task the assistant cannot do yet: offer the closest ones it can.
      const closest = ranked.length
        ? ranked.map(({ action }) => action)
        : [...catalog.values()].map(({ id }) => id);
      return replyForNothingFits(catalog, closest.slice(0, MAX_SUGGESTIONS));
    }
    default:
      return replyForKind(kind, catalog);
  }
}

/** A new request for `actionId`, with whatever details the sentence carried. */
async function startAction(
  actionId: string,
  text: string,
  session: AssistantSession,
  services: TurnServices,
  heard?: Understanding
): Promise<Outcome> {
  const action = services.catalog.get(actionId);
  if (!action) return withReply(session, replyForError('I can’t do that yet.'));
  const words = text ? (heard?.words(action) ?? (await wordsFor(action, text, services))) : {};
  const updates = await toFieldUpdates(action, words, services.records, true, {}, text);
  return applyEvent(
    {
      type: 'request',
      action: actionId,
      updates: requireLongTextPreview(action, text, updates),
    },
    session,
    services
  );
}

/** A long request can produce a plausible but incomplete text span. Make the send preview
 * explicit while leaving exact people and channel matches certain. */
function requireLongTextPreview(
  action: ActionDefinition,
  text: string,
  updates: FieldUpdate[]
): FieldUpdate[] {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (
    action.effect !== 'send' ||
    wordCount <= MAX_VALUE_WORDS ||
    !Object.values(action.fields).some((field) => field.kind === 'text')
  ) {
    return updates;
  }

  return updates.map((update) =>
    action.fields[update.field]?.kind === 'text' && update.op === 'set'
      ? { ...update, certain: false }
      : update
  );
}

/** The details the sentence gives for `action`: the words of it that Jev picked. */
async function wordsFor(
  action: ActionDefinition,
  text: string,
  services: TurnServices
): Promise<FieldWords> {
  const reading = readingFor(action, text);
  if (Object.keys(reading.questions).length === 0) return {};
  const answers = await services.askJev(reading.state, reading.questions);
  return answers ? reading.read(answers) : {};
}

/** A reply given as is, when nothing more could be read from it: "Random." → "Random". */
function bareAnswer(text: string): string {
  return text.trim().replace(/[.!?]+$/, '');
}

/** Runs one engine event and turns the step into a reply, or into a plan to run. */
async function applyEvent(
  event: TurnEvent,
  session: AssistantSession,
  services: TurnServices
): Promise<Outcome> {
  let { state, step } = advance(session.conversation, event, services.catalog);
  // A search waiting for the names that narrow it runs once they are settled.
  while (step.kind === 'lookup') {
    const draft = state.active;
    const action = draft && services.catalog.get(draft.action);
    if (!draft || !action)
      return { session, reply: replyForError('That request is no longer available.') };
    const updates = await toFieldUpdates(
      action,
      { [step.field]: step.said },
      services.records,
      true,
      draft.values
    );
    ({ state, step } = advance(state, { type: 'details', updates }, services.catalog));
  }

  const next: AssistantSession = { ...session, conversation: state };
  if (step.kind !== 'run') return withReply(next, replyForStep(step));

  const runId = services.newId();
  return {
    session: {
      ...next,
      question: null,
      run: { runId, action: step.action, expectedResults: step.plan.length, done: step.done },
    },
    reply: { say: '', question: null, expectsReply: false },
    run: { runId, plan: step.plan },
  };
}

/** The dashboard ran the plan: say the action's final words, or what went wrong. */
function finishRun(
  runId: string,
  results: ReadonlyArray<{ ok: boolean; error?: string | undefined }>,
  session: AssistantSession
): Outcome {
  const { run } = session;
  if (!run || run.runId !== runId) {
    return { session, reply: replyForError('That result doesn’t match anything I’m running.') };
  }
  const cleared: AssistantSession = { ...session, run: null };
  const failed = results.find((result) => !result.ok);
  if (failed || results.length === 0) {
    const reason = failed?.error ? `: ${failed.error}` : '.';
    return { session: cleared, reply: replyForError(`That didn’t finish${reason}`) };
  }
  if (run.expectedResults !== undefined && results.length > run.expectedResults) {
    return {
      session: cleared,
      reply: replyForError('That result doesn’t match the actions I ran.'),
    };
  }
  if (run.expectedResults !== undefined && results.length !== run.expectedResults) {
    return {
      session: cleared,
      reply: replyForError(
        'I can’t confirm this finished because some action results are missing.'
      ),
    };
  }
  return { session: cleared, reply: { say: run.done, question: null, expectsReply: false } };
}

function withReply(session: AssistantSession, reply: Reply): Outcome {
  return { session: { ...session, question: reply.question }, reply };
}
