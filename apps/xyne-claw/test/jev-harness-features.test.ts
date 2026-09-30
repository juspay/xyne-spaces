import { describe, expect, it, vi } from "vitest";
import type { JevAnswer } from "../src/jev.js";
import {
  buildTwinDeliverTool,
  checkTwinDelivery,
  installStopAfterDelivery,
  twinCheckFromAnswers,
  twinCheckQuestions,
  type TwinDeliverRef,
} from "../src/twin-deliver.js";
import { decideFromJev } from "../src/twin-respond-gate.js";
import { pickFromAnswers, pickPersonaFiles, toggledFiles } from "../src/persona-pick.js";
import { checkFromAnswers, checkMemoryUpdate } from "../src/memory-update-check.js";
import { checkMemoryCandidates, decideCandidate, mostSimilar, similarity } from "../src/memory-candidate-check.js";
import { routeFromJev } from "../src/mode-router.js";
import { goalFromJev } from "../src/goal-judge.js";
import { prefetchGateFromJev } from "../src/prefetch.js";
import { checkpointFromJev, contextGate, contextGateFromJev } from "../src/answer-gates.js";
import { stalledFromJev } from "../src/tool-budget.js";
import { siftState } from "../src/result-sift.js";

const noul = (p: number): JevAnswer => ({ type: "noul", noul: p });
const score = (p: number): JevAnswer => ({ type: "score", score: p });
const choice = (pick: string, p: number): JevAnswer => ({ type: "choice", choice: pick, probabilities: { [pick]: p }, confidence: p });

// ── R7: stop after delivery ──────────────────────────────────────────────────
describe("twin_deliver ends the run", () => {
  const exec = async (ref: TwinDeliverRef, params: unknown) =>
    (await buildTwinDeliverTool("digital-twin", ref).execute("c", params)) as { terminate?: boolean; details: Record<string, unknown> };

  it("an accepted reply, an ignore and every duplicate return terminate:true", async () => {
    const ref: TwinDeliverRef = {};
    expect((await exec(ref, { action: "reply", message: "on it" })).terminate).toBe(true);
    const dup = await exec(ref, { action: "reply", message: "again" });
    expect(dup.terminate).toBe(true);
    expect(dup.details["duplicate"]).toBe(true);
    expect((await exec({}, { action: "ignore" })).terminate).toBe(true);
  });

  it("a rejected call does not terminate, so the model can retry", async () => {
    expect((await exec({}, { action: "reply" })).terminate).toBeUndefined();
  });

  it("stop hook ends the loop once delivered and chains the previous hook", async () => {
    let delivered = false;
    const prev = vi.fn(() => true);
    const agent = { createLoopConfig: () => ({ shouldStopAfterTurn: prev }) };
    expect(installStopAfterDelivery(agent, () => delivered)).toBe(true);
    const cfg = agent.createLoopConfig();
    expect(await cfg.shouldStopAfterTurn!({})).toBe(true);
    expect(prev).toHaveBeenCalledTimes(1);
    prev.mockReturnValue(false);
    expect(await cfg.shouldStopAfterTurn!({})).toBe(false);
    delivered = true;
    expect(await cfg.shouldStopAfterTurn!({})).toBe(true);
    expect(prev).toHaveBeenCalledTimes(2); // not consulted once delivered
  });

  it("reports false when pi's shape drifted", () => {
    expect(installStopAfterDelivery({}, () => true)).toBe(false);
  });
});

// ── R5: respond gate band 0.7 / 0.3 ──────────────────────────────────────────
describe("twin respond gate via classifier", () => {
  it("≥0.7 respond, ≤0.3 skip, between → LLM", () => {
    expect(decideFromJev({ worth: score(0.82) })).toMatchObject({ respond: true });
    expect(decideFromJev({ worth: score(0.12) })).toMatchObject({ respond: false });
    expect(decideFromJev({ worth: score(0.5) })).toBeNull();
    expect(decideFromJev({})).toBeNull();
  });
});

// ── R6: delivery check ───────────────────────────────────────────────────────
describe("twin delivery check", () => {
  it("asks reply questions for a reply and an action question for ignore", () => {
    expect(Object.keys(twinCheckQuestions({ action: "reply", message: "x" }))).toEqual(["answers_ask", "grounded"]);
    expect(Object.keys(twinCheckQuestions({ action: "reply", message: "x", destination: { kind: "dm_sender" } as never }))).toContain("destination");
    expect(Object.keys(twinCheckQuestions({ action: "ignore" }))).toEqual(["action_fits"]);
  });

  it("overall is the lowest score; a wrong destination forces 0", () => {
    const c = twinCheckFromAnswers({ action: "reply", message: "x" }, { answers_ask: score(0.9), grounded: score(0.4) }, 5);
    expect(c).toMatchObject({ answersAsk: 0.9, grounded: 0.4, overall: 0.4, source: "jev" });
    const wrong = twinCheckFromAnswers({ action: "reply", message: "x" }, { answers_ask: score(0.9), grounded: score(0.9), destination: choice("wrong", 0.8) }, 5);
    expect(wrong?.overall).toBe(0);
  });

  it("returns null when the classifier is unavailable or disabled", async () => {
    const ctx = { task: "t", messages: [] };
    expect(await checkTwinDelivery({ action: "reply", message: "x" }, ctx, { ask: async () => null, enabled: true })).toBeNull();
    expect(await checkTwinDelivery({ action: "reply", message: "x" }, ctx, { enabled: false })).toBeNull();
  });

  it("puts the delivery in the state as fenced data", async () => {
    const ask = vi.fn(async () => ({ answers_ask: score(0.8), grounded: score(0.7) }));
    const c = await checkTwinDelivery({ action: "reply", message: "shipping friday" }, { task: "when do we ship?", messages: [] }, { ask, enabled: true });
    expect(c?.overall).toBe(0.7);
    expect(String(ask.mock.calls[0]![0])).toContain("<<<DATA\naction: reply\nreply: shipping friday");
  });
});

// ── R9: persona file pick ────────────────────────────────────────────────────
describe("persona file pick", () => {
  const files = [
    { name: "soul.md", content: "voice", loadInPrompt: true },
    { name: "people.md", content: "ppl", loadInPrompt: true },
    { name: "projects.md", content: "proj", loadInPrompt: true },
    { name: "playbook.md", content: "how", loadInPrompt: false },
    { name: "expertise.md", content: "exp", loadInPrompt: false },
  ];

  it("fallback = the user's toggled files", () => {
    expect(toggledFiles(files).map((f) => f.name)).toEqual(["soul.md", "people.md", "projects.md"]);
  });

  it("soul.md always, then the best others ≥0.5, max 3 total", () => {
    const picked = pickFromAnswers(files, { f1: noul(0.2), f2: noul(0.6), f3: noul(0.9), f4: noul(0.7) });
    expect(picked?.map((f) => f.name)).toEqual(["soul.md", "playbook.md", "expertise.md"]);
    // Nothing clearly needed beyond the core voice → null → the toggled set.
    expect(pickFromAnswers(files, { f1: noul(0.1), f2: noul(0.1), f3: noul(0.1), f4: noul(0.1) })).toBeNull();
    expect(pickFromAnswers(files, {})).toBeNull();
  });

  it("classifier down → toggled set", async () => {
    const picked = await pickPersonaFiles(files, "can you review my PR?", { ask: async () => null, enabled: true });
    expect(picked.map((f) => f.name)).toEqual(["soul.md", "people.md", "projects.md"]);
  });
});

// ── R10: nightly update check ────────────────────────────────────────────────
describe("memory update check", () => {
  it("accept only when every signal is good; reject on a clear problem; else review", () => {
    expect(checkFromAnswers({ supported: score(0.9), keeps_old: score(0.8), verdict: choice("accept", 0.9) }, 1)?.verdict).toBe("accept");
    expect(checkFromAnswers({ supported: score(0.9), keeps_old: score(0.2), verdict: choice("accept", 0.9) }, 1)?.verdict).toBe("reject");
    expect(checkFromAnswers({ supported: score(0.9), verdict: choice("reject", 0.6) }, 1)?.verdict).toBe("reject");
    expect(checkFromAnswers({ supported: score(0.45), verdict: choice("accept", 0.6) }, 1)?.verdict).toBe("review");
    expect(checkFromAnswers({}, 1)).toBeNull();
  });

  it("classifier down → accept (today's behaviour)", async () => {
    const c = await checkMemoryUpdate({ fileName: "soul.md", description: "d", newContent: "n", facts: ["f"] }, { ask: async () => null, enabled: true });
    expect(c).toMatchObject({ verdict: "accept", source: "fallback" });
  });
});

// ── R8: memory candidate check ───────────────────────────────────────────────
describe("memory candidate check", () => {
  const existing = [
    { id: "1", subsystem: "people", text: "The user works closely with Priya on payments reconciliation" },
    { id: "2", subsystem: "style", text: "The user writes short replies with no greeting" },
  ];
  const cand = (text: string, signalScore = 0.8) => ({ text, subsystem: "people" as const, signalScore, groundedOnIds: ["r1"] });

  it("finds the most similar stored memories", () => {
    expect(similarity("a b c", "x y z")).toBe(0);
    expect(mostSimilar("Priya payments reconciliation owner", existing)[0]!.id).toBe("1");
  });

  it("drops confident duplicates and noise, keeps the rest", () => {
    expect(decideCandidate({ verdict: choice("duplicate", 0.8) })).toMatchObject({ keep: false });
    expect(decideCandidate({ verdict: choice("noise", 0.75) })).toMatchObject({ keep: false });
    expect(decideCandidate({ verdict: choice("duplicate", 0.6) })).toMatchObject({ keep: true });
    expect(decideCandidate({ verdict: choice("new", 0.9), worth: score(0.7) })).toMatchObject({ keep: true, worth: 0.7 });
  });

  it("filters and re-ranks a batch; unavailable candidates pass through", async () => {
    const answersFor: Record<string, Record<string, JevAnswer>> = {
      dup: { verdict: choice("duplicate", 0.9) },
      good: { verdict: choice("new", 0.9), worth: score(0.9) },
      meh: { verdict: choice("new", 0.8), worth: score(0.2) },
    };
    const ask = vi.fn(async (state: string) => {
      const key = Object.keys(answersFor).find((k) => state.includes(`] ${k}`));
      return key ? answersFor[key]! : null;
    });
    const { candidates, summary } = await checkMemoryCandidates(
      [cand("meh", 0.8), cand("dup"), cand("good", 0.8), cand("down", 0.75)],
      existing,
      { ask, enabled: true },
    );
    // meh: classifier 0.2 + curator 0.8 = 1.0 ranks below unchecked down: 0.75 + 0.75.
    expect(candidates.map((c) => c.text)).toEqual(["good", "down", "meh"]);
    expect(candidates[0]).toMatchObject({ jevVerdict: "new", jevScore: 0.9 });
    expect(summary).toMatchObject({ checked: 4, unavailable: 1 });
    expect(summary?.dropped.map((d) => d.text)).toEqual(["dup"]);
  });

  it("stops asking after 3 misses in a row; the rest pass through", async () => {
    const ask = vi.fn(async () => null);
    const many = Array.from({ length: 20 }, (_, i) => cand(`fact ${i}`));
    const { candidates, summary } = await checkMemoryCandidates(many, existing, { ask, enabled: true });
    expect(candidates).toHaveLength(20);
    expect(summary?.unavailable).toBe(20);
    expect(ask.mock.calls.length).toBeLessThanOrEqual(8 + 3); // at most one in-flight wave past the cutoff
  });

  it("disabled → unchanged, no calls", async () => {
    const ask = vi.fn();
    const out = await checkMemoryCandidates([cand("a")], existing, { ask, enabled: false });
    expect(out.summary).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});

// ── R12/R14 gates and routers ────────────────────────────────────────────────
describe("routing and gates", () => {
  const commands = [{ command: "/review", instruction: "review code" }, { command: "/learn", instruction: "learn" }] as never;

  it("mode router: a mode needs ≥0.85, none needs ≥0.7, else LLM", () => {
    expect(routeFromJev(commands, { mode: choice("review", 0.9) })?.command).toMatchObject({ command: "/review" });
    expect(routeFromJev(commands, { mode: choice("review", 0.8) })).toBeNull();
    expect(routeFromJev(commands, { mode: choice("none", 0.75) })).toEqual({ command: null, source: "jev" });
    expect(routeFromJev(commands, { mode: choice("none", 0.6) })).toBeNull();
  });

  it("goal judge: only clear done / clear continue are decided", () => {
    expect(goalFromJev({ status: choice("completed", 0.95) })).toMatchObject({ done: true });
    expect(goalFromJev({ status: choice("completed", 0.85) })).toBeNull();
    expect(goalFromJev({ status: choice("continue", 0.85) })).toMatchObject({ done: false });
    expect(goalFromJev({ status: choice("stuck", 0.99) })).toBeNull();
  });

  it("prefetch gate: skip only on a clear 'nothing to look up'", () => {
    expect(prefetchGateFromJev({ names_entity: noul(0.1) })).toBe("skip");
    expect(prefetchGateFromJev({ names_entity: noul(0.5) })).toBe("extract");
    expect(prefetchGateFromJev({})).toBeNull();
  });

  it("checkpoint pre-check: skip the nudge only when clearly a real answer", () => {
    expect(checkpointFromJev({ is_answer: noul(0.9) })).toBe(true);
    expect(checkpointFromJev({ is_answer: noul(0.1) })).toBe(false);
    expect(checkpointFromJev({ is_answer: noul(0.6) })).toBeNull();
  });

  it("context gate: fetch more only on a clear gap for a request that needs lookups", async () => {
    expect(contextGateFromJev({ supported: score(0.2), no_lookup_needed: noul(0.1) })).toBe("fetch-more");
    expect(contextGateFromJev({ supported: score(0.2), no_lookup_needed: noul(0.9) })).toBe("accept");
    expect(contextGateFromJev({ supported: score(0.6) })).toBe("accept");
    expect(await contextGate({ task: "t", messages: [], answer: "a", evidence: "" }, { ask: async () => null, enabled: true })).toBe("accept");
  });

  it("tool progress: only a clear stall nudges", () => {
    expect(stalledFromJev({ progress: score(0.2) })).toBe(true);
    expect(stalledFromJev({ progress: score(0.5) })).toBe(false);
    expect(stalledFromJev({})).toBeNull();
  });
});

// ── R1: sift context ─────────────────────────────────────────────────────────
describe("result sift state", () => {
  it("carries the earlier conversation and the call's args, not just the latest message", () => {
    const state = siftState({
      toolName: "spaces-search",
      task: "and what did Priya say about it?",
      messages: [
        { role: "user", content: [{ type: "text", text: "summarise the payments outage from Monday" }] },
        { role: "assistant", content: [{ type: "text", text: "The outage was caused by a stuck reconciliation job." }] },
        { role: "user", content: [{ type: "text", text: "and what did Priya say about it?" }] },
      ],
      args: { query: "Priya payments outage" },
    });
    expect(state).toContain("summarise the payments outage from Monday");
    expect(state).toContain('spaces-search({"query":"Priya payments outage"})');
    expect(state).toContain("returned a list of items");
  });
});
