import { describe, expect, it } from "vitest";
import { childBaseEnv } from "./child-env.js";

describe("MCP child environment", () => {
  it("passes only allowlisted parent variables, never secrets", () => {
    const env = childBaseEnv({
      PATH: "/usr/bin", HOME: "/root", HTTPS_PROXY: "http://proxy:3128",
      ENCRYPTION_KEY: "x", XYNE_CLAW_S2S_KEY: "x", INTERNAL_S2S_KEY: "x", DATABASE_URL: "x",
      SPACES_DB_URL: "x", CLAW_SERVICE_PRIVATE_KEY: "x", LITELLM_API_KEY: "x", REDIS_PASSWORD: "x",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/root", HTTPS_PROXY: "http://proxy:3128" });
  });
});
