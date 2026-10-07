import type { JsonValue } from '@openfeature/server-sdk';
import { logger } from '@/utils/logger';
import { isProbability } from '@/utils/probability';
import { superpositionClient } from '@/services/superpositionClient';
import { ASSISTANT_ROUTE_NONE_ID as NONE_ID } from '@/validators/assistantRouteValidator';
import {
  askJev,
  isJevConfigured,
  type JevAnswer,
  type JevChoiceQuestion,
  type JevNoulQuestion,
  type JevFailure,
  type JevQuestion,
} from '@/services/queryIntent/jevClient';
import { clearCandidates, isBareName, namedAction } from './candidates';
import { fieldReading, type AssistantRouteField, type FieldFloor } from './fields';

export interface AssistantRouteAction {
  id: string;
  description: string;
  fields?: Record<string, AssistantRouteField>;
  // Hidden from this user by their role: Jev may choose it, so they are told they lack access
  // rather than given its nearest neighbour. It is never acted on, and no field is read for it.
  unavailable?: boolean;
}

/** A question the assistant just asked, which the sentence may answer. */
export interface AssistantRoutePending {
  action: string;
  field?: string; // absent when the question is about the whole request
  prompt: string;
}

type FieldValues = Record<string, string>;

type AssistantRouteResult =
  | {
      route: 'actions';
      actionIds: string[];
      confidence: number;
      fields?: Record<string, FieldValues>;
    }
  // Between the two thresholds: the user is asked which of these actions they meant, if any.
  | { route: 'unsure'; actionIds: string[]; fields?: Record<string, FieldValues> }
  | { route: 'answer'; fields: FieldValues }
  // `answering`, with a question pending: P(the sentence answers it), for the client to judge a
  // short reply that no field was read from.
  | { route: 'ask_ai'; reason: 'none' | 'low_confidence' | 'not_request'; answering?: number }
  // The action meant is one the user's role hides.
  | { route: 'no_access'; actionId: string }
  // `reason`: why nothing was routed, for the logs and the eval; never user content.
  | { route: 'unavailable'; reason: UnavailableReason };

type UnavailableReason =
  | 'not_configured'
  | 'switched_off'
  | 'no_choice'
  | JevFailure['kind']
  | `status_${number}`;

interface AssistantRouteContext {
  userId: string;
  workspaceId: string;
}

// Overrides `enabled` and the thresholds without a deploy.
const CONFIG_KEY = 'assistant_route_config';

// Tuned on jev-latest; re-tune when JEV_MODEL changes. Both thresholds apply to 1 - p(none), not
// the top option: a sentence naming several actions splits the mass between them. From
// ACTION_THRESHOLD up the request is acted on; from UNSURE_THRESHOLD up to it the user is asked
// which action they meant. Jev's answers shift by about 8% between identical calls, and a band
// keeps a request near the edge from flipping between acting and Ask AI.
const ACTION_THRESHOLD = 0.8;
const UNSURE_THRESHOLD = 0.5;
const ALSO_THRESHOLD = 0.1;
// P(the sentence asks for something to be done now) below which nothing is acted on or offered:
// "i created a channel yesterday", "rahul built an agent". Not asked while a question is pending,
// whose answers the pending rules judge. On the tune split, sentences about what was done or what
// someone else did reach 0.14 at most, and requests to act go down to 0.18.
const REQUEST_FLOOR = 0.15;
// The most actions the user is asked to choose between.
const MAX_UNSURE_ACTIONS = 2;

// The least probability of its best span for a field's value to count as said: below it the span
// is mostly a guess for something the user never gave.
const FIELD_FLOOR = 0.5;
// The same for the other fields of the action while a question about one field is pending: it
// keeps "call it ops and make it private" working, but a stray span does not fill a field the
// question was not about.
const UNASKED_FLOOR = 0.7;
// P(the sentence answers the pending question) from which it is the answer on that alone: it
// overlaps with off-topic replies between 0.28 and 0.56, so below it a value for what was asked
// (or the pending action asked for again) is needed too.
const STRONG_ANSWER = 0.7;
// How far another action must lead the pending one to be asked for instead, when the question is
// about the whole request ("tell me more, or pick one"): any field of it answers that, so "mention
// Sarah to do an RCA" would narrow a search by Sarah. On the eval's turns after a list, requests
// for another action lead by 0.22 and more, while a narrowing Jev also reads as another action
// ("in the android channel" as browse channels) leads by 0.03.
const SWITCH_LEAD = 0.2;

// Kinds whose value is any words of the sentence.
const FREE_TEXT_KINDS: ReadonlySet<string> = new Set(['text', 'longtext']);
// The least 1 - p(none) of the actions for a free-text value to count as said. On the tune split,
// answers to a text question reach at least 0.4 and off-topic requests at most 0.2.
const FREE_TEXT_MIN_CONFIDENCE = 0.3;

// The most a turn waits for Jev. About 1 call in 400 takes over 2 s (Jev's own tail), and
// cutting it off sends a request to Ask AI, so the limit is generous.
const TIMEOUT_MS = 5000;
// A second identical call starts when the first has taken this long: Jev's median is about
// 310 ms, but about one call in ten takes over a second.
const HEDGE_AFTER_MS = 800;

// Field questions make most of the request (about 215 tokens each), and Jev's latency grows with
// its length, so they are asked only for this many actions, those likeliest from the sentence's
// words, and for the pending one. Every action stays in the choice of which. Measured on the tune
// split: p50 333 -> 261 ms and p90 464 -> 363 ms, with the fields read as well as before.
const FIELD_QUESTION_ACTIONS = 5;
// Words too common to tell one action from another.
const STOP_WORDS = new Set(
  (
    'a an the to of for in on at and or is it my me i you we this that with do does can how what ' +
    'please want would like be as by from about some any'
  ).split(' ')
);

const NONE_DESCRIPTION =
  'None of these: a general question, or a request about something else, for the AI assistant to answer.';

const INSTRUCTIONS =
  'Which of these is the user asking to do now, or asking how they can do? Pick none when the ' +
  'message is about something else, is a general question, is about something already done or ' +
  'what someone else does, or says not to do it.';

interface AssistantRouteConfig {
  enabled: boolean;
  actionThreshold: number;
  unsureThreshold: number;
  alsoThreshold: number;
  requestFloor: number;
}

const DEFAULT_CONFIG: AssistantRouteConfig = {
  enabled: true,
  actionThreshold: ACTION_THRESHOLD,
  unsureThreshold: UNSURE_THRESHOLD,
  alsoThreshold: ALSO_THRESHOLD,
  requestFloor: REQUEST_FLOOR,
};

// Said once per process: a config outage must not fill the logs, nor switch Buddy off.
let configOutageLogged = false;
const configOutage = (why: string): AssistantRouteConfig => {
  if (!configOutageLogged)
    logger.warn('assistant route config unavailable, using defaults', { why });
  configOutageLogged = true;
  return DEFAULT_CONFIG;
};

// The defaults when Superposition is not ready or fails: retrying its init here would hold the
// request for its full network timeout. Only its answer can switch Buddy off. Remote fields are
// checked one by one, so a mistyped value cannot turn the kill switch off or make every message
// match.
const getConfig = async (ctx: AssistantRouteContext): Promise<AssistantRouteConfig> => {
  if (!superpositionClient.isReady()) return configOutage('not ready');
  let remote: unknown;
  try {
    remote = await superpositionClient.getObjectValue(
      CONFIG_KEY,
      DEFAULT_CONFIG as unknown as JsonValue,
      { userId: ctx.userId, workspaceId: ctx.workspaceId }
    );
  } catch {
    return configOutage('failed');
  }
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return DEFAULT_CONFIG;
  const { enabled, actionThreshold, unsureThreshold, alsoThreshold, requestFloor } =
    remote as Record<string, unknown>;
  return {
    enabled: enabled === undefined ? DEFAULT_CONFIG.enabled : enabled === true,
    actionThreshold: isProbability(actionThreshold)
      ? actionThreshold
      : DEFAULT_CONFIG.actionThreshold,
    unsureThreshold: isProbability(unsureThreshold)
      ? unsureThreshold
      : DEFAULT_CONFIG.unsureThreshold,
    alsoThreshold: isProbability(alsoThreshold) ? alsoThreshold : DEFAULT_CONFIG.alsoThreshold,
    requestFloor: isProbability(requestFloor) ? requestFloor : DEFAULT_CONFIG.requestFloor,
  };
};

const ANSWERS_PENDING: JevNoulQuestion = {
  type: 'noul',
  instructions:
    '`question` is what the assistant just asked the user while helping with `request`. Does ' +
    '`text` give what `question` asks for? A reply that asks something back, or asks for ' +
    'something else, does not.',
};

// Whether the sentence asks for anything at all, beside the choice of which action it would be.
const ASKS_NOW: JevNoulQuestion = {
  type: 'noul',
  instructions:
    'Does `text` ask the assistant to do something now? It does not when it only says what was ' +
    'already done, what someone else did, or what the user does not want.',
};

/**
 * The field questions for `actions`, and a reader of their answers: values by action id, each
 * field kept when it reaches `floorFor(action id, field)`.
 */
const readFields = (
  text: string,
  actions: AssistantRouteAction[],
  pending?: AssistantRoutePending
) => {
  const questions: Record<string, JevQuestion> = {};
  const readings = actions.flatMap((action) => {
    if (!action.fields || Object.keys(action.fields).length === 0) return [];
    const name = action.id.replace(/_/g, ' ');
    const premise =
      pending?.action === action.id
        ? `If \`text\` answers \`question\`, or asks for this action (${name}): `
        : `If \`text\` asks for this action (${name}): `;
    const reading = fieldReading(action.fields, text, (field) => `${action.id}.${field}`, premise);
    Object.assign(questions, reading.questions);
    return [{ id: action.id, reading }];
  });
  return {
    questions,
    read: (
      answers: Record<string, JevAnswer> | null,
      floorFor: (action: string, field: string) => FieldFloor
    ): Record<string, FieldValues> =>
      Object.fromEntries(
        readings
          .map(({ id, reading }): [string, FieldValues] => [
            id,
            reading.read(answers ?? {}, (field) => floorFor(id, field)),
          ])
          .filter(([, values]) => Object.keys(values).length > 0)
      ),
  };
};

const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !STOP_WORDS.has(word))
    .map((word) => word.replace(/(ing|ed|es|s)$/, ''))
    .filter((word) => word.length > 1);

// What an action is for, without what it is not for: that part names other actions ("creating
// one (that is create_channel)"), whose words would rank it for their sentences.
const NOT_FOR = ' Not for: ';
const purposeOf = (action: AssistantRouteAction): string =>
  `${action.id.replace(/_/g, ' ')} ${action.description.split(NOT_FOR)[0] ?? ''}`;

/**
 * The actions whose fields are asked for: the FIELD_QUESTION_ACTIONS whose id and description
 * (its examples included) share the most words with the sentence, a rarer word weighing more, and
 * the pending one. All of them when the sentence shares no word with any: nothing tells them
 * apart.
 */
const fieldActions = (
  text: string,
  actions: AssistantRouteAction[],
  pending?: string
): AssistantRouteAction[] => {
  const known = actions.map((action) => new Set(wordsOf(purposeOf(action))));
  const weight = (word: string): number =>
    known.some((words) => words.has(word))
      ? Math.log(1 + actions.length / known.filter((words) => words.has(word)).length)
      : 0;
  const said = [...new Set(wordsOf(text))];
  const ranked = actions
    .map((action, at) => ({
      id: action.id,
      score: said.reduce((sum, word) => sum + (known[at]?.has(word) ? weight(word) : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  if (!ranked[0]?.score) return actions;
  const kept = new Set(ranked.slice(0, FIELD_QUESTION_ACTIONS).map(({ id }) => id));
  if (pending) kept.add(pending);
  return actions.filter((action) => kept.has(action.id));
};

const shuffle = <T>(items: T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

export const routeAssistantMessage = async (
  request: { text: string; actions: AssistantRouteAction[]; pending?: AssistantRoutePending },
  ctx: AssistantRouteContext,
  signal?: AbortSignal
): Promise<AssistantRouteResult> => {
  const { actions } = request;
  const text = request.text.trim();
  const offerable = actions.filter((action) => !action.unavailable);
  // A pending question about an action the client did not offer is ignored.
  const pending = offerable.some((action) => action.id === request.pending?.action)
    ? request.pending
    : undefined;
  const started = Date.now();
  const finish = (
    result: AssistantRouteResult,
    chosen?: string,
    confidence?: number,
    requested?: number
  ) => {
    // Never the text, the prompt or the action descriptions: they are user content.
    const found =
      result.route === 'answer'
        ? Object.keys(result.fields).length
        : result.route === 'actions' || result.route === 'unsure'
          ? Object.values(result.fields ?? {}).reduce(
              (n, values) => n + Object.keys(values).length,
              0
            )
          : 0;
    logger.info('assistant route', {
      route: result.route,
      ...(result.route === 'unavailable' ? { reason: result.reason } : {}),
      ...(chosen ? { chosen } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(requested !== undefined ? { request: requested } : {}),
      actions: actions.length,
      fields: found,
      pending: Boolean(pending),
      latencyMs: Date.now() - started,
    });
    return result;
  };

  if (!isJevConfigured()) return finish({ route: 'unavailable', reason: 'not_configured' });
  const config = await getConfig(ctx);
  if (!config.enabled) return finish({ route: 'unavailable', reason: 'switched_off' });

  // Shuffled against position bias. Built with fromEntries, not `criteria[id] =`: ids come from
  // the request, and fromEntries defines own keys without going through prototype setters.
  const criteria: Record<string, string> = Object.fromEntries([
    ...shuffle(actions).map((action) => [action.id, action.description]),
    [NONE_ID, NONE_DESCRIPTION],
  ]);
  const question: JevChoiceQuestion = { type: 'choice', instructions: INSTRUCTIONS, criteria };

  // The likeliest actions' fields are read in the same request as the action, so one call is all
  // it takes.
  const fields = readFields(text, fieldActions(text, offerable, pending?.action), pending);

  // `partial`: one unusable field answer must not cost the turn.
  let failure: UnavailableReason = 'no_choice';
  const answers = await askJev(
    // The request the question belongs to: "the checkout outage" answers "What was it about?"
    // only once Jev knows it is about finding messages.
    pending
      ? { text, question: pending.prompt, request: pending.action.replace(/_/g, ' ') }
      : { text },
    {
      action: question,
      ...(pending ? { answers: ANSWERS_PENDING } : { request: ASKS_NOW }),
      ...fields.questions,
    },
    TIMEOUT_MS,
    signal,
    {
      partial: true,
      hedgeAfterMs: HEDGE_AFTER_MS,
      onFailure: (why) => {
        failure = why.kind === 'status' ? `status_${why.status}` : why.kind;
      },
    }
  );
  const answer = answers?.action;
  if (!answer || answer.type !== 'choice') {
    return finish({ route: 'unavailable', reason: failure });
  }

  const scored = Object.entries(answer.probabilities)
    .filter(([id]) => id !== NONE_ID && Object.prototype.hasOwnProperty.call(criteria, id))
    .sort((a, b) => b[1] - a[1]);
  const confidence =
    scored.length > 0
      ? Math.min(
          1,
          scored.reduce((sum, [, p]) => sum + p, 0)
        )
      : (answer.confidence ?? 0);
  const confident = confidence >= config.actionThreshold;
  const top = scored[0]?.[0];
  const noul = answers.answers?.type === 'noul' ? answers.answers.noul : undefined;
  const answering = noul === undefined ? {} : { answering: noul };
  const requested = answers.request?.type === 'noul' ? answers.request.noul : undefined;

  // The sentence answers the pending question unless it clearly asks for a different action.
  const probability = (id: string | undefined): number =>
    scored.find(([candidate]) => candidate === id)?.[1] ?? 0;
  const leads =
    !!pending && !pending.field && probability(top) - probability(pending.action) >= SWITCH_LEAD;
  const switching = (confident || leads) && answer.choice !== NONE_ID && top !== pending?.action;
  if (pending && !switching) {
    // The field asked about counts as said at FIELD_FLOOR, whichever span it is: the answer is
    // often a few words in a longer sentence. With a field pending, the action's other fields
    // need UNASKED_FLOOR: part of an answer may be about them, but a stray span is not.
    const readAll =
      fields.read(answers, (id, field): FieldFloor => {
        const asked = id === pending.action && field === pending.field;
        if (asked) return { floor: FIELD_FLOOR, by: 'said' };
        return {
          floor: id !== pending.action || !pending.field ? FIELD_FLOOR : UNASKED_FLOOR,
          by: 'span',
        };
      })[pending.action] ?? {};
    // Offered alone, the action was picked on a card: whatever Jev thinks of the sentence, it is
    // read for that action, free text and all.
    const picked = offerable.length === 1;
    // Any sentence can be read as a description or a topic, so "tell me a joke" would fill what
    // the agent should do. Free text therefore counts only for the question asked (any, when what
    // to change is asked), and only when the sentence is not clearly about something else.
    const pendingFields = actions.find((action) => action.id === pending.action)?.fields ?? {};
    const read = Object.fromEntries(
      Object.entries(readAll).filter(
        ([field]) =>
          picked ||
          !FREE_TEXT_KINDS.has(pendingFields[field]?.kind ?? 'text') ||
          ((!pending.field || field === pending.field) && confidence >= FREE_TEXT_MIN_CONFIDENCE)
      )
    );
    // A value for any field of the pending action is an answer, or a correction ("yes but call
    // it Zed"): "make it private" answers a question about the name.
    const evidence = Object.keys(read).length > 0;
    if (picked || evidence || (noul ?? 0) >= STRONG_ANSWER) {
      return finish({ route: 'answer', fields: read }, pending.action, noul);
    }
    // About the pending action with no value in it is a question about it ("what is an agent?"):
    // Ask AI answers it, and the open question stays.
    if (top === pending.action)
      return finish({ route: 'ask_ai', reason: 'none', ...answering }, top);
  }

  const values = fields.read(answers, () => ({ floor: FIELD_FLOOR, by: 'span' }));
  const asksNow = requested === undefined || requested >= config.requestFloor;
  // An action's bare name ("Send message.") asks for it, however unsure Jev is of so few words.
  const bare = pending ? undefined : namedAction(text, actions);
  if (bare && asksNow && isBareName(text, bare)) {
    const hidden = actions.find((action) => action.id === bare)?.unavailable;
    if (hidden) return finish({ route: 'no_access', actionId: bare }, bare, confidence, requested);
    const read = values[bare] ? { fields: { [bare]: values[bare] } } : {};
    return finish(
      { route: 'actions', actionIds: [bare], confidence, ...read },
      bare,
      confidence,
      requested
    );
  }

  if (answer.choice === NONE_ID) {
    return finish({ route: 'ask_ai', reason: 'none', ...answering }, NONE_ID);
  }
  if (confidence < config.unsureThreshold) {
    return finish(
      { route: 'ask_ai', reason: 'low_confidence', ...answering },
      answer.choice,
      confidence
    );
  }
  // Which action fits says nothing of whether it is asked for: "rahul built an agent" is about
  // creating one. Without an answer to this the choice alone decides, as before.
  if (!asksNow) {
    return finish({ route: 'ask_ai', reason: 'not_request' }, answer.choice, confidence, requested);
  }

  const chosen = top ?? answer.choice;
  const definition = actions.find((action) => action.id === chosen);
  if (definition?.unavailable) {
    return finish({ route: 'no_access', actionId: chosen }, chosen, confidence, requested);
  }
  const offered = scored
    .filter(([id, p]) => p >= config.alsoThreshold && offerable.some((action) => action.id === id))
    .map(([id]) => id);
  const candidates = clearCandidates(offered.length > 0 ? offered : [chosen], {
    text,
    actions: offerable,
    values,
    probability,
  });
  // The one action left, asked for by its own name with something in it ("send a message to
  // Sarah"), is acted on however unsure Jev is: a change is still confirmed before it is done.
  const [only] = candidates;
  const asked =
    candidates.length === 1 && !!only && !!values[only] && namedAction(text, offerable) === only;
  const acting = confidence >= config.actionThreshold || asked;
  const actionIds = acting ? candidates : candidates.slice(0, MAX_UNSURE_ACTIONS);
  const found = Object.fromEntries(
    actionIds.filter((id) => values[id]).map((id) => [id, values[id]])
  );
  const withFields = Object.keys(found).length > 0 ? { fields: found } : {};

  return finish(
    acting
      ? { route: 'actions', actionIds, confidence, ...withFields }
      : { route: 'unsure', actionIds, ...withFields },
    actionIds[0],
    confidence,
    requested
  );
};
