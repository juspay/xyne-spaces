import { bankIdForAgentOrg, getMemoryProvider, type MemoryProvider } from "xyne-claw-shared";
import { createLogger } from "../../logger.js";

const log = createLogger("agent-index-bank");

/**
 * Reserved slug for the per-org index. Routed through `bankIdForAgentOrg` so the
 * bank is org-scoped by construction — tags are a filter one query can forget,
 * a bank id is a boundary nothing can reach across.
 */
const INDEX_SLUG = "agent-index";

/** Keeps a typical system prompt in a single chunk; longer ones still split. */
const CHUNK_SIZE = 6_000;

/** `applyBankTuning` retains this to force bank materialization. In `chunks`
 *  mode there is no extraction to discard it, so it lands as a real searchable
 *  entry and has to be swept. */
const WARMUP_TAG = "warmup-tuning";

const bootstrapped = new Set<string>();

export function agentIndexBankId(orgId: string): string {
  return bankIdForAgentOrg(INDEX_SLUG, orgId);
}

export function memory(): MemoryProvider {
  return getMemoryProvider();
}

/** False when no memory backend is configured, in which case indexing is a no-op. */
function memoryEnabled(): boolean {
  return (memory() as { enabled?: boolean }).enabled !== false;
}

/**
 * Create and configure the org's index bank, once per process.
 *
 * Hindsight materializes a bank row lazily on first retain, so a config write
 * before that returns 200 and persists nothing. `ensureBank` already handles the
 * warmup-and-verify loop; this adds the sweep of the warmup entry it leaves
 * behind and refuses to report success if the mode did not stick — feeding an
 * untuned bank silently stores extracted facts instead of verbatim documents.
 */
export async function ensureAgentIndexBank(orgId: string): Promise<string> {
  const bankId = agentIndexBankId(orgId);
  if (bootstrapped.has(bankId)) return bankId;

  const provider = memory();
  await provider.ensureBank(bankId, {
    mission: "Searchable catalogue of this organization's agents, for routing.",
    retainExtractionMode: "chunks",
    retainChunkSize: CHUNK_SIZE,
    enableObservations: false,
  });

  await assertChunksMode(bankId);
  await provider.deleteByTag?.(bankId, WARMUP_TAG).catch(() => 0);

  bootstrapped.add(bankId);
  log.info(`[agent-index] bank ready: ${bankId}`);
  return bankId;
}

/**
 * A bank that silently fell back to fact extraction accepts writes and returns
 * 200 — the documents are simply shredded into facts instead of stored. Nothing
 * downstream can detect that, so refuse to feed the bank at all.
 */
async function assertChunksMode(bankId: string): Promise<void> {
  const read = memory().getBankConfig;
  if (!read) return;

  const { overrides } = await read.call(memory(), bankId);
  // A disabled provider returns an empty shape rather than failing. Nothing was
  // written and nothing will be read, so there is no mis-tuned bank to protect
  // against — let the caller no-op instead of reporting a tuning failure.
  if (Object.keys(overrides).length === 0 && !memoryEnabled()) return;
  if (overrides["retain_extraction_mode"] !== "chunks") {
    throw new Error(
      `bank ${bankId} is not in chunks mode (got ${String(overrides["retain_extraction_mode"] ?? "unset")}) — refusing to index`,
    );
  }
}

/** Resolved settings for the org's bank, for operators verifying configuration. */
export async function agentIndexBankConfig(orgId: string): Promise<Record<string, unknown>> {
  const bankId = await ensureAgentIndexBank(orgId);
  const read = memory().getBankConfig;
  if (!read) return {};
  const { overrides } = await read.call(memory(), bankId);
  return overrides;
}

/** Drops the memoized bootstrap so the next call re-applies tuning. */
export function resetBankCache(orgId?: string): void {
  if (orgId) bootstrapped.delete(agentIndexBankId(orgId));
  else bootstrapped.clear();
}
