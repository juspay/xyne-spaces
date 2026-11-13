/**
 * SSRF guard for outbound HTTP (the HTTP_REQUEST and CLASSIFIER_AGENT steps).
 *
 * A workflow author controls the request URL, so without validation the server
 * can be turned into a proxy for internal services or — on a cloud VM — the
 * instance metadata endpoint (169.254.169.254 / metadata.google.internal),
 * which hands out service-account credentials.
 *
 * Two layers, both applied by `publicFetch`:
 * - `assertPublicHttpUrl` rejects non-http(s) schemes, blocked hostnames and
 *   literal blocked IPs (the socket never does a DNS lookup for those).
 * - The request goes through a dispatcher whose DNS lookup refuses blocked
 *   addresses, so the address checked is the address connected to — a hostname
 *   cannot resolve public for the check and private for the connection.
 *
 * Redirects are never followed by `publicFetch`; a caller that wants them calls
 * it again for each hop so every target is checked.
 */
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

/** Thrown when a destination is refused; the message says why. */
export class SsrfBlockedError extends Error {
  override name = 'SsrfBlockedError';
}

const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal', 'metadata', 'localhost']);

const BLOCKED_IPV4 = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local incl. 169.254.169.254 metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const;

// IPv6 is deny-by-default: only global unicast (2000::/3) is reachable. That alone
// refuses loopback, link-local, unique-local, multicast and every form that embeds
// an IPv4 address outside it (mapped, translated, IPv4-compatible, NAT64).
const GLOBAL_UNICAST_IPV6 = ['2000::', 3] as const;

// Special-purpose blocks inside 2000::/3.
const BLOCKED_IPV6 = [
  ['2001::', 32], // Teredo (embeds an IPv4 address)
  ['2001:2::', 48], // benchmarking
  ['2001:10::', 28], // ORCHID
  ['2001:20::', 28], // ORCHIDv2
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds an IPv4 address)
  ['3fff::', 20], // documentation
] as const;

// The SDK root (and so this module) is also imported by browser bundles, so no
// Node API runs at import time: the lists and the dispatcher are built on first use.
let lists: { blocked: BlockList; globalIpv6: BlockList } | undefined;

function ipLists(): { blocked: BlockList; globalIpv6: BlockList } {
  if (!lists) {
    const blocked = new BlockList();
    for (const [net, bits] of BLOCKED_IPV4) blocked.addSubnet(net, bits, 'ipv4');
    for (const [net, bits] of BLOCKED_IPV6) blocked.addSubnet(net, bits, 'ipv6');
    const globalIpv6 = new BlockList();
    globalIpv6.addSubnet(GLOBAL_UNICAST_IPV6[0], GLOBAL_UNICAST_IPV6[1], 'ipv6');
    lists = { blocked, globalIpv6 };
  }
  return lists;
}

/** True if `ip` (a literal IPv4/IPv6) is in a blocked range. Non-IPs are blocked. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return true;
  const { blocked, globalIpv6 } = ipLists();
  if (v === 4) return blocked.check(ip, 'ipv4');
  return !globalIpv6.check(ip, 'ipv6') || blocked.check(ip, 'ipv6');
}

/**
 * Throw unless `rawUrl` is an http(s) URL whose host is not a blocked name or a
 * literal blocked IP. Hostnames are checked at connect time by `publicFetch`.
 */
export function assertPublicHttpUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`SSRF guard: invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`SSRF guard: blocked scheme "${url.protocol}" (only http/https allowed)`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(`SSRF guard: blocked host "${host}"`);
  }
  if (isIP(host) && isBlockedIp(host)) {
    throw new SsrfBlockedError(`SSRF guard: blocked address ${host}`);
  }
}

/** DNS lookup that refuses to hand the socket a blocked address. */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '');
    const blocked = addresses.find((a) => isBlockedIp(a.address));
    if (blocked) {
      return callback(
        new SsrfBlockedError(`SSRF guard: host "${hostname}" resolves to blocked address ${blocked.address}`),
        '',
      );
    }
    const first = addresses[0];
    if (!first) return callback(new SsrfBlockedError(`SSRF guard: could not resolve host "${hostname}"`), '');
    if (options.all) return callback(null, addresses);
    return callback(null, first.address, first.family);
  });
};

type FetchDispatcher = NonNullable<RequestInit['dispatcher']>;
let dispatcher: Promise<FetchDispatcher> | undefined;

/** An undici Agent whose sockets resolve through `publicOnlyLookup`. */
function publicDispatcher(): Promise<FetchDispatcher> {
  // Cast: global fetch types `dispatcher` with Node's bundled undici-types; same runtime contract.
  dispatcher ??= import('undici').then(
    ({ Agent }) => new Agent({ connect: { lookup: publicOnlyLookup } }) as unknown as FetchDispatcher,
  );
  return dispatcher;
}

/** `fetch` that only reaches public http(s) addresses and never follows redirects. */
export async function publicFetch(rawUrl: string, init: RequestInit): Promise<Response> {
  assertPublicHttpUrl(rawUrl);
  const viaPublicOnly = await publicDispatcher();
  try {
    return await fetch(rawUrl, { ...init, redirect: 'manual', dispatcher: viaPublicOnly });
  } catch (err) {
    // fetch wraps connect errors as TypeError('fetch failed', { cause }).
    if (err instanceof Error && err.cause instanceof SsrfBlockedError) throw err.cause;
    throw err;
  }
}
