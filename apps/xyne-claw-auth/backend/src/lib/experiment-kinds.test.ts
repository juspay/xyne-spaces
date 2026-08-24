import { describe, expect, it, beforeAll } from "vitest";

// experiment.ts pulls in config.ts, which hard-requires ENCRYPTION_KEY at module
// load. The parser under test has no runtime dependency on it, so a dummy key
// plus a dynamic import keeps this a pure unit test.
process.env["ENCRYPTION_KEY"] ??= "00".repeat(32);

let parseExperimentCommand: typeof import("./experiment.js")["parseExperimentCommand"];
beforeAll(async () => {
  ({ parseExperimentCommand } = await import("./experiment.js"));
});

describe("/framework command", () => {
  it("parses duration and focus, tagged as a framework run", () => {
    const c = parseExperimentCommand("@Agent /framework 4h focus=apps/backend controllers");
    expect(c).toMatchObject({ sub: "start", kind: "framework" });
    expect((c as { focus?: string }).focus).toContain("apps/backend");
  });

  it("shares the subcommands with /experiment", () => {
    expect(parseExperimentCommand("/framework status")).toMatchObject({ sub: "status" });
    expect(parseExperimentCommand("/framework stop")).toMatchObject({ sub: "stop" });
    expect(parseExperimentCommand("/framework findings")).toMatchObject({ sub: "findings" });
  });

  it("keeps the kinds distinct", () => {
    expect((parseExperimentCommand("/experiment 2h focus=x") as { kind?: string }).kind).toBeUndefined();
    expect(parseExperimentCommand("/understanding 2h focus=x")).toMatchObject({ kind: "understanding" });
    expect(parseExperimentCommand("/framework 2h focus=x")).toMatchObject({ kind: "framework" });
    expect(parseExperimentCommand("/security-scan 2h focus=x")).toMatchObject({ kind: "security" });
    expect(parseExperimentCommand("/repo-history 2h focus=abc123")).toMatchObject({ kind: "repo-history" });
  });

  it("/security-scan shares duration, focus, provider pin and subcommands", () => {
    const c = parseExperimentCommand("/security-scan 6h provider=claude model=claude-opus-4-8 focus=apps/backend");
    expect(c).toMatchObject({ sub: "start", kind: "security", provider: "claude", model: "claude-opus-4-8" });
    expect(parseExperimentCommand("/security-scan status")).toMatchObject({ sub: "status" });
    expect(parseExperimentCommand("/security-scan findings")).toMatchObject({ sub: "findings" });
  });


  it("requires framework reports to include a tag index", async () => {
    const { buildEpochTask } = await import("./experiment.js");
    const run = {
      id: "exp-1",
      agentId: "agent-1",
      conversationId: "conv-1",
      status: "running",
      mode: "participant",
      kind: "framework",
      focus: "apps/backend",
      deadlineAt: new Date(Date.now() + 60_000),
      epoch: 1,
      sandboxNote: null,
      deliveredArtifacts: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      provider: null,
      model: null,
      branch: null,
      pullRequestUrl: null,
      userId: null,
      workspaceId: null,
    };
    const task = buildEpochTask(run as unknown as Parameters<typeof buildEpochTask>[0], "");
    expect(task).toContain("Tag Index table");
    expect(task).toContain("tag name, finding count, affected areas, proposed paved path/framework abstraction, and migration cost");
  });

  it("accepts a provider/model pin like the others", () => {
    const c = parseExperimentCommand("/framework 3h provider=litellm model=glm-private-claw focus=packages");
    expect(c).toMatchObject({ kind: "framework", provider: "litellm", model: "glm-private-claw" });
  });

  it("ignores unrelated text", () => {
    expect(parseExperimentCommand("what frameworks do we use?")).toBeNull();
  });
});
