
import { promises as dns } from 'node:dns';
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
  return config.env !== 'production' || config.dataSource.allowPrivateHosts;
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

function isBlockedHostname(host: string): boolean {
  const lower = host.toLowerCase().trim();
  if (lower === 'localhost') return true;
  if (lower.endsWith('.svc.cluster.local')) return true;
  if (lower.endsWith('.local')) return true;
  if (lower === 'metadata.google.internal') return true;
  if (lower === 'instance-data') return true;
  return false;
}

export async function assertHostIsExternal(host: string): Promise<void> {
  if (isAllowPrivate()) {
    logger.debug(
      '[SsrfGuard] private hosts allowed (non-prod or DATA_SOURCE_ALLOW_PRIVATE_HOSTS); skipping check',
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
