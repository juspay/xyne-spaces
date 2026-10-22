import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  BlockedBaseUrlError,
  createScopedGuardLookup,
  guardUserBaseUrl,
  isGuardedHost,
  resetGuardedHostsForTest,
} from "../src/outbound-guard.js";
import { createPublicOnlyLookup } from "xyne-claw-shared";

const ORIGINAL_ENV = process.env["NODE_ENV"];

beforeEach(() => resetGuardedHostsForTest());
afterEach(() => {
  process.env["NODE_ENV"] = ORIGINAL_ENV;
});

describe("guardUserBaseUrl", () => {
  it("ignores an empty base URL", () => {
    expect(() => guardUserBaseUrl(undefined)).not.toThrow();
  });

  it("registers a DNS name for connect-time checks", () => {
    guardUserBaseUrl("https://llm.example.com/v1");
    expect(isGuardedHost("llm.example.com")).toBe(true);
    expect(isGuardedHost("LLM.EXAMPLE.COM")).toBe(true);
    expect(isGuardedHost("api.openai.com")).toBe(false);
  });

  it("refuses internal IP literals (which never hit the lookup hook)", () => {
    for (const url of ["https://169.254.169.254/", "https://10.0.0.1/v1", "https://[::ffff:a9fe:a9fe]/"]) {
      expect(() => guardUserBaseUrl(url), url).toThrow(BlockedBaseUrlError);
    }
  });

  it("allows loopback outside production, refuses it in production", () => {
    process.env["NODE_ENV"] = "development";
    expect(() => guardUserBaseUrl("http://127.0.0.1:4100")).not.toThrow();
    expect(() => guardUserBaseUrl("http://localhost:4100")).not.toThrow();
    process.env["NODE_ENV"] = "production";
    expect(() => guardUserBaseUrl("http://127.0.0.1:4100")).toThrow(BlockedBaseUrlError);
    expect(() => guardUserBaseUrl("http://localhost:4100")).toThrow(BlockedBaseUrlError);
  });

  it("refuses an unparseable URL", () => {
    expect(() => guardUserBaseUrl("::nope::")).toThrow(BlockedBaseUrlError);
  });
});

describe("createScopedGuardLookup", () => {
  function run(lookup: ReturnType<typeof createScopedGuardLookup>, host: string) {
    return new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((resolve) => {
      lookup(host, {}, (err, address) => resolve({ err, address }));
    });
  }

  it("blocks a guarded host that rebinds to the metadata address", async () => {
    const guarded = createPublicOnlyLookup({ resolve: async () => [{ address: "169.254.169.254", family: 4 }] });
    const lookup = createScopedGuardLookup(guarded);
    guardUserBaseUrl("https://rebind.example.com/v1");
    expect((await run(lookup, "rebind.example.com")).err?.code).toBe("EBLOCKED");
  });

  it("leaves unregistered (platform / in-cluster) hosts on the normal resolver", async () => {
    const guarded = createPublicOnlyLookup({ resolve: async () => { throw new Error("should not be called"); } });
    const lookup = createScopedGuardLookup(guarded);
    expect((await run(lookup, "localhost")).err).toBeNull();
  });
});
