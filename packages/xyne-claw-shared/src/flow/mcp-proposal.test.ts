import { describe, expect, it } from "vitest";
import { validateMcpProposal } from "./mcp-proposal.js";

const good = { name: "Acme", url: "https://mcp.acme.com/v1" };

describe("validateMcpProposal — HTTP only", () => {
  it("accepts an https server and pins transport to http", () => {
    const r = validateMcpProposal(good);
    expect(r.ok).toBe(true);
    expect(r.config?.transport).toBe("http");
  });

  it.each(["command", "args", "env", "cwd", "entrypoint", "exec", "shell"])(
    "rejects the stdio field %s — that is arbitrary code execution",
    (key) => {
      const r = validateMcpProposal({ ...good, [key]: "npx -y some-server" });
      expect(r.ok).toBe(false);
      expect(r.error).toContain(key);
    },
  );

  it("rejects an explicit non-http transport", () => {
    expect(validateMcpProposal({ ...good, transport: "stdio" }).ok).toBe(false);
  });

  it("rejects plain http — an MCP endpoint carries the user's credentials", () => {
    expect(validateMcpProposal({ ...good, url: "http://mcp.acme.com" }).ok).toBe(false);
  });

  it("rejects a malformed url", () => {
    expect(validateMcpProposal({ ...good, url: "mcp.acme.com" }).ok).toBe(false);
  });

  it("rejects credentials embedded in the url", () => {
    expect(validateMcpProposal({ ...good, url: "https://user:pass@mcp.acme.com" }).ok).toBe(false);
  });
});

describe("validateMcpProposal — never carries credentials", () => {
  it.each(["token", "apiKey", "api_key", "secret", "password", "authorization", "clientSecret"])(
    "rejects a %s field outright",
    (key) => {
      const r = validateMcpProposal({ ...good, [key]: "whatever" });
      expect(r.ok).toBe(false);
      expect(r.error).toContain(key);
    },
  );

  it.each([
    ["github PAT", "ghp_1234567890abcdefghijklmnopqrstuvwx"],
    ["openai key", "sk-abcdefghijklmnopqrstuvwxyz0123456789"],
    ["slack token", "xoxb-123456789012-abcdefghijklmno"],
    ["jwt", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc"],
    ["opaque blob", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8"],
  ])("rejects a secret-shaped value in an innocuous field (%s)", (_label, value) => {
    const r = validateMcpProposal({ ...good, description: value });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("secret");
  });

  it("keeps header NAMES — the user fills the values", () => {
    const r = validateMcpProposal({ ...good, headerNames: ["X-Api-Key", "X-Tenant"] });
    expect(r.ok).toBe(true);
    expect(r.config?.headerNames).toEqual(["X-Api-Key", "X-Tenant"]);
  });

  it("does not mistake ordinary prose for a secret", () => {
    const r = validateMcpProposal({ ...good, description: "Acme's ticketing and search tools" });
    expect(r.ok).toBe(true);
  });
});

describe("validateMcpProposal — basics", () => {
  it.each([[undefined], [null], ["str"], [[]]])("rejects a non-object proposal (%s)", (v) => {
    expect(validateMcpProposal(v).ok).toBe(false);
  });

  it("requires name and url", () => {
    expect(validateMcpProposal({ url: good.url }).ok).toBe(false);
    expect(validateMcpProposal({ name: good.name }).ok).toBe(false);
  });
});
