/**
 * The conversational-flow view of a workflow, where the config *is* the tree.
 *
 * A section is a CYCLE whose id is that section's screen; the screens under it
 * are the cases of its SWITCH. So a screen's place in the tree is structural,
 * not derived from where options happen to point — and what a screen can read
 * is what the frames around it ran on the way in.
 *
 *   CYCLE root                         ← the conversation
 *     SWITCH
 *       case root         eq(screen, 'root')                  → WAIT
 *       case payments     any(screen ∈ payments' subtree)     → [calls…, CYCLE payments]
 *                                                                  SWITCH
 *                                                                    case payments  eq  → WAIT
 *                                                                    case refunds   any → [calls…, CYCLE refunds]
 *
 * Nothing here is stored: it is rebuilt from the config on every change.
 */

import type { Condition } from '../types/workflow-config.js';

/** Where an option, a typed message, or a failed call sends someone. */
export type Destination =
  /** Another screen, wherever it sits: the jump names the nearest cycle enclosing both. */
  | { kind: 'screen'; screen: string }
  /** A FINISH: the conversation ends carrying `value`. */
  | { kind: 'end'; value: Record<string, unknown> }
  /** Decided at run time by a step's output — a classifier, an agent. */
  | { kind: 'dynamic'; from: string; fromType: string | undefined }
  /** Nothing this view can read. */
  | { kind: 'none' };

/**
 * What a screen is, read from the steps in its case — never from its name:
 *
 * - `menu`      asks, and its options open the screens beneath it
 * - `message`   says something; its options lead back, across, or out
 * - `input`     asks for something on the way in, then opens the one screen inside it
 * - `ask-ai`    an agent answers until they pick a way out
 * - `router`    no question: it reads typed text and opens the screen that fits
 * - `end`       a FINISH — the conversation ends here
 * - `handoff`   a person takes the conversation until they send it back
 * - `custom`    steps this view cannot read; shown, and edited as steps
 */
export type ScreenKind = 'menu' | 'message' | 'input' | 'ask-ai' | 'router' | 'end' | 'handoff' | 'custom';

export interface PromptOption {
  label: string;
  value: string;
  to: Destination;
  /** Leads to one of this screen's ancestors. */
  back: boolean;
  /**
   * Offered only when this holds. Absent means always offered.
   *
   * The whole question is still asked — this is one line of it appearing or
   * not, which is why it is stored on the option rather than as a branch: two
   * people are asked the same thing and owed different choices.
   */
  when?: Condition;
}

/** One question: a WAIT with a select field, and optionally a text field. */
export interface Prompt {
  /** The WAIT step's id. */
  id: string;
  /**
   * What the screen says, in order. Several are sent one after another rather
   * than as one paragraph; a screen that says nothing has none.
   */
  says: string[];
  /** The heading shown above it — usually the breadcrumb. */
  header: string | undefined;
  choiceField: string | undefined;
  textField: string | undefined;
  options: PromptOption[];
  /** Where typed text goes, when this question takes any. */
  freeText: Destination | undefined;
  /**
   * Set when the options are not a list but a reference to what a lookup found.
   * The destinations are then unknown until it runs, so nothing can draw them.
   */
  optionsFrom?: string;
  /**
   * Asked only when this holds — a screen that says something different, or
   * offers different options, depending on the data. Absent on the version that
   * is asked when nothing else matched.
   */
  when?: Condition;
}

/**
 * What a screen asks a person for on the way into it, beyond where to go next.
 *
 * Its own WAIT, before the frame — which is what makes the answers readable by
 * every screen inside, for the whole visit, without any jump carrying them. A
 * screen without a frame has no inside, so it has no question of this kind.
 */
export interface Question {
  /** The WAIT step's id — what its answers are quoted by. */
  id: string;
  /** What it says while asking, in order. */
  says: string[];
  /** The heading shown above it. */
  header: string | undefined;
  /** What it asks for, in the order it asks. */
  asks: QuestionField[];
  /**
   * What the answers are called and of what type — the same shape a lookup's
   * fields take, because the editor offers both the same way.
   */
  answers: DeclaredField[];
  /**
   * The ways out it offers. Never the ways in: those belong to the screen's own
   * question, which is asked again every time someone comes back to it.
   */
  options: PromptOption[];
  /**
   * What its answers are for, in the author's own word — `feedback`, or
   * whatever a flow calls its own kind of question.
   *
   * It exists because the names of the fields are a flow's own business: two
   * flows can both ask how it went and call the field whatever they like, and
   * whoever reads the runs still needs to know they are the same thing.
   */
  purpose: string | undefined;
  /** The field its ways out are picked from, when it offers any. */
  choiceField: string | undefined;
  /** The box whose text is routed rather than kept, when the author routes it. */
  routedField: string | undefined;
}

/**
 * One thing to ask for, as an author writes it: what kind of answer, and what
 * to call it on screen.
 *
 * What it is *quoted* by is not here, because it is not the author's to choose —
 * it follows from the kind, so that a client reads the same name in every
 * workflow it ever talks to.
 */
export interface QuestionDraft {
  kind: 'text' | 'choice' | 'attachment';
  label: string;
  required?: boolean;
  /** For a choice: what may be picked. */
  choices?: string[];
  /** For an attachment: whether more than one may be sent. */
  multiple?: boolean;
}

/** One thing a question asks for, as the layer reads it back. */
export interface QuestionField extends QuestionDraft {
  /** What the answer is called from then on — the kind's own name. */
  name: string;
  required: boolean;
  choices: string[];
  multiple: boolean;
}

/**
 * A test the engine can make: what to read, how to compare it, against what —
 * or a group of those, joined by `all` or `any`.
 *
 * The engine's own type, not a copy of it: a condition written here is read by
 * the same evaluator that reads a CONDITIONAL's, so there is one vocabulary of
 * operators in the product and one shape on the wire.
 */
export type { Condition, LeafCondition } from '../types/workflow-config.js';

/**
 * Something the conversation fetches, and everything below it can read.
 *
 * It sits before the frame it feeds: on a section, before that section's CYCLE;
 * on a leaf screen, before its question; on the conversation, before the root
 * CYCLE. So it runs on the way in, however someone arrived, and its answer is
 * read as `{{steps.<id>.output.body.…}}` from anywhere inside.
 */
/**
 * How long a call's answer lasts, which is where its step sits:
 *
 * - `conversation`  before the first screen's cycle — once, in scope everywhere
 * - `section`       before a section's cycle — once per entry, in scope inside it
 * - `screen`        before a question — every visit, in scope on that screen
 */
export type CallScope = 'conversation' | 'section' | 'screen';

/**
 * A leaf of a declared shape, as a dotted path — what a JSON Schema says you
 * can quote.
 *
 * Named rather than written inline, because a lookup's answer and what the
 * conversation is started with are the same promise and must stay the same
 * shape.
 */
export interface DeclaredField {
  path: string;
  /** The declared JSON-Schema type, when its author declared one. */
  type: string | undefined;
  /**
   * For a list of objects: the fields of each item.
   *
   * A list is a leaf as far as quoting goes — there is no reference to one
   * item of it — but *filtering* a list means naming a field of its items
   * ("only the ones where tag is fee"), and totalling one means naming the
   * field to add up. Neither is expressible without this, and the schema
   * already says it. Absent for a list of plain values, and for everything
   * that is not a list.
   */
  itemFields?: DeclaredField[];
}

export interface Call {
  /** The step's id — what its answer is quoted by. */
  id: string;
  scope: CallScope;
  title: string;
  method: string;
  url: string;
  /** The request as the author wrote it: the step's own config. */
  request: Record<string, unknown>;
  credentialName: string | undefined;
  /** The answer's declared fields, relative to its body. */
  fields: DeclaredField[];
  /** Where to go when it cannot be reached; undefined fails the conversation. */
  onFail: string | undefined;
}

export interface RouterInfo {
  mode: 'classifier' | 'agent';
  /** The deciding step. */
  stepId: string;
  agent: string | undefined;
  model: string | undefined;
  credentialName: string | undefined;
  minConfidence: number | undefined;
  /** What it is told; generated from the screens it may choose. */
  task: string | undefined;
  /** The author's own words, kept in the step's description. */
  guidance: string | undefined;
  /** Screens it may choose — the ones in its own switch, and their subtrees. */
  candidates: string[];
}

/** An agent that answers until they choose to leave. */
export interface AskAiInfo {
  stepId: string;
  agent: string | undefined;
  task: string;
  intro: string;
  exits: PromptOption[];
}

export interface Screen {
  id: string;
  title: string;
  kind: ScreenKind;
  /** The screen this one sits inside; undefined at the top of the conversation. */
  parent: string | undefined;
  /** How many sections deep it sits. The first screen is 0. */
  depth: number;
  /** The screens inside it, in the order its switch lists them. */
  children: string[];
  /**
   * Whether it has room for screens beneath it — its own `CYCLE`.
   *
   * This is what separates a Menu from a Message, and it is the author's to give
   * or take away rather than a count of what happens to be inside: a Menu with
   * nothing in it yet is still a Menu, and a Message cannot hold a screen at all.
   */
  hasFrame: boolean;
  /**
   * Where its case lives, as frames: `['payments', 'refunds']` means the case is
   * in Refunds' switch, inside Payments'. What a screen may read is what those
   * frames fetched.
   */
  frames: string[];
  /** What it fetches on the way in — in scope for it and everything inside it. */
  calls: Call[];
  /** "The router sends people here when…" — the entry step's description. */
  about: string | undefined;
  /**
   * What it asks for on the way in: one question, or none.
   *
   * A list because the reader builds it as one, not because a screen may ask
   * two ways — it may not. Every way would be its own WAIT with its own id, and
   * what reads the answer from inside the frame can only name one of them.
   */
  questions: Question[];
  prompts: Prompt[];
  /**
   * The ways this screen asks, when it asks more than one. Each names the
   * question it starts with; the last has no condition and is what is asked when
   * none of the others hold. Empty when the screen asks one way.
   *
   * A Finish has versions too: each names its FINISH instead of a question, and
   * carries what that one reports and says.
   */
  versions: Array<{
    when?: Condition;
    promptId: string;
    endValue?: Record<string, unknown>;
    endMessage?: string | undefined;
  }>;
  router: RouterInfo | undefined;
  askAi: AskAiInfo | undefined;
  /** What an `end` screen reports, without the keys this layer reserves. */
  endValue: Record<string, unknown> | undefined;
  /** What an `end` screen says as it closes. */
  endMessage: string | undefined;
}

export interface ConversationalFlow {
  /**
   * The first screen — and the id of the CYCLE that is the conversation, since a
   * section and its screen are the same thing. Calls made before that cycle are
   * this screen's, which is what puts them in scope everywhere.
   */
  rootScreen: string;
  /** The round-state key every switch tests (usually `screen`). */
  routeKey: string;
  screens: Screen[];
  /**
   * What the conversation is started with, as its author declared it on the
   * trigger — the other place values come from, beside what a lookup fetched.
   * Quoted as `{{trigger.context.<name>}}`.
   */
  inputs: DeclaredField[];
}

/** Every option a screen offers, whatever its kind. */
/**
 * What the screen says when someone arrives: its own question's first words, or
 * the words of the question it asks on the way in.
 */
export function saysOf(screen: Screen): string[] {
  return screen.prompts[0]?.says ?? screen.questions[0]?.says ?? [];
}

/**
 * Where someone goes on from here, in the order they are offered.
 *
 * A screen that asks for something has no options to go on with — answering is
 * how they go on — so its way on is the screen inside it.
 */
export function waysOn(screen: Screen): PromptOption[] {
  if (screen.kind === 'input') {
    const inside = screen.children[0];
    return inside === undefined ? [] : [{ label: 'Once they answer', value: inside, to: { kind: 'screen', screen: inside }, back: false }];
  }
  return screen.prompts[0]?.options.filter((o) => !o.back) ?? [];
}

export function optionsOf(screen: Screen): PromptOption[] {
  return [...screen.prompts.flatMap((p) => p.options), ...screen.questions.flatMap((q) => q.options)];
}

/**
 * Where a classifier is asked when no credential says otherwise. It lives here
 * because the step that calls it and the flows that configure it both need it.
 */
export const DEFAULT_CLASSIFIER_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

/** The step types this layer recognises, named rather than imported. */
export const AGENT_STEP_TYPE = 'RUN_AGENT';
export const CLASSIFIER_STEP_TYPE = 'CLASSIFIER_AGENT';
export const HTTP_STEP_TYPE = 'HTTP_REQUEST';

/** Keys this layer reserves inside what a FINISH carries. */
export const END_MESSAGE_KEY = 'message';

/** The display section that marks a WAIT as a hand off to a person. */
export const HANDOFF_SECTION = 'handoff';

/** What separates an agent's instructions from the question put to it. */
export const QUESTION_SEPARATOR = '\n\nTheir question: ';
