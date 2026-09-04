import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../config.js", () => ({ CONFIG: { litellmUrl: "", litellmApiKey: "" } }));
vi.mock("../crypto.js", () => ({ decrypt: () => "" }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
vi.mock("../repositories/index.js", () => ({ agentProviderCredentialsRepository: { listByAgent: async () => [] }, userProviderCredentialsRepository: {}, sharedProviderCredentialRepository: {} }));

import { agentDefaultSpeed, applyFastModeModels, parseFastModeProfile, providerConfigForSpeed } from "./agent-provider-config.js";

const base = { provider: "litellm", providerOrder: ["litellm", "spaces"], modelSettings: { speed: "fast" } };

describe("fast-mode provider profile", () => {
  it("defaults to inherit (same providers as standard)", () => {
    expect(parseFastModeProfile(undefined).providers).toBe("inherit");
    expect(parseFastModeProfile({ fastModeProfile: { providers: "custom" } })).toEqual({ providers: "custom", providerOrder: [], models: {} });
    expect(providerConfigForSpeed(base, "fast")["providerOrder"]).toEqual(["litellm", "spaces"]);
  });

  it("swaps in the custom order only for fast speed, dropping the legacy provider", () => {
    const cfg = { ...base, fastModeProfile: { providers: "custom", providerOrder: ["claude", "bogus", "spaces"], models: { claude: "claude-opus-5", nope: "x" } } };
    const fast = providerConfigForSpeed(cfg, "fast");
    expect(fast["providerOrder"]).toEqual(["claude", "spaces"]);
    expect(fast["provider"]).toBeUndefined();
    const std = providerConfigForSpeed(cfg, "standard");
    expect(std["providerOrder"]).toEqual(["litellm", "spaces"]);
    expect(std["provider"]).toBe("litellm");
  });

  it("applies per-provider model overrides in fast mode only", () => {
    const cfg = { fastModeProfile: { providers: "custom", providerOrder: ["claude"], models: { claude: "claude-opus-5" } } };
    const configs = { claude: { model: "claude-sonnet-5" }, litellm: { model: "open-fast" } };
    applyFastModeModels(configs, cfg, "standard");
    expect(configs.claude.model).toBe("claude-sonnet-5");
    applyFastModeModels(configs, cfg, "fast");
    expect(configs.claude.model).toBe("claude-opus-5");
    expect(configs.litellm.model).toBe("open-fast");
  });

  it("reads the agent default speed from modelSettings", () => {
    expect(agentDefaultSpeed(base)).toBe("fast");
    expect(agentDefaultSpeed({})).toBe("standard");
  });
});
