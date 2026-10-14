/**
 * Outbound address policy shared by claw-auth (safe-fetch, MCP gateway
 * http-client) and the claw runtime. One deny list, one IPv4-mapped decoder,
 * one connect-time guard, so the services cannot drift on what "internal" means.
 *
 * The connect-time guard (`createPublicOnlyLookup`) is what closes DNS
 * rebinding: a pre-flight check resolves a name and approves it, but a plain
 * `fetch` resolves it AGAIN when it dials. Plugging this lookup into an undici
 * `Agent({ connect: { lookup } })` makes the address that is actually dialled
 * the one that is checked — for the first request, every redirect hop and
 * every keep-alive reconnect.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, isIPv6 } from "node:net";

export interface ResolvedAddress {
  address: string;
  family: number;
}

function blockList(v4: Array<[string, number]>, v6: Array<[string, number]>): BlockList {
  const list = new BlockList();
  for (const [net, bits] of v4) list.addSubnet(net, bits, "ipv4");
  for (const [net, bits] of v6) list.addSubnet(net, bits, "ipv6");
  return list;
}

const denied = blockList(
  [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
   ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
   ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]],
  [["::", 128], ["::1", 128], ["fe80::", 10], ["fc00::", 7], ["ff00::", 8], ["2001:db8::", 32]],
);
const loopback = blockList([["127.0.0.0", 8]], [["::1", 128]]);

/** `::ffff:127.0.0.1` and `::ffff:7f00:1` are both 127.0.0.1 wearing a hat. */
function ipv4Mapped(ip: string): string | null {
  const bare = (ip.toLowerCase().split("%")[0] ?? "").replace(/^\[|\]$/g, "");
  const dotted = bare.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1] as string;
  const hex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1] as string, 16);
  const lo = Number.parseInt(hex[2] as string, 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function inList(list: BlockList, ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const mapped = isIPv6(bare) ? ipv4Mapped(bare) : null;
  const target = mapped ?? bare;
  const family = isIP(target);
  if (family === 0) return true;
  return list.check(target, family === 4 ? "ipv4" : "ipv6");
}

/** True for loopback, RFC1918, link-local/metadata, CGNAT, ULA, multicast,
 *  documentation and reserved ranges — and for anything that is not an IP. */
export function isBlockedIpAddress(ip: string): boolean {
  return inList(denied, ip);
}

export function isLoopbackAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  return isIP(bare) !== 0 && inList(loopback, bare);
}

export async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const entries = await dnsLookup(hostname, { all: true, verbatim: true });
  return entries.map((entry) => ({ address: entry.address, family: entry.family }));
}

export interface PublicOnlyLookupOptions {
  /** Injected resolver (tests). Defaults to the system resolver. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Permit loopback answers (local development only — callers gate on NODE_ENV). */
  allowLoopback?: boolean;
}

export type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: number,
) => void;

export type ConnectLookup = (
  hostname: string,
  options: { all?: boolean | undefined } | undefined,
  callback: LookupCallback,
) => void;

/** Error raised at connect time when a name resolves to a blocked address. */
export function blockedAddressError(hostname: string, address: string): NodeJS.ErrnoException {
  const err = new Error(`Blocked destination address: ${address} (${hostname})`) as NodeJS.ErrnoException;
  err.code = "EBLOCKED";
  return err;
}

/**
 * A `net.connect`-compatible `lookup` that resolves the host and refuses the
 * connection if ANY answer is in a blocked range. Use as
 * `new Agent({ connect: { lookup: createPublicOnlyLookup() } })`.
 *
 * Note: Node skips `lookup` for IP-literal hosts, so literals must also be
 * rejected before dialling (assertSafeOutboundUrl / guardUserBaseUrl do that).
 */
export function createPublicOnlyLookup(opts: PublicOnlyLookupOptions = {}): ConnectLookup {
  const resolve = opts.resolve ?? defaultResolve;
  return (hostname, options, callback) => {
    const host = hostname.replace(/^\[|\]$/g, "");
    const literal = isIP(host);
    const pending: Promise<ResolvedAddress[]> = literal !== 0
      ? Promise.resolve([{ address: host, family: literal }])
      : resolve(host);
    pending.then(
      (entries) => {
        if (entries.length === 0) {
          const err = new Error(`Could not resolve hostname: ${host}`) as NodeJS.ErrnoException;
          err.code = "ENOTFOUND";
          callback(err, "");
          return;
        }
        for (const entry of entries) {
          if (opts.allowLoopback && isLoopbackAddress(entry.address)) continue;
          if (isBlockedIpAddress(entry.address)) {
            callback(blockedAddressError(host, entry.address), "");
            return;
          }
        }
        const first = entries[0] as ResolvedAddress;
        if (options?.all) callback(null, entries);
        else callback(null, first.address, first.family);
      },
      (err: unknown) => callback(err as NodeJS.ErrnoException, ""),
    );
  };
}
