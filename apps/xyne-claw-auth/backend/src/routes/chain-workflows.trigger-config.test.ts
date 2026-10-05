import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({ CONFIG: {} }));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../middleware/require-auth.js", () => ({ requireS2S: vi.fn() }));
vi.mock("../crypto.js", () => ({ decrypt: vi.fn() }));
vi.mock("../repositories/index.js", () => ({ agentChainWorkflowRepository: {}, agentRepository: {} }));
vi.mock("../lib/spaces-db.js", () => ({ getSpacesAuthForUser: vi.fn(), getWorkspaceIdForUser: vi.fn() }));
vi.mock("./webhook.js", () => ({ setSession: vi.fn() }));
vi.mock("../lib/spaces-api.js", () => ({ spacesAppFetch: vi.fn() }));

const { buildSpacesConfig, sanitizeNativeTriggerConfig, triggerConfigFingerprint } = await import(
  "./chain-workflows.js"
);

describe("buildSpacesConfig — native trigger filters", () => {
  it("carries typed filters into the Spaces trigger config", () => {
    const cfg = buildSpacesConfig("MESSAGE_RECEIVED", "ch-1", "agent", "u-1", { contentContains: "^ALARM" }, {
      contentContains: ["^ALARM", "outage"],
      fireOnEdit: true,
    });
    expect(cfg.trigger).toEqual({
      type: "MESSAGE_RECEIVED",
      config: { contentContains: ["^ALARM", "outage"], fireOnEdit: true, channelIds: ["ch-1"] },
    });
  });

  it("never lets user config override the workflow's channel scope", () => {
    const cfg = buildSpacesConfig("TICKET_CREATED", "ch-1", "agent", "u-1", {}, {
      channelIds: ["someone-elses-channel"],
      boardIds: ["b-1"],
    });
    expect(cfg.trigger.config).toEqual({ boardIds: ["b-1"], channelIds: ["ch-1"] });
  });

  it("keeps the agent-page (*) MESSAGE_RECEIVED trigger pinned to the requester", () => {
    const cfg = buildSpacesConfig("MESSAGE_RECEIVED", "*", "agent", "u-1", {}, { fromUserIds: ["u-2", "u-3"] });
    expect(cfg.trigger.config).toEqual({ fromUserIds: ["u-1"] });
  });

  it("is unchanged when no typed config is sent (old clients)", () => {
    const cfg = buildSpacesConfig("TICKET_CREATED", "ch-1", "agent", "u-1", { boardIds: "b-1" });
    expect(cfg.trigger.config).toEqual({ channelIds: ["ch-1"] });
  });

  it("ignores native config for VCS templates", () => {
    const cfg = buildSpacesConfig("GITHUB_EVENT", "ch-1", "agent", "u-1", { eventTypes: "push" }, { foo: "bar" });
    expect(cfg.trigger).toEqual({ type: "WEBHOOK", config: { bodySchema: {}, headerSchema: {} } });
  });
});

describe("sanitizeNativeTriggerConfig", () => {
  it("drops reserved keys, non-plain values and empties", () => {
    expect(
      sanitizeNativeTriggerConfig({
        context: "prompt text",
        channelIds: ["x"],
        nested: { a: 1 },
        nan: Number.NaN,
        empty: "  ",
        emptyArr: ["", " "],
        mixed: ["a", 1, " b "],
        n: 3,
      }),
    ).toEqual({ mixed: ["a", "b"], n: 3 });
  });

  it("returns {} for non-objects", () => {
    expect(sanitizeNativeTriggerConfig(undefined)).toEqual({});
    expect(sanitizeNativeTriggerConfig(["a"])).toEqual({});
    expect(sanitizeNativeTriggerConfig("a")).toEqual({});
  });
});

describe("triggerConfigFingerprint", () => {
  it("is stable across key order and blank values", () => {
    expect(triggerConfigFingerprint("T", { b: "2", a: " 1 ", c: "" })).toBe(
      triggerConfigFingerprint("T", { a: "1", b: "2" }),
    );
  });

  it("changes when the type or a filter changes", () => {
    const base = triggerConfigFingerprint("T", { a: "1" });
    expect(triggerConfigFingerprint("U", { a: "1" })).not.toBe(base);
    expect(triggerConfigFingerprint("T", { a: "2" })).not.toBe(base);
  });
});
