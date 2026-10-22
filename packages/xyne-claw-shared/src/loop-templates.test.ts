import { describe, expect, it } from "vitest";
import { LOOP_TEMPLATES, buildCustomLoopDef, type CustomLoopCommand } from "./loop-templates.js";
import { loopCommandFor, loopFromPayload, resolveLoop } from "./loop-commands.js";

const base: CustomLoopCommand = {
  id: "lc1",
  name: "perf-hunt",
  description: "Hunt performance regressions",
  template: "deadline-checker",
  instruction: "Profile the payments service and record every regression with a benchmark.",
  skills: ["understanding-skills"],
  subagents: ["log-triage"],
  deliverable: "md",
  judgeQuestion: null,
  maxPasses: null,
};

describe("loop templates", () => {
  it("covers the five catalogue shapes", () => {
    expect(LOOP_TEMPLATES.map((t) => t.id)).toEqual(["deadline-checker", "frontier", "cursor-walk", "until-condition", "fix-retry"]);
  });

  it.each([
    ["deadline-checker", "timeboxed", "deadline", true],
    ["frontier", "timeboxed", "frontier", true],
    ["cursor-walk", "progress", "frontier", false],
  ] as const)("%s builds a %s graph with a %s exit", (template, graph, exit, deadlineReleases) => {
    const def = buildCustomLoopDef({ ...base, template });
    expect(def).toMatchObject({ key: "custom", kind: "custom", command: "/perf-hunt", graph, exit, deadlineReleases, deliverable: "md", skills: ["understanding-skills"], subagents: ["log-triage"] });
    expect(def.judge).toBeUndefined();
    expect(def.custom).toMatchObject({ id: "lc1", template, instruction: base.instruction });
  });

  it("wires the judge so until-condition retries while NOT met and fix-retry retries while problems remain", () => {
    const until = buildCustomLoopDef({ ...base, template: "until-condition", judgeQuestion: "Is p95 under 200 ms?", maxPasses: 5 });
    expect(until.judge).toEqual({ questions: [{ id: "condition", type: "yesno", question: "Is p95 under 200 ms?" }], retryWhen: { question: "condition", value: false }, maxRetries: 5 });
    const fix = buildCustomLoopDef({ ...base, template: "fix-retry", judgeQuestion: "Are tests still failing?" });
    expect(fix.judge?.retryWhen).toEqual({ question: "condition", value: true });
    expect(fix.judge?.maxRetries).toBe(6);
    expect(fix.custom?.exitText).toContain('Finish condition the judge checks: "Are tests still failing?"');
  });

  it("drops skills that are not shipped skill bundles", () => {
    expect(buildCustomLoopDef({ ...base, skills: ["understanding-skills", "../../etc"] }).skills).toEqual(["understanding-skills"]);
  });
});

describe("custom loop payload", () => {
  const def = buildCustomLoopDef({ ...base, template: "frontier" });
  const payload = { command: def.command, graph: def.graph, exit: def.exit, deadlineReleases: def.deadlineReleases, deliverable: def.deliverable, skills: [...def.skills, "../secrets"], subagents: def.subagents, custom: def.custom };

  it("round-trips what claw-auth sends, minus unsafe skills", () => {
    const back = loopFromPayload(payload)!;
    expect(back).toMatchObject({ key: "custom", command: "/perf-hunt", graph: "timeboxed", exit: "frontier", deliverable: "md", skills: ["understanding-skills"], custom: def.custom });
    expect(resolveLoop({ kind: "custom", loop: back })).toBe(back);
  });

  it("rejects malformed payloads and falls back to the built-in loop", () => {
    expect(loopFromPayload({ ...payload, command: "/../x" })).toBeUndefined();
    expect(loopFromPayload({ ...payload, graph: "forever" })).toBeUndefined();
    expect(loopFromPayload({ ...payload, custom: undefined })).toBeUndefined();
    expect(resolveLoop({ kind: "understanding" })).toBe(loopCommandFor("understanding"));
  });
});
