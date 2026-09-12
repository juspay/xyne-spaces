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
  name: "Nightly digest",
  description: "Posts a digest every night",
  status: "DRAFT",
  trigger: { type: "SCHEDULE" },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

/** Load a tool from the real catalog, which also asserts it is registered. */
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

describe("automation tool registration", () => {
  it("registers every automation tool in the xyne-spaces catalog", async () => {
    const mod = await import("./xyne-spaces-tools.js");
    const names = mod.tools.map((t) => t.name);
    for (const expected of [
      "automations-create",
      "automations-list",
      "automations-get",
      "automations-update",
      "automations-submit",
      "automations-validate",
      "automations-schema",
      "automations-list-runs",
      "automations-get-run",
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe("automations-get", () => {
  // Regression: GET /:id returns the automation directly under `data`, while
  // POST / and PUT /:id wrap it in `{ automation }`. Reading `data.automation`
  // here made the tool fail 100% of the time with "did not return an automation".
  it("reads an automation from a BARE data payload, not data.automation", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: AUTOMATION });

    const tool = await loadTool("automations-get");
    const result = await tool.handler({ id: "wf_1" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Nightly digest");
    expect(text).toContain("wf_1");
    expect(text).toContain("Status: DRAFT");
    expect(text).toContain("Posts a digest every night");
    expect(mocks.spacesFetch).toHaveBeenCalledWith("/api/automations/claw/wf_1");
  });

  it("errors when the backend returns no automation", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true });

    const tool = await loadTool("automations-get");
    const result = await tool.handler({ id: "wf_1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("did not return an automation");
  });

  it("requires an id", async () => {
    const tool = await loadTool("automations-get");
    const result = await tool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-create", () => {
  it("posts the automation and reports the created id", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { automation: AUTOMATION } });

    const tool = await loadTool("automations-create");
    const result = await tool.handler(
      { name: "Nightly digest", config: { trigger: { type: "SCHEDULE" }, steps: [] } },
      ctx,
    );
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("wf_1");
    expect(text).toContain("Status: DRAFT");

    const [path, init] = lastCall();
    expect(path).toBe("/api/automations/claw");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toMatchObject({ name: "Nightly digest" });
  });

  it("rejects a missing or non-object config without calling the backend", async () => {
    const tool = await loadTool("automations-create");
    const result = await tool.handler({ name: "x" }, ctx);

    expect(result.isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-list", () => {
  it("formats a page and surfaces the next cursor", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: [AUTOMATION],
      pagination: { limit: 50, nextCursor: "cur_2", hasMore: true },
    });

    const tool = await loadTool("automations-list");
    const result = await tool.handler({ limit: 50 }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Nightly digest");
    expect(text).toContain("cur_2");
  });

  it("returns a no-results message when empty", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: [] });

    const tool = await loadTool("automations-list");
    const result = await tool.handler({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("No automations found.");
  });
});

describe("automations-update", () => {
  it("sends only the fields that were supplied", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { automation: AUTOMATION } });

    const tool = await loadTool("automations-update");
    const result = await tool.handler({ id: "wf_1", name: "Renamed" }, ctx);

    expect(result.isError).toBeUndefined();
    const [path, init] = lastCall();
    expect(path).toBe("/api/automations/claw/wf_1");
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(body).toEqual({ name: "Renamed" });
    expect(body).not.toHaveProperty("config");
  });

  it("rejects a non-object config", async () => {
    const tool = await loadTool("automations-update");
    const result = await tool.handler({ id: "wf_1", config: "not-an-object" }, ctx);

    expect(result.isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-submit", () => {
  it("submits a DRAFT for approval", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { automation: { ...AUTOMATION, status: "PENDING_APPROVAL" } },
    });

    const tool = await loadTool("automations-submit");
    const result = await tool.handler({ id: "wf_1" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Status: PENDING_APPROVAL");

    const [path, init] = lastCall();
    expect(path).toBe("/api/automations/claw/wf_1/submit");
    expect(init?.method).toBe("POST");
  });

  it("surfaces a backend rejection as a tool error rather than throwing", async () => {
    mocks.spacesFetch.mockRejectedValueOnce(new Error("Spaces API 409: already submitted"));

    const tool = await loadTool("automations-submit");
    const result = await tool.handler({ id: "wf_1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("already submitted");
  });
});

describe("automations-validate", () => {
  it("reports a valid config", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { valid: true } });

    const tool = await loadTool("automations-validate");
    const result = await tool.handler({ config: { trigger: { type: "SCHEDULE" } } }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("Config is valid.");
    expect(lastCall()[0]).toBe("/api/automations/claw/validate");
  });

  it("returns the validation detail when the config is invalid", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { valid: false, errors: [{ message: "trigger.type is required" }] },
    });

    const tool = await loadTool("automations-validate");
    const result = await tool.handler({ config: {} }, ctx);
    const text = result.content[0]?.text ?? "";

    // Not a tool error: an invalid config is a normal answer the agent acts on.
    expect(result.isError).toBeUndefined();
    expect(text).toContain("NOT valid");
    expect(text).toContain("trigger.type is required");
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
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("SCHEDULE");
    expect(text).toContain("Runs on a cron");
    expect(lastCall()[0]).toBe("/api/automations/claw/schema/triggers");
  });

  it("fetches the full schema for one step type", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: { type: "SEND_EMAIL", configSchema: { type: "object" } },
    });

    const tool = await loadTool("automations-schema");
    const result = await tool.handler({ kind: "steps", type: "SEND_EMAIL" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("SEND_EMAIL");
    expect(lastCall()[0]).toBe("/api/automations/claw/schema/steps/SEND_EMAIL");
  });

  it("lists condition operators and marks the value-less ones", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: [
        { value: "eq", requiresValue: true },
        { value: "exists", requiresValue: false },
      ],
    });

    const tool = await loadTool("automations-schema");
    const result = await tool.handler({ kind: "operators" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("`eq`");
    expect(text).toContain("no value needed");
    expect(lastCall()[0]).toBe("/api/automations/claw/schema/operators");
  });

  it("rejects an unknown kind without calling the backend", async () => {
    const tool = await loadTool("automations-schema");
    const result = await tool.handler({ kind: "widgets" }, ctx);

    expect(result.isError).toBe(true);
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });
});

describe("automations-list-runs / automations-get-run", () => {
  it("lists runs for an automation with its filters in the query string", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: {
        runs: [{ id: "run_1", automationId: "wf_1", status: "COMPLETED", startedAt: "2026-09-01T00:00:00.000Z" }],
        nextCursor: null,
      },
    });

    const tool = await loadTool("automations-list-runs");
    const result = await tool.handler({ automationId: "wf_1", status: "COMPLETED" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("run_1");
    expect(text).toContain("COMPLETED");
    expect(lastCall()[0]).toContain("/api/automations/claw/wf_1/runs?");
    expect(lastCall()[0]).toContain("status=COMPLETED");
  });

  it("returns a no-results message when an automation has no runs", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, data: { runs: [], nextCursor: null } });

    const tool = await loadTool("automations-list-runs");
    const result = await tool.handler({ automationId: "wf_1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("No runs found.");
  });

  it("renders a single run with its step statuses", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({
      success: true,
      data: {
        run: { id: "run_1", automationId: "wf_1", status: "FAILED", error: "step 2 blew up" },
        steps: [
          { id: "s1", stepName: "Fetch tickets", status: "COMPLETED" },
          { id: "s2", stepName: "Send email", status: "FAILED" },
        ],
      },
    });

    const tool = await loadTool("automations-get-run");
    const result = await tool.handler({ runId: "run_1" }, ctx);
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Status: FAILED");
    expect(text).toContain("step 2 blew up");
    expect(text).toContain("Fetch tickets [COMPLETED]");
    expect(text).toContain("Send email [FAILED]");
    expect(lastCall()[0]).toBe("/api/automations/claw/runs/run_1");
  });
});
