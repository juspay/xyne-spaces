#!/usr/bin/env npx tsx
/**
 * Latency and source mix of Hub `POST /claw/api/v1/agents/suggest-tools`.
 * Requests run one at a time so the Grid key's parallel limit is never hit.
 * Run once with XOR_SUGGEST unset (XOR) and once with XOR_SUGGEST=off on the
 * server to compare against the LLM judge.
 *
 * Usage (from apps/xyne-claw-auth/backend; needs the server running):
 *   XYNE_CLAW_S2S_KEY=... BENCH_USER_ID=<user id> pnpm exec tsx scripts/benchmark-suggest.ts
 * Optional: AUTH_SERVICE_URL (default http://localhost:3003), BENCH_ROUNDS (default 3),
 *           BENCH_ORG_ID (sent as x-org-id when set).
 */

const base = (process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003").replace(/\/+$/, "");
const s2sKey = process.env["XYNE_CLAW_S2S_KEY"] ?? "";
const userId = process.env["BENCH_USER_ID"] ?? "";
const orgId = process.env["BENCH_ORG_ID"] ?? "";
const rounds = Math.max(1, Number(process.env["BENCH_ROUNDS"] ?? 3));

const INTENTS = [
  "Build an agent that watches our payment gateway success rate every 5 minutes and, when it drops below 95 percent, posts an alert in #oncall on Slack and opens a Jira ticket.",
  "Every morning research the latest design and UX news on the web and email me a short digest.",
  "A friendly writing coach that helps me brainstorm and polish essays. Chat only, no tools or integrations.",
  "Review open pull requests on GitHub every morning and post a summary in our Slack channel.",
  "Answer customer questions using our product documentation and cite the page.",
];

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

async function main(): Promise<void> {
  if (!s2sKey || !userId) {
    console.error("Set XYNE_CLAW_S2S_KEY and BENCH_USER_ID.");
    process.exit(2);
  }
  const bySource = new Map<string, number[]>();
  let failures = 0;
  for (let round = 0; round < rounds; round++) {
    for (const description of INTENTS) {
      const started = Date.now();
      try {
        const res = await fetch(`${base}/claw/api/v1/agents/suggest-tools`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-s2s-key": s2sKey,
            "x-user-id": userId,
            ...(orgId ? { "x-org-id": orgId } : {}),
          },
          body: JSON.stringify({ description }),
          signal: AbortSignal.timeout(50_000),
        });
        const ms = Date.now() - started;
        const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { source?: string } };
        if (!res.ok || !body.success) {
          failures += 1;
          console.error(`HTTP ${res.status} after ${ms}ms`);
          continue;
        }
        const source = body.data?.source ?? "unknown";
        bySource.set(source, [...(bySource.get(source) ?? []), ms]);
      } catch (err) {
        failures += 1;
        console.error(`request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const total = [...bySource.values()].reduce((n, v) => n + v.length, 0);
  console.log("source      calls  share   p50ms  p95ms");
  for (const [source, values] of [...bySource.entries()].sort()) {
    const share = total ? `${((values.length / total) * 100).toFixed(0)}%` : "-";
    console.log(
      `${source.padEnd(11)} ${String(values.length).padEnd(6)} ${share.padEnd(7)} ${String(quantile(values, 0.5)).padEnd(6)} ${quantile(values, 0.95)}`,
    );
  }
  console.log(`failures: ${failures}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
