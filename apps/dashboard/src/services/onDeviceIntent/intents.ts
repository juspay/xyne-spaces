/**
 * Intent registry.
 *
 * Adding an intent is a PR that touches this file plus a regenerated
 * prototypes.json — no retraining, no prompt engineering. That property is the
 * main reason this uses embeddings rather than a generative model.
 *
 * After editing `examples` or `negatives`, run `pnpm build:prototypes` and bump
 * PROTOTYPES_VERSION in the same commit.
 *
 * NOTE: these phrases are the *training* side. Do not copy strings from
 * fixtures/intents.jsonl into here — that set is held out, and overfitting it
 * makes the eval meaningless.
 *
 * See docs/ON_DEVICE_INTENT.md §5.2
 */

/**
 * A specific thing a how-to question can be *about*.
 *
 * Topics are stage 2. Stage 1 (the intent's own examples) decides whether the
 * message is a how-to at all; topics decide which one, scored on the same vector
 * with a margin rule. See scoring.ts `resolveTopic`.
 *
 * An intent's `examples` are deliberately WIDER than its `topics`: a how-to we
 * have no topic for must still be absorbed and still stay silent, which only
 * works if the gate recognises it. Adding a topic is what makes a phrasing
 * actionable — it is not enough for the gate to know about it.
 */
export interface HelpTopicSpec {
  readonly id: string;
  /**
   * Prototype phrases, max-scored like an intent's. Keep these separated from
   * each other, not just from other intents — "create a ticket" and "create a
   * canvas" are the confusable pair, not "create a ticket" and "hop on a call".
   */
  readonly examples: readonly string[];
  /**
   * Anti-prototypes, for the same reason intents have them: phrasings that share
   * this topic's vocabulary but ask for something we cannot act on. The margin
   * rule does NOT cover these — a call-recording question beats every other topic
   * decisively, so it looks confident rather than ambiguous.
   */
  readonly negatives: readonly string[];
}

export interface IntentSpec {
  readonly id: string;
  /**
   * Prototype phrases. Each is embedded at build time into its own vector;
   * scoring takes the max across them. Add phrasings that are genuinely
   * different from the ones already here — near-duplicates add cost, not recall.
   */
  readonly examples: readonly string[];
  /**
   * Anti-prototypes. Phrases that live near this intent in embedding space but
   * must NOT fire it. The intent is suppressed when a negative outscores every
   * positive.
   *
   * These exist because some collisions are unfixable from the positive side:
   * "who is on call this week" sits closer to the call-intent examples than
   * several genuine positives do, and no amount of positive phrasing separates
   * them. See the measurements in scoring.ts.
   */
  readonly negatives: readonly string[];
  /**
   * Minimum cosine similarity to trigger. Read it off the production score
   * histogram, not off the fixture eval. See docs/ON_DEVICE_INTENT.md §7.
   */
  readonly threshold: number;
  /**
   * Whether clearing the threshold should do anything at all.
   *
   * `false` makes the intent a pure ABSORBER: it competes for the top slot so
   * neighbouring intents stop claiming its phrasings, and then does nothing.
   *
   * This is a real flag rather than "set threshold to 0.99" because that trick
   * does not work — a near-exact match to an example scores 1.0000 and sails
   * over any threshold below it, producing a pointless action nothing can undo.
   *
   * `true` plus a `topics` table is a THIRD state: acts only for the phrasings
   * that route, absorbs the rest. That is what `platform-help` does today.
   */
  readonly actionable: boolean;
  /**
   * Optional routing table. When present, clearing `threshold` is not enough to
   * act — a topic must also resolve (see `TOPIC_FLOOR` / `TOPIC_MARGIN`).
   * Absent means the intent has a single action and needs no routing.
   */
  readonly topics?: readonly HelpTopicSpec[];
}

export const INTENTS = [
  {
    id: 'start-call',
    examples: [
      // NOTE: "how do I make a call" and friends used to live here. They are
      // platform HOW-TO questions, not a wish to talk to people, and they scored
      // 0.988 — the highest of anything measured — pulling help-seekers into a
      // "start a call with these colleagues" card. They now belong to
      // `platform-help` below, which exists partly to absorb them.
      // Deliberately NOT "how do we get everyone on a call" — that phrasing sits too
      // close to "who is on call this week" in embedding space and pulled the
      // on-call rotation family back over the line.
      'lets get the team on a call',
      // proposing one
      'can we hop on a quick call',
      'lets discuss this over a call',
      'should we get on a call to sort this out',
      'can we do a quick sync',
      // product names
      'anyone free to jump on a huddle',
      'quick google meet instead?',
      'shall we do a zoom call',
      // typing is slower than talking
      'easier to explain on a call',
      'this is hard to explain over text',
      'lets just talk instead of typing',
      // availability
      'is anyone free to talk right now',
      'can someone call me',
      'anyone around to dial in',
      // "connect" family — the most common enterprise phrasing for this and it was
      // entirely missing. "Lets connect to discuss about this once?" scored 0.422
      // without these, i.e. below any usable threshold.
      'lets connect to discuss this',
      'can we connect sometime today',
      'shall we catch up on this',
      'can we sync up about this',
      'lets get on a huddle about this',
    ],
    negatives: [
      // on-call rotation — the collision that motivated this field
      'who is handling the on call shift',
      'the oncall rotation schedule changed',
      'paging the on call engineer',
      // function/API calls
      'we call this method during startup',
      'the API call returned an error',
      // idioms
      'that was a good call',
      'a strong call to action button',
      // records of past calls
      'the recording from the call is uploaded',
      'notes from our call yesterday',
    ],
    // Precision-first operating point from the fixture eval (P=1.00, R=0.45).
    // Re-read from the production score histogram before widening. See §7.
    threshold: 0.6,
    actionable: true,
  },
  {
    // Platform how-to questions: "how do I do X in this product".
    //
    // Born as a pure absorber: these phrasings used to be the top match for
    // `start-call`, so someone asking for help got a card proposing a call with
    // colleagues. Routing them here fixed that.
    //
    // It now also ACTS, but only for the three topics below — the ones with a
    // real destination in the product. Everything else it claims (screen share,
    // canvas, shortcuts) still wins the top slot and still fires nothing, which
    // is the absorber behaviour it was built for. Widening `examples` makes it
    // absorb more; adding a `topics` entry is what makes a phrasing act.
    id: 'platform-help',
    examples: [
      'how do I make a call',
      'how do I start a call here',
      'where is the button to start a call',
      'how do I share my screen',
      'how do I create a ticket',
      // Ticket vocabulary beyond the literal word. Without these the gate scored
      // "where do I go to file a bug" at 0.237 and "how do i log an issue here"
      // at 0.338 — both unclassified, so stage 2 never ran even though the topic
      // resolver would have got them right (0.770 and 0.493).
      'how do I file a bug report',
      'how do I report a problem',
      'how do I turn this into a task',
      'where do I find the recording of a call',
      'how do I add someone to this channel',
      // Same gap on the invite side: "where do I add members" scored 0.573 and
      // "how can I invite my teammate here" 0.474, both under the 0.6 gate.
      'how do I invite someone to this channel',
      'where do I manage channel members',
      'how do I set up a canvas',
      'is there a way to schedule this in advance',
      'what is the shortcut for search',
      'how do I change my notification settings',
    ],
    negatives: [
      // Real asks that merely start with a question word — these must stay with
      // start-call rather than being absorbed as how-to.
      'can we hop on a quick call',
      'is anyone free to talk right now',
      'lets connect to discuss this',
    ],
    threshold: 0.6,
    // Was `false` while this intent existed only to absorb. It now routes to a
    // topic and fires a purely local toast — see `topics` below. The absorber
    // behaviour is unchanged for anything that does NOT resolve to a topic.
    actionable: true,
    topics: [
      {
        // Converges with the `start-call` intent on the same action, reached
        // from the opposite phrasing: "can we hop on a call" is the ask,
        // "how do I start a call" is the how-to. Same modal either way.
        id: 'start-call',
        examples: [
          'how do I start a call',
          'how do I make a call',
          'where is the button to start a call',
          'how do I begin a video call',
          'how can I get people into a huddle',
          'is there a way to start a meeting here',
        ],
        negatives: [
          // Call-adjacent how-tos with no start-a-call action behind them. These
          // are the measured misroutes, not hypotheticals.
          'where do I find the call recording',
          'how do I share my screen',
          'how do I mute myself on a call',
          'how do I turn my camera off',
          'how do I see who is on the call',
        ],
      },
      {
        id: 'create-ticket',
        examples: [
          'how do I create a ticket',
          'how do I file a ticket',
          'where is the option to raise an issue',
          'how can I turn this message into a ticket',
          'how do I open a bug report',
          'is there a way to track this as a task',
        ],
        negatives: [
          // Reading/finding tickets is not creating one; there is no create
          // action to offer and the toast would be wrong.
          'where do I see my assigned tickets',
          'how do I close a ticket',
          'how do I search for an existing ticket',
        ],
      },
      {
        id: 'add-people',
        examples: [
          'how do I add someone to this channel',
          'how do I invite people to this channel',
          'where do I add members to a channel',
          'how can I add more people here',
          'how do I bring someone into this conversation',
          'is there a way to invite a teammate to this channel',
        ],
        negatives: [
          // Removing, leaving, or listing members — adjacent vocabulary, opposite
          // or unavailable action.
          'how do I remove someone from this channel',
          'how do I leave this channel',
          'how do I see who is in this channel',
        ],
      },
    ],
  },
] as const satisfies readonly IntentSpec[];

export type IntentId = (typeof INTENTS)[number]['id'];

/**
 * Bump on ANY change to the phrases above. Stamped on every metric and log
 * record so historical eval data stays interpretable.
 */
export const PROTOTYPES_VERSION = '5';

export function getIntent(id: string): IntentSpec | undefined {
  return INTENTS.find(i => i.id === id);
}
