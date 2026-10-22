import { describe, it, expect } from "vitest";
import { createPublicOnlyLookup, isBlockedIpAddress, type ResolvedAddress } from "./outbound-policy.js";

function run(
  lookup: ReturnType<typeof createPublicOnlyLookup>,
  host: string,
  all = false,
): Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number | undefined }> {
  return new Promise((resolve) => {
    lookup(host, { all }, (err, address, family) => resolve({ err, address, family }));
  });
}

const fixed = (answers: ResolvedAddress[]) => async () => answers;

describe("isBlockedIpAddress", () => {
  it("blocks metadata, loopback, RFC1918, CGNAT, ULA and v4-mapped forms", () => {
    for (const ip of ["169.254.169.254", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1",
      "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:169.254.169.254", "::ffff:7f00:1", "[::1]"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(isBlockedIpAddress(ip), ip).toBe(false);
    }
  });
});

describe("createPublicOnlyLookup", () => {
  it("passes a public answer through (single and all)", async () => {
    const lookup = createPublicOnlyLookup({ resolve: fixed([{ address: "93.184.216.34", family: 4 }]) });
    const one = await run(lookup, "example.com");
    expect(one.err).toBeNull();
    expect(one.address).toBe("93.184.216.34");
    expect(one.family).toBe(4);
    const all = await run(lookup, "example.com", true);
    expect(all.address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses at connect time when the name now resolves to the metadata IP (rebinding)", async () => {
    let calls = 0;
    // First answer public (what a pre-flight check would see), then metadata.
    const lookup = createPublicOnlyLookup({
      resolve: async () => (calls++ === 0
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "169.254.169.254", family: 4 }]),
    });
    expect((await run(lookup, "rebind.test")).err).toBeNull();
    expect((await run(lookup, "rebind.test")).err?.code).toBe("EBLOCKED");
  });

  it("refuses when ANY answer is internal", async () => {
    const lookup = createPublicOnlyLookup({
      resolve: fixed([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]),
    });
    expect((await run(lookup, "mixed.test", true)).err?.code).toBe("EBLOCKED");
  });

  it("refuses a blocked literal and an empty answer", async () => {
    const lookup = createPublicOnlyLookup({ resolve: fixed([]) });
    expect((await run(lookup, "127.0.0.1")).err?.code).toBe("EBLOCKED");
    expect((await run(lookup, "[::1]")).err?.code).toBe("EBLOCKED");
    expect((await run(lookup, "nothing.test")).err?.code).toBe("ENOTFOUND");
  });

  it("allows loopback only when asked, never metadata", async () => {
    const lookup = createPublicOnlyLookup({ allowLoopback: true, resolve: fixed([{ address: "127.0.0.1", family: 4 }]) });
    expect((await run(lookup, "localhost")).err).toBeNull();
    const metadata = createPublicOnlyLookup({ allowLoopback: true, resolve: fixed([{ address: "169.254.169.254", family: 4 }]) });
    expect((await run(metadata, "x.test")).err?.code).toBe("EBLOCKED");
  });

  it("propagates resolver failures", async () => {
    const lookup = createPublicOnlyLookup({ resolve: async () => { throw Object.assign(new Error("boom"), { code: "ESERVFAIL" }); } });
    expect((await run(lookup, "x.test")).err?.code).toBe("ESERVFAIL");
  });
});
