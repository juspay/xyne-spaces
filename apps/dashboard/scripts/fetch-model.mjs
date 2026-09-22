/**
 * Vendors the on-device embedding model into `public/models/` so it is served
 * from our own origin at runtime.
 *
 * Build-time fetch from Hugging Face is fine — it runs on our infra and the
 * output is self-hosted. A *runtime* fetch from HF is what we forbid: it breaks
 * under mTLS and kills the offline story. See docs/ON_DEVICE_INTENT.md §5.1.
 *
 * Weights are gitignored; run this after a fresh clone (or let `prebuild` do it).
 */
import { createWriteStream } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep in sync with MODEL_ID in src/services/onDeviceIntent/config.ts
const MODEL_ID = 'all-MiniLM-L6-v2';
const REPO = 'Xenova/all-MiniLM-L6-v2';
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
];

const outDir = path.join(dirname, '..', 'public', 'models', MODEL_ID);

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function download(file) {
  const dest = path.join(outDir, file);
  if (await exists(dest)) {
    console.log(`[fetch-model] cached  ${file}`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });

  const url = `https://huggingface.co/${REPO}/resolve/main/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[fetch-model] ${res.status} ${res.statusText} for ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
  console.log(`[fetch-model] fetched ${file}`);
}

for (const file of FILES) {
  await download(file);
}
console.log(`[fetch-model] ${REPO} ready at public/models/${MODEL_ID}`);
