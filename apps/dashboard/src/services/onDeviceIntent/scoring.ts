/**
 * Pure scoring logic. No DOM, no worker, no model, and deliberately **no imports** —
 * the Node-side scripts (build-prototypes, eval-intents) load this file directly via
 * type stripping, which cannot resolve extensionless relative imports. Keeping this
 * module self-contained is what lets the worker, the playground, and CI all score
 * identically instead of drifting across three copies.
 *
 * ## Why max-over-prototypes and not a mean centroid
 *
 * The obvious design is one mean-pooled centroid per intent. Measured on the real
 * example set, it does not work: mean-pooling washes out diverse phrasings badly
 * enough that the scores invert.
 *
 *                              mean centroid    max over prototypes
 *   weakest positive               0.451              0.695
 *   strongest negative             0.611              0.557
 *   separation                    -0.160             +0.138
 *
 * With the mean there is no threshold that separates positives from negatives at
 * all. Scoring against each example vector and taking the max keeps every phrasing
 * sharp, and costs one dot product per example (microseconds at 384 dims).
 *
 * See docs/ON_DEVICE_INTENT.md §5.3–5.4
 */

/** Prefilter bounds — shape only, no language assumptions. */
export const MIN_TEXT_LENGTH = 8;
/**
 * Raised from 400 once scoring became per-segment: a long message no longer
 * dilutes its own intent, so there is less reason to drop it on length alone.
 */
export const MAX_TEXT_LENGTH = 1000;

/** Segments scored per message. Caps embedding cost on a wall of text. */
export const MAX_SEGMENTS = 8;

/**
 * An anti-prototype only suppresses if it clears this on its own.
 *
 * Without a floor, suppression compares noise to noise: text unrelated to any
 * intent scores ~0 positive, so a 0.2 negative "wins" and the result reads as a
 * deliberate rejection when nothing was ever close to firing. Harmless for the
 * decision (both are under threshold) but actively misleading in traces and evals.
 */
export const NEGATIVE_FLOOR = 0.35;

/** Reported as `topIntent` when nothing scored high enough to claim the message. */
export const UNCLASSIFIED = 'unclassified';

/**
 * Below this, no intent is claimed at all.
 *
 * `topIntent` is an argmax, so with a handful of intents one always "wins" no
 * matter how irrelevant the text — ordinary chatter lands on whichever intent is
 * least unlike it, around 0.15–0.25. Without a floor those all get recorded as
 * `intent="start-call"`, which makes `intent_classification_total` read as
 * "start-call classified N times" when it means "start-call was argmax N times",
 * and buries the production score histogram under noise. That histogram is what
 * §7 says to read the live threshold off, so the noise is not cosmetic.
 *
 * 0.35 sits in measured empty space: chatter tops out ~0.22, the weakest true
 * positive is 0.408, and the hardest real negative ("who is on call this week")
 * is 0.591 — so genuine near-misses stay visible as near-misses.
 */
export const MIN_INTENT_SCORE = 0.35;

/** Per-intent prototype vectors: one per example phrase, plus anti-prototypes. */
export interface IntentPrototypes {
  positive: number[][];
  negative: number[][];
  /**
   * Stage-2 routing vectors, nested under the intent that owns them. Absent for
   * intents with a single action. Nesting rather than a sibling map is what makes
   * it impossible for a stale artifact to pair one intent's gate with another's
   * topics.
   */
  topics?: TopicMap;
}

export type PrototypeMap = Record<string, IntentPrototypes>;

export interface IntentScore {
  intentId: string;
  /** Max cosine over the positive prototypes. */
  score: number;
  /** Max cosine over the anti-prototypes. */
  negativeScore: number;
  /** True when an anti-prototype matched at least as well — intent cannot fire. */
  suppressed: boolean;
  /** Index of the example phrase that matched best — the debugging affordance. */
  matchedExample: number;
  /** Index of the anti-prototype that matched best, when suppressed. */
  matchedNegative: number;
}

export interface ScoreResult {
  topIntent: string;
  topScore: number;
  runnerUpIntent: string | null;
  /** Runner-up similarity. `topScore - runnerUpScore` small ⇒ intents are confusable. */
  runnerUpScore: number;
  /** Every intent, descending. Used by the playground; never sent to telemetry. */
  all: IntentScore[];
}

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/i;
const CODE_FENCE = /```/;

/**
 * Stage 0. Deliberately conservative: every rule here is silent recall loss.
 * Shape only — no keyword matching (that is what the embeddings are for) and no
 * word lists (they would make this English-only).
 *
 * Returns the reason so debug tracing can say *why* something was dropped;
 * `prefilter()` is the boolean wrapper used by the hot path and the scripts.
 */
export function prefilterDetail(text: string): { pass: boolean; reason: string } {
  const t = text.trim();
  if (t.length < MIN_TEXT_LENGTH) return { pass: false, reason: `too short (<${MIN_TEXT_LENGTH})` };
  if (t.length > MAX_TEXT_LENGTH) return { pass: false, reason: `too long (>${MAX_TEXT_LENGTH})` };
  if (URL_ONLY.test(t)) return { pass: false, reason: 'bare URL' };
  if (CODE_FENCE.test(t)) return { pass: false, reason: 'code fence' };
  return { pass: true, reason: 'ok' };
}

export function prefilter(text: string): boolean {
  return prefilterDetail(text).pass;
}

/**
 * Split a message into independently-scored segments.
 *
 * A single mean-pooled vector over a whole message buries a short ask inside
 * surrounding text. Measured on a real 248-char message whose last sentence was
 * "Lets connect to discuss about this once?": scoring the whole thing gave 0.000,
 * scoring per sentence gave 0.422 — same model, same prototypes. Long messages are
 * the common case in channels, so whole-message scoring silently loses most of
 * the traffic this feature exists for.
 *
 * Sentence-ish splitting only: terminators and hard newlines. Fragments below
 * MIN_TEXT_LENGTH are dropped (a bare "Thanks." carries no intent), and a message
 * with no punctuation stays one segment — i.e. previous behavior.
 */
export function splitForScoring(text: string): string[] {
  const segments = text
    .split(/(?<=[.?!])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length >= MIN_TEXT_LENGTH);

  // Nothing splittable (no punctuation, or every fragment too short) — score whole.
  if (segments.length === 0) return [text.trim()];
  return segments.slice(0, MAX_SEGMENTS);
}

/**
 * Both vectors are expected to be L2-normalized (the extractor runs with
 * `normalize: true`, prototypes are normalized at build time), so the dot product
 * is the cosine similarity.
 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

export function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const mag = Math.sqrt(sum) || 1;
  return vec.map(v => v / mag);
}

/**
 * Scores against whatever intents the prototype map contains — it does not read the
 * registry, so a stale prototypes.json can never silently score against intents whose
 * vectors were never built.
 */
function maxCosine(vec: ArrayLike<number>, vectors: number[][]): { score: number; index: number } {
  let best = -Infinity;
  let index = -1;
  for (let i = 0; i < vectors.length; i++) {
    const prototype = vectors[i];
    if (!prototype) continue;
    const score = cosine(vec, prototype);
    if (score > best) {
      best = score;
      index = i;
    }
  }
  return { score: best === -Infinity ? 0 : best, index };
}

export function scoreVector(vec: ArrayLike<number>, prototypes: PrototypeMap): ScoreResult {
  const all: IntentScore[] = Object.keys(prototypes)
    .map(intentId => {
      const entry = prototypes[intentId];
      const positive = maxCosine(vec, entry?.positive ?? []);
      const negative = maxCosine(vec, entry?.negative ?? []);
      // Must beat the positive AND stand on its own — see NEGATIVE_FLOOR.
      const suppressed = negative.score >= positive.score && negative.score >= NEGATIVE_FLOOR;

      return {
        intentId,
        // A suppressed intent scores 0 so it can never out-rank a live one and can
        // never clear a threshold, without losing the raw numbers for debugging.
        score: suppressed ? 0 : positive.score,
        negativeScore: negative.score,
        suppressed,
        matchedExample: positive.index,
        matchedNegative: negative.index,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = all[0];
  const claimed = best !== undefined && best.score >= MIN_INTENT_SCORE;

  return {
    // `unclassified` rather than the argmax winner when nothing cleared the floor.
    // Set here, in the one place every caller goes through, so telemetry, traces
    // and the playground cannot each forget to apply it.
    topIntent: claimed ? best.intentId : UNCLASSIFIED,
    // Raw score is kept either way — useful for tuning the floor itself.
    topScore: best?.score ?? 0,
    runnerUpIntent: all[1]?.intentId ?? null,
    runnerUpScore: all[1]?.score ?? 0,
    all,
  };
}

/* ------------------------------------------------------------------------- *
 * Stage 2 — help-topic routing
 * ------------------------------------------------------------------------- */

/**
 * Reported as `topicId` when the message is a how-to but we cannot tell which
 * one with enough confidence to act on.
 *
 * This is a first-class outcome, not a failure. "I know this is a how-to, I do
 * not know about what" is the honest answer for "how do I do that here?", and
 * silence is the correct response to it.
 */
export const UNRESOLVED_TOPIC = 'unresolved';

/**
 * Absolute floor for the winning topic.
 *
 * Stage 1 has already established the message is a how-to, so this is not
 * re-litigating that — it guards the case where the how-to is about something
 * we have no topic for at all ("how do I change my notification sound"), where
 * every topic scores low and the argmax is meaningless.
 *
 * Measured on the fixture set: the weakest CORRECT route is 0.493 ("how do i log
 * an issue here") and the strongest route that must stay quiet is 0.368 ("how do
 * i share my screen during a call", already suppressed). Anything in (0.368,
 * 0.493] gives zero wrong routes and zero lost ones; 0.45 sits mid-band.
 */
export const TOPIC_FLOOR = 0.45;

/**
 * Minimum gap between the winning topic and the runner-up.
 *
 * The topics share almost all of their surface form — "how do I create a
 * ticket" and "how do I create a canvas" differ by one noun — so the margin,
 * not the absolute score, is what says whether the model actually discriminated
 * or just broke a tie. Firing the wrong topic is the expensive error here: a
 * missed suggestion is invisible, a confidently wrong one teaches people the
 * feature is not worth reading.
 *
 * HONEST CAVEAT: on the current fixture set this constraint is slack. Every
 * correct route clears it by 0.219 or more, and the failures it was meant to
 * catch turned out not to be ambiguous at all — they were confidently wrong and
 * needed anti-prototypes instead (see TopicPrototypes). It is kept as cheap
 * insurance for the genuinely ambiguous case the fixtures do not yet contain,
 * not because it is currently carrying weight. Do not tune it against noise.
 */
export const TOPIC_MARGIN = 0.06;

/**
 * Per-topic prototype vectors, same shape as an intent's.
 *
 * Topics need anti-prototypes for the same reason intents do, and the failure
 * looked identical: "how do I share my screen during a call" routed to
 * `start-call` at 0.629 with a 0.261 margin, and "where do I find the recording
 * of yesterdays call" at 0.481 with a 0.238 margin. Neither is ambiguous — the
 * margin rule sees a decisive win — they are confidently wrong, because they
 * share the call vocabulary while asking for something else entirely. Only the
 * negative side reaches that.
 */
export interface TopicPrototypes {
  positive: number[][];
  negative: number[][];
}

export type TopicMap = Record<string, TopicPrototypes>;

export interface TopicScore {
  topicId: string;
  score: number;
  negativeScore: number;
  suppressed: boolean;
  matchedExample: number;
  matchedNegative: number;
}

export interface TopicResult {
  /** The routed topic, or UNRESOLVED_TOPIC when floor/margin were not met. */
  topicId: string;
  score: number;
  runnerUpId: string | null;
  runnerUpScore: number;
  /** `score - runnerUpScore`. Small ⇒ the topics were not actually separated. */
  margin: number;
  /** Full ranking — playground and eval only. Never sent to telemetry. */
  all: TopicScore[];
}

/**
 * Routes an already-classified how-to to the specific thing being asked about.
 *
 * Runs on the SAME vector stage 1 scored, so it costs no extra inference — just
 * a dot product per topic example. Kept separate from `scoreVector` because the
 * two decisions have different error costs and therefore different gates: stage
 * 1 asks "is this a how-to at all", stage 2 asks "which one", and fusing them
 * into a single argmax would make it impossible to tune either independently.
 */
export function resolveTopic(vec: ArrayLike<number>, topics: TopicMap): TopicResult {
  const all: TopicScore[] = Object.keys(topics)
    .map(topicId => {
      const entry = topics[topicId];
      const positive = maxCosine(vec, entry?.positive ?? []);
      const negative = maxCosine(vec, entry?.negative ?? []);
      const suppressed = negative.score >= positive.score && negative.score >= NEGATIVE_FLOOR;

      return {
        topicId,
        // Zeroed like a suppressed intent, so a suppressed topic can neither win
        // nor prop up the runner-up score and shrink someone else's margin.
        score: suppressed ? 0 : positive.score,
        negativeScore: negative.score,
        suppressed,
        matchedExample: positive.index,
        matchedNegative: negative.index,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = all[0];
  const runnerUp = all[1];
  const runnerUpScore = runnerUp?.score ?? 0;
  const margin = (best?.score ?? 0) - runnerUpScore;
  const resolved = best !== undefined && best.score >= TOPIC_FLOOR && margin >= TOPIC_MARGIN;

  return {
    topicId: resolved ? best.topicId : UNRESOLVED_TOPIC,
    score: best?.score ?? 0,
    runnerUpId: runnerUp?.topicId ?? null,
    runnerUpScore,
    margin,
    all,
  };
}
