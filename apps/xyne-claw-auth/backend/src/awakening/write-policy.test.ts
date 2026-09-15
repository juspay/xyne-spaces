import { describe, expect, it } from "vitest";
import { buildWritePermissions, isReadOnlyRun } from "./write-policy.js";
import { AWAKENING_DEFAULTS, type AwakeningConfig, type WritePolicy } from "./config.js";

const cfg = (writePolicy: WritePolicy, shadow = false): AwakeningConfig => ({
  ...AWAKENING_DEFAULTS,
  writePolicy,
  shadow,
});

const APP_POST = "xyne-spaces-app-tools__apps-send-message";
const USER_POST = "xyne-spaces__user-send-message";
const CREATE_TICKET = "xyne-spaces__spaces-create-ticket";
const UPDATE_TICKET = "xyne-spaces__spaces-update-ticket";
const EDIT_CANVAS = "xyne-spaces__spaces-edit-canvas";

describe("observe — no outbound writes at all", () => {
  const p = buildWritePermissions(cfg("observe"));

  it("denies the ungated bot post tool — the whole point of the guard", () => {
    expect(p[APP_POST]).toBe("deny");
  });

  it("denies posting as the user", () => {
    expect(p[USER_POST]).toBe("deny");
  });

  it("denies every durable mutation", () => {
    for (const t of [CREATE_TICKET, UPDATE_TICKET, EDIT_CANVAS]) expect(p[t]).toBe("deny");
  });
});

describe("reply — threads only", () => {
  const p = buildWritePermissions(cfg("reply"));

  it("leaves the bot post tool available so it can actually reply", () => {
    expect(p[APP_POST]).toBeUndefined();
  });

  it("still denies durable mutations", () => {
    for (const t of [CREATE_TICKET, UPDATE_TICKET, EDIT_CANVAS]) expect(p[t]).toBe("deny");
  });

  it("still denies posting as the human user", () => {
    expect(p[USER_POST]).toBe("deny");
  });
});

describe("act — full surface", () => {
  it("denies nothing", () => {
    expect(buildWritePermissions(cfg("act"))).toEqual({});
  });
});

describe("shadow overrides everything", () => {
  it("reduces act to observe", () => {
    const p = buildWritePermissions(cfg("act", true));
    expect(p[APP_POST]).toBe("deny");
    expect(p[CREATE_TICKET]).toBe("deny");
  });

  it("reduces reply to observe", () => {
    expect(buildWritePermissions(cfg("reply", true))[APP_POST]).toBe("deny");
  });

  it("is the default posture for a newly enabled agent", () => {
    expect(AWAKENING_DEFAULTS.shadow).toBe(true);
    expect(buildWritePermissions(AWAKENING_DEFAULTS)[APP_POST]).toBe("deny");
  });
});

describe("merging with the agent's existing permissions", () => {
  it("preserves unrelated settings", () => {
    const p = buildWritePermissions(cfg("observe"), { "github__create-issue": "ask" });
    expect(p["github__create-issue"]).toBe("ask");
    expect(p[APP_POST]).toBe("deny");
  });

  it("a policy denial overrides a permissive existing setting", () => {
    const p = buildWritePermissions(cfg("observe"), { [APP_POST]: "allow" });
    expect(p[APP_POST]).toBe("deny");
  });

  it("does not mutate the input map", () => {
    const existing = { [APP_POST]: "allow" };
    buildWritePermissions(cfg("observe"), existing);
    expect(existing[APP_POST]).toBe("allow");
  });
});

describe("isReadOnlyRun", () => {
  it("is true for shadow or observe, false otherwise", () => {
    expect(isReadOnlyRun(cfg("act", true))).toBe(true);
    expect(isReadOnlyRun(cfg("observe"))).toBe(true);
    expect(isReadOnlyRun(cfg("reply"))).toBe(false);
    expect(isReadOnlyRun(cfg("act"))).toBe(false);
  });
});
