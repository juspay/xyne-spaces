/**
 * Outbound-URL guard for MCP adapters that make HTTP requests from this
 * process to a host that is NOT a compile-time constant:
 *
 *   - webfetch: fetches an arbitrary caller-supplied URL by design.
 *   - bitbucket: the API base URL is a per-connection credential field
 *     (`credentials.baseUrl`, written by POST /:userId/connections from the
 *     request body), so any authenticated user can point it anywhere.
 *
 * Without a fence either path lets a caller aim this service at loopback,
 * RFC1918 ranges, link-local / cloud-metadata (169.254.169.254) or the
 * cluster's internal DNS — classic SSRF. The guard resolves hostnames via the
 * same resolver `fetch` uses and refuses anything that lands on a private,
 * loopback, link-local, multicast or reserved address.
 *
 * Escape hatches (both opt-in, both off by default):
 *   - MCP_OUTBOUND_ALLOW_PRIVATE_HOSTS=true  — local development only; skips
 *     the address check entirely.
 *   - per-integration host allowlists (e.g. BITBUCKET_ALLOWED_HOSTS) — an
 *     operator-trusted host list; hosts on it are accepted without the
 *     address check so an on-prem server on a private range still works.
 *
 * Limitation: a DNS answer can change between this check and the connect
 * (rebinding). Pinning the resolved address would need a custom dispatcher;
 * callers MUST at least re-validate every redirect hop (see webfetch).
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class OutboundUrlBlockedError extends Error {
  override readonly name = "OutboundUrlBlockedError";
  readonly host: string;
  constructor(host: string, reason: string) {
    super(`Refusing to connect to ${host || "(empty host)"}: ${reason}`);
    this.host = host;
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const blockedV4 = new BlockList();
blockedV4.addRange("0.0.0.0", "0.255.255.255"); // "this" network
blockedV4.addRange("10.0.0.0", "10.255.255.255"); // RFC1918
blockedV4.addRange("100.64.0.0", "100.127.255.255"); // CGNAT
blockedV4.addRange("127.0.0.0", "127.255.255.255"); // loopback
blockedV4.addRange("169.254.0.0", "169.254.255.255"); // link-local / cloud metadata
blockedV4.addRange("172.16.0.0", "172.31.255.255"); // RFC1918
blockedV4.addRange("192.0.0.0", "192.0.0.255"); // IETF protocol assignments
blockedV4.addRange("192.0.2.0", "192.0.2.255"); // TEST-NET-1
blockedV4.addRange("192.168.0.0", "192.168.255.255"); // RFC1918
blockedV4.addRange("198.18.0.0", "198.19.255.255"); // benchmarking
blockedV4.addRange("198.51.100.0", "198.51.100.255"); // TEST-NET-2
blockedV4.addRange("203.0.113.0", "203.0.113.255"); // TEST-NET-3
blockedV4.addRange("224.0.0.0", "239.255.255.255"); // multicast
blockedV4.addRange("240.0.0.0", "255.255.255.255"); // reserved + broadcast

const blockedV6 = new BlockList();
blockedV6.addAddress("::", "ipv6"); // unspecified
blockedV6.addAddress("::1", "ipv6"); // loopback
blockedV6.addSubnet("fc00::", 7, "ipv6"); // unique local
blockedV6.addSubnet("fe80::", 10, "ipv6"); // link-local
blockedV6.addSubnet("ff00::", 8, "ipv6"); // multicast
blockedV6.addSubnet("2001:db8::", 32, "ipv6"); // documentation
blockedV6.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 (wraps IPv4, checked below)

/** Hostnames that name internal-only things regardless of what they resolve to. */
function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true; // mDNS + *.svc.cluster.local
  if (h.endsWith(".internal")) return true; // metadata.google.internal, *.internal cloud DNS
  if (h === "metadata" || h === "instance-data") return true; // cloud metadata aliases
  return false;
}

/** True when `addr` (a literal IPv4/IPv6 address) is private, loopback, link-local, etc. */
export function isBlockedAddress(addr: string): boolean {
  const bare = addr.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const kind = isIP(bare);
  if (kind === 4) return blockedV4.check(bare);
  if (kind === 6) {
    // BlockList matches IPv4-mapped (::ffff:a.b.c.d) against the v4 rules itself.
    if (blockedV4.check(bare, "ipv6")) return true;
    if (blockedV6.check(bare, "ipv6")) return true;
    // NAT64 embeds an IPv4 address in the low 32 bits; unwrap and re-check.
    const nat64 = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare);
    if (nat64) {
      const hi = parseInt(nat64[1]!, 16);
      const lo = parseInt(nat64[2]!, 16);
      return blockedV4.check(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
    return false;
  }
  // Not an IP literal at all — caller should have resolved it first.
  return true;
}

function allowPrivateHosts(): boolean {
  return process.env["MCP_OUTBOUND_ALLOW_PRIVATE_HOSTS"] === "true";
}

/**
 * Resolve `hostname` and throw unless every address it maps to is public.
 * IP literals are checked directly. Fails CLOSED on resolver errors: a host
 * that does not resolve here would not connect either, and failing open
 * would turn a flaky resolver into a bypass.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.trim().replace(/^\[|\]$/g, "");
  if (!host) throw new OutboundUrlBlockedError(host, "empty host");
  if (allowPrivateHosts()) return;

  if (isBlockedHostname(host)) {
    throw new OutboundUrlBlockedError(host, "hostname is internal-only");
  }

  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new OutboundUrlBlockedError(host, "private, loopback or link-local address");
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch (err) {
    throw new OutboundUrlBlockedError(
      host,
      `DNS resolution failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (addresses.length === 0) {
    throw new OutboundUrlBlockedError(host, "hostname does not resolve");
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new OutboundUrlBlockedError(host, `resolves to private, loopback or link-local address ${address}`);
    }
  }
}

/** Parse a comma/whitespace-separated host allowlist from an env var value. */
export function parseHostAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ""))
    .filter((h) => h.length > 0);
}

export interface OutboundUrlOptions {
  /**
   * Operator-trusted hostnames. When non-empty the URL's host MUST be on this
   * list and the address check is skipped (on-prem servers on private ranges
   * are the point of the list). When empty, the address check applies.
   */
  allowedHosts?: readonly string[];
  /** Used in error messages, e.g. "Bitbucket base URL". Defaults to "URL". */
  label?: string;
}

/**
 * Validate an outbound request target: well-formed, http(s), and a host that
 * is either on the allowlist or resolves only to public addresses. Returns
 * the parsed URL; callers must build the request from IT (`.origin`,
 * `.href`), never from the raw input string.
 */
export async function assertOutboundUrlAllowed(
  input: string | URL,
  opts: OutboundUrlOptions = {},
): Promise<URL> {
  const label = opts.label ?? "URL";
  let parsed: URL;
  try {
    parsed = input instanceof URL ? input : new URL(input);
  } catch {
    throw new OutboundUrlBlockedError(String(input).slice(0, 200), `${label} is not a valid absolute URL`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new OutboundUrlBlockedError(parsed.hostname, `${label} must use http or https (got ${parsed.protocol})`);
  }
  if (parsed.username || parsed.password) {
    throw new OutboundUrlBlockedError(parsed.hostname, `${label} must not embed credentials`);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) throw new OutboundUrlBlockedError(hostname, `${label} has no host`);

  const allowedHosts = opts.allowedHosts ?? [];
  if (allowedHosts.length > 0) {
    if (!allowedHosts.includes(hostname.replace(/\.$/, ""))) {
      throw new OutboundUrlBlockedError(hostname, `${label} host is not on the configured allowlist`);
    }
    return parsed;
  }

  await assertPublicHost(hostname);
  return parsed;
}
