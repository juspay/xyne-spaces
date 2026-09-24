import { describe, expect, it } from "vitest";
import { validateConnectorConfig } from "./servers.js";

function httpUrl(url: string): string | null {
  return validateConnectorConfig({ transport: "http", httpConfigTemplate: { url } });
}

function mcpRemoteArg(arg: string): string | null {
  return validateConnectorConfig({
    transport: "stdio",
    launchConfigTemplate: { cmd: "npx", args: ["-y", "mcp-remote", arg] },
  });
}

describe("MCP http connector URL — save-time destination policy", () => {
  it("accepts a pinned public host", () => {
    expect(httpUrl("https://mcp.vendor.example/v1/sse")).toBeNull();
  });

  it("accepts a template token at or after the path", () => {
    expect(httpUrl("https://mcp.vendor.example/{{workspace}}/sse")).toBeNull();
    expect(httpUrl("https://mcp.vendor.example/v1/sse?key={{apiKey}}")).toBeNull();
  });

  it("rejects a templated host — the {{ escape hatch that skipped validation entirely", () => {
    for (const url of [
      "https://{{host}}/sse",
      "{{base}}/sse",
      "https://{{tenant}}.vendor.example/sse",
      "http://169.254.169.{{octet}}/latest/meta-data/",
    ]) {
      expect(httpUrl(url), url).toMatch(/templated host is not allowed/);
    }
  });

  it("rejects a host-suffix template that could extend the origin", () => {
    // https://vendor.example{{x}} would become https://vendor.example.evil/…
    expect(httpUrl("https://mcp.vendor.example{{suffix}}/sse")).toMatch(/templated host is not allowed/);
  });

  it("rejects private, loopback, link-local and non-canonical destinations", () => {
    expect(httpUrl("http://169.254.169.254/latest/meta-data/")).toMatch(/blocked address/);
    expect(httpUrl("http://10.0.0.5/sse")).toMatch(/blocked address/);
    expect(httpUrl("http://127.0.0.1:6379/sse")).toMatch(/loopback/);
    expect(httpUrl("http://localhost:6379/sse")).toMatch(/loopback/);
    // new URL() canonicalises these to 127.0.0.1 before the deny list sees
    // them; either way they never reach the wire.
    expect(httpUrl("http://2130706433/sse")).toMatch(/loopback|blocked address|non-canonical/);
    expect(httpUrl("http://0x7f000001/sse")).toMatch(/loopback|blocked address|non-canonical/);
    expect(httpUrl("http://127.1/sse")).toMatch(/loopback|blocked address|non-canonical/);
    expect(httpUrl("http://[::1]/sse")).toMatch(/loopback/);
  });

  it("rejects bad schemes and embedded credentials", () => {
    expect(httpUrl("file:///etc/passwd")).toMatch(/unsupported URL protocol/);
    expect(httpUrl("https://user:pass@mcp.vendor.example/sse")).toMatch(/credentials/);
    expect(httpUrl("/relative/path")).toMatch(/absolute http\(s\) URL/);
  });

  it("applies the same policy to an mcp-remote stdio URL argument", () => {
    expect(mcpRemoteArg("https://mcp.vendor.example/sse")).toBeNull();
    expect(mcpRemoteArg("https://mcp.vendor.example/{{tenant}}/sse")).toBeNull();
    expect(mcpRemoteArg("http://169.254.169.254/")).toMatch(/blocked address/);
    expect(mcpRemoteArg("https://{{host}}/sse")).toMatch(/templated host is not allowed/);
  });
});
