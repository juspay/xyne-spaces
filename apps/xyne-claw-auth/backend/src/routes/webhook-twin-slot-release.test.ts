import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webhookSrc = readFileSync(resolve(here, "./webhook.ts"), "utf8");

// Regression pin for the 2026-08-19 twin-slot leak: the session_locked branch
// of /webhook/result released the conversation slot WITHOUT the twin user
// scope, so a digital-twin run's 3-part busy key (conv:digital-twin:<userId>,
// see scoped() in lib/message-queue.ts) was never deleted — it leaked for the
// full BUSY_TTL (20m) and every new twin tag queued behind a phantom "active
// run". Every releaseSlot on a path a twin run can reach MUST pass the scope.

describe("twin slot release scope", () => {
  it("passes resultUserScope on the session_locked releaseSlot", () => {
    // The offending call, now scoped. If a refactor drops the 4th arg, the
    // twin slot leaks again.
    expect(webhookSrc).toContain(
      "await releaseSlot(resultConversationId, resultAgentSlug, undefined, resultUserScope || undefined)",
    );
  });

  it("never releases a twin-reachable slot with the bare 2-arg form", () => {
    // The bare `releaseSlot(resultConversationId, resultAgentSlug)` is the bug
    // shape — it mis-keys a twin slot to the 2-part key. It must not reappear.
    expect(webhookSrc).not.toMatch(/releaseSlot\(resultConversationId, resultAgentSlug\)/);
  });
});
