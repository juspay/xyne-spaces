#!/usr/bin/env npx tsx
/**
 * Hub selection accuracy eval — stage C (BM25) + thresholded stage E metrics.
 * Replaces latency-only benchmark-laya-suggest.ts as the primary gate.
 *
 * Usage:
 *   pnpm exec tsx scripts/eval/eval-selection.ts
 *   (from apps/xyne-claw-auth/backend)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bm25Rank } from "../../src/lib/bm25.js";
import {
  enrichIntegrationDoc,
  enrichSkillDoc,
  enrichSubagentDoc,
  enrichKnowledgeDoc,
} from "../../src/lib/selection-docs.js";
import {
  applyBuiltinThresholds,
  applyMcpThresholds,
  applySkillThresholds,
  applySubagentThresholds,
  SHORTLIST_TOP_K,
  type JudgedPick,
} from "../../src/lib/selection-thresholds.js";

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

function aliasMatch(id: string, wanted: string[]): boolean {
  const n = id.toLowerCase();
  return wanted.some((w) => {
    const ww = w.toLowerCase();
    return n === ww || n.includes(ww) || ww.includes(n);
  });
}

function stageCIds(hub: string, intent: string): string[] {
  if (hub === "subagent") {
    const docs = TOY.subagents.map(enrichSubagentDoc);
    return bm25Rank(intent, docs, { topK: SHORTLIST_TOP_K }).map((h) => h.id);
  }
  if (hub === "skill") {
    const docs = TOY.skills.map(enrichSkillDoc);
    return bm25Rank(intent, docs, { topK: SHORTLIST_TOP_K }).map((h) => h.id);
  }
  if (hub === "knowledge") {
    const docs = TOY.knowledge.map(enrichKnowledgeDoc);
    return bm25Rank(intent, docs, { topK: SHORTLIST_TOP_K }).map((h) => h.id);
  }
  const pool =
    hub === "builtin"
      ? TOY.integrations.filter((i) => i.slug.startsWith("custom:"))
      : TOY.integrations.filter((i) => !i.slug.startsWith("custom:"));
  const docs = pool.map(enrichIntegrationDoc);
  return bm25Rank(intent, docs, { topK: SHORTLIST_TOP_K }).map((h) => h.id);
}

/** Heuristic judge: BM25 score normalized + named boost → confidence. */
function heuristicJudge(hub: string, intent: string, candidateIds: string[]): JudgedPick[] {
  const lower = intent.toLowerCase();
  return candidateIds.map((id, idx) => {
    const named =
      lower.includes(id.toLowerCase()) ||
      lower.includes(id.replace(/^custom:/, "").replace(/-/g, " "));
    const confidence = named ? 1.0 : Math.max(0.35, 0.9 - idx * 0.08);
    return {
      id,
      confidence,
      reason: named ? `Named in intent` : `BM25 rank ${idx + 1}`,
    };
  });
}

function applyHub(hub: string, picks: JudgedPick[]) {
  if (hub === "subagent") return applySubagentThresholds(picks);
  if (hub === "skill" || hub === "knowledge") return applySkillThresholds(picks);
  if (hub === "builtin") {
    const ruleIds = new Set(
      picks.filter((p) => p.confidence >= 0.6).map((p) => p.id),
    );
    return applyBuiltinThresholds(picks, ruleIds);
  }
  return applyMcpThresholds(picks);
}

function loadJobs(): GoldenJob[] {
  const path = join(__dirname, "selection-golden.jsonl");
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldenJob);
}

function main(): void {
  const jobs = loadJobs();
  const hubs = ["mcp", "builtin", "subagent", "skill", "knowledge"] as const;

  let recallAt8Sum = 0;
  let recallAt8N = 0;
  let compAt8Sum = 0;
  let compAt8N = 0;
  let autoPrecHits = 0;
  let autoPrecTotal = 0;
  let reqRecallHits = 0;
  let reqRecallTotal = 0;
  let noneOk = 0;
  let noneTotal = 0;
  let namedOk = 0;
  let namedTotal = 0;
  let unknownIds = 0;

  const catalogIds = new Set([
    ...TOY.subagents.map((s) => s.name),
    ...TOY.integrations.map((i) => i.slug),
    ...TOY.skills.map((s) => s.slug),
    ...TOY.knowledge.map((k) => k.id),
  ]);

  for (const job of jobs) {
    for (const hub of hubs) {
      const label = job.labels[hub];
      if (!label) continue;
      const stageC = stageCIds(hub, job.intent);
      const required = label.required;
      const acceptable = [...label.required, ...label.acceptable];

      if (required.length > 0) {
        const hit = required.every((r) => stageC.some((id) => aliasMatch(id, [r])));
        recallAt8Sum += required.filter((r) => stageC.some((id) => aliasMatch(id, [r]))).length /
          required.length;
        recallAt8N += 1;
        compAt8Sum += hit ? 1 : 0;
        compAt8N += 1;
      }

      const picks = heuristicJudge(hub, job.intent, stageC);
      for (const p of picks) {
        if (!catalogIds.has(p.id) && ![...catalogIds].some((c) => aliasMatch(c, [p.id]))) {
          unknownIds += 1;
        }
      }
      const applied = applyHub(hub, picks);
      const boundIds = applied.bound.map((p) => p.id);
      const allIds = [...boundIds, ...applied.suggested.map((p) => p.id)];

      if (boundIds.length > 0) {
        for (const id of boundIds) {
          autoPrecTotal += 1;
          if (acceptable.length === 0 || aliasMatch(id, acceptable) || !label.none) {
            // Precision: bound item should be in acceptable/required when labeled.
            if (acceptable.length === 0) {
              if (label.none) {
                /* false positive */
              } else autoPrecHits += 1;
            } else if (aliasMatch(id, acceptable)) {
              autoPrecHits += 1;
            }
          }
        }
      }

      if (required.length > 0) {
        for (const r of required) {
          reqRecallTotal += 1;
          if (allIds.some((id) => aliasMatch(id, [r]))) reqRecallHits += 1;
        }
      }

      if (label.none) {
        noneTotal += 1;
        if (boundIds.length === 0) noneOk += 1;
      }

      if (job.tags?.includes("named") && required.length > 0 && hub === "mcp") {
        namedTotal += 1;
        if (required.every((r) => allIds.some((id) => aliasMatch(id, [r])) || stageC.some((id) => aliasMatch(id, [r])))) {
          namedOk += 1;
        }
      }
      if (job.tags?.includes("named") && required.length > 0 && hub === "skill") {
        namedTotal += 1;
        if (required.every((r) => allIds.some((id) => aliasMatch(id, [r])) || stageC.some((id) => aliasMatch(id, [r])))) {
          namedOk += 1;
        }
      }
    }
  }

  const metrics = {
    jobs: jobs.length,
    stageC: {
      recallAt8: recallAt8N ? recallAt8Sum / recallAt8N : 1,
      compAt8: compAt8N ? compAt8Sum / compAt8N : 1,
    },
    stageE: {
      autoBoundPrecision: autoPrecTotal ? autoPrecHits / autoPrecTotal : 1,
      requiredRecall: reqRecallTotal ? reqRecallHits / reqRecallTotal : 1,
      noneAccuracy: noneTotal ? noneOk / noneTotal : 1,
      namedHitRate: namedTotal ? namedOk / namedTotal : 1,
      unknownIdRate: unknownIds === 0 ? 0 : unknownIds,
    },
    targets: {
      recallAt8: 0.9,
      compAt8: 0.85,
      autoBoundPrecision: 0.9,
      requiredRecall: 0.8,
      noneAccuracy: 0.95,
      namedHitRate: 1.0,
      unknownIdRate: 0,
    },
    gate: {
      /** Switch LAYA_SUGGEST from shadow→fast only when stage C beats targets. */
      stageCBeatsTargets: false,
      layaSuggestDefault: "shadow",
    },
  };

  metrics.gate.stageCBeatsTargets =
    metrics.stageC.recallAt8 >= metrics.targets.recallAt8 &&
    metrics.stageC.compAt8 >= metrics.targets.compAt8;

  console.log(JSON.stringify(metrics, null, 2));
  if (!metrics.gate.stageCBeatsTargets) {
    console.error(
      "\n[gate] Stage C below target — keep LAYA_SUGGEST=shadow (do not flip to fast).",
    );
  }
}

main();
