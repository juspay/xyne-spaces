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
   * Whether clearing the threshold should call the server at all.
   *
   * `false` makes the intent a pure ABSORBER: it competes for the top slot so
   * neighbouring intents stop claiming its phrasings, and then does nothing.
   *
   * This is a real flag rather than "set threshold to 0.99" because that trick
   * does not work — a near-exact match to an example scores 1.0000 and sails
   * over any threshold below it, producing a pointless round-trip the server
   * rejects as `unsupported-intent`.
   */
  readonly actionable: boolean;
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
    // ABSORBER (`actionable: false`). These phrasings used to be the top match for
    // `start-call`, so someone asking for help got a card proposing a call with
    // colleagues. Now they land here, win the top slot, and fire nothing.
    //
    // The threshold below is a real, meaningful value — it decides what counts as
    // "confidently platform-help" in metrics and will be the live gate the day this
    // grows an action (docs deep-link, help card). `actionable` is what keeps it
    // quiet until then, so flipping this on is a one-word change.
    id: 'platform-help',
    examples: [
      'how do I make a call',
      'how do I start a call here',
      'where is the button to start a call',
      'how do I share my screen',
      'how do I create a ticket',
      'where do I find the recording of a call',
      'how do I add someone to this channel',
      'how do I set up a canvas',
      'is there a way to schedule this in advance',
      'what is the shortcut for search',
    ],
    negatives: [
      // Real asks that merely start with a question word — these must stay with
      // start-call rather than being absorbed as how-to.
      'can we hop on a quick call',
      'is anyone free to talk right now',
      'lets connect to discuss this',
    ],
    threshold: 0.6,
    actionable: false,
  },
] as const satisfies readonly IntentSpec[];

export type IntentId = (typeof INTENTS)[number]['id'];

/**
 * Bump on ANY change to the phrases above. Stamped on every metric and log
 * record so historical eval data stays interpretable.
 */
export const PROTOTYPES_VERSION = '4';

export function getIntent(id: string): IntentSpec | undefined {
  return INTENTS.find(i => i.id === id);
}
