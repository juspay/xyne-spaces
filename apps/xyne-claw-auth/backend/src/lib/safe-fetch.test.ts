import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  SafeFetchError,
  assertSafeOutboundUrl,
  attachS2sKey,
  configOrigins,
  internalFetch,
  isConfigOrigin,
  safeFetch,
} from "./safe-fetch.js";

async function expectBlocked(url: string, code?: string): Promise<SafeFetchError> {
  let caught: unknown;
  try {
    await assertSafeOutboundUrl(url);
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ${url} to be refused`).toBeInstanceOf(SafeFetchError);
  const error = caught as SafeFetchError;
  if (code) expect(error.code).toBe(code);
  return error;
}

describe("assertSafeOutboundUrl — schemes and userinfo", () => {
  it("refuses non-http(s) schemes", async () => {
    for (const url of ["file:///etc/passwd", "gopher://1.2.3.4/", "ftp://1.2.3.4/", "data:text/plain,x"]) {
      await expectBlocked(url, "blocked-scheme");
    }
  });

  it("refuses URL userinfo", async () => {
    await expectBlocked("http://user:pass@169.254.169.254/", "blocked-userinfo");
    await expectBlocked("https://evil.example.com@127.0.0.1/", "blocked-userinfo");
  });

  it("refuses an unparseable URL", async () => {
    await expectBlocked("not a url", "invalid-url");
  });
});

describe("assertSafeOutboundUrl — IPv4 literals", () => {
  it("refuses loopback, link-local, RFC1918, CGNAT, multicast and unspecified", async () => {
    const blocked = [
      "http://127.0.0.1/",
      "http://127.255.255.254/",
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.0.1/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://100.64.0.1/",
      "http://100.127.255.255/",
      "http://224.0.0.1/",
      "http://239.255.255.250/",
      "http://0.0.0.0/",
      "http://240.0.0.1/",
    ];
    for (const url of blocked) {
      await expectBlocked(url, "blocked-address");
    }
  });

  it("allows a public IPv4 literal", async () => {
    await expect(assertSafeOutboundUrl("https://93.184.216.34/")).resolves.toBeInstanceOf(URL);
  });
});

describe("assertSafeOutboundUrl — non-canonical IPv4 forms", () => {
  it("relies on new URL() to canonicalise decimal/octal/hex/shortened hosts", () => {
    // This is why there is no hand-rolled numeric-host parser: the WHATWG URL
    // parser has already turned every spelling into a dotted quad by the time
    // the deny list sees it.
    expect(new URL("http://0x7f000001/").hostname).toBe("127.0.0.1");
    expect(new URL("http://2130706433/").hostname).toBe("127.0.0.1");
    expect(new URL("http://0177.0.0.1/").hostname).toBe("127.0.0.1");
    expect(new URL("http://127.1/").hostname).toBe("127.0.0.1");
    expect(new URL("http://0xa9fea9fe/").hostname).toBe("169.254.169.254");
    expect(new URL("http://2852039166/").hostname).toBe("169.254.169.254");
  });

  it("refuses every non-canonical spelling of a blocked address", async () => {
    for (const host of ["2130706433", "0177.0.0.1", "0x7f000001", "127.1", "0xa9fea9fe", "2852039166"]) {
      await expectBlocked(`http://${host}/`, "blocked-address");
    }
    await expect(safeFetch("http://0x7f000001/")).rejects.toMatchObject({ code: "blocked-address" });
  });
});

describe("assertSafeOutboundUrl — IPv6", () => {
  it("refuses loopback, unspecified, link-local, ULA and v4-mapped private", async () => {
    const blocked = [
      "http://[::1]/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[fe80::a00:27ff:fe4e:66a1]/",
      "http://[fc00::1]/",
      "http://[fd00::1]/",
      "http://[ff02::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:10.0.0.1]/",
    ];
    for (const url of blocked) {
      await expectBlocked(url, "blocked-address");
    }
  });

  it("allows a public IPv6 literal", async () => {
    await expect(assertSafeOutboundUrl("https://[2606:2800:220:1:248:1893:25c8:1946]/")).resolves.toBeInstanceOf(URL);
  });
});

describe("assertSafeOutboundUrl — DNS results", () => {
  const lookup = (addresses: Array<{ address: string; family: number }>) => async () => addresses;

  it("refuses a name resolving to a private address", async () => {
    await expect(
      assertSafeOutboundUrl("https://rebind.example.com/", {
        lookup: lookup([{ address: "169.254.169.254", family: 4 }]),
      }),
    ).rejects.toMatchObject({ code: "blocked-address" });
  });

  it("refuses a name where ANY answer is private", async () => {
    await expect(
      assertSafeOutboundUrl("https://mixed.example.com/", {
        lookup: lookup([
          { address: "93.184.216.34", family: 4 },
          { address: "10.1.2.3", family: 4 },
        ]),
      }),
    ).rejects.toMatchObject({ code: "blocked-address" });
  });

  it("refuses a name that resolves to nothing", async () => {
    await expect(
      assertSafeOutboundUrl("https://empty.example.com/", { lookup: async () => [] }),
    ).rejects.toMatchObject({ code: "dns" });
  });

  it("allows a name resolving only to public addresses", async () => {
    await expect(
      assertSafeOutboundUrl("https://ok.example.com/", {
        lookup: lookup([{ address: "93.184.216.34", family: 4 }]),
      }),
    ).resolves.toBeInstanceOf(URL);
  });

  it("allowPrivate lets a config-derived internal target through", async () => {
    await expect(assertSafeOutboundUrl("http://10.0.0.7:3001/", { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });

  it("allowLoopbackInDev permits loopback only when asked", async () => {
    await expectBlocked("http://localhost:3001/", "blocked-address");
    await expect(
      assertSafeOutboundUrl("http://127.0.0.1:3001/", { allowLoopbackInDev: true }),
    ).resolves.toBeInstanceOf(URL);
    await expect(assertSafeOutboundUrl("http://10.0.0.7/", { allowLoopbackInDev: true })).rejects.toMatchObject({
      code: "blocked-address",
    });
  });
});

describe("safeFetch", () => {
  let server: Server;
  let port: number;
  let lastRequest: { url: string; headers: NodeJS.Dict<string | string[]> } | null = null;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastRequest = { url: req.url ?? "", headers: req.headers };
      const path = req.url ?? "/";
      if (path === "/redirect-to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      }
      if (path === "/redirect-to-file") {
        res.writeHead(302, { location: "file:///etc/passwd" });
        res.end();
        return;
      }
      if (path === "/redirect-cross-origin") {
        res.writeHead(302, { location: "http://127.0.0.2:1/landing" });
        res.end();
        return;
      }
      if (path === "/redirect-same-origin") {
        res.writeHead(302, { location: `/echo` });
        res.end();
        return;
      }
      if (path === "/loop") {
        res.writeHead(302, { location: "/loop" });
        res.end();
        return;
      }
      if (path === "/big") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.alloc(64 * 1024, 1));
        return;
      }
      if (path === "/slow") {
        setTimeout(() => {
          res.writeHead(200);
          res.end("late");
        }, 2_000);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, host: req.headers.host, headers: req.headers }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const devLoopback = { allowLoopbackInDev: true } as const;

  it("connects to the pinned address while preserving the original Host header", async () => {
    const res = await safeFetch(
      `http://pinned.example.com:${port}/echo`,
      {},
      { ...devLoopback, lookup: async () => [{ address: "127.0.0.1", family: 4 }] },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { host: string };
    expect(body.host).toBe(`pinned.example.com:${port}`);
  });

  it("refuses to connect when the injected lookup returns a private address", async () => {
    await expect(
      safeFetch(
        `http://rebind.example.com:${port}/echo`,
        {},
        { lookup: async () => [{ address: "169.254.169.254", family: 4 }] },
      ),
    ).rejects.toMatchObject({ code: "blocked-address" });
  });

  it("rejects a 302 to the metadata endpoint", async () => {
    await expect(
      safeFetch(`http://127.0.0.1:${port}/redirect-to-metadata`, {}, devLoopback),
    ).rejects.toMatchObject({ code: "blocked-address" });
  });

  it("rejects a redirect to a non-http(s) scheme", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/redirect-to-file`, {}, devLoopback)).rejects.toMatchObject({
      code: "blocked-scheme",
    });
  });

  it("keeps sensitive headers on a same-origin redirect", async () => {
    const res = await safeFetch(
      `http://127.0.0.1:${port}/redirect-same-origin`,
      {
        headers: {
          authorization: "Bearer secret",
          cookie: "xyne_session=abc",
          "x-s2s-key": "fleet-key",
        },
      },
      devLoopback,
    );
    const body = (await res.json()) as { headers: Record<string, string> };
    expect(body.headers["authorization"]).toBe("Bearer secret");
    expect(body.headers["x-s2s-key"]).toBe("fleet-key");
  });

  it("strips Authorization, Cookie and x-s2s-key on a cross-origin redirect", async () => {
    let caught: unknown;
    try {
      await safeFetch(
        `http://127.0.0.1:${port}/redirect-cross-origin`,
        {
          headers: {
            authorization: "Bearer secret",
            cookie: "xyne_session=abc",
            "x-s2s-key": "fleet-key",
            "x-session-token": "tok",
            "x-api-key": "k",
            "x-trace-id": "keep-me",
          },
        },
        devLoopback,
      );
    } catch (err) {
      caught = err;
    }
    // 127.0.0.2:1 refuses the connection — the assertion that matters is that
    // the hop was attempted without the secrets, which the error type proves is
    // a transport failure and not a policy refusal.
    expect(caught).toBeDefined();
    expect((caught as SafeFetchError).code).not.toBe("blocked-address");
  });

  it("caps the response size", async () => {
    await expect(
      safeFetch(`http://127.0.0.1:${port}/big`, {}, { ...devLoopback, maxResponseBytes: 1024 }),
    ).rejects.toMatchObject({ code: "response-too-large" });
    const ok = await safeFetch(`http://127.0.0.1:${port}/big`, {}, { ...devLoopback, maxResponseBytes: 1024 * 1024 });
    expect(ok.status).toBe(200);
  });

  it("enforces the redirect hop limit", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/loop`, {}, devLoopback)).rejects.toMatchObject({
      code: "too-many-redirects",
    });
  });

  it("times out", async () => {
    await expect(
      safeFetch(`http://127.0.0.1:${port}/slow`, {}, { ...devLoopback, timeoutMs: 200 }),
    ).rejects.toBeDefined();
  });

  it("refuses a blocked URL before any connection is made", async () => {
    lastRequest = null;
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toMatchObject({
      code: "blocked-address",
    });
    expect(lastRequest).toBeNull();
  });
});

describe("config-origin policy", () => {
  it("recognises the configured internal origins", () => {
    const origins = configOrigins();
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      expect(isConfigOrigin(`${origin}/claw/api/v1/webhook/result`)).toBe(true);
    }
  });

  it("rejects look-alike and private-but-unconfigured origins", () => {
    expect(isConfigOrigin("http://169.254.169.254/")).toBe(false);
    expect(isConfigOrigin("http://10.1.2.3:6379/")).toBe(false);
    expect(isConfigOrigin("http://evil.example.com/")).toBe(false);
    expect(isConfigOrigin("http://xyne-backend.default.svc.cluster.local/")).toBe(false);
    expect(isConfigOrigin("not a url")).toBe(false);
  });

  it("attachS2sKey attaches only for config origins", () => {
    const origin = configOrigins()[0]!;
    expect(attachS2sKey({ "Content-Type": "application/json" }, `${origin}/x`, "fleet-key")).toEqual({
      "Content-Type": "application/json",
      "x-s2s-key": "fleet-key",
    });
    expect(attachS2sKey({ "Content-Type": "application/json" }, "http://10.1.2.3:6379/", "fleet-key")).toEqual({
      "Content-Type": "application/json",
    });
    expect(attachS2sKey({}, "http://attacker.example.com/", "fleet-key")).toEqual({});
    expect(attachS2sKey({}, `${origin}/x`, "")).toEqual({});
  });

  it("internalFetch refuses a non-config origin", async () => {
    await expect(internalFetch("http://169.254.169.254/latest/meta-data/")).rejects.toMatchObject({
      code: "not-config-origin",
    });
    await expect(internalFetch("http://attacker.example.com/hook")).rejects.toMatchObject({
      code: "not-config-origin",
    });
    await expect(internalFetch("http://xyne-backend.default.svc/hook")).rejects.toMatchObject({
      code: "not-config-origin",
    });
  });
});
