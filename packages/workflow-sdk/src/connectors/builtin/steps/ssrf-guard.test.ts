import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi } from 'vitest';

// A name that resolves to loopback without the network — the shape of a DNS-rebinding host.
vi.mock('node:dns', async (importOriginal) => {
  const dns = await importOriginal<typeof import('node:dns')>();
  return {
    ...dns,
    lookup: ((hostname: string, options: object, callback: (...args: unknown[]) => void) => {
      if (hostname === 'rebind.test') return callback(null, [{ address: '127.0.0.1', family: 4 }]);
      return (dns.lookup as (...args: unknown[]) => void)(hostname, options, callback);
    }) as typeof dns.lookup,
  };
});

const { isBlockedIp, assertPublicHttpUrl, publicFetch, SsrfBlockedError } = await import('./ssrf-guard.js');

describe('SSRF guard — isBlockedIp', () => {
  it('blocks the cloud metadata address and private/loopback/link-local ranges', () => {
    for (const ip of [
      '169.254.169.254', // GCP/AWS metadata (link-local)
      '169.254.0.1',
      '127.0.0.1', // loopback
      '0.0.0.0',
      '10.0.0.5', // private
      '172.16.9.9', // private
      '172.31.255.255',
      '192.168.1.1', // private
      '100.64.0.1', // CGNAT
      '192.0.2.1', // documentation
      '255.255.255.255',
      '::', // v6 unspecified
      '::1', // v6 loopback
      'fd00::1', // v6 unique-local
      'fe80::1', // v6 link-local
      'fe80::1%eth0',
      'fec0::1', // v6 site-local
      'ff02::1', // v6 multicast
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it('blocks private IPv4 embedded in IPv6, however it is spelled', () => {
    for (const ip of [
      '::ffff:169.254.169.254', // v4-mapped, dotted
      '::ffff:a9fe:a9fe', // v4-mapped, hex (what URL normalises to)
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:7f00:1',
      '::7f00:1', // v4-compatible
      '64:ff9b::a9fe:a9fe', // NAT64
      '2002:7f00:1::', // 6to4
      '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
      '::ffff:0:7f00:1', // IPv4-translated
      '::ffff:8.8.8.8', // mapped, even when public: no real host publishes one
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it('refuses IPv6 outside global unicast, and special blocks inside it', () => {
    for (const ip of ['5f00::1', '100::1', '2001:2::1', '2001:20::1', '3fff::1']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it('blocks anything that is not an IP', () => {
    expect(isBlockedIp('example.com')).toBe(true);
  });
});

describe('SSRF guard — assertPublicHttpUrl', () => {
  it('rejects the metadata endpoint by hostname and by literal IP', () => {
    expect(() => assertPublicHttpUrl('http://metadata.google.internal/computeMetadata/v1/')).toThrow(/blocked host/i);
    expect(() => assertPublicHttpUrl('http://metadata.google.internal./computeMetadata/v1/')).toThrow(/blocked host/i);
    expect(() => assertPublicHttpUrl('http://169.254.169.254/computeMetadata/v1/')).toThrow(/blocked address/i);
  });

  it('rejects literal IPs in the forms URL accepts', () => {
    for (const url of [
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://[::1]/',
      'http://2130706433/', // decimal 127.0.0.1
      'http://0x7f.1/', // hex 127.0.0.1
      'http://0251.0376.0251.0376/', // octal 169.254.169.254
    ]) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(/blocked address/i);
    }
  });

  it('rejects non-http(s) schemes and localhost', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(/scheme/i);
    expect(() => assertPublicHttpUrl('gopher://127.0.0.1/')).toThrow(/scheme/i);
    expect(() => assertPublicHttpUrl('http://localhost/')).toThrow(/blocked host/i);
    expect(() => assertPublicHttpUrl('http://localhost./')).toThrow(/blocked host/i);
  });

  it('allows a public IP or a hostname without touching DNS', () => {
    expect(() => assertPublicHttpUrl('https://8.8.8.8/')).not.toThrow();
    expect(() => assertPublicHttpUrl('https://api.example.com/')).not.toThrow();
  });
});

describe('SSRF guard — publicFetch', () => {
  it('refuses a hostname that resolves to a blocked address, before connecting', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.end('internal');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const attempt = publicFetch(`http://rebind.test:${String(port)}/`, {});
      await expect(attempt).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(attempt).rejects.toThrow(/resolves to blocked address 127\.0\.0\.1/);
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it('refuses a literal blocked IP without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(publicFetch('http://[::ffff:a9fe:a9fe]/', {})).rejects.toThrow(/blocked address/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
