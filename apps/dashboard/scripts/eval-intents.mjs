/**
 * Offline eval for the on-device intent classifier.
 *
 * Sweeps the threshold rather than asserting against a fixed one — picking the
 * threshold IS the decision, so the job of this script is to show the tradeoff,
 * not to hide it behind a pass/fail.
 *
 * Runs the SAME model, quantization, prototypes and scoring code as the browser
 * worker, so CI numbers match runtime.
 *
 *   pnpm eval:intents            # print the sweep
 *   pnpm eval:intents --ci       # also fail on F1 below the floor
 *
 * See docs/ON_DEVICE_INTENT.md §7
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env, pipeline } from '@huggingface/transformers';

import { MODEL_ID, MODEL_DTYPE } from '../src/services/onDeviceIntent/config.ts';
import { INTENTS } from '../src/services/onDeviceIntent/intents.ts';
import {
  UNRESOLVED_TOPIC,
  prefilter,
  resolveTopic,
  scoreVector,
  splitForScoring,
} from '../src/services/onDeviceIntent/scoring.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dirname, '..');

const SWEEP = [0.5, 0.55, 0.6, 0.62, 0.65, 0.68, 0.7, 0.75, 0.8];
/** CI floor. Deliberately modest — this gate exists to catch regressions, not to certify quality. */
const MIN_F1 = 0.7;

env.allowRemoteModels = false;
env.localModelPath = path.join(root, 'public', 'models');

const { prototypes, modelVersion, prototypesVersion } = JSON.parse(
  readFileSync(path.join(root, 'src/services/onDeviceIntent/prototypes.json'), 'utf8'),
);

const fixtures = readFileSync(path.join(root, 'fixtures/intents.jsonl'), 'utf8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => JSON.parse(line));

const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE });

// Score every fixture once; the sweep is then pure arithmetic over these.
const scored = [];
for (const fixture of fixtures) {
  if (!prefilter(fixture.text)) {
    scored.push({ ...fixture, prefiltered: true, topIntent: null, topScore: 0 });
    continue;
  }
  // Mirror the worker exactly: split, batch-embed, keep the best segment.
  // If this drifts from intent.worker.ts the eval stops predicting runtime.
  const segments = splitForScoring(fixture.text);
  const out = await extractor(segments, { pooling: 'mean', normalize: true });
  const dims = Math.floor(out.data.length / segments.length);

  let result = null;
  let bestVec = null;
  for (let i = 0; i < segments.length; i++) {
    const slice = Array.prototype.slice.call(out.data, i * dims, (i + 1) * dims);
    const r = scoreVector(slice, prototypes);
    if (!result || r.topScore > result.topScore) {
      result = r;
      bestVec = slice;
    }
  }

  // Stage 2 on the same vector — no second embed, mirroring intent.worker.ts.
  const topicVectors = prototypes[result.topIntent]?.topics;

  scored.push({
    ...fixture,
    prefiltered: false,
    topIntent: result.topIntent,
    topScore: result.topScore,
    suppressed: result.all[0]?.suppressed ?? false,
    // `fixture.topic` is the gold label; this is the prediction. Distinct names
    // on purpose — spreading the fixture would otherwise silently overwrite one
    // with the other and the eval would score itself.
    topicResult: topicVectors ? resolveTopic(bestVec, topicVectors) : null,
  });
}

const intentIds = Object.keys(prototypes);

function evaluate(intentId, threshold) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const row of scored) {
    const predicted = !row.prefiltered && row.topIntent === intentId && row.topScore >= threshold;
    const actual = row.expect === intentId;
    if (predicted && actual) tp++;
    else if (predicted && !actual) fp++;
    else if (!predicted && actual) fn++;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

console.log(`\nmodel ${modelVersion} · prototypes v${prototypesVersion} · ${fixtures.length} fixtures`);

const prefilteredCount = scored.filter(r => r.prefiltered).length;
if (prefilteredCount) {
  console.log(`${prefilteredCount} fixture(s) rejected by prefilter before scoring`);
}

// Anti-prototypes doing their job: negatives killed before they ever reach a threshold.
const suppressedNegatives = scored.filter(r => r.suppressed && r.expect === null).length;
const suppressedPositives = scored.filter(r => r.suppressed && r.expect !== null).length;
console.log(
  `anti-prototypes suppressed ${suppressedNegatives} negative(s)` +
    (suppressedPositives ? ` and ${suppressedPositives} POSITIVE(s) — too aggressive` : ''),
);

console.log(`\nthreshold sweep  (P = precision, R = recall)\n`);
const header = ['intent'.padEnd(16), ...SWEEP.map(t => `thr=${t.toFixed(2)}`.padEnd(13))].join('');
console.log(header);
console.log('-'.repeat(header.length));

let worstBest = 1;
for (const intentId of intentIds) {
  const cells = SWEEP.map(t => {
    const { precision, recall } = evaluate(intentId, t);
    return `P${precision.toFixed(2)} R${recall.toFixed(2)}`.padEnd(13);
  });
  console.log(intentId.padEnd(16) + cells.join(''));

  const best = Math.max(...SWEEP.map(t => evaluate(intentId, t).f1));
  worstBest = Math.min(worstBest, best);
  const bestThreshold = SWEEP.find(t => evaluate(intentId, t).f1 === best);
  console.log(
    `${''.padEnd(16)}best F1 ${best.toFixed(3)} at threshold ${bestThreshold?.toFixed(2)}\n`,
  );
}

// This cascade is precision-biased: a false positive costs a server call and possibly a
// wrong widget, while a false negative is invisible (nothing renders, which is today's
// behavior). So the operating point that matters is "highest recall we can get while
// staying clean", NOT best F1 and NOT full separation.
console.log('precision-first operating points\n');
for (const intentId of intentIds) {
  for (const minPrecision of [1.0, 0.95, 0.9]) {
    const viable = SWEEP.map(t => ({ t, ...evaluate(intentId, t) })).filter(
      r => r.precision >= minPrecision,
    );
    const best = viable.sort((a, b) => b.recall - a.recall)[0];
    console.log(
      best
        ? `  ${intentId} @ P>=${minPrecision.toFixed(2)}: recall ${best.recall.toFixed(2)} at threshold ${best.t.toFixed(2)}`
        : `  ${intentId} @ P>=${minPrecision.toFixed(2)}: unreachable at any swept threshold`,
    );
  }
}
console.log();

// Full separation is a stricter bar than the trigger needs, but it is still the signal
// that the phrase sets need work: an inverted band means the intent can never be made
// high-recall, only high-precision.
for (const intentId of intentIds) {
  const positives = scored.filter(r => r.expect === intentId && !r.prefiltered);
  // Only rows where THIS intent actually won the top slot can be false positives
  // for it. Without the topIntent filter, a phrase claimed by another intent gets
  // reported as this one's "hardest negative" at a score it never produced —
  // which is how "How can I make a call" appeared as a 0.988 start-call negative
  // when platform-help had already absorbed it.
  const negatives = scored.filter(
    r => r.expect !== intentId && !r.prefiltered && r.topIntent === intentId,
  );

  if (positives.length === 0 || negatives.length === 0) {
    console.log(
      `${intentId}: ${positives.length} positive(s), ${negatives.length} competing negative(s) — separation not meaningful\n`,
    );
    continue;
  }

  const weakestPositive = Math.min(...positives.map(r => r.topScore));
  const strongestNegative = Math.max(...negatives.map(r => r.topScore));
  const separation = weakestPositive - strongestNegative;

  console.log(
    `${intentId}: weakest positive ${weakestPositive.toFixed(3)}, ` +
      `strongest negative ${strongestNegative.toFixed(3)}, ` +
      `separation ${separation >= 0 ? '+' : ''}${separation.toFixed(3)}` +
      (separation < 0 ? '  ← inverted: high recall is unreachable, precision-only' : ''),
  );

  const worstNegative = negatives.reduce((a, b) => (a.topScore > b.topScore ? a : b), negatives[0]);
  const worstPositive = positives.reduce((a, b) => (a.topScore < b.topScore ? a : b), positives[0]);
  console.log(`  hardest negative: ${worstNegative.topScore.toFixed(3)}  "${worstNegative.text}"`);
  console.log(`  weakest positive: ${worstPositive.topScore.toFixed(3)}  "${worstPositive.text}"\n`);
}

/* --------------------------------------------------------------------------
 * Stage 2 — topic routing
 *
 * Scored only over fixtures the gate actually claimed. Routing is conditional on
 * the gate, so counting a how-to the gate missed would blame stage 2 for a
 * stage-1 recall problem.
 * ------------------------------------------------------------------------ */
const thresholdOf = id => INTENTS.find(i => i.id === id)?.threshold ?? 1;

// Stage 2 only runs on messages the gate CLAIMED AND that cleared its threshold.
// Dropping the threshold check here silently inflates coverage: three fixtures
// score 0.55-0.57 against platform-help, which reads as "routed correctly" while
// at runtime the gate stops them before stage 2 is ever consulted.
const labelledForTopic = scored.filter(r => r.topic);
const routed = labelledForTopic.filter(
  r => r.topicResult && r.expect === r.topIntent && r.topScore >= thresholdOf(r.topIntent),
);
const gateMissed = labelledForTopic.filter(r => !routed.includes(r));

if (routed.length) {
  console.log(
    `\ntopic routing  ·  ${routed.length} of ${labelledForTopic.length} labelled fixture(s) reached stage 2\n`,
  );

  if (gateMissed.length) {
    // A stage-1 recall problem, not a routing problem. Listed separately so the
    // two never get conflated when someone tunes one of them.
    console.log('  blocked at the gate (stage-1 recall, NOT a routing failure):');
    for (const r of gateMissed) {
      console.log(
        `    ${r.topIntent.padEnd(14)}${r.topScore.toFixed(3)} < ${thresholdOf(r.expect)}` +
          `  would route to ${r.topicResult?.all[0]?.topicId ?? '?'}` +
          ` @ ${(r.topicResult?.score ?? 0).toFixed(3)}  "${r.text}"`,
      );
    }
    console.log();
  }

  const FLOORS = [0.4, 0.45, 0.5, 0.55];
  const MARGINS = [0.0, 0.02, 0.04, 0.06, 0.08, 0.12];

  /**
   * The two error types are NOT interchangeable, so they are never summed:
   * a wrong topic is a confidently wrong toast, a quiet one is just silence.
   */
  function sweep(floor, margin) {
    let ok = 0;
    let wrong = 0;
    let quiet = 0;
    for (const r of routed) {
      const t = r.topicResult;
      const predicted =
        t.score >= floor && t.margin >= margin ? t.all[0].topicId : UNRESOLVED_TOPIC;

      if (predicted === r.topic) ok++;
      else if (predicted === UNRESOLVED_TOPIC) quiet++;
      else wrong++;
    }
    return { ok, wrong, quiet };
  }

  const head = ['floor'.padEnd(8), ...MARGINS.map(m => `m=${m.toFixed(2)}`.padEnd(15))].join('');
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const floor of FLOORS) {
    const cells = MARGINS.map(m => {
      const { ok, wrong, quiet } = sweep(floor, m);
      return `${ok}ok ${wrong}wrong ${quiet}q`.padEnd(15);
    });
    console.log(floor.toFixed(2).padEnd(8) + cells.join(''));
  }
  console.log('\n  ok    = correct, including correctly staying quiet');
  console.log('  wrong = routed to the wrong topic — the expensive error');
  console.log('  q     = should have routed, stayed quiet — free, just lost recall\n');

  // Zero-wrong operating points, highest recall first. Same precision-first bias
  // as the intent thresholds above.
  const clean = [];
  for (const floor of FLOORS) {
    for (const margin of MARGINS) {
      const r = sweep(floor, margin);
      if (r.wrong === 0) clean.push({ floor, margin, ...r });
    }
  }
  if (clean.length) {
    const best = clean.sort((a, b) => a.quiet - b.quiet || a.margin - b.margin)[0];
    console.log(
      `  zero-wrong operating point: floor ${best.floor} margin ${best.margin} ` +
        `→ ${best.ok}/${routed.length} correct, ${best.quiet} left quiet`,
    );
  } else {
    console.log('  no floor/margin in the sweep reaches zero wrong routes');
  }
  console.log();

  // Every misroute, spelled out. These are the rows to write prototypes against.
  const live = routed.filter(r => r.topicResult.topicId !== r.topic);
  if (live.length) {
    console.log('misroutes at the LIVE floor/margin\n');
    for (const r of live) {
      const t = r.topicResult;
      console.log(
        `  got ${t.topicId.padEnd(14)} want ${String(r.topic).padEnd(14)}` +
          `s=${t.score.toFixed(3)} m=${t.margin.toFixed(3)} ` +
          `(runner-up ${t.runnerUpId} ${t.runnerUpScore.toFixed(3)})  "${r.text}"`,
      );
    }
    console.log();
  } else {
    console.log('no misroutes at the live floor/margin\n');
  }
}

if (process.argv.includes('--ci') && worstBest < MIN_F1) {
  console.error(`FAIL: best achievable F1 ${worstBest.toFixed(3)} is below the ${MIN_F1} floor`);
  process.exit(1);
}
