import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts needs the key at import time, and static imports run before the test body.
vi.hoisted(() => {
  process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);
});
import { GRAFANA_MCP_VERSION, grafanaAdapter } from "./grafana.js";

const creds = { url: "https://grafana.example.com", token: "glsa_x" };

afterEach(() => vi.unstubAllEnvs());

describe("grafana MCP launch", () => {
  it("runs the binary baked into the image when MCP_GRAFANA_BIN is set", () => {
    vi.stubEnv("MCP_GRAFANA_BIN", "/usr/local/bin/mcp-grafana");
    const { cmd, args, env } = grafanaAdapter.buildCommand(creds);
    expect(cmd).toBe("/usr/local/bin/mcp-grafana");
    expect(args[0]).toBe("--enabled-tools");
    expect(env).toMatchObject({ GRAFANA_URL: creds.url, GRAFANA_SERVICE_ACCOUNT_TOKEN: creds.token });
  });

  it("falls back to uvx with the pinned version elsewhere", () => {
    vi.stubEnv("MCP_GRAFANA_BIN", "");
    const { cmd, args } = grafanaAdapter.buildCommand(creds);
    expect(cmd).toBe("uvx");
    expect(args.slice(0, 2)).toEqual([`mcp-grafana==${GRAFANA_MCP_VERSION}`, "--enabled-tools"]);
  });
});
