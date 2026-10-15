import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildSandboxStoreKey, getSandboxSession, sandboxConversationIdFromMeta } from "xyne-claw-shared";
import { xor } from "../xor.js";
import { createLogger } from "../logger.js";
import { metric } from "../metrics.js";
import { DOM_AUDIT_SOURCE, ENDPOINT_TYPES_SOURCE, HARNESS_SOURCE } from "./harness.js";
import {
  buildQuestions,
  formatReport,
  judgeVariation,
  type CustomCheck,
  type VariationResult,
  type VariationVerdict,
} from "./checks.js";

const log = createLogger("ui-tester");

export const UI_TESTER_SOURCE = "custom:ui-tester";
export const UI_TESTER_TOOL_NAMES = ["ui-test-variations", "visual-check"] as const;
export const UI_TESTER_SANDBOX_TOOL_NAMES = new Set([
  "sandbox-create",
  "sandbox-run",
  "sandbox-run-detached",
  "sandbox-poll-job",
  "sandbox-read-file",
  "sandbox-write-file",
  "sandbox-deliver-files",
]);

const MAX_VARIATIONS = 30;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const VISUAL_CONCURRENCY = 8;
const VISUAL_STATE = "Screenshot of a page in a web application.";

type SandboxSession = NonNullable<ReturnType<typeof getSandboxSession>>;

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }], details: {} };
}

function sessionFor(meta: Record<string, string>): SandboxSession | undefined {
  const key = buildSandboxStoreKey(meta["userId"], sandboxConversationIdFromMeta(meta), meta["agentSlug"]);
  return key ? getSandboxSession(key) : undefined;
}

const NO_SANDBOX =
  "Error: no sandbox session for this conversation. Create one first with sandbox-create (or sandbox-repo-setup), start the app there, then call this tool again.";

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function screenshotDataUrl(session: SandboxSession, path: string): Promise<string | null> {
  try {
    const buf = await session.files.read(path);
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    const mime = /\.jpe?g$/i.test(path) ? "jpeg" : /\.webp$/i.test(path) ? "webp" : "png";
    return `data:image/${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function judgeAll(session: SandboxSession, results: VariationResult[], visual: boolean, signal?: AbortSignal): Promise<VariationVerdict[]> {
  return mapLimit(results, VISUAL_CONCURRENCY, async (r) => {
    if (!visual || !r.screenshot) return judgeVariation(r, visual ? null : {});
    const image = await screenshotDataUrl(session, r.screenshot);
    const answers = image
      ? await xor({ state: VISUAL_STATE, images: [image], questions: buildQuestions(r), purpose: "ui-tester", signal })
      : null;
    return judgeVariation(r, answers);
  });
}

async function endpointContracts(session: SandboxSession, runDir: string, sourceDir: string, results: VariationResult[]): Promise<string> {
  const endpoints = [...new Set(results.flatMap((r) => (r.unmatchedRequests ?? []).map((u) => u.split(" ").pop() ?? u)))].slice(0, 15);
  if (endpoints.length === 0) return "";
  try {
    await session.files.write(`${runDir}/endpoints.cjs`, Buffer.from(ENDPOINT_TYPES_SOURCE, "utf8"));
    await session.files.write(`${runDir}/endpoints.json`, Buffer.from(JSON.stringify(endpoints), "utf8"));
    const res = await session.commands.run(`node ${runDir}/endpoints.cjs ${JSON.stringify(sourceDir)} ${runDir}/endpoints.json`, 60_000);
    const found = lastJsonLine(res.stdout ?? "") as Record<string, { file?: string; function?: string | null; code?: string; types?: Record<string, string>; found?: boolean; truncated?: boolean }> | null;
    if (!found) return "";
    const parts = ["", "", "Endpoint contracts (requests no mock covered):"];
    for (const [ep, e] of Object.entries(found)) {
      if (e.found === false) { parts.push(`### ${ep}\n(not found in ${sourceDir})`); continue; }
      parts.push(`### ${ep} → ${e.function ?? "?"} (${e.file})${e.truncated ? " [omitted: size cap]" : ""}`);
      if (e.code) parts.push("```ts\n" + e.code + "\n```");
      for (const [name, code] of Object.entries(e.types ?? {})) parts.push("```ts\n// " + name + "\n" + code + "\n```");
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

function safeName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) : "";
  return s || `run-${Date.now()}`;
}

function harnessTimeoutMs(spec: { variations: Array<{ mocks?: Array<{ delayMs?: number }> }> }): number {
  const delays = spec.variations.reduce((n, v) => n + Math.max(0, ...(v.mocks ?? []).map((m) => Math.min(Number(m.delayMs) || 0, 30_000))), 0);
  return Math.min(900_000, 60_000 + spec.variations.length * 25_000 + delays);
}

function lastJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split("\n").reverse();
  for (const l of lines) {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

const SPEC_DESCRIPTION = [
  "Run spec (JSON object):",
  "- baseUrl: app root reachable from inside the sandbox, e.g. http://localhost:5199/claw",
  "- sourceDir: the frontend source directory in the sandbox (e.g. /home/user/repo/apps/xyne-claw-auth/frontend/src). When set, the report adds the API-client function and response TypeScript types for every request no mock covered — use them to write fixtures instead of reading files.",
  "- apiPattern: glob of requests to intercept (default **/api/**). Every intercepted request is answered by the first matching mock; unmatched ones get `fallback`.",
  '- fallback: {status, json} for unmatched API calls (default {status:200, json:{success:true,data:[]}}), or "passthrough" to hit the real backend.',
  "- themeStorageKey: localStorage key the app reads its theme from (e.g. xyne-theme)",
  "- concurrency: variations rendered in parallel (default 8, max 10). All variations of one call run at the same time — put the whole matrix in ONE call instead of calling once per variation.",
  "- video: true records a .webm per variation (navigation, steps and final state) as proof of test; set it on the spec or per variation. Keep video variations short (a few steps with {wait} pauses). The report lists each video path; deliver them with sandbox-deliver-files.",
  "- allowExternal: true lets requests to other origins (fonts, CDNs) through. By default they are answered instantly with an empty response so pages never hang on the network.",
  "- defaults: {viewport, theme, localStorage, mocks, shotAfterMs} applied to every variation (variation mocks are tried first)",
  "- variations: [{id, path, viewport?:{width,height}, theme?:'light'|'dark', localStorage?, mocks?:[{match, method?, status?, json?, body?, delayMs?}], steps?:[{click}|{fill:[selector,value]}|{press}|{hover}|{waitFor}|{wait}], shotAfterMs?, fullPage?, expect?:{content?:'data'|'empty'|'error'|'loading'|'blank', errors?:'none'|'banner'|'toast'|'both', background?:'light'|'dark'}, checks?:[{id, question, options:{key:description}, expect?}]}]",
  "- mock.match: substring of pathname+query, or 're:<regex>'.",
  "- step selectors are Playwright selectors: CSS, text=Visible label, role=button[name=\"Save\"], [data-id=...]. A failed step is reported as a page error.",
  "- mock.json may contain {\"$repeat\": N, \"$item\": {...}} to generate N items; inside $item, \"{{i}}\" is the index (a number when it is the whole string, e.g. \"{{i+1}}\", \"{{i*37}}\") and is substituted inside longer strings (\"run-{{i}}\").",
].join("\n");

export function buildUiTesterTools(meta: Record<string, string>): ToolDefinition[] {
  const runVariations: ToolDefinition = {
    name: "ui-test-variations",
    label: "Test UI variations",
    description: [
      "Render every variation of a web UI in the sandbox browser with mocked API responses, then check each screenshot.",
      "Each variation is screenshotted, DOM-audited (content past the viewport edge, squeezed text, NaN/undefined text, duplicate toasts, crash screens, console and page errors, requests no mock covered) and visually checked by the xor classifier (cut-off or overlapping content, error banners/toasts, placeholder text, toast count, what the main area shows, background colour, plus your own `checks`).",
      "Returns a PASS/FAIL/UNSURE line per variation with the evidence, and writes summary.json, verdicts.json and the screenshots to the run directory.",
      "The app must already be running inside the sandbox (start the dev server with sandbox-run-detached first). Fix fixtures and re-run when a variation reports requests served by the fallback mock.",
      "",
      SPEC_DESCRIPTION,
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        spec: { type: "object", description: "The run spec described above." },
        runName: { type: "string", description: "Short name for the run directory (letters, digits, - and _)." },
        visual: { type: "boolean", description: "Run the xor visual checks on each screenshot (default true)." },
      },
      required: ["spec"],
    }),
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const p = (params ?? {}) as { spec?: unknown; runName?: unknown; visual?: unknown };
      let spec = p.spec as Record<string, unknown> | undefined;
      if (typeof p.spec === "string") {
        try {
          spec = JSON.parse(p.spec) as Record<string, unknown>;
        } catch {
          return text("Error: `spec` is a string that is not valid JSON — pass the spec as a JSON object.");
        }
      }
      if (!spec || typeof spec !== "object") return text("Error: `spec` must be an object.");
      if (typeof spec["baseUrl"] !== "string" || !spec["baseUrl"]) return text("Error: spec.baseUrl is required.");
      const variations = spec["variations"];
      if (!Array.isArray(variations) || variations.length === 0) return text("Error: spec.variations must be a non-empty array.");
      if (variations.length > MAX_VARIATIONS) return text(`Error: at most ${MAX_VARIATIONS} variations per run; split the matrix into several runs.`);
      const ids = new Set<string>();
      for (const v of variations as Array<Record<string, unknown>>) {
        const id = typeof v["id"] === "string" ? v["id"] : "";
        if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id) || ids.has(id)) return text(`Error: every variation needs a unique id of letters, digits, - and _ (bad: ${JSON.stringify(v["id"])}).`);
        ids.add(id);
      }
      const session = sessionFor(meta);
      if (!session) return text(NO_SANDBOX);

      const runDir = `/tmp/ui-tester/${safeName(p.runName)}`;
      const outDir = `${runDir}/out`;
      const started = Date.now();
      try {
        await session.commands.run(`mkdir -p ${outDir}`, 15_000);
        await session.files.write(`${runDir}/harness.cjs`, Buffer.from(HARNESS_SOURCE, "utf8"));
        await session.files.write(`${runDir}/audit.js`, Buffer.from(DOM_AUDIT_SOURCE, "utf8"));
        await session.files.write(`${runDir}/spec.json`, Buffer.from(JSON.stringify({ ...spec, outDir }), "utf8"));
        const result = await session.commands.run(
          `cd ${runDir} && NODE_PATH="\${NODE_PATH:-/usr/local/lib/node_modules}" node harness.cjs spec.json`,
          harnessTimeoutMs({ variations: variations as Array<{ mocks?: Array<{ delayMs?: number }> }> }),
        );
        const head = lastJsonLine(result.stdout ?? "");
        if (!head || head["ok"] !== true) {
          return text(`Error: the harness failed (exit ${result.exitCode}). ${String(head?.["error"] ?? "").slice(0, 600)}\nstderr: ${(result.stderr ?? "").slice(-800)}`);
        }
        const summary = JSON.parse((await session.files.read(`${outDir}/summary.json`)).toString("utf8")) as { results: VariationResult[] };
        const verdicts = await judgeAll(session, summary.results, p.visual !== false, signal);
        const contracts = typeof spec["sourceDir"] === "string" && spec["sourceDir"]
          ? await endpointContracts(session, runDir, spec["sourceDir"], summary.results)
          : "";
        await session.files.write(`${outDir}/verdicts.json`, Buffer.from(JSON.stringify(verdicts, null, 2), "utf8"));
        const counts = verdicts.reduce((m, v) => ((m[v.verdict] = (m[v.verdict] ?? 0) + 1), m), {} as Record<string, number>);
        metric.count("ui_tester_run", { variations: verdicts.length, fail: counts["fail"] ?? 0, unsure: counts["unsure"] ?? 0 });
        log.info(`[ui-tester] ${verdicts.length} variations in ${Date.now() - started}ms fail=${counts["fail"] ?? 0} unsure=${counts["unsure"] ?? 0}`);
        return text(`${formatReport(verdicts)}${contracts}\n\nRun directory: ${runDir} (summary.json, verdicts.json, <id>.png in out/).`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return text(`Error: ui-test-variations failed: ${msg.slice(0, 500)}`);
      }
    },
  };

  const visualCheck: ToolDefinition = {
    name: "visual-check",
    label: "Visual check",
    description: [
      "Ask the xor visual classifier about screenshots already saved in the sandbox (PNG/JPEG paths).",
      "Always runs the standard checks (cut-off content, overlap, error indications, placeholder text, toast count, main-area state, background colour) and any multiple-choice `checks` you add.",
      "Phrase checks about what is visible (\"Is the Save button greyed out?\") with exhaustive options; answers below 0.7 confidence are reported as unsure.",
    ].join(" "),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        screenshots: { type: "array", items: { type: "string" }, description: "Sandbox paths of the screenshots (max 10)." },
        checks: {
          type: "array",
          description: "Extra multiple-choice checks: [{id, question, options:{key:description}, expect?:key}].",
          items: { type: "object" },
        },
      },
      required: ["screenshots"],
    }),
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const p = (params ?? {}) as { screenshots?: unknown; checks?: unknown };
      const shots = Array.isArray(p.screenshots) ? (p.screenshots as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 10) : [];
      if (shots.length === 0) return text("Error: `screenshots` must list at least one sandbox path.");
      const checks = Array.isArray(p.checks) ? (p.checks as CustomCheck[]) : [];
      const session = sessionFor(meta);
      if (!session) return text(NO_SANDBOX);
      const results: VariationResult[] = shots.map((s) => ({ id: s.split("/").pop() ?? s, screenshot: s, checks }));
      const verdicts = await judgeAll(session, results, true, signal);
      const detail = verdicts.map((v) => `${v.id}: ${Object.entries(v.visual).map(([k, a]) => `${k}=${a.choice}(${a.confidence})`).join(" ")}`).join("\n");
      return text(`${formatReport(verdicts)}\n\nRaw answers:\n${detail}`);
    },
  };

  for (const t of [runVariations, visualCheck]) (t as unknown as { source: string }).source = UI_TESTER_SOURCE;
  return [runVariations, visualCheck];
}

