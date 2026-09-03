import { describe, expect, it } from "vitest";
import { normalizeFindingTitle, proofWasDelivered } from "./experimentRepository.js";

/** Title pairs taken verbatim from the first three live /experiment runs, where
 *  exact-match upsert stored each as a separate finding and inflated the
 *  ledger. Each pair MUST collapse to one entry. */
const REAL_DUPLICATE_PAIRS: Array<[string, string]> = [
  [
    "RenderMessageWithHTML DOMParser pipeline: 2.1-3.0× waste from unnecessary serialization + re-parsing (28-172 µs saved per message)",
    "F22: RenderMessageWithHTML DOMParser pipeline 2.0-3.5× waste from unnecessary serialization + re-parsing (824.3 µs saved per message arrival in F17 scenario)",
  ],
  [
    "useUserBookmarks redundant O(n) .some() + .find() per ChatBubble render: 207.7 µs at 1000 bookmarks, 13-227× speedup with Map",
    "F23: useUserBookmarks redundant O(n) .some() + .find() per ChatBubble render: 208.5 µs at 1000 bookmarks, 131.8× speedup with Map",
  ],
];

/** Same defect, but re-written rather than re-measured — no shared prefix
 *  survives normalisation. String matching cannot collapse this; catching it
 *  needs a semantic pass over the ledger. Asserted as a KNOWN LIMIT so the gap
 *  stays visible instead of being quietly assumed solved. */
const SEMANTIC_DUPLICATE_PAIR: [string, string] = [
  "Webhook signature verification defaults to fail-open (warn) instead of fail-closed (enforce) — full impersonation via forged webhook",
  "Webhook signature verification fails OPEN by default — contradicts its own documentation",
];

describe("normalizeFindingTitle", () => {
  it.each(REAL_DUPLICATE_PAIRS)("collapses re-recorded titles: %s", (a, b) => {
    expect(normalizeFindingTitle(a)).toBe(normalizeFindingTitle(b));
  });

  it("KNOWN LIMIT: does not collapse a semantic re-write (needs the ledger checker)", () => {
    const [a, b] = SEMANTIC_DUPLICATE_PAIR;
    expect(normalizeFindingTitle(a)).not.toBe(normalizeFindingTitle(b));
  });

  it("strips an F-index prefix", () => {
    expect(normalizeFindingTitle("F22: Foo bar baz")).toBe(normalizeFindingTitle("Foo bar baz"));
  });

  it("keeps genuinely distinct findings distinct", () => {
    expect(normalizeFindingTitle("N+1 query in handleUnreadCount")).not.toBe(
      normalizeFindingTitle("N+1 query in getChannelHistory"),
    );
    expect(normalizeFindingTitle("Cross-workspace ticket WRITE via updateTicket")).not.toBe(
      normalizeFindingTitle("Cross-workspace message READ via getConversationMessage"),
    );
  });
});

describe("proofWasDelivered", () => {
  const delivered = ["proof_ssrf.cjs", "bench_201_channels.js"];

  it("matches an in-sandbox path against its delivered basename", () => {
    expect(proofWasDelivered("/workspace/proof_ssrf.cjs", delivered)).toBe(true);
    expect(proofWasDelivered("proof_ssrf.cjs", delivered)).toBe(true);
    expect(proofWasDelivered("/workspace/findings/BENCH_201_CHANNELS.JS", delivered)).toBe(true);
  });

  it("rejects proof that never left the sandbox — the live failure mode", () => {
    expect(proofWasDelivered("/workspace/proof_dm_race.cjs", delivered)).toBe(false);
  });

  it("rejects an absent or blank path", () => {
    expect(proofWasDelivered(null, delivered)).toBe(false);
    expect(proofWasDelivered("   ", delivered)).toBe(false);
  });

  it("rejects everything when nothing has been delivered", () => {
    expect(proofWasDelivered("/workspace/proof_ssrf.cjs", [])).toBe(false);
  });
});
