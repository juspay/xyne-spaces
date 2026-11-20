/**
 * assertSafeOutboundUrl: allows http(s) URLs whose host is not a private,
 * loopback, link-local or metadata address, or whose origin is in
 * OUTBOUND_PRIVATE_ORIGIN_ALLOWLIST. Allows loopback outside production.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const BLOCKED = (() => {
  const b = new BlockList();
  const v4: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
    ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
    ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  for (const [net, bits] of v4) b.addSubnet(net, bits, "ipv4");
  // fec0::/10 site-local; 64:ff9b::/96 NAT64.
  const v6: Array<[string, number]> = [["::", 128], ["::1", 128], ["fe80::", 10], ["fec0::", 10], ["fc00::", 7], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96]];
  for (const [net, bits] of v6) b.addSubnet(net, bits, "ipv6");
  return b;
})();

/** True for private, loopback, link-local, metadata and other non-public addresses. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return BLOCKED.check(ip, "ipv4");
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped?.[1]) return BLOCKED.check(mapped[1], "ipv4");
    return BLOCKED.check(ip, "ipv6");
  }
  return true;
}

function toOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function allowlistedOrigin(rawUrl: string): boolean {
  const origin = toOrigin(rawUrl);
  if (!origin) return false;
  return (process.env["OUTBOUND_PRIVATE_ORIGIN_ALLOWLIST"] ?? "")
    .split(",")
    .map((e) => toOrigin(e.trim()))
    .includes(origin);
}

export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  const isProd = process.env["NODE_ENV"] === "production";
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid request URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error("Missing request hostname");
  const loopback = host === "localhost" || host === "::1" || /^127\./.test(host);
  if (!isProd && loopback) return;
  if (allowlistedOrigin(rawUrl)) return;
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error(`Blocked destination address: ${host}`);
    return;
  }
  const resolved = await lookup(host, { all: true, verbatim: true });
  if (resolved.length === 0) throw new Error(`Could not resolve hostname: ${host}`);
  for (const { address } of resolved) {
    if (!isProd && (/^127\./.test(address) || address === "::1")) continue;
    if (isBlockedAddress(address)) throw new Error(`Blocked destination address: ${address}`);
  }
}
