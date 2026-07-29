/**
 * Standalone Digital Twin page (route: /digital-twin).
 *
 * Layout (top to bottom):
 *   1. Page header with Brain icon + description
 *   2. DigitalTwinSection — banner with Enable / Review / Backfill / Upload .md / Settings / Disable
 *   3. MemoryTab — the full V2 memory explorer (All / Hot / Batches / Candidates / Graph / Recall
 *      Tester), pinned to the `digital-twin` Hindsight bank, scoped to THIS user via the
 *      `userTag` prop. The backend's privacy gate (memory.ts) enforces that the userTag matches
 *      the requesting `x-user-id`, so even if the prop were tampered with at the wire layer the
 *      server refuses cross-user reads.
 *
 * Reusing `<MemoryTab>` (instead of building a Twin-specific clone) gives us all six sub-tabs
 * for free, including the Recall Tester which is the most useful thing for "is my Twin
 * actually learning the right facts about me" debugging.
 */

import { Brain } from "lucide-react";
import { DigitalTwinSection } from "./DigitalTwinSection";
import { MemoryTab } from "../v2/components/MemoryTab";

export function DigitalTwinPage({ userId }: { userId: string }) {
  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Brain size={22} className="text-indigo-400" />
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Digital Twin</h1>
          <p className="text-xs text-zinc-500">
            Your personal AI memory — built from your own Spaces activity, reviewed by you before
            it ever reaches the Twin agent.
          </p>
        </div>
      </div>

      <DigitalTwinSection userId={userId} />

      {/* Memory explorer — All / Hot / Batches / Candidates / Graph / Recall Tester.
          userTag scopes every API call to this user's slice of the digital-twin bank;
          the backend rejects mismatched userTag for the digital-twin agentSlug. */}
      <div className="mt-8">
        <MemoryTab agentSlug="digital-twin" userTag={`user:${userId}`} canDelete={true} />
      </div>
    </>
  );
}
