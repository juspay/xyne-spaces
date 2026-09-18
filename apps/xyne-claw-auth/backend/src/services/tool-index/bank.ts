import { bankIdForAgent, getMemoryProvider, type MemoryProvider } from "xyne-claw-shared";
import { createLogger } from "../../logger.js";

const log = createLogger("tool-index-bank");

/**
 * Reserved slug for the catalog index. Not org-scoped: see the note in
 * `types.ts` — the `tools` table has no `orgId` and is served globally today.
 */
const INDEX_SLUG = "tool-index";

/** Keeps an ordinary tool document to a single chunk, so one hit means one tool. */
const CHUNK_SIZE = 6_000;

/** `applyBankTuning` retains this to force bank materialization. In `chunks`
 *  mode nothing discards it, so it lands as a real entry and must be swept. */
const WARMUP_TAG = "warmup-tuning";

let bootstrapped = false;

export function toolIndexBankId(): string {
  return bankIdForAgent(INDEX_SLUG);
}

export function memory(): MemoryProvider {
  return getMemoryProvider();
}

/** False when no memory backend is configured, in which case indexing is a no-op. */
export function memoryEnabled(): boolean {
  return (memory() as { enabled?: boolean }).enabled !== false;
}

/**
 * Creates and configures the catalog bank, once per process.
 *
 * Must stay in `chunks` mode: fact extraction would shred a tool's
 * description/params into assertions that answer nothing. No LLM on the
 * write path, so a rebuild costs only HTTP.
 */
export async function ensureToolIndexBank(): Promise<string> {
  const bankId = toolIndexBankId();
  if (bootstrapped) return bankId;

  const provider = memory();
  await provider.ensureBank(bankId, {
    mission: "Searchable catalogue of every tool this deployment can offer an agent.",
    retainExtractionMode: "chunks",
    retainChunkSize: CHUNK_SIZE,
    enableObservations: false,
  });

  await assertChunksMode(bankId);
  await provider.deleteByTag?.(bankId, WARMUP_TAG).catch(() => 0);

  bootstrapped = true;
  log.info(`[tool-index] bank ready: ${bankId}`);
  return bankId;
}

/**
 * A silent fallback to fact extraction still accepts writes and answers 200 —
 * documents get shredded instead of stored, undetectably. Refuse to feed the
 * bank rather than risk that.
 */
async function assertChunksMode(bankId: string): Promise<void> {
  const read = memory().getBankConfig;
  if (!read) return;

  const { overrides } = await read.call(memory(), bankId);
  // Disabled provider returns an empty shape rather than failing — nothing is
  // written or read here, so there's no mis-tuned bank to guard against.
  if (Object.keys(overrides).length === 0 && !memoryEnabled()) return;
  if (overrides["retain_extraction_mode"] !== "chunks") {
    throw new Error(
      `bank ${bankId} is not in chunks mode (got ${String(overrides["retain_extraction_mode"] ?? "unset")}) — refusing to index`,
    );
  }
}

/** Resolved settings, for operators verifying configuration. */
export async function toolIndexBankConfig(): Promise<Record<string, unknown>> {
  const bankId = await ensureToolIndexBank();
  const read = memory().getBankConfig;
  if (!read) return {};
  const { overrides } = await read.call(memory(), bankId);
  return overrides;
}

/** Drops the memoized bootstrap so the next call re-applies tuning. */
export function resetToolBankCache(): void {
  bootstrapped = false;
}
