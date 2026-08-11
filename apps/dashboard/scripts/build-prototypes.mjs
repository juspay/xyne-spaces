/**
 * Embeds each intent's example phrases into prototype vectors, written to
 * src/services/onDeviceIntent/prototypes.json.
 *
 * One vector per example (NOT one mean-pooled centroid per intent) — scoring takes
 * the max over prototypes. See the header of scoring.ts for the measurements that
 * forced that choice.
 *
 * Runs the SAME model and quantization as the browser worker (both read
 * src/services/onDeviceIntent/config.ts), so CI scores match runtime exactly.
 *
 * Run after editing intents.ts, and bump PROTOTYPES_VERSION in the same commit.
 *
 * See docs/ON_DEVICE_INTENT.md §5.2
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env, pipeline } from '@huggingface/transformers';

import { INTENTS, PROTOTYPES_VERSION } from '../src/services/onDeviceIntent/intents.ts';
import { MODEL_ID, MODEL_DTYPE } from '../src/services/onDeviceIntent/config.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const modelRoot = path.join(dirname, '..', 'public', 'models');
const outPath = path.join(dirname, '..', 'src', 'services', 'onDeviceIntent', 'prototypes.json');

/** 4dp keeps the JSON ~7x smaller than full float precision; cosine is unaffected at this scale. */
const PRECISION = 4;

// Same guarantee as the worker: read only the weights we vendored ourselves.
env.allowRemoteModels = false;
env.localModelPath = modelRoot;

const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE });

async function embed(text) {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data, v => Number(v.toFixed(PRECISION)));
}

const prototypes = {};
for (const intent of INTENTS) {
  const positive = [];
  for (const example of intent.examples) {
    positive.push(await embed(example));
  }
  const negative = [];
  for (const example of intent.negatives) {
    negative.push(await embed(example));
  }
  prototypes[intent.id] = { positive, negative };
  console.log(
    `[build-prototypes] ${intent.id}: ${positive.length} positive + ${negative.length} negative → ${positive[0].length}d`,
  );
}

const payload = {
  // Stamped so a stale prototypes.json is detectable at runtime rather than
  // silently producing scores from a different model.
  modelVersion: `${MODEL_ID}-${MODEL_DTYPE}`,
  prototypesVersion: PROTOTYPES_VERSION,
  prototypes,
};

writeFileSync(outPath, `${JSON.stringify(payload)}\n`);
console.log(`[build-prototypes] wrote ${path.relative(process.cwd(), outPath)}`);
