/**
 * Cluster-global concurrency gate for Daily Brief LLM runs.
 *
 * The mechanism lives in lib/llm-slot.ts — this is the Daily Brief's
 * configuration of it. See that file for why per-worker concurrency alone is
 * not enough on a multi-replica fleet.
 */

import { withGlobalLlmSlot } from "./llm-slot.js";
import { CONFIG } from "../config.js";

const KEY = "claw:daily-brief:llm-slots";
// Safety reclaim: a brief run should finish well within this; if a pod dies
// mid-run its slot is auto-reclaimed after this window.
const SLOT_TTL_MS = 15 * 60 * 1000;

/**
 * Run `fn` while holding one global brief LLM slot. Waits up to
 * CONFIG.dailyBriefSlotWaitMs for a slot; if none frees up in that window it
 * throws so BullMQ retries the job later rather than exceeding the global cap.
 * When the cap is 0/undefined the gate is disabled and `fn` runs immediately.
 */
export async function withDailyBriefLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  return withGlobalLlmSlot(
    {
      key: KEY,
      cap: CONFIG.dailyBriefGlobalConcurrency,
      waitMs: CONFIG.dailyBriefSlotWaitMs,
      ttlMs: SLOT_TTL_MS,
      label: "daily-brief-slot",
    },
    fn,
  );
}
