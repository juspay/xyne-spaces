import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interact: vi.fn(),
  spacesFetchBuffer: vi.fn(),
  spacesFetch: vi.fn(),
  spacesFetchText: vi.fn(),
  search: vi.fn(),
  memorySearch: vi.fn(),
  appFetch: vi.fn(),
}));

vi.mock("./xyne-spaces-client.js", () => mocks);

process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);
process.env["XYNE_CLAW_URL"] = "http://claw.local";
process.env["XYNE_CLAW_S2S_KEY"] = "s2s-secret";

const ctx = { userId: "u1", authMode: "user" as const };

const AUTOMATION = {
  id: "wf_1",
  workspaceId: "ws_1",
  name: "Nightly digest",
  description: "Posts a digest every night",
  status: "DRAFT",
  createdById: "u1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  automationSeriesId: null,
  config: {
    trigger: { type: "SCHEDULE", config: { cron: "0 9 * * *" } },
    conditions: [{ field: "priority", operator: "eq", value: "HIGH" }],
    steps: [{ type: "SEND_EMAIL", config: { to: "team@example.com" } }],
  },
};

async function loadTool(name: string) {
  const mod = await import("./xyne-spaces-tools.js");
  const tool = mod.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} tool not found`);
  return tool;
}

function lastCall() {
  const calls = mocks.spacesFetch.mock.calls;
  return calls[calls.length - 1] as [string, { method?: string; body?: string } | undefined];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("automation tool surface", () => {
  it("registers exactly the fifteen automation tools", async () => {
    const mod = await import("./xyne-spaces-tools.js");
    const names = mod.tools.map((t) => t.name).filter(n => n.startsWith("automations-"));
    // Exact set, not a containment check: a containment assertion silently
    // passed when the surface grew from 7 to 14, which is precisely the kind of
    // drift this test exists to catch.
    expect(names.sort()).toEqual(
      [
        "automations-agents",
        "automations-clone",
        "automations-create",
        "automations-diff",
        "automations-edit",
        "automations-get",
        "automations-pending",
        "automations-run",
        "automations-runs",
        "automations-schema",
        "automations-submit",
        "automations-update",
        "automations-validate",
        "automations-versions",
        "automations-webhook",
      ].sort(),
    );
  });

  it("no longer exposes the narrow tools the generic ones replaced", async () => {
    const mod = await import("./xyne-spaces-tools.js");
    const names = mod.tools.map((t) => t.name);
    for (const gone of ["automations-list", "automations-list-runs", "automations-get-run"]) {
      expect(names).not.toContain(gone);
    }
  });
});

describe("automations-get — detail", () => {
  // Regression: GET /:id returns the automation directly under `data`, while
  // POST / and PUT /:id wrap it in `{ automation }`. Reading `data.automation`
  // made this fail 100% of the time.
  it("reads a BARE data payload and returns the full config, not a summary", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: AUTOMATION });

    const tool = await loadTool("automations-get");
    const result = await tool.handler({ id: "wf_1" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Nightly digest");
    // The whole definition must survive — this is what an agent edits against.
    expect(text).toContain("SCHEDULE");
    expect(text).toContain("0 9 * * *");
    expect(text).toContain("SEND_EMAIL");
    expect(text).toContain("team@example.com");
    expect(mocks.spacesFetch).toHaveBeenCalledWith("/api/automations/claw/wf_1");
  });

  it("errors when the backend returns no automation", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true });

    const tool = await loadTool("automations-get");
    const result = await tool.handler({ id: "wf_1" }, ctx);

    expect(result.isError).toBe(true);
  });
});

describe("automations-get — list and filters", () => {
  it("lists with no filters and no stray query string", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: [AUTOMATION] });

    const tool = await loadTool("automations-get");
    const result = await tool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("wf_1");
    expect(text).toContain("trigger=SCHEDULE");
    expect(lastCall()[0]).toBe("/api/automations/claw");
  });

  it("passes every filter through to the backend", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: [AUTOMATION] });

    const tool = await loadTool("automations-get");
    await tool.handler(
      {
        status: "ACTIVE",
        triggerType: "SCHEDULE",
        name: "digest",
        includeArchived: true,
        limit: 25,
        cursor: "cur_1",
      },
      ctx,
    );

    const url = lastCall()[0];
    expect(url).toContain("status=ACTIVE");
    expect(url).toContain("triggerType=SCHEDULE");
    expect(url).toContain("name=digest");
    expect(url).toContain("includeArchived=true");
    expect(url).toContain("limit=25");
    expect(url).toContain("cursor=cur_1");
  });

  it("omits includeArchived unless explicitly true", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: [AUTOMATION] });

    const tool = await loadTool("automations-get");
    await tool.handler({ includeArchived: false }, ctx);

    expect(lastCall()[0]).not.toContain("includeArchived");
  });

  it("surfaces the next cursor and returns a no-results message when empty", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: [AUTOMATION],
      pagination: { limit: 50, nextCursor: "cur_2", hasMore: true },
    });
    const tool = await loadTool("automations-get");
    expect((await tool.handler({}, ctx)).content[0]?.text).toContain("cur_2");

    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: [] });
    expect((await tool.handler({}, ctx)).content[0]?.text).toBe("No automations found.");
  });
});

describe("automations-runs", () => {
  it("automations-run returns a single run with its context and step data", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: {
        run: {
          id: "run_1",
          automationId: "wf_1",
          status: "FAILED",
          error: "step 2 blew up",
          startedAt: "2026-09-01T00:00:00.000Z",
          completedAt: "2026-09-01T00:01:00.000Z",
          triggerData: { ticketId: "TKT-9" },
          context: { lastStep: "Send email" },
        },
        steps: [
          { id: "s1", stepName: "Fetch tickets", status: "COMPLETED", data: { count: 3 } },
          { id: "s2", stepName: "Send email", status: "FAILED", data: { smtp: "550 rejected" } },
        ],
      },
    });

    const tool = await loadTool("automations-run");
    const result = await tool.handler({ runId: "run_1" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("FAILED");
    expect(text).toContain("step 2 blew up");
    // The debugging payload must not be summarised away.
    expect(text).toContain("TKT-9");
    expect(text).toContain("550 rejected");
    expect(text).toContain("completedAt");
    expect(lastCall()[0]).toBe("/api/automations/claw/runs/run_1");
  });

  it("lists workspace-wide runs when no automationId is given", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: {
        runs: [
          {
            id: "run_1",
            automationId: "wf_1",
            status: "FAILED",
            error: "boom",
            startedAt: "2026-09-01T00:00:00.000Z",
            completedAt: "2026-09-01T00:01:00.000Z",
          },
        ],
        nextCursor: null,
      },
    });

    const tool = await loadTool("automations-runs");
    const result = await tool.handler({ status: "FAILED" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("run_1");
    // completedAt, not finishedAt — the field the backend actually sends.
    expect(text).toContain("completed=2026-09-01T00:01:00.000Z");
    expect(text).toContain("boom");
    expect(lastCall()[0]).toContain("/api/automations/claw/runs?");
    expect(lastCall()[0]).toContain("status=FAILED");
    expect(lastCall()[0]).not.toContain("automationId");
  });

  it("passes automationId and the time window through", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { runs: [], nextCursor: null } });

    const tool = await loadTool("automations-runs");
    const result = await tool.handler(
      { automationId: "wf_1", from: 1756684800000, to: 1756771200000, limit: 10, cursor: "c1" },
      ctx,
    );

    expect(result.content[0]?.text).toBe("No runs found.");
    const url = lastCall()[0];
    expect(url).toContain("automationId=wf_1");
    expect(url).toContain("from=1756684800000");
    expect(url).toContain("to=1756771200000");
    expect(url).toContain("limit=10");
    expect(url).toContain("cursor=c1");
  });
});

describe("automations-create", () => {
  it("creates and reports that it stays in DRAFT pending human approval", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { automation: AUTOMATION } });

    const tool = await loadTool("automations-create");
    const result = await tool.handler(
      { name: "Nightly digest", config: AUTOMATION.config },
      ctx,
    );
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("wf_1");
    expect(text).toContain("DRAFT");
    expect(text).toMatch(/human|approve/i);

    const [path, init] = lastCall();
    expect(path).toBe("/api/automations/claw");
    expect(init?.method).toBe("POST");
  });

  it("rejects a missing config without calling the backend", async () => {
    const tool = await loadTool("automations-create");
    const result = await tool.handler({ name: "x" }, ctx);

    expect(result.isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-update", () => {
  it("sends only the supplied fields", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { automation: AUTOMATION } });

    const tool = await loadTool("automations-update");
    await tool.handler({ id: "wf_1", name: "Renamed" }, ctx);

    const [path, init] = lastCall();
    expect(path).toBe("/api/automations/claw/wf_1");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ name: "Renamed" });
  });

  it("flags when the backend answered with a NEW draft version", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { automation: { ...AUTOMATION, id: "wf_2", automationSeriesId: "wf_1" } },
    });

    const tool = await loadTool("automations-update");
    const result = await tool.handler({ id: "wf_1", name: "Renamed" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("wf_2");
    expect(text).toContain("new DRAFT version");
  });

  it("refuses an update with nothing to change", async () => {
    const tool = await loadTool("automations-update");
    const result = await tool.handler({ id: "wf_1" }, ctx);

    expect(result.isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-validate", () => {
  it("reports a valid config", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { valid: true } });

    const tool = await loadTool("automations-validate");
    const result = await tool.handler({ config: AUTOMATION.config }, ctx);

    expect(result.content[0]?.text).toBe("Config is valid.");
    expect(lastCall()[0]).toBe("/api/automations/claw/validate");
  });

  it("returns the detail for an invalid config without flagging a tool error", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { valid: false, errors: [{ message: "trigger.type is required" }] },
    });

    const tool = await loadTool("automations-validate");
    const result = await tool.handler({ config: {} }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("trigger.type is required");
  });
});

describe("automations-schema", () => {
  it("lists trigger types", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: [{ type: "SCHEDULE", name: "Schedule", description: "Runs on a cron" }],
    });

    const tool = await loadTool("automations-schema");
    const result = await tool.handler({ kind: "triggers" }, ctx);

    expect(result.content[0]?.text).toContain("SCHEDULE");
    expect(lastCall()[0]).toBe("/api/automations/claw/schema/triggers");
  });

  it("fetches one step's full schema", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { type: "SEND_EMAIL", configSchema: { type: "object" } },
    });

    const tool = await loadTool("automations-schema");
    const result = await tool.handler({ kind: "steps", type: "SEND_EMAIL" }, ctx);

    expect(result.content[0]?.text).toContain("SEND_EMAIL");
    expect(lastCall()[0]).toBe("/api/automations/claw/schema/steps/SEND_EMAIL");
  });

  it("lists operators and marks the value-less ones", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: [
        { value: "eq", requiresValue: true },
        { value: "exists", requiresValue: false },
      ],
    });

    const tool = await loadTool("automations-schema");
    const text = (await tool.handler({ kind: "operators" }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("`eq`");
    expect(text).toContain("no value needed");
  });

  it("rejects an unknown kind without calling the backend", async () => {
    const tool = await loadTool("automations-schema");
    const result = await tool.handler({ kind: "widgets" }, ctx);

    expect(result.isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-versions", () => {
  it("lists the lineage", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: [AUTOMATION, { ...AUTOMATION, id: "wf_2", status: "ACTIVE" }],
    });

    const tool = await loadTool("automations-versions");
    const text = (await tool.handler({ id: "wf_1" }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("2 version(s)");
    expect(text).toContain("wf_2");
    expect(lastCall()[0]).toBe("/api/automations/claw/wf_1/versions");
  });

  it("handles an empty lineage", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: [] });
    const tool = await loadTool("automations-versions");
    expect((await tool.handler({ id: "wf_1" }, ctx)).content[0]?.text).toBe("No versions found.");
  });
});

describe("automations-diff", () => {
  it("reports changed fields and added/removed/changed steps", async () => {
    const from = AUTOMATION;
    const to = {
      ...AUTOMATION,
      id: "wf_2",
      name: "Renamed",
      config: {
        ...AUTOMATION.config,
        steps: [
          { type: "SEND_EMAIL", id: "s1", config: { to: "changed@example.com" } },
          { type: "SEND_MESSAGE", id: "s2", config: {} },
        ],
      },
    };
    mocks.spacesFetch
      .mockResolvedValueOnce({ success: true, data: from })
      .mockResolvedValueOnce({ success: true, data: to });

    const tool = await loadTool("automations-diff");
    const text = (await tool.handler({ fromId: "wf_1", toId: "wf_2" }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("name");
    expect(text).toContain("Renamed");
    expect(text).toContain("step added: `s2`");
  });

  it("says so when two versions are identical", async () => {
    mocks.spacesFetch
      .mockResolvedValueOnce({ success: true, data: AUTOMATION })
      .mockResolvedValueOnce({ success: true, data: AUTOMATION });

    const tool = await loadTool("automations-diff");
    const text = (await tool.handler({ fromId: "wf_1", toId: "wf_1" }, ctx)).content[0]?.text ?? "";
    expect(text).toContain("No differences");
  });

  it("requires both ids", async () => {
    const tool = await loadTool("automations-diff");
    expect((await tool.handler({ fromId: "wf_1" }, ctx)).isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-edit", () => {
  it("PATCHes the operations through untouched", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { automation: AUTOMATION } });

    const operations = [{ op: "delete-step", stepId: "s1" }];
    const tool = await loadTool("automations-edit");
    const result = await tool.handler({ id: "wf_1", operations }, ctx);

    expect(result.isError).toBeUndefined();
    const [path, init] = lastCall();
    expect(path).toBe("/api/automations/claw/wf_1/config");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ operations });
  });

  it("flags when the edit produced a new DRAFT version", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { automation: { ...AUTOMATION, id: "wf_2" } },
    });

    const tool = await loadTool("automations-edit");
    const text = (
      await tool.handler({ id: "wf_1", operations: [{ op: "delete-step", stepId: "s1" }] }, ctx)
    ).content[0]?.text ?? "";
    expect(text).toContain("new DRAFT version");
  });

  it("rejects empty or missing operations without calling the backend", async () => {
    const tool = await loadTool("automations-edit");
    expect((await tool.handler({ id: "wf_1", operations: [] }, ctx)).isError).toBe(true);
    expect((await tool.handler({ id: "wf_1" }, ctx)).isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-clone", () => {
  it("clones and passes an explicit name", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { automation: { ...AUTOMATION, id: "wf_9", name: "My copy" } },
    });

    const tool = await loadTool("automations-clone");
    const text = (await tool.handler({ id: "wf_1", name: "My copy" }, ctx)).content[0]?.text ?? "";

    expect(text).toContain("wf_9");
    const [path, init] = lastCall();
    expect(path).toBe("/api/automations/claw/wf_1/clone");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ name: "My copy" });
  });

  it("omits the name so the backend defaults it", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { automation: AUTOMATION } });
    const tool = await loadTool("automations-clone");
    await tool.handler({ id: "wf_1" }, ctx);
    expect(JSON.parse(lastCall()[1]?.body ?? "{}")).toEqual({});
  });
});

describe("automations-agents / -pending / -webhook", () => {
  it("lists agents for RUN_AGENT steps", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: [{ slug: "infra-doctor", name: "Infra Doctor" }],
    });

    const tool = await loadTool("automations-agents");
    const text = (await tool.handler({}, ctx)).content[0]?.text ?? "";
    expect(text).toContain("infra-doctor");
    expect(lastCall()[0]).toBe("/api/automations/claw/agents");
  });

  it("lists automations awaiting approval", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: [{ ...AUTOMATION, status: "PENDING_APPROVAL" }],
    });

    const tool = await loadTool("automations-pending");
    const text = (await tool.handler({}, ctx)).content[0]?.text ?? "";
    expect(text).toContain("1 awaiting approval");
    expect(lastCall()[0]).toBe("/api/automations/claw/pending");
  });

  it("returns the webhook url and never a secret", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { url: "https://spaces.local/api/automation-webhooks/wf_1", issued: true },
    });

    const tool = await loadTool("automations-webhook");
    const text = (await tool.handler({ id: "wf_1" }, ctx)).content[0]?.text ?? "";
    expect(text).toContain("automation-webhooks/wf_1");
    expect(text).toContain("Secret issued: yes");
    expect(text).not.toMatch(/secret[:=]\s*\S+/i);
  });

  it("reports a no-results message for each when empty", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: [] });
    expect((await (await loadTool("automations-agents")).handler({}, ctx)).content[0]?.text).toBe(
      "No agents available.",
    );

    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: [] });
    expect((await (await loadTool("automations-pending")).handler({}, ctx)).content[0]?.text).toBe(
      "No automations are pending approval.",
    );
  });
});
