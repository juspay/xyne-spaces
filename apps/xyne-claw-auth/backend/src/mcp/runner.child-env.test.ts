import { describe, expect, it, vi } from "vitest";
process.env["ENCRYPTION_KEY"] = "00".repeat(32);
vi.mock("../logger.js", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
describe("MCP child environment", () => {
  it("passes only allowlisted parent variables, never secrets", async () => {
    const { childBaseEnv } = await import("./runner.js");
    const env = childBaseEnv({
      PATH: "/usr/bin", HOME: "/root", HTTPS_PROXY: "http://proxy:3128",
      ENCRYPTION_KEY: "x", XYNE_CLAW_S2S_KEY: "x", INTERNAL_S2S_KEY: "x", DATABASE_URL: "x",
      SPACES_DB_URL: "x", CLAW_SERVICE_PRIVATE_KEY: "x", LITELLM_API_KEY: "x", REDIS_PASSWORD: "x",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/root", HTTPS_PROXY: "http://proxy:3128" });
  });
});
