import { createHash } from "node:crypto";

/**
 * Deterministic BullMQ job id for one agent's weekly synthesis pass.
 *
 * Kept free of imports so the rule can be tested on its own. It is the dedupe
 * for the whole pipeline: same (org, agent, week) must yield the same id, or the
 * weekly cron and a manual bulk trigger both synthesize the same agent and the
 * two passes leave duplicate `kind:usage` blobs in the bank.
 *
 * Two production facts constrain the format. BullMQ rejects a custom id
 * containing ":" (its own key delimiter) — the agent-backfill queue shipped with
 * colons and every backfill 500'd until that was found. And slugs are not
 * otherwise id-safe: one prod slug is "burp owners changed plains text". So the
 * readable half is sanitized for whoever is reading the BullMQ dashboard, and a
 * hash of the true (orgId, slug) pair carries the uniqueness, which keeps two
 * slugs that sanitize alike from silently sharing one job.
 */
export function usagePatternJobId(orgId: string, agentSlug: string, bucket: string): string {
  const readable = agentSlug.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48).replace(/^-+|-+$/g, "") || "agent";
  const hash = createHash("sha1").update(`${orgId} ${agentSlug}`).digest("hex").slice(0, 12);
  return `usage-patterns_${bucket}_${readable}_${hash}`;
}
