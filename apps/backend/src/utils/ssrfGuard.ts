
import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
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

// A stricter subset that is refused even when internal webhook hosts are otherwise
// allowed: loopback and link-local / cloud-metadata (169.254.x — the instance
// metadata endpoint that can return the workload's credentials).
const metadataV4 = new BlockList();
metadataV4.addRange('0.0.0.0', '0.255.255.255');
metadataV4.addRange('127.0.0.0', '127.255.255.255');
metadataV4.addRange('169.254.0.0', '169.254.255.255');
const metadataV6 = new BlockList();
metadataV6.addAddress('::', 'ipv6');
metadataV6.addAddress('::1', 'ipv6');
metadataV6.addSubnet('fe80::', 10, 'ipv6');
// The IPv6 instance-metadata prefix (fd00:ec2::/32) sits inside the fc00::/7 ULA
// range that internal webhooks are otherwise allowed to reach — refuse just this
// metadata prefix without blocking legitimate internal ULA addresses.
metadataV6.addSubnet('fd00:ec2::', 32, 'ipv6');
// (IPv4-mapped loopback/link-local/metadata — dotted and compact ::ffff: forms — is
// handled by ipv4FromMapped() in isMetadataV6, mirroring the strict isBlockedV6 path.)

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

function isMetadataV4(addr: string): boolean {
  return metadataV4.check(addr);
}

function isMetadataV6(addr: string): boolean {
  const mapped = ipv4FromMapped(addr);
  if (mapped) return isMetadataV4(mapped);
  return metadataV6.check(addr, 'ipv6');
}

// Hostnames refused even when internal webhook targets are allowed.
function isMetadataHostname(host: string): boolean {
  const lower = host.toLowerCase().trim();
  return (
    lower === 'localhost' ||
    lower === 'metadata.google.internal' ||
    lower === 'metadata' ||
    lower === 'instance-data'
  );
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
  allowPrivate: boolean = isAllowPrivate() && config.env === 'development',
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
  allowPrivate: boolean = isAllowPrivate() && config.env === 'development',
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
 * An undici dispatcher whose connection lookup is fixed to `pinned`, for callers
 * that use fetch() rather than axios (which cannot take an http.Agent). Same
 * guarantee as pinnedAgentsFor: the request connects only to the validated
 * addresses, the URL keeps its hostname so TLS still verifies against the name,
 * and any other hostname (e.g. a redirect target) fails closed.
 */
export function pinnedDispatcherFor(hostname: string, pinned: PinnedHost): Agent {
  return new Agent({
    keepAliveTimeout: 1000,
    connect: {
      lookup: ((host: string, _options: unknown, callback: (err: Error | null, address?: unknown, family?: number) => void): void => {
        if (host !== hostname) {
          callback(new Error(`Refusing to resolve unexpected host "${host}"`));
          return;
        }
        callback(null, pinned.addresses.map((address) => ({ address, family: pinned.family })));
      }) as never,
    },
  });
}

/**
 * Webhook variant used when WEBHOOK_ALLOW_INTERNAL_HOSTS is enabled: allows private /
 * internal destinations but still refuses loopback and link-local / cloud-metadata
 * (the instance-metadata credential endpoint). Resolves and pins to the checked
 * addresses so a later DNS answer cannot swing to a refused address (rebinding-safe).
 */
export async function resolveWebhookHostAllowingInternal(host: string): Promise<PinnedHost> {
  const trimmed = host.trim();
  if (!trimmed) throw new SsrfBlockedError(host, null, 'empty host');
  if (isMetadataHostname(trimmed)) {
    throw new SsrfBlockedError(trimmed, null, 'loopback / metadata host is never allowed');
  }
  const literalKind = isIP(trimmed);
  if (literalKind === 4) {
    if (isMetadataV4(trimmed)) throw new SsrfBlockedError(trimmed, trimmed, 'loopback / link-local / metadata');
    return { family: 4, addresses: [trimmed] };
  }
  if (literalKind === 6) {
    if (isMetadataV6(trimmed)) throw new SsrfBlockedError(trimmed, trimmed, 'loopback / link-local / metadata');
    return { family: 6, addresses: [trimmed] };
  }
  const [v4, v6] = await Promise.all([
    dns.resolve4(trimmed).catch(() => [] as string[]),
    dns.resolve6(trimmed).catch(() => [] as string[]),
  ]);
  if (v4.length === 0 && v6.length === 0) {
    throw new SsrfBlockedError(trimmed, null, 'no DNS records (hostname does not resolve)');
  }
  for (const addr of v4) {
    if (isMetadataV4(addr)) throw new SsrfBlockedError(trimmed, addr, 'resolves to loopback / link-local / metadata');
  }
  for (const addr of v6) {
    if (isMetadataV6(addr)) throw new SsrfBlockedError(trimmed, addr, 'resolves to loopback / link-local / metadata');
  }
  return v4.length > 0 ? { family: 4, addresses: v4 } : { family: 6, addresses: v6 };
}

/**
 * Validate an outbound webhook URL and fetch it pinned to the addresses that passed,
 * so a second DNS answer cannot swing the connection between the check and the request
 * (rebinding). The fetch() counterpart to how LinkPreviewService uses
 * resolveExternalHostPinned + pinnedAgentsFor. Honors WEBHOOK_ALLOW_INTERNAL_HOSTS.
 * Callers MUST still pass `redirect: 'manual'` — a 3xx target is a fresh URL this has
 * not validated. Throws SsrfBlockedError on a blocked destination.
 */
export async function safeWebhookFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, null, 'invalid URL');
  }
  // When WEBHOOK_ALLOW_INTERNAL_HOSTS is set, internal webhook targets are allowed
  // while loopback and cloud-metadata stay refused.
  const pinned = config.webhooks.allowInternalHosts
    ? await resolveWebhookHostAllowingInternal(parsed.hostname)
    : await resolveExternalHostPinned(parsed.hostname, isAllowPrivate() && config.env === 'development');
  // A fresh dispatcher per request — never shared, so a pinned socket is never
  // reused under a later verdict; its idle socket is dropped on keep-alive timeout.
  const dispatcher = pinned
    ? pinnedDispatcherFor(parsed.hostname, pinned)
    : new Agent({ keepAliveTimeout: 1000 });
  return (await undiciFetch(rawUrl, { ...init, dispatcher } as never)) as unknown as Response;
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
  // When WEBHOOK_ALLOW_INTERNAL_HOSTS is set, internal webhook targets are allowed
  // while loopback and cloud-metadata stay refused. Validation only: this throws on a
  // disallowed destination; the pinned outbound connection is made by safeWebhookFetch,
  // so the resolved addresses are intentionally not returned here.
  if (config.webhooks.allowInternalHosts) {
    await resolveWebhookHostAllowingInternal(parsed.hostname);
    return;
  }
  // Otherwise webhooks honor the private-host bypass only in local development, not
  // in shared non-prod where DATA_SOURCE_ALLOW_PRIVATE_HOSTS may be set for
  // data-source connectors.
  const allowPrivate = isAllowPrivate() && config.env === 'development';
  await assertHostIsExternal(parsed.hostname, allowPrivate);
}
