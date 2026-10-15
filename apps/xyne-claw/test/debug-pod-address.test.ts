import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWithPort(port: string) {
  vi.resetModules();
  process.env["XYNE_CLAW_PORT"] = port;
  return (await import("../src/routes/debug.js")).isTrustedPodAddress;
}

const originalPort = process.env["XYNE_CLAW_PORT"];

afterEach(() => {
  if (originalPort === undefined) delete process.env["XYNE_CLAW_PORT"];
  else process.env["XYNE_CLAW_PORT"] = originalPort;
});

describe("isTrustedPodAddress", () => {
  it("accepts a pod address on port 80, which URL normalises to an empty port", async () => {
    const isTrusted = await loadWithPort("80");
    expect(isTrusted("http://10.10.22.27:80")).toBe(true);
    expect(isTrusted("http://10.10.22.27")).toBe(true);
  });

  it("accepts a pod address on a non-default port", async () => {
    const isTrusted = await loadWithPort("3002");
    expect(isTrusted("http://10.10.22.27:3002")).toBe(true);
    expect(isTrusted("http://10.10.22.27:80")).toBe(false);
  });

  it("rejects public, credentialed, https and path-bearing addresses", async () => {
    const isTrusted = await loadWithPort("80");
    expect(isTrusted("http://8.8.8.8:80")).toBe(false);
    expect(isTrusted("http://user:pw@10.10.22.27:80")).toBe(false);
    expect(isTrusted("https://10.10.22.27:80")).toBe(false);
    expect(isTrusted("http://10.10.22.27:80/x")).toBe(false);
    expect(isTrusted("http://10.10.22.27:8080")).toBe(false);
  });
});
