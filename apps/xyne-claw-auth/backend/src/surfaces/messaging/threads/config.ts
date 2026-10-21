import type { ChannelAccount } from "../plugin.js";

/**
 * Per-account gate for the concurrent-threads path, on top of the plugin's
 * `concurrentThreads` capability. Driven by WA_CONCURRENT_THREADS so a number
 * can be switched on one at a time without a schema or UI change:
 *   unset / "off" / ""  → nobody (default; every chat keeps the serial path)
 *   "on" / "all"        → every account whose plugin advertises the capability
 *   "<id>,<key>,…"       → only accounts whose id or accountKey is listed
 */
export function threadsEnabled(account: Pick<ChannelAccount, "id" | "accountKey">): boolean {
  const raw = (process.env["WA_CONCURRENT_THREADS"] ?? "").trim().toLowerCase();
  if (!raw || raw === "off" || raw === "false" || raw === "0") return false;
  if (raw === "on" || raw === "all" || raw === "true" || raw === "1") return true;
  const allow = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return allow.has(account.id.toLowerCase()) || allow.has(account.accountKey.toLowerCase());
}
