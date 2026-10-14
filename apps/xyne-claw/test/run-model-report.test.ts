import { describe, expect, test } from "vitest";
import {
  buildModelFallbackReport,
  platformModel,
  reportedModelForAttempt,
  type PlatformModelDefaults,
} from "../src/run-model-report.js";

const defaults = (over: Partial<PlatformModelDefaults> = {}): PlatformModelDefaults => ({
  automationRun: false,
  defaultModel: "private-large",
  automationModel: "private-automation",
  ...over,
});

describe("platformModel (mirrors agent.ts runTask precedence)", () => {
  test("modelSettings.model wins", () => {
    expect(platformModel(defaults({ modelSettingsModel: "open-large", automationRun: true }))).toBe("open-large");
  });
  test("automation runs use the automation model", () => {
    expect(platformModel(defaults({ automationRun: true }))).toBe("private-automation");
  });
  test("interactive runs use the platform default", () => {
    expect(platformModel(defaults())).toBe("private-large");
  });
  test("blank modelSettings.model is ignored", () => {
    expect(platformModel(defaults({ modelSettingsModel: "  " }))).toBe("private-large");
  });
});

describe("reportedModelForAttempt", () => {
  test("XYNE-66321: spaces attempt reports the pinned model, not LITELLM.model", () => {
    expect(
      reportedModelForAttempt({ provider: "spaces", config: undefined }, defaults({ modelSettingsModel: "open-large" })),
    ).toBe("open-large");
  });
  test("undefined provider is the spaces attempt", () => {
    expect(reportedModelForAttempt({ provider: undefined, config: undefined }, defaults())).toBe("private-large");
  });
  test("premium attempt reports its credential model, ignoring modelSettings.model", () => {
    expect(
      reportedModelForAttempt(
        { provider: "codex", config: { model: "gpt-5.5" } },
        defaults({ modelSettingsModel: "open-large" }),
      ),
    ).toBe("gpt-5.5");
  });
  test("premium attempt without a credential model reports undefined", () => {
    expect(reportedModelForAttempt({ provider: "codex", config: {} }, defaults())).toBeUndefined();
  });
});

describe("buildModelFallbackReport", () => {
  const codex = { provider: "codex", config: { model: "gpt-5.5" } };
  const spaces = { provider: "spaces", config: undefined };

  test("no report when the requested attempt answered", () => {
    expect(
      buildModelFallbackReport({ attempts: [codex, spaces], completedAttempt: codex, reason: undefined, defaults: defaults() }),
    ).toBeUndefined();
  });
  test("XYNE-66319: reports the requested provider/model and reason on fallback", () => {
    expect(
      buildModelFallbackReport({ attempts: [codex, spaces], completedAttempt: spaces, reason: "auth", defaults: defaults() }),
    ).toEqual({ fromProvider: "codex", fromModel: "gpt-5.5", reason: "auth" });
  });
  test("unknown reason when none was classified", () => {
    expect(
      buildModelFallbackReport({ attempts: [codex, spaces], completedAttempt: spaces, reason: undefined, defaults: defaults() }),
    ).toMatchObject({ reason: "unknown" });
  });
});
