import { afterEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const { assertOutboundUrlAllowed, isBlockedAddress, parseHostAllowlist } = await import("./url-guard.js");

afterEach(() => {
  lookupMock.mockReset();
  vi.unstubAllEnvs();
});

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.8.8.8",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
  ])("blocks %s", (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "43.204.132.146", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public %s",
    (addr) => {
      expect(isBlockedAddress(addr)).toBe(false);
    },
  );
});

describe("assertOutboundUrlAllowed", () => {
  it("rejects non-http(s) schemes and malformed URLs without resolving", async () => {
    await expect(assertOutboundUrlAllowed("file:///etc/passwd")).rejects.toThrow(/http or https/);
    await expect(assertOutboundUrlAllowed("gopher://example.com")).rejects.toThrow(/http or https/);
    await expect(assertOutboundUrlAllowed("not a url")).rejects.toThrow(/valid absolute URL/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1:3003/internal",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://2130706433/", // decimal form of 127.0.0.1, normalised by the URL parser
    "http://0x7f.0.0.1/",
  ])("rejects IP literal %s without resolving", async (u) => {
    await expect(assertOutboundUrlAllowed(u)).rejects.toThrow(/private, loopback or link-local/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost:8080/",
    "http://api.localhost/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://vespa.svc.cluster.local:8080/",
    "http://printer.local/",
  ])("rejects internal-only hostname %s without resolving", async (u) => {
    await expect(assertOutboundUrlAllowed(u)).rejects.toThrow(/internal-only/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects a public-looking hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.9", family: 4 }]);
    await expect(assertOutboundUrlAllowed("https://evil.example.com/x")).rejects.toThrow(/resolves to private/);
  });

  it("fails closed when the hostname does not resolve", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertOutboundUrlAllowed("https://nope.example.net/")).rejects.toThrow(/DNS resolution failed/);
    lookupMock.mockResolvedValue([]);
    await expect(assertOutboundUrlAllowed("https://nope.example.net/")).rejects.toThrow(/does not resolve/);
  });

  it("returns the parsed URL for a host that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const u = await assertOutboundUrlAllowed("https://example.com/a/b?c=1");
    expect(u).toBeInstanceOf(URL);
    expect(u.origin).toBe("https://example.com");
    expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("rejects URLs with embedded credentials", async () => {
    await expect(assertOutboundUrlAllowed("https://user:pw@example.com/")).rejects.toThrow(/embed credentials/);
  });

  it("with an allowlist, accepts only listed hosts and skips resolution for them", async () => {
    const allowedHosts = parseHostAllowlist(" Bitbucket.Example.net, other.example.org ");
    expect(allowedHosts).toEqual(["bitbucket.example.net", "other.example.org"]);
    const u = await assertOutboundUrlAllowed("https://bitbucket.example.net/rest", { allowedHosts });
    expect(u.hostname).toBe("bitbucket.example.net");
    expect(lookupMock).not.toHaveBeenCalled();
    await expect(assertOutboundUrlAllowed("https://example.com/", { allowedHosts })).rejects.toThrow(/allowlist/);
    // Even a listed host cannot smuggle a different scheme.
    await expect(assertOutboundUrlAllowed("ftp://bitbucket.example.net/", { allowedHosts })).rejects.toThrow(/http or https/);
  });

  it("MCP_OUTBOUND_ALLOW_PRIVATE_HOSTS=true skips the address check (local dev only)", async () => {
    vi.stubEnv("MCP_OUTBOUND_ALLOW_PRIVATE_HOSTS", "true");
    const u = await assertOutboundUrlAllowed("http://localhost:3000/");
    expect(u.hostname).toBe("localhost");
  });
});
