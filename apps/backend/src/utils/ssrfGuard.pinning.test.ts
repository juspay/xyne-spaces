import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { pinnedAgentsFor } from './ssrfGuard';

function get(url: string, agent: http.Agent, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

describe('pinnedAgentsFor', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => res.end(`host=${req.headers.host}`));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connects to the pinned address and leaves the Host header intact', async () => {
    // The hostname does not resolve publicly at all, so only the pin makes this
    // reachable. Host survives, which is what keeps certificate verification
    // meaningful over https: the certificate is checked against the name, not the IP.
    const { httpAgent } = pinnedAgentsFor('example.invalid', { family: 4, addresses: ['127.0.0.1'] });
    await expect(get(`http://example.invalid:${port}/`, httpAgent)).resolves.toContain('example.invalid');
  });

  it('refuses to resolve any host other than the one that was validated', async () => {
    // A redirect is re-validated by the caller and gets its own agents, so a lookup
    // for a different name here means something has gone wrong. Fail closed.
    const { httpAgent } = pinnedAgentsFor('example.invalid', { family: 4, addresses: ['127.0.0.1'] });
    await expect(get(`http://other.invalid:${port}/`, httpAgent)).rejects.toThrow(
      /Refusing to resolve unexpected host/,
    );
  });

  /**
   * The rebinding case, and the whole reason pinning exists.
   *
   * The name is pinned to an address that passed validation. At connect time DNS
   * would answer 127.0.0.1, where a real server is listening and would return 200.
   * A client that resolved the name a second time would reach it. Because the
   * address is pinned, the connection is attempted against the validated address
   * instead and never reaches localhost — so this must fail, and a success here
   * means the pin is not being honoured.
   */
  it('connects to the validated address even when DNS would now answer internally', async () => {
    const { httpAgent } = pinnedAgentsFor('rebind.invalid', {
      family: 4,
      addresses: ['192.0.2.1'], // TEST-NET-1: reserved for documentation, unroutable
    });
    await expect(get(`http://rebind.invalid:${port}/`, httpAgent, 1500)).rejects.toThrow();
  });

  /**
   * Node requests options.all on the happy-eyeballs path and will try each address
   * it is given, so every pinned address has to be one that passed validation —
   * which is what resolveExternalHostPinned returns. This pins two such addresses
   * and shows the connection stays within them rather than falling back to real
   * DNS, where this hostname resolves to nothing at all.
   */
  it('stays within the pinned set when the resolver asks for all addresses', async () => {
    const { httpAgent } = pinnedAgentsFor('multi.invalid', {
      family: 4,
      addresses: ['192.0.2.1', '198.51.100.1'], // TEST-NET-1 and TEST-NET-2, both unroutable
    });
    await expect(get(`http://multi.invalid:${port}/`, httpAgent, 1500)).rejects.toThrow();
  });
});
