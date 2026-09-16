import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bitbucketAdapter } from "./bitbucket.js";
import { jusbizMcpAdapter } from "./jusbiz-mcp.js";
import { juspayInternalToolsAdapter } from "./juspay-internal-tools.js";
import { xyneSpacesAdapter } from "./xyne-spaces.js";
import { xyneDashboardAdapter } from "./xyne-dashboard.js";

/**
 * OSS-safety guards for MCP adapter internal-reference defaults.
 *
 * The claw-auth MCP adapters must not ship internal hostnames or
 * credential-shaped placeholder values: this repo is open-sourced, and the
 * defaults/placeholder text are what a fresh deployment (and every reader of
 * the public source) sees first. Internal deployments restore the internal
 * endpoints via env vars:
 *
 *   BITBUCKET_BASE_URL             - Bitbucket Server base URL (bitbucket adapter)
 *   JUSBIZ_MCP_URL                 - Jusbiz Expense MCP streamable-HTTP endpoint
 *   JUSPAY_INTERNAL_TOOLS_BASE_URL - juspay-internal-tools server base URL
 *   PUBLIC_SPACES_URL              - Xyne Spaces URL (credential placeholders)
 *
 * buildCommand/buildHttpUrl resolve their default at call time, so env
 * overrides are testable directly; credential placeholders bind at module
 * load (ambient env is clean in the test process, so they hold the
 * OSS-neutral defaults).
 */

const INTERNAL_HOST = /juspay|rbihub|svc\.k8s/i;
/** A run of base64-ish characters with optional padding — credential-shaped. */
const CREDENTIAL_SHAPED = /[A-Za-z0-9+/]{16,}={0,2}/;

const ENV_KEYS = ["BITBUCKET_BASE_URL", "JUSBIZ_MCP_URL", "JUSPAY_INTERNAL_TOOLS_BASE_URL"] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function urlField(adapter: { credentialFields: ReadonlyArray<{ name?: unknown; placeholder?: unknown }> }) {
  const field = adapter.credentialFields.find((f) => f.name === "url");
  return typeof field?.placeholder === "string" ? field.placeholder : "";
}

describe("bitbucket adapter OSS-safe defaults", () => {
  it("default baseUrl is not an internal host", () => {
    const { env } = bitbucketAdapter.buildCommand({ username: "u", token: "t" });
    expect(env.BITBUCKET_BASE_URL).not.toMatch(INTERNAL_HOST);
  });

  it("default baseUrl honors BITBUCKET_BASE_URL env", () => {
    process.env.BITBUCKET_BASE_URL = "https://bitbucket.internal.example.org";
    const { env } = bitbucketAdapter.buildCommand({ username: "u", token: "t" });
    expect(env.BITBUCKET_BASE_URL).toBe("https://bitbucket.internal.example.org");
  });

  it("credential placeholder for baseUrl is not an internal host", () => {
    const field = bitbucketAdapter.credentialFields.find((f) => f.name === "baseUrl");
    expect(field?.placeholder ?? "").not.toMatch(INTERNAL_HOST);
  });
});

describe("jusbiz-mcp adapter OSS-safe defaults", () => {
  it("buildHttpUrl url is not an internal host", () => {
    const { url } = jusbizMcpAdapter.buildHttpUrl({ authToken: "test-token" });
    expect(url).not.toMatch(INTERNAL_HOST);
  });

  it("buildHttpUrl honors JUSBIZ_MCP_URL env", () => {
    process.env.JUSBIZ_MCP_URL = "https://jusbiz.internal.example.org/mcp";
    const { url } = jusbizMcpAdapter.buildHttpUrl({ authToken: "test-token" });
    expect(url).toBe("https://jusbiz.internal.example.org/mcp");
  });

  it("auth-token placeholder is not a credential-shaped value", () => {
    const field = jusbizMcpAdapter.credentialFields.find((f) => f.name === "authToken");
    expect(field?.placeholder ?? "").not.toMatch(CREDENTIAL_SHAPED);
  });
});

describe("juspay-internal-tools adapter OSS-safe defaults", () => {
  it("buildHttpUrl url is not an internal host", () => {
    const { url } = juspayInternalToolsAdapter.buildHttpUrl({});
    expect(url).not.toMatch(INTERNAL_HOST);
  });

  it("buildHttpUrl honors JUSPAY_INTERNAL_TOOLS_BASE_URL env", () => {
    process.env.JUSPAY_INTERNAL_TOOLS_BASE_URL = "https://tools.internal.example.org/";
    const { url } = juspayInternalToolsAdapter.buildHttpUrl({});
    expect(url).toBe("https://tools.internal.example.org/tools");
  });
});

describe("xyne-spaces / xyne-dashboard credential placeholders", () => {
  it("xyne-spaces url placeholder is not an internal host", () => {
    expect(urlField(xyneSpacesAdapter)).not.toMatch(INTERNAL_HOST);
  });

  it("xyne-dashboard url placeholder is not an internal host", () => {
    expect(urlField(xyneDashboardAdapter)).not.toMatch(INTERNAL_HOST);
  });
});
