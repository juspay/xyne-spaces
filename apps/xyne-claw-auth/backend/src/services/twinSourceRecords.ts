/**
 * Source kind → the user's records in a window, shared by the nightly cron, the
 * backfill worker and the pipeline-event retry route so all three fetch the
 * same thing for the same source.
 *
 * Its own module (not userMemoryFetcher.ts) because contextAssembler.ts imports
 * userMemoryFetcher.ts — pulling the assembler into it would be a cycle.
 */

import type { UserMemoryRecord } from "xyne-claw-shared";
import type { BackfillSource } from "./digitalTwinBackfillState.js";
import { assembleConversationUnits, isContextAssemblerEnabled } from "./contextAssembler.js";
import { fetchUserCalls, fetchUserCanvases, fetchUserMessages } from "./userMemoryFetcher.js";

export async function fetchSourceRecords(
  source: BackfillSource,
  userId: string,
  window: { from: Date; to: Date },
): Promise<UserMemoryRecord[]> {
  if (source === "messages") {
    // Thread-complete conversation units when the assembler flag is on, else the
    // legacy flat outgoing-message stream.
    return isContextAssemblerEnabled()
      ? assembleConversationUnits(userId, window)
      : fetchUserMessages(userId, window);
  }
  if (source === "calls") return fetchUserCalls(userId, window);
  return fetchUserCanvases(userId, window);
}
