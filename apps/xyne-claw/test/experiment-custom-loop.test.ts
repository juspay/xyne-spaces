import { describe, expect, it } from "vitest";
import { buildCustomLoopDef, resolveLoop } from "xyne-claw-shared";
import { normalizeExperimentContext } from "../src/routes/run.js";

const def = buildCustomLoopDef({
  id: "lc1",
  name: "route-explainer",
  description: "Explain every API route",
  template: "frontier",
  instruction: "Explain every API route in apps/orders and what it touches.",
  skills: ["understanding-skills"],
  subagents: [],
  deliverable: "html",
  judgeQuestion: null,
  maxPasses: null,
});
const loop = { command: def.command, graph: def.graph, exit: def.exit, deadlineReleases: def.deadlineReleases, deliverable: def.deliverable, skills: def.skills, subagents: [], custom: def.custom };

describe("custom loop on an epoch dispatch", () => {
  it("carries the user's loop definition so exit rules, deliverable and skills follow it", () => {
    const ctx = normalizeExperimentContext({ id: "e1", epoch: 2, deadlineAt: "2026-10-23T12:00:00Z", kind: "custom", loop })!;
    expect(ctx.kind).toBe("custom");
    const resolved = resolveLoop(ctx);
    expect(resolved).toMatchObject({ command: "/route-explainer", exit: "frontier", deliverable: "html", skills: ["understanding-skills"], custom: { id: "lc1" } });
  });

  it("ignores a loop on a built-in kind and a malformed loop on a custom one", () => {
    expect(normalizeExperimentContext({ id: "e1", deadlineAt: "x", kind: "understanding", loop })!.loop).toBeUndefined();
    const forged = normalizeExperimentContext({ id: "e1", deadlineAt: "x", kind: "custom", loop: { ...loop, skills: ["../../../etc"], command: "/ok-name" } })!;
    expect(forged.loop?.skills).toEqual([]);
    expect(normalizeExperimentContext({ id: "e1", deadlineAt: "x", kind: "custom", loop: { ...loop, exit: "never" } })!.loop).toBeUndefined();
    expect(resolveLoop(normalizeExperimentContext({ id: "e1", deadlineAt: "x", kind: "custom" }))).toMatchObject({ key: "experiment" });
  });
});
