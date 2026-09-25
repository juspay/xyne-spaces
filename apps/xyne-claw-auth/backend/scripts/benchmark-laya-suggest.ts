/**
 * Benchmark Laya gap shortlist vs full-catalog suggest path.
 *
 * Usage (from apps/xyne-claw-auth/backend):
 *   ENCRYPTION_KEY=… pnpm exec tsx scripts/benchmark-laya-suggest.ts
 *   LAYA_SUGGEST=off  ENCRYPTION_KEY=… pnpm exec tsx scripts/benchmark-laya-suggest.ts
 *   LAYA_SUGGEST=fast ENCRYPTION_KEY=… pnpm exec tsx scripts/benchmark-laya-suggest.ts
 *
 * Optional live claw closed-pick (needs claw + auth running + cookie/S2S):
 *   BENCH_LIVE=1 BENCH_USER_ID=… ENCRYPTION_KEY=… pnpm exec tsx scripts/benchmark-laya-suggest.ts
 */
import { performance } from "node:perf_hooks";
import {
  buildGapShortlist,
  defaultEmptyHubs,
  type SuggestCatalog,
} from "../src/lib/laya-authoring.js";
import { layaHealth, layaSuggestMode } from "../src/lib/laya-client.js";

const FIXTURES: Array<{ name: string; intent: string }> = [
  {
    name: "named-slack",
    intent: "Create a read-only Slack triage agent for support channels",
  },
  {
    name: "gap-queue",
    intent: "Watch the queue and ping me when something looks stuck",
  },
  {
    name: "gap-docs",
    intent: "Answer product questions from our internal docs and escalate unclear ones",
  },
  {
    name: "named-github",
    intent: "GitHub PR review agent that summarizes open pull requests",
  },
  {
    name: "vague",
    intent: "make me an agent",
  },
];

function sampleCatalog(): SuggestCatalog {
  return {
    subagents: [
      { name: "spaces", description: "Xyne Spaces search and messaging" },
      { name: "artifacts", description: "slides and decks" },
      { name: "google", description: "Gmail and Drive" },
    ],
    integrations: [
      {
        slug: "slack",
        label: "Slack",
        readTools: [
          { name: "list_channels", description: "list channels", riskLevel: "read" },
          { name: "get_history", description: "channel history", riskLevel: "read" },
        ],
        writeTools: [
          { name: "post_message", description: "post to channel", riskLevel: "write" },
        ],
      },
      {
        slug: "github",
        label: "GitHub",
        readTools: [
          { name: "list_prs", description: "list pull requests", riskLevel: "read" },
        ],
        writeTools: [],
      },
      {
        slug: "custom:email",
        label: "Email",
        readTools: [],
        writeTools: [
          { name: "send_email", description: "send email", riskLevel: "write" },
        ],
      },
      {
        slug: "notion",
        label: "Notion",
        readTools: [
          { name: "search_pages", description: "search pages", riskLevel: "read" },
        ],
        writeTools: [],
      },
    ],
  };
}

async function liveSuggest(intent: string): Promise<{ ms: number; ok: boolean; error?: string }> {
  const authUrl = (process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003").replace(/\/+$/, "");
  const s2s = process.env["XYNE_CLAW_S2S_KEY"] ?? "";
  const userId = process.env["BENCH_USER_ID"] ?? "";
  const started = performance.now();
  try {
    const res = await fetch(`${authUrl}/api/v1/agents/suggest-tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(s2s ? { "x-s2s-key": s2s } : {}),
        ...(userId ? { "x-user-id": userId } : {}),
      },
      body: JSON.stringify({ description: intent }),
      signal: AbortSignal.timeout(50_000),
    });
    const ms = Math.round(performance.now() - started);
    if (!res.ok) {
      return { ms, ok: false, error: `HTTP ${res.status}` };
    }
    return { ms, ok: true };
  } catch (err) {
    return {
      ms: Math.round(performance.now() - started),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const mode = layaSuggestMode();
  const healthy = await layaHealth();
  const catalog = sampleCatalog();
  const skills = [
    { slug: "ticket-triage", name: "Ticket triage", description: "triage support tickets" },
    { slug: "pr-review", name: "PR review", description: "review pull requests" },
  ];
  const emptyHubs = defaultEmptyHubs(catalog, true);
  const rounds = Math.max(1, Number(process.env["BENCH_ROUNDS"] ?? 3));
  const live = process.env["BENCH_LIVE"] === "1";

  console.log(
    JSON.stringify(
      {
        mode,
        layaHealthy: healthy,
        rounds,
        live,
        emptyHubs,
      },
      null,
      2,
    ),
  );

  const rows: Array<Record<string, unknown>> = [];

  for (const fixture of FIXTURES) {
    const times: number[] = [];
    let lastShortlist = 0;
    let lastFallback = "";
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      const gap = await buildGapShortlist({
        intent: fixture.intent,
        catalog,
        skills,
        emptyHubs,
        surface: "hub",
      });
      times.push(Math.round(performance.now() - t0));
      lastShortlist = gap.shortlistIds.length;
      lastFallback = gap.fallback;
    }
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)]!;
    const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)]!;
    const row: Record<string, unknown> = {
      fixture: fixture.name,
      shortlistMs_p50: p50,
      shortlistMs_p95: p95,
      shortlistCount: lastShortlist,
      fallback: lastFallback,
    };
    if (live) {
      const liveRes = await liveSuggest(fixture.intent);
      row.liveSuggestMs = liveRes.ms;
      row.liveOk = liveRes.ok;
      if (liveRes.error) row.liveError = liveRes.error;
    }
    rows.push(row);
  }

  console.log("\nResults");
  console.table(rows);
  console.log(
    "\nHow to read: shortlistMs is Laya/lexical gap fill only. liveSuggestMs is full /suggest-tools (shortlist + closed LLM pick) when BENCH_LIVE=1.",
  );
  console.log(
    "Baseline compare: run once with LAYA_SUGGEST=off BENCH_LIVE=1, then LAYA_SUGGEST=fast BENCH_LIVE=1.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
