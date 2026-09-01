import http from 'node:http';
import { Agent, fetch as undiciFetch } from 'undici';
import type { AddressInfo } from 'node:net';
import { pinnedDispatcherFor, safeWebhookFetch, SsrfBlockedError } from './ssrfGuard';

// Webhook SSRF: the outbound URL is caller-supplied. safeWebhookFetch resolves +
// validates the host, then pins the connection to the checked address so a second
// DNS answer cannot swing it to an internal host between the check and the connect
// (DNS rebinding). These tests exercise the connection-level pinning directly.

function listen(host: string, handler: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, host, () => resolve(server));
  });
}

async function tryListenOn(host: string, port: number, body: string): Promise<http.Server | null> {
  return new Promise((resolve) => {
    const server = http.createServer((_q, r) => { r.writeHead(200); r.end(body); });
    server.on('error', () => resolve(null)); // e.g. ::1 not bindable
    server.listen(port, host, () => resolve(server));
  });
}

describe('pinnedDispatcherFor', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = await listen('127.0.0.1', (req, res) => { res.writeHead(200); res.end(`served:${req.headers.host}`); });
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it('connects to the pinned address for a hostname that never resolves in DNS', async () => {
    // If any DNS lookup happened, "pinned.invalid" would NXDOMAIN and this would throw.
    const dispatcher = pinnedDispatcherFor('pinned.invalid', { family: 4, addresses: ['127.0.0.1'] });
    const res = await undiciFetch(`http://pinned.invalid:${port}/`, { dispatcher } as never);
    // Host header (and thus TLS SNI, for https) is preserved as the name, not the IP.
    expect(await res.text()).toBe(`served:pinned.invalid:${port}`);
  });

  it('fails closed when asked to connect to a different host (e.g. a redirect target)', async () => {
    const dispatcher = pinnedDispatcherFor('pinned.invalid', { family: 4, addresses: ['127.0.0.1'] });
    await expect(
      undiciFetch(`http://other.invalid:${port}/`, { dispatcher } as never),
    ).rejects.toThrow();
  });

  it('defeats DNS rebinding where an unpinned client would be redirected internally', async () => {
    // GOOD = the validated address (127.0.0.1, stands in for a public IP);
    // EVIL = where flipped DNS would point (::1, stands in for an internal host).
    const good = await listen('127.0.0.1', (_q, r) => { r.writeHead(200); r.end('GOOD'); });
    const gPort = (good.address() as AddressInfo).port;
    const evil = await tryListenOn('::1', gPort, 'EVIL');
    if (!evil) { good.close(); return; } // ::1 not bindable here — skip the contrast half

    try {
      // Malicious resolver: GOOD on the validating lookup, EVIL on every lookup afterwards.
      let n = 0;
      const flipLookup = (_host: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void): void => {
        n += 1;
        if (n === 1) cb(null, [{ address: '127.0.0.1', family: 4 }]);
        else cb(null, [{ address: '::1', family: 6 }]);
      };

      // Unpinned client that resolves at connect time (n already past 1) -> rebound to EVIL.
      n = 1;
      const evilAgent = new Agent({ connect: { lookup: flipLookup as never } });
      const unpinned = await (await undiciFetch(`http://target.invalid:${gPort}/`, { dispatcher: evilAgent } as never)).text();
      expect(unpinned).toBe('EVIL'); // confirms the attack is real without pinning

      // Pinned to the validated address -> never re-resolves -> stays on GOOD.
      const pinned = pinnedDispatcherFor('target.invalid', { family: 4, addresses: ['127.0.0.1'] });
      const pinnedBody = await (await undiciFetch(`http://target.invalid:${gPort}/`, { dispatcher: pinned } as never)).text();
      expect(pinnedBody).toBe('GOOD');
    } finally {
      evil.close();
      good.close();
    }
  });
});

describe('safeWebhookFetch', () => {
  it('blocks a destination that resolves to a private / loopback address', async () => {
    const server = await listen('127.0.0.1', (_q, res) => { res.writeHead(200); res.end('should-not-reach'); });
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        safeWebhookFetch(`http://127.0.0.1:${port}/hook`, { method: 'POST', redirect: 'manual' }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    } finally {
      server.close();
    }
  });

  it('rejects a non-URL', async () => {
    await expect(safeWebhookFetch('not a url')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
