import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Agent } from "undici";
import { createPublicOnlyLookup, type ConnectLookup } from "xyne-claw-shared";
import { outboundDispatcher, publicOnlyAgent } from "./safe-fetch.js";

/**
 * End-to-end proof that undici routes connects through the guarded lookup: a
 * name that "rebinds" to an internal address must fail at connect, including
 * when it is reached through a redirect from an allowed host.
 */
describe("connect-time guard (DNS rebinding)", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: `http://internal.rebind.test:${port}/secret` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("internal secret");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // `allowed.test` stands in for a public name (dialled to the local test
  // server); every other name resolves to loopback and goes through the guard.
  function guardedAgent(): Agent {
    const guarded = createPublicOnlyLookup({ resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
    const lookup: ConnectLookup = (host, opts, cb) => {
      if (host === "allowed.test") {
        if (opts?.all) cb(null, [{ address: "127.0.0.1", family: 4 }]);
        else cb(null, "127.0.0.1", 4);
        return;
      }
      guarded(host, opts, cb);
    };
    return new Agent({ connect: { lookup: lookup as never } });
  }

  it("serves the allowed host", async () => {
    const agent = guardedAgent();
    const res = await fetch(`http://allowed.test:${port}/ok`, { dispatcher: agent } as unknown as RequestInit);
    expect(await res.text()).toBe("internal secret");
    await agent.close();
  });

  it("refuses to connect when the name resolves to an internal address", async () => {
    const agent = guardedAgent();
    await expect(fetch(`http://internal.rebind.test:${port}/secret`, { dispatcher: agent } as unknown as RequestInit)).rejects.toThrow();
    await agent.close();
  });

  it("refuses the internal hop of a followed redirect", async () => {
    const agent = guardedAgent();
    await expect(fetch(`http://allowed.test:${port}/redirect`, { dispatcher: agent } as unknown as RequestInit)).rejects.toThrow();
    await agent.close();
  });

  it("outboundDispatcher returns the guarded agent for untrusted URLs", () => {
    expect(outboundDispatcher("https://example.com/")).toBe(publicOnlyAgent);
  });
});
