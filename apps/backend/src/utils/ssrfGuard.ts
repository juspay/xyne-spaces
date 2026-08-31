
import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export class SsrfBlockedError extends Error {
  public override readonly name = 'SsrfBlockedError';
  public readonly host: string;
  public readonly resolvedAddress: string | null;
  public constructor(host: string, resolvedAddress: string | null, reason: string) {
    super(
      `Refusing to connect to ${host}${resolvedAddress ? ` (${resolvedAddress})` : ''}: ${reason}`,
    );
    this.host = host;
    this.resolvedAddress = resolvedAddress;
  }
}

function isAllowPrivate(): boolean {
  // Local devs set DATA_SOURCE_ALLOW_PRIVATE_HOSTS=true in their own env.
  return config.dataSource.allowPrivateHosts;
}

const blockedV4 = new BlockList();
blockedV4.addRange('0.0.0.0', '0.255.255.255');
blockedV4.addRange('10.0.0.0', '10.255.255.255');
blockedV4.addRange('100.64.0.0', '100.127.255.255');
blockedV4.addRange('127.0.0.0', '127.255.255.255');
blockedV4.addRange('169.254.0.0', '169.254.255.255');
blockedV4.addRange('172.16.0.0', '172.31.255.255');
blockedV4.addRange('192.0.0.0', '192.0.0.255');
blockedV4.addRange('192.168.0.0', '192.168.255.255');
blockedV4.addRange('198.18.0.0', '198.19.255.255');
blockedV4.addRange('224.0.0.0', '239.255.255.255');
blockedV4.addRange('240.0.0.0', '255.255.255.255');

const blockedV6 = new BlockList();
blockedV6.addAddress('::', 'ipv6');
blockedV6.addAddress('::1', 'ipv6');
blockedV6.addSubnet('fc00::', 7, 'ipv6');
blockedV6.addSubnet('fe80::', 10, 'ipv6');
blockedV6.addSubnet('ff00::', 8, 'ipv6');

function ipv4FromMapped(addr: string): string | null {
  const lower = addr.toLowerCase();
  const dotted = lower.match(/^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted && dotted[1]) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex && hex[1] && hex[2]) {
    const upperGroup = parseInt(hex[1], 16);
    const lowerGroup = parseInt(hex[2], 16);
    const octet0 = (upperGroup >> 8) & 0xff;
    const octet1 = upperGroup & 0xff;
    const octet2 = (lowerGroup >> 8) & 0xff;
    const octet3 = lowerGroup & 0xff;
    return `${octet0}.${octet1}.${octet2}.${octet3}`;
  }
  return null;
}

function isBlockedV4(addr: string): boolean {
  return blockedV4.check(addr);
}

function isBlockedV6(addr: string): boolean {
  const mapped = ipv4FromMapped(addr);
  if (mapped) return isBlockedV4(mapped);
  return blockedV6.check(addr, 'ipv6');
}

// Internal host suffixes are refused by name, before DNS resolution, as
// defence-in-depth alongside the network egress policy that is the primary control.
// Operator-supplied suffixes are configured per environment rather than committed,
// so no internal topology lives in the source. Matched as a dotted-suffix or exact
// host, case-insensitively.
const internalHostSuffixes: string[] = config.ssrf.internalHostSuffixes;

function matchesInternalSuffix(lower: string): boolean {
  return internalHostSuffixes.some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`),
  );
}

function isBlockedHostname(host: string): boolean {
  const lower = host.toLowerCase().trim();
  if (lower === 'localhost') return true;
  if (lower.endsWith('.svc.cluster.local')) return true;
  if (lower.endsWith('.local')) return true;
  if (lower === 'metadata.google.internal') return true;
  if (lower === 'instance-data') return true;
  if (matchesInternalSuffix(lower)) return true;
  return false;
}

export async function assertHostIsExternal(
  host: string,
  allowPrivate: boolean = isAllowPrivate(),
): Promise<void> {
  if (allowPrivate) {
    logger.debug(
      '[SsrfGuard] private hosts allowed (DATA_SOURCE_ALLOW_PRIVATE_HOSTS); skipping check',
      { host },
    );
    return;
  }

  const trimmed = host.trim();
  if (!trimmed) throw new SsrfBlockedError(host, null, 'empty host');

  if (isBlockedHostname(trimmed)) {
    throw new SsrfBlockedError(trimmed, null, 'hostname maps to an internal-only address');
  }

  const literalKind = isIP(trimmed);
  if (literalKind === 4) {
    if (isBlockedV4(trimmed)) {
      throw new SsrfBlockedError(trimmed, trimmed, 'private / loopback / link-local IPv4');
    }
    return;
  }
  if (literalKind === 6) {
    if (isBlockedV6(trimmed)) {
      throw new SsrfBlockedError(trimmed, trimmed, 'private / loopback / link-local IPv6');
    }
    return;
  }

  let v4: string[] = [];
  let v6: string[] = [];
  try {
    [v4, v6] = await Promise.all([
      dns.resolve4(trimmed).catch(() => [] as string[]),
      dns.resolve6(trimmed).catch(() => [] as string[]),
    ]);
  } catch (err) {
    throw new SsrfBlockedError(
      trimmed,
      null,
      `DNS resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (v4.length === 0 && v6.length === 0) {
    throw new SsrfBlockedError(trimmed, null, 'no DNS records (hostname does not resolve)');
  }

  for (const addr of v4) {
    if (isBlockedV4(addr)) {
      throw new SsrfBlockedError(trimmed, addr, 'resolves to private / loopback / link-local IPv4');
    }
  }
  for (const addr of v6) {
    if (isBlockedV6(addr)) {
      throw new SsrfBlockedError(trimmed, addr, 'resolves to private / loopback / link-local IPv6');
    }
  }
}

/** Addresses that passed validation and are the only ones a caller may connect to. */
export interface PinnedHost {
  family: 4 | 6;
  addresses: string[];
}

/**
 * Validate a host and return the addresses that passed, so the caller can connect
 * to exactly those instead of resolving the name again. `assertHostIsExternal`
 * proves the name resolved to public addresses when asked; it cannot stop the HTTP
 * client resolving again and getting a different (internal) answer — DNS rebinding.
 * Returns null when the bypass is active and there is nothing to pin.
 */
export async function resolveExternalHostPinned(
  host: string,
  allowPrivate: boolean = isAllowPrivate(),
): Promise<PinnedHost | null> {
  if (allowPrivate) return null;

  await assertHostIsExternal(host, false);

  const trimmed = host.trim();
  const literalKind = isIP(trimmed);
  if (literalKind === 4) return { family: 4, addresses: [trimmed] };
  if (literalKind === 6) return { family: 6, addresses: [trimmed] };

  // Re-check every resolved address; the connection is held to this set.
  const [v4, v6] = await Promise.all([
    dns.resolve4(trimmed).catch(() => [] as string[]),
    dns.resolve6(trimmed).catch(() => [] as string[]),
  ]);

  const safeV4 = v4.filter((a) => !isBlockedV4(a));
  const safeV6 = v6.filter((a) => !isBlockedV6(a));

  if (safeV4.length !== v4.length || safeV6.length !== v6.length) {
    throw new SsrfBlockedError(trimmed, null, 'DNS answer changed to an internal address between checks');
  }
  if (safeV4.length === 0 && safeV6.length === 0) {
    throw new SsrfBlockedError(trimmed, null, 'no usable public address');
  }

  return safeV4.length > 0 ? { family: 4, addresses: safeV4 } : { family: 6, addresses: safeV6 };
}

/**
 * HTTP/HTTPS agents whose DNS lookup is fixed to `pinned`, so a request cannot
 * connect anywhere other than the validated addresses. The URL keeps its hostname,
 * so TLS still verifies against the name — only address selection is pinned. Any
 * other hostname fails closed (a redirect is re-validated and gets its own agents),
 * and keepAlive is off so a pinned socket is not reused under a later verdict.
 */
export function pinnedAgentsFor(
  hostname: string,
  pinned: PinnedHost,
): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  const lookup = (
    host: string,
    options: { all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    if (host !== hostname) {
      callback(new Error(`Refusing to resolve unexpected host "${host}"`), '', 4);
      return;
    }
    if (options?.all) {
      callback(null, pinned.addresses.map((address) => ({ address, family: pinned.family })));
      return;
    }
    callback(null, pinned.addresses[0]!, pinned.family);
  };

  return {
    httpAgent: new http.Agent({ keepAlive: false, lookup: lookup as never }),
    httpsAgent: new https.Agent({ keepAlive: false, lookup: lookup as never }),
  };
}

/**
 * SSRF guard for outbound webhook URLs (app webhooks, automation
 * trigger_webhook). Ensures the host does not resolve to an internal / private /
 * loopback / link-local address. Throws SsrfBlockedError on any violation.
 * Scheme is intentionally not restricted to https.
 *
 * Callers MUST also disable redirect-following (`redirect: 'manual'`) on the
 * subsequent fetch.
 */
export async function assertWebhookUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, null, 'invalid URL');
  }
  // Webhooks honor the private-host bypass only in local development, not in
  // shared non-prod where DATA_SOURCE_ALLOW_PRIVATE_HOSTS may be set for
  // data-source connectors.
  const allowPrivate = isAllowPrivate() && config.env === 'development';
  await assertHostIsExternal(parsed.hostname, allowPrivate);
}
