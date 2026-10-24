import { beforeAll, describe, expect, it, vi } from "vitest";

process.env["ENCRYPTION_KEY"] ??= "00".repeat(32);

const rows = vi.hoisted(() => ({ byName: new Map<string, Record<string, unknown>>() }));
vi.mock("../db.js", () => ({
  prisma: {
    loopCommandDefinition: {
      findMany: vi.fn(async ({ where }: { where: { name: { in: string[] } } }) => [...rows.byName.values()].filter((r) => where.name.in.includes(r["name"] as string))),
      findUnique: vi.fn(async ({ where }: { where: { orgId_name?: { name: string }; id?: string } }) =>
        where.orgId_name ? rows.byName.get(where.orgId_name.name) ?? null : [...rows.byName.values()].find((r) => r["id"] === where.id) ?? null),
    },
  },
}));

let defs: typeof import("./loop-command-defs.js");
let exp: typeof import("./experiment.js");
let help: typeof import("./webhook-commands/help.js");
beforeAll(async () => {
  defs = await import("./loop-command-defs.js");
  exp = await import("./experiment.js");
  help = await import("./webhook-commands/help.js");
});

const input = {
  name: "perf-hunt",
  description: "Hunt performance regressions in payments",
  template: "until-condition",
  instruction: "Benchmark the checkout path and tune it until it is fast enough.",
  judgeQuestion: "Does the reply show p95 under 200 ms?",
  maxDurationMinutes: 90,
  maxPasses: 5,
  skills: ["understanding-skills"],
  subagents: ["log-triage"],
};

describe("validateLoopCommand", () => {
  it("accepts a well-formed command and normalises it", () => {
    expect(defs.validateLoopCommand(input, { requireName: true })).toMatchObject({ name: "perf-hunt", template: "until-condition", maxDurationMinutes: 90, maxPasses: 5, judgeQuestion: input.judgeQuestion, provider: null });
  });

  it.each([
    [{ name: "help" }, "name"],
    [{ name: "experiment" }, "name"],
    [{ name: "ui-test" }, "name"],
    [{ name: "X" }, "name"],
    [{ template: "forever" }, "template"],
    [{ judgeQuestion: "" }, "judgeQuestion"],
    [{ template: "frontier", deliverable: null }, "deliverable"],
    [{ skills: ["../../etc"] }, "skills"],
    [{ skills: ["my-org-skill"] }, "skills"],
    [{ maxDurationMinutes: 99999 }, "maxDurationMinutes"],
    [{ provider: "openai-direct" }, "provider"],
    [{ instruction: "too short" }, "instruction"],
  ])("rejects %j", (extra, field) => {
    let err: unknown;
    try {
      defs.validateLoopCommand({ ...input, ...extra }, { requireName: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(defs.LoopCommandValidationError);
    expect((err as InstanceType<typeof defs.LoopCommandValidationError>).field).toBe(field);
  });

  it("drops the judge question on templates that have no judge", () => {
    expect(defs.validateLoopCommand({ ...input, template: "deadline-checker" }, { requireName: true }).judgeQuestion).toBeNull();
  });
});

describe("running a custom command", () => {
  const row = { id: "lc1", orgId: "o1", name: "perf-hunt", description: input.description, template: "until-condition", instruction: input.instruction, skills: [], subagents: ["log-triage"], deliverable: "md", judgeQuestion: input.judgeQuestion, maxPasses: 5, maxDurationMinutes: 90, provider: "litellm", modelId: "open-fast", published: false, enabled: true, createdByUserId: "u1", updatedAt: new Date("2026-10-23T00:00:00Z") };

  it("only the creator can run a draft; anyone can run a published command", async () => {
    rows.byName.set("perf-hunt", row);
    expect(await defs.findRunnableLoopCommand("o1", "u1", "/perf-hunt")).toMatchObject({ id: "lc1" });
    expect(await defs.findRunnableLoopCommand("o1", "u2", "/perf-hunt")).toBeNull();
    rows.byName.set("perf-hunt", { ...row, published: true });
    expect(await defs.findRunnableLoopCommand("o1", "u2", "perf-hunt")).toMatchObject({ id: "lc1" });
    expect(await defs.findRunnableLoopCommand("o1", "u1", "/experiment")).toBeNull();
  });

  it("parses duration, focus and subcommands, capped at the command's own limit", () => {
    const custom = { def: defs.toLoopDef(row as never), commandId: "lc1", maxDurationMs: 90 * 60_000, provider: "litellm", modelId: "open-fast" };
    expect(exp.parseExperimentCommand("@Agent /perf-hunt 30m checkout service", custom)).toMatchObject({ sub: "start", kind: "custom", commandId: "lc1", durationMs: 30 * 60_000, focus: "checkout service", provider: "litellm", model: "open-fast" });
    expect(exp.parseExperimentCommand("/perf-hunt 6h", custom)).toMatchObject({ durationMs: 90 * 60_000 });
    expect(exp.parseExperimentCommand("/perf-hunt", custom)).toMatchObject({ sub: "start", durationMs: 90 * 60_000 });
    expect(exp.parseExperimentCommand("/perf-hunt status", custom)).toEqual({ sub: "status" });
    expect(exp.parseExperimentCommand("/perf-hunter 30m", custom)).toBeNull();
    expect(exp.slashWord("@Agent /perf-hunt now")).toBe("perf-hunt");
  });

  it("builds each pass from the user's instruction and the template's exit rule", () => {
    const def = defs.toLoopDef(row as never);
    const task = exp.buildEpochTask({ id: "e1", kind: "custom", commandId: "lc1", epoch: 2, status: "running", deadlineAt: new Date(Date.now() + 3_600_000), deliveredArtifacts: [], sandboxNote: null } as never, "## Ledger", def);
    expect(task).toContain("You are running the /perf-hunt loop, pass 2.");
    expect(task).toContain(input.instruction);
    expect(task).toContain("SUBAGENTS: delegate the work they are built for to log-triage");
    expect(task).toContain(`Finish condition the judge checks: "${input.judgeQuestion}"`);
    expect(task).toContain("DELIVERABLE: ONE markdown report");
    expect(task).not.toContain("You are in /experiment mode");
    const finishing = exp.buildEpochTask({ id: "e1", kind: "custom", epoch: 3, status: "finishing", deadlineAt: new Date(), deliveredArtifacts: [], sandboxNote: null } as never, "", def);
    expect(finishing).toContain("The judge says the loop is finished");
    expect(exp.loopPayload(def)).toMatchObject({ command: "/perf-hunt", graph: "fix-retry", exit: "judge", custom: { id: "lc1" } });
  });

  it("lists your loop commands in /help, marking drafts", () => {
    const text = help.buildHelpText({ chat: false, loops: [{ name: "perf-hunt", description: input.description, template: "until-condition", published: false, maxDurationMinutes: 90 }] });
    expect(text).toContain("*Loop commands built in your org*");
    expect(text).toContain("`/perf-hunt` — Hunt performance regressions in payments _(draft, only you)_");
    expect(help.buildHelpText({ chat: false, command: "perf-hunt", loops: [{ name: "perf-hunt", description: "d", template: "until-condition", published: true, maxDurationMinutes: 90 }] })).toContain("Loop: Until condition");
  });
});

describe("sequence commands", () => {
  const seq = { name: "release-check", description: "UI, security and perf before a release", template: "sequence", steps: [{ command: "/ui-test", args: "{focus}" }, { command: "/security-scan", args: "30m auth" }] };

  it("accepts 2–6 loop steps and ignores loop-only fields", () => {
    const v = defs.validateLoopCommand({ ...seq, instruction: "ignored", judgeQuestion: "ignored?", skills: ["understanding-skills"] }, { requireName: true });
    expect(v).toMatchObject({ template: "sequence", instruction: "", skills: [], judgeQuestion: null, steps: seq.steps });
  });

  it.each([
    [{ steps: [{ command: "/ui-test", args: "" }] }, "steps"],
    [{ steps: [...Array(7)].map(() => ({ command: "/ui-test", args: "" })) }, "steps"],
    [{ steps: [{ command: "ui-test", args: "" }, { command: "/x1", args: "" }] }, "steps[0].command"],
    [{ steps: [{ command: "/release-check", args: "" }, { command: "/ui-test", args: "" }] }, "steps[0].command"],
    [{ steps: [{ command: "/ui-test", args: "x".repeat(301) }, { command: "/ui-test", args: "" }] }, "steps[0].args"],
  ])("rejects %j", (extra, field) => {
    let err: unknown;
    try {
      defs.validateLoopCommand({ ...seq, ...extra }, { requireName: true });
    } catch (e) {
      err = e;
    }
    expect((err as InstanceType<typeof defs.LoopCommandValidationError>).field).toBe(field);
  });
});

describe("checkSequenceSteps", () => {
  it("allows built-in loops and the org's own loops, but not missing commands or nested sequences", async () => {
    rows.byName.set("perf-hunt", { id: "p", name: "perf-hunt", template: "deadline-checker" });
    rows.byName.set("nightly", { id: "n", name: "nightly", template: "sequence" });
    await expect(defs.checkSequenceSteps("o1", [{ command: "/ui-test", args: "" }, { command: "/perf-hunt", args: "" }])).resolves.toBeUndefined();
    await expect(defs.checkSequenceSteps("o1", [{ command: "/ui-test", args: "" }, { command: "/nope", args: "" }])).rejects.toMatchObject({ field: "steps[1].command" });
    await expect(defs.checkSequenceSteps("o1", [{ command: "/nightly", args: "" }, { command: "/ui-test", args: "" }])).rejects.toThrow(/cannot nest/);
  });
});
