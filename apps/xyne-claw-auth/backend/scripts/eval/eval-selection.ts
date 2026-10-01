#!/usr/bin/env npx tsx
/**
 * Hub selection accuracy eval. Runs the PRODUCTION selector
 * (src/lib/tool-selection.ts: pools → questions → thresholds) over the golden
 * set with a pluggable judge:
 *   EVAL_JUDGE=heuristic (default)  BM25-rank stand-in, no network
 *   EVAL_JUDGE=xor                  real XOR via Grid (needs XOR_API_KEY)
 *
 * Usage (from apps/xyne-claw-auth/backend):
 *   pnpm exec tsx scripts/eval/eval-selection.ts
 *   EVAL_JUDGE=xor XOR_MAX_PARALLEL=0 pnpm exec tsx --env-file=.env \
 *     scripts/eval/eval-selection.ts --cache files/eval/xor.json
 *   ... --sweep     re-score the cached answers over a threshold grid, no new calls
 *   ... --verbose   print every job with a miss or a false bind
 *
 * XOR_MAX_PARALLEL=0 turns off the Redis slot gate, so the eval needs no Redis.
 * Exits non-zero when the stage-E gate fails.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bm25Rank } from "../../src/lib/bm25.js";
import {
  enrichIntegrationDoc,
  enrichKnowledgeDoc,
  enrichSkillDoc,
  enrichSubagentDoc,
} from "../../src/lib/selection-docs.js";
import { SHORTLIST_TOP_K } from "../../src/lib/selection-thresholds.js";
import {
  ALL_HUBS,
  buildPools,
  buildQuestions,
  planFromAnswers,
  questionState,
  type BuiltQuestions,
  type Hub,
  type SelectionInput,
  type SelectionPlan,
} from "../../src/lib/tool-selection.js";
import { xorAsk, type XorAnswers } from "../../src/lib/xor-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface HubLabel {
  required: string[];
  acceptable: string[];
  none: boolean;
}

interface GoldenJob {
  id: string;
  intent: string;
  labels: Record<string, HubLabel>;
  tags?: string[];
}

/** Toy catalog matching golden aliases. */
const TOY = {
  subagents: [
    { name: "web-research", description: "Delegates web research and competitor look-ups" },
    { name: "spaces", description: "Xyne Spaces specialist" },
    { name: "artifacts", description: "Builds slides and artifacts" },
  ],
  integrations: [
    {
      slug: "slack",
      label: "Slack",
      readTools: [{ name: "list_channels", description: "list channels" }],
      writeTools: [{ name: "post_message", description: "post to channel" }],
    },
    {
      slug: "github",
      label: "GitHub",
      readTools: [{ name: "list_prs", description: "list pull requests" }],
      writeTools: [{ name: "comment_pr", description: "comment on PR" }],
    },
    {
      slug: "jira",
      label: "Jira",
      readTools: [{ name: "list_issues", description: "list tickets" }],
      writeTools: [],
    },
    {
      slug: "gmail",
      label: "Gmail",
      readTools: [{ name: "list_inbox", description: "read inbox" }],
      writeTools: [{ name: "send_mail", description: "send email" }],
    },
    {
      slug: "outlook",
      label: "Outlook",
      readTools: [],
      writeTools: [{ name: "send_outlook", description: "send outlook email" }],
    },
    {
      slug: "notion",
      label: "Notion",
      readTools: [{ name: "search", description: "search pages" }],
      writeTools: [],
    },
    {
      slug: "linear",
      label: "Linear",
      readTools: [{ name: "list_issues", description: "eng backlog" }],
      writeTools: [],
    },
    {
      slug: "discord",
      label: "Discord",
      readTools: [{ name: "list_messages", description: "moderate messages" }],
      writeTools: [],
    },
    {
      slug: "teams",
      label: "Microsoft Teams",
      readTools: [],
      writeTools: [{ name: "post", description: "post updates" }],
    },
    {
      slug: "calendar",
      label: "Google Calendar",
      readTools: [{ name: "list_events", description: "list meetings" }],
      writeTools: [{ name: "create_event", description: "schedule meeting" }],
    },
    {
      slug: "confluence",
      label: "Confluence",
      readTools: [{ name: "search_wiki", description: "search wiki" }],
      writeTools: [],
    },
    {
      slug: "twitter",
      label: "X / Twitter",
      readTools: [{ name: "search_tweets", description: "from x.com" }],
      writeTools: [],
    },
    {
      slug: "spaces",
      label: "Xyne Spaces",
      readTools: [{ name: "list_dms", description: "spaces dms" }],
      writeTools: [{ name: "send_dm", description: "send spaces dm" }],
    },
    {
      slug: "custom:email",
      label: "Send email",
      readTools: [],
      writeTools: [{ name: "send_email", description: "send email digest" }],
    },
    {
      slug: "custom:web-search",
      label: "Web search",
      readTools: [{ name: "web_search", description: "search the web" }],
      writeTools: [],
    },
    {
      slug: "custom:send-message",
      label: "Send message",
      readTools: [],
      writeTools: [{ name: "send_message", description: "send direct message" }],
    },
    {
      slug: "custom:code",
      label: "Code / data",
      readTools: [{ name: "analyze_csv", description: "analyze csv chart calculate" }],
      writeTools: [],
    },
    {
      slug: "custom:image",
      label: "Generate image",
      readTools: [],
      writeTools: [{ name: "generate_image", description: "generate image" }],
    },
  ],
  skills: [
    {
      slug: "api-design-review",
      name: "API design review",
      description: "Review API design documents and OpenAPI specs",
      content: "Use when reviewing API design",
    },
    {
      slug: "ticket-triage",
      name: "Ticket triage",
      description: "Triage Jira tickets and issue trackers",
      content: "Use when triaging tickets",
    },
  ],
  knowledge: [{ id: "product-docs", name: "Product docs" }],
};


const CATALOG: SelectionInput["catalog"] = {
  subagents: TOY.subagents,
  integrations: TOY.integrations.map((i) => ({
    slug: i.slug,
    label: i.label,
    readTools: i.readTools.map((t) => ({ ...t, riskLevel: "read" })),
    writeTools: i.writeTools.map((t) => ({ ...t, riskLevel: "write" })),
  })),
};

function inputFor(job: GoldenJob): SelectionInput {
  return {
    intent: job.intent,
    namedText: job.intent,
    catalog: CATALOG,
    skills: TOY.skills,
    knowledge: TOY.knowledge,
    hubs: [...ALL_HUBS],
  };
}

function stageCIds(hub: Hub, intent: string): string[] {
  const top = (docs: Array<{ id: string; text: string }>): string[] =>
    bm25Rank(intent, docs, { topK: SHORTLIST_TOP_K }).map((h) => h.id);
  if (hub === "subagent") return top(TOY.subagents.map(enrichSubagentDoc));
  if (hub === "skill") return top(TOY.skills.map(enrichSkillDoc));
  if (hub === "knowledge") return top(TOY.knowledge.map(enrichKnowledgeDoc));
  const pool =
    hub === "builtin"
      ? TOY.integrations.filter((i) => i.slug.startsWith("custom:"))
      : TOY.integrations.filter((i) => !i.slug.startsWith("custom:"));
  return top(pool.map(enrichIntegrationDoc));
}

function aliasMatch(id: string, wanted: string[]): boolean {
  const n = id.toLowerCase();
  return wanted.some((w) => {
    const ww = w.toLowerCase();
    return n === ww || n.includes(ww) || ww.includes(n);
  });
}

/** No-network stand-in: named → 1.0, otherwise decays with BM25 rank inside the hub. */
function heuristicAnswers(input: SelectionInput, built: BuiltQuestions): XorAnswers {
  const out: XorAnswers = {};
  const lower = input.intent.toLowerCase();
  const writeVerb = /\b(create|update|edit|send|post|schedule|upload|write|triage|reply|comment|draft)\b/i.test(input.intent);
  const ordered = new Map<Hub, string[]>(ALL_HUBS.map((hub) => [hub, stageCIds(hub, input.intent)]));
  for (const [qid, m] of built.meta) {
    if (m.kind === "write") {
      out[qid] = { noul: writeVerb ? 0.6 : 0.1 };
      continue;
    }
    const pos = (ordered.get(m.hub) ?? []).indexOf(m.id);
    const named = lower.includes(m.id.toLowerCase()) || lower.includes(m.id.replace(/^custom:/, "").replace(/-/g, " "));
    out[qid] = { noul: named ? 1 : pos < 0 ? 0.1 : Math.max(0.35, 0.9 - pos * 0.08) };
  }
  return out;
}

function loadJobs(): GoldenJob[] {
  const path = join(__dirname, "selection-golden.jsonl");
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldenJob);
}

interface JobRun {
  job: GoldenJob;
  input: SelectionInput;
  built: BuiltQuestions;
  answers: XorAnswers | null;
  ms: number | null;
}

interface Scores {
  jobs: number;
  stageC: { recallAt8: number; compAt8: number };
  stageE: {
    autoBoundPrecision: number;
    requiredRecallBound: number;
    requiredRecallAll: number;
    noneAccuracyBound: number;
    noneAccuracyStrict: number;
    namedHitRate: number;
    unknownIdRate: number;
  };
  misses: string[];
}

function score(runs: JobRun[]): Scores {
  const catalogIds = new Set([
    ...TOY.subagents.map((s) => s.name),
    ...TOY.integrations.map((i) => i.slug),
    ...TOY.skills.map((s) => s.slug),
    ...TOY.knowledge.map((k) => k.id),
  ]);
  let recallSum = 0, recallN = 0, compSum = 0, compN = 0;
  let precHit = 0, precTotal = 0;
  let reqBound = 0, reqAll = 0, reqTotal = 0;
  let noneBound = 0, noneStrict = 0, noneTotal = 0;
  let namedOk = 0, namedTotal = 0;
  let picksTotal = 0, unknown = 0;
  const misses: string[] = [];

  for (const run of runs) {
    const { job, input } = run;
    const pools = buildPools(input);
    const plan: SelectionPlan = run.answers
      ? planFromAnswers(input, pools, run.built, run.answers)
      : planFromAnswers(input, pools, run.built, {});
    for (const hub of ALL_HUBS) {
      const label = job.labels[hub];
      if (!label) continue;
      const required = label.required;
      const acceptable = [...label.required, ...label.acceptable];
      const sel = plan.hubs[hub];
      const boundIds = sel.bound.map((p) => p.id);
      const allIds = [...boundIds, ...sel.suggested.map((p) => p.id)];

      const stageC = stageCIds(hub, job.intent);
      if (required.length > 0) {
        const found = required.filter((r) => stageC.some((id) => aliasMatch(id, [r]))).length;
        recallSum += found / required.length;
        recallN += 1;
        compSum += found === required.length ? 1 : 0;
        compN += 1;
      }

      for (const p of [...sel.bound, ...sel.suggested]) {
        picksTotal += 1;
        if (![...catalogIds].some((c) => c === p.id)) unknown += 1;
      }
      for (const id of boundIds) {
        precTotal += 1;
        if (aliasMatch(id, acceptable)) precHit += 1;
        else misses.push(`${job.id}/${hub}: false bind ${id}`);
      }
      for (const r of required) {
        reqTotal += 1;
        if (boundIds.some((id) => aliasMatch(id, [r]))) reqBound += 1;
        if (allIds.some((id) => aliasMatch(id, [r]))) reqAll += 1;
        else misses.push(`${job.id}/${hub}: missed ${r}`);
      }
      if (label.none) {
        noneTotal += 1;
        if (boundIds.length === 0) noneBound += 1;
        else misses.push(`${job.id}/${hub}: expected none, bound ${boundIds.join(",")}`);
        if (allIds.length === 0) noneStrict += 1;
      }
      if (job.tags?.includes("named") && required.length > 0 && (hub === "mcp" || hub === "skill")) {
        namedTotal += 1;
        if (required.every((r) => boundIds.some((id) => aliasMatch(id, [r])))) namedOk += 1;
      }
    }
  }
  const ratio = (a: number, b: number): number => (b ? a / b : 1);
  return {
    jobs: runs.length,
    stageC: { recallAt8: ratio(recallSum, recallN), compAt8: ratio(compSum, compN) },
    stageE: {
      autoBoundPrecision: ratio(precHit, precTotal),
      requiredRecallBound: ratio(reqBound, reqTotal),
      requiredRecallAll: ratio(reqAll, reqTotal),
      noneAccuracyBound: ratio(noneBound, noneTotal),
      noneAccuracyStrict: ratio(noneStrict, noneTotal),
      namedHitRate: ratio(namedOk, namedTotal),
      unknownIdRate: ratio(unknown, picksTotal),
    },
    misses,
  };
}

const TARGETS = {
  recallAt8: 0.9,
  compAt8: 0.85,
  autoBoundPrecision: 0.9,
  requiredRecallBound: 0.75,
  requiredRecallAll: 0.9,
  noneAccuracyBound: 0.95,
  namedHitRate: 1.0,
  unknownIdRate: 0,
} as const;

function gate(s: Scores): boolean {
  return (
    s.stageC.recallAt8 >= TARGETS.recallAt8 &&
    s.stageC.compAt8 >= TARGETS.compAt8 &&
    s.stageE.autoBoundPrecision >= TARGETS.autoBoundPrecision &&
    s.stageE.requiredRecallBound >= TARGETS.requiredRecallBound &&
    s.stageE.requiredRecallAll >= TARGETS.requiredRecallAll &&
    s.stageE.noneAccuracyBound >= TARGETS.noneAccuracyBound &&
    s.stageE.namedHitRate >= TARGETS.namedHitRate &&
    s.stageE.unknownIdRate <= TARGETS.unknownIdRate
  );
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : (process.argv[i + 1] ?? "");
}

async function main(): Promise<void> {
  const judge = (process.env["EVAL_JUDGE"] ?? "heuristic").toLowerCase();
  if (judge !== "heuristic" && judge !== "xor") throw new Error(`EVAL_JUDGE must be heuristic or xor (got ${judge})`);
  const cachePath = flag("--cache");
  const cache: Record<string, XorAnswers> =
    cachePath && existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, XorAnswers>) : {};

  const runs: JobRun[] = [];
  let failures = 0;
  for (const job of loadJobs()) {
    const input = inputFor(job);
    const built = buildQuestions(buildPools(input), input);
    let answers: XorAnswers | null;
    let ms: number | null = null;
    if (judge === "heuristic") {
      answers = heuristicAnswers(input, built);
    } else if (cache[job.id]) {
      answers = cache[job.id]!;
    } else {
      const started = Date.now();
      answers = await xorAsk(questionState(input.intent), built.questions, { purpose: "eval", timeoutMs: 8_000 });
      ms = Date.now() - started;
      if (answers) cache[job.id] = answers;
      else failures += 1;
    }
    runs.push({ job, input, built, answers, ms });
  }
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  }

  if (process.argv.includes("--sweep")) {
    console.log("autoBind  suggestMin  precision  reqRecall(bound)  reqRecall(all)  none(bound)");
    for (const autoBind of [0.6, 0.7, 0.75, 0.8, 0.85, 0.9]) {
      for (const suggestMin of [0.3, 0.4, 0.5, 0.6]) {
        if (suggestMin >= autoBind) continue;
        process.env["XOR_TH_AUTO_BIND"] = String(autoBind);
        process.env["XOR_TH_SUGGEST_MIN"] = String(suggestMin);
        const s = score(runs).stageE;
        console.log(
          `${autoBind.toFixed(2)}      ${suggestMin.toFixed(2)}        ${pct(s.autoBoundPrecision).padEnd(9)}  ${pct(s.requiredRecallBound).padEnd(16)}  ${pct(s.requiredRecallAll).padEnd(14)}  ${pct(s.noneAccuracyBound)}`,
        );
      }
    }
    return;
  }

  const scores = score(runs);
  const latencies = runs.map((r) => r.ms).filter((m): m is number => m !== null);
  const passed = gate(scores);
  console.log(
    JSON.stringify(
      {
        judge,
        ...scores,
        misses: undefined,
        targets: TARGETS,
        latencyMs: { calls: latencies.length, failures, p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95) },
        gate: { passed },
      },
      null,
      2,
    ),
  );
  if (process.argv.includes("--verbose")) for (const m of scores.misses) console.log(`  ${m}`);
  if (!passed) {
    console.error("\n[gate] Stage E below target for this judge. See --verbose for the misses.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
