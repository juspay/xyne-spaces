import { describe, it, expect, afterEach } from "vitest";
import { validateMcpBaseUrl, validateCredentialBaseUrl } from "./mcp-base-url.js";

const ENV = "MCP_BASE_URL_ALLOWED_HOSTS";

afterEach(() => {
  delete process.env[ENV];
});

describe("validateMcpBaseUrl", () => {
  it("accepts an absolute https URL", () => {
    expect(validateMcpBaseUrl("https://ops-dashboard.sso.internal/mcp")).toBeNull();
  });

  it("rejects a relative path", () => {
    expect(validateMcpBaseUrl("/mcp")).toMatch(/absolute/);
  });

  it("rejects non-http protocols", () => {
    expect(validateMcpBaseUrl("file:///etc/passwd")).toMatch(/http/);
  });

  it("rejects embedded credentials", () => {
    expect(validateMcpBaseUrl("https://user:pass@ops.internal/mcp")).toMatch(/credentials/);
  });

  it("enforces the host allowlist when configured", () => {
    process.env[ENV] = ".internal,ops-dashboard.juspay.net";
    expect(validateMcpBaseUrl("https://ops-dashboard.sso.internal/mcp")).toBeNull();
    expect(validateMcpBaseUrl("https://ops-dashboard.juspay.net/mcp")).toBeNull();
    expect(validateMcpBaseUrl("https://attacker.example.com/mcp")).toMatch(/not in/);
  });
});

describe("validateCredentialBaseUrl", () => {
  it("ignores credential blobs without baseUrl", () => {
    expect(validateCredentialBaseUrl({ apiKey: "k" })).toBeNull();
  });

  it("validates baseUrl when present", () => {
    expect(validateCredentialBaseUrl({ baseUrl: "nope", apiKey: "k" })).toMatch(/absolute/);
  });
});
