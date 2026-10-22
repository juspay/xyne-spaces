import { UI_TESTER_STANDARD_CHECKS, type DecideQuestion, type UiTesterStandardKey } from "xyne-claw-shared";
import type { XorAnswer, XorQuestion } from "../xor.js";

export const CONFIDENT = 0.7;

export type StandardQuestion = Extract<XorQuestion, { type: "choice" }> | Extract<XorQuestion, { type: "noul" }>;

function toStandardQuestion(c: DecideQuestion): StandardQuestion | null {
  if (c.type === "yesno") return { type: "noul", instructions: c.question };
  if (c.type === "choice" && c.options && !Array.isArray(c.options)) return { type: "choice", instructions: c.question, criteria: c.options };
  return null;
}

export const STANDARD_QUESTIONS: Record<UiTesterStandardKey, StandardQuestion> = Object.fromEntries(
  UI_TESTER_STANDARD_CHECKS.map((c) => [c.id, toStandardQuestion(c as DecideQuestion)!]),
) as Record<UiTesterStandardKey, StandardQuestion>;

export function standardQuestionsFrom(checks: DecideQuestion[] | undefined): Record<UiTesterStandardKey, StandardQuestion> {
  if (!checks || checks.length === 0) return STANDARD_QUESTIONS;
  const out = { ...STANDARD_QUESTIONS };
  for (const c of checks) {
    const base = STANDARD_QUESTIONS[c.id as UiTesterStandardKey];
    const next = toStandardQuestion(c);
    if (!base || !next || base.type !== next.type) continue;
    if (base.type === "choice" && next.type === "choice" && Object.keys(base.criteria).sort().join() !== Object.keys(next.criteria).sort().join()) continue;
    out[c.id as UiTesterStandardKey] = next;
  }
  return out;
}

export type StandardKey = UiTesterStandardKey;

export interface CustomCheck {
  id: string;
  question: string;
  options: Record<string, string>;
  expect?: string;
}

export interface VariationAudit {
  viewportWidth?: number;
  horizontalScroll?: boolean;
  offRight?: string[];
  narrowText?: number;
  garbage?: string[];
  duplicateToasts?: string[];
  errorBoundary?: boolean;
  dark?: boolean;
  textLength?: number;
  error?: string;
}

export interface VariationResult {
  id: string;
  path?: string;
  finalUrl?: string;
  apiRequests?: number;
  viewport?: { width: number; height: number };
  theme?: string;
  screenshot?: string | null;
  video?: string | null;
  title?: string;
  themeApplied?: boolean | null;
  textChecks?: Array<{ text: string; kind: "expect" | "reject"; ok: boolean }> | null;
  externalStubbed?: number;
  externalHosts?: string[];
  error?: string;
  navError?: string | null;
  audit?: VariationAudit | null;
  consoleErrors?: string[];
  pageErrors?: string[];
  failedRequests?: string[];
  unmatchedRequests?: string[];
  expect?: Partial<Record<StandardKey, string>> | null;
  checks?: CustomCheck[] | null;
}

export interface Finding {
  severity: "fail" | "warn" | "unsure";
  source: "dom" | "visual" | "runtime" | "fixture";
  message: string;
}

export interface VariationVerdict {
  id: string;
  title?: string;
  verdict: "pass" | "fail" | "unsure";
  findings: Finding[];
  visual: Record<string, { choice: string | null; confidence: number | null }>;
  screenshot?: string;
  video?: string;
}

const PROBLEM_WHEN: Partial<Record<StandardKey, string>> = { cut_off: "yes", overlap: "yes", placeholders: "yes", toasts: "several" };

export function buildQuestions(result: VariationResult, standard: Record<UiTesterStandardKey, StandardQuestion> = STANDARD_QUESTIONS): Record<string, XorQuestion> {
  const questions: Record<string, XorQuestion> = { ...standard };
  for (const c of result.checks ?? []) {
    if (!c.id || !c.question || Object.keys(c.options ?? {}).length < 2) continue;
    questions[`custom_${c.id}`] = { type: "choice", instructions: c.question, criteria: c.options };
  }
  return questions;
}

function pick(a: XorAnswer | undefined): { choice: string | null; confidence: number | null } {
  if (typeof a?.noul === "number" && a.choice === undefined) {
    return { choice: a.noul >= 0.5 ? "yes" : "no", confidence: Math.round(Math.abs(a.noul - 0.5) * 200) / 100 };
  }
  return { choice: a?.choice ?? null, confidence: typeof a?.confidence === "number" ? Math.round(a.confidence * 100) / 100 : null };
}

function optionLabel(q: StandardQuestion, key: string): string {
  return q.type === "choice" ? q.criteria[key] ?? key : key;
}

export function judgeVariation(
  result: VariationResult,
  answers: Record<string, XorAnswer> | null,
  standard: Record<UiTesterStandardKey, StandardQuestion> = STANDARD_QUESTIONS,
): VariationVerdict {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], source: Finding["source"], message: string) => findings.push({ severity, source, message });

  if (result.error) add("fail", "runtime", `harness error: ${result.error}`);
  if (result.navError) add("fail", "runtime", `navigation failed: ${result.navError}`);
  for (const e of result.pageErrors ?? []) add("fail", "runtime", `uncaught page error: ${e}`);
  const a = result.audit ?? {};
  if (a.error) add("warn", "dom", `DOM audit failed: ${a.error}`);
  if ((a.offRight?.length ?? 0) > 0) add("fail", "dom", `content past the right edge of a ${a.viewportWidth}px viewport: ${a.offRight!.slice(0, 5).join(", ")}`);
  if (a.horizontalScroll) add("fail", "dom", "page scrolls horizontally");
  if ((a.narrowText ?? 0) >= 2) add("warn", "dom", `${a.narrowText} text blocks squeezed into a column under 90px wide`);
  if ((a.garbage?.length ?? 0) > 0) add("fail", "dom", `placeholder values in visible text: ${a.garbage!.join(", ")}`);
  if ((a.duplicateToasts?.length ?? 0) > 0) add("fail", "dom", `duplicate toasts: ${a.duplicateToasts!.join("; ")}`);
  if (a.errorBoundary) add("fail", "dom", "an error-boundary / crash message is visible");
  if (typeof a.textLength === "number" && a.textLength < 20) add("warn", "dom", "page has almost no visible text (blank render?)");
  const expectedErrors = result.expect?.errors && result.expect.errors !== "none";
  for (const e of (result.consoleErrors ?? []).slice(0, 3)) {
    if (expectedErrors && /status of [45]\d\d/.test(e)) continue;
    add("warn", "runtime", `console error: ${e}`);
  }
  for (const t of result.textChecks ?? []) {
    if (!t.ok) add("fail", "dom", t.kind === "expect" ? `expected text not on the page: "${t.text}"` : `text that must not appear is on the page: "${t.text}"`);
  }
  if (result.theme === "dark" && result.themeApplied === false) add("warn", "fixture", "dark theme was requested but the page rendered light — set spec.themeStorageKey to the key the app reads (the probe's \"Theme storage keys\" line lists the ones found in the source)");
  if (result.apiRequests === 0 && !result.error) add("warn", "fixture", `no API request was intercepted on ${result.finalUrl ?? result.path ?? "the page"} — check baseUrl, path and apiPattern`);
  if ((result.unmatchedRequests?.length ?? 0) > 0) add("warn", "fixture", `requests served by the fallback mock (fixture may be missing): ${result.unmatchedRequests!.slice(0, 6).join(", ")}`);

  const visual: VariationVerdict["visual"] = {};
  if (!answers) {
    add("unsure", "visual", "visual check unavailable (xor returned nothing)");
  } else {
    for (const [key, ans] of Object.entries(answers)) visual[key] = pick(ans);
    for (const [key, bad] of Object.entries(PROBLEM_WHEN) as Array<[StandardKey, string]>) {
      const v = visual[key];
      if (!v || v.choice === null) continue;
      const confident = (v.confidence ?? 0) >= CONFIDENT;
      const q = standard[key];
      if (v.choice === bad && q) add(confident ? "fail" : "unsure", "visual", `${q.instructions} → ${optionLabel(q, bad)} (confidence ${v.confidence})`);
    }
    const blank = visual["content"];
    if (blank?.choice === "blank" && (blank.confidence ?? 0) >= CONFIDENT && result.expect?.content !== "blank") {
      add("fail", "visual", `the page rendered blank at ${result.finalUrl ?? result.path ?? "?"} (confidence ${blank.confidence})`);
    }
    for (const [key, want] of Object.entries(result.expect ?? {}) as Array<[StandardKey, string]>) {
      const v = visual[key];
      if (!v || v.choice === null || !want) continue;
      if (v.choice !== want) {
        const confident = (v.confidence ?? 0) >= CONFIDENT;
        add(confident ? "fail" : "unsure", "visual", `expected ${key}=${want}, screenshot shows ${key}=${v.choice} (confidence ${v.confidence})`);
      }
    }
    for (const c of result.checks ?? []) {
      const v = visual[`custom_${c.id}`];
      if (!v || v.choice === null) continue;
      const confident = (v.confidence ?? 0) >= CONFIDENT;
      if (c.expect && v.choice !== c.expect) add(confident ? "fail" : "unsure", "visual", `${c.question} → expected "${c.options[c.expect] ?? c.expect}", got "${c.options[v.choice] ?? v.choice}" (confidence ${v.confidence})`);
      else if (!confident) add("unsure", "visual", `${c.question} → "${c.options[v.choice] ?? v.choice}" at low confidence ${v.confidence}`);
    }
    if (result.audit?.dark !== undefined && visual["background"]?.choice) {
      const domDark = result.audit.dark;
      if (domDark !== (visual["background"].choice === "dark") && (visual["background"].confidence ?? 0) >= CONFIDENT) {
        add("warn", "visual", `theme class says ${domDark ? "dark" : "light"} but the screenshot background looks ${visual["background"].choice}`);
      }
    }
  }
  const verdict = findings.some((f) => f.severity === "fail") ? "fail" : findings.some((f) => f.severity === "unsure") ? "unsure" : "pass";
  return { id: result.id, ...(result.title ? { title: result.title } : {}), verdict, findings, visual, ...(result.screenshot ? { screenshot: result.screenshot } : {}), ...(result.video ? { video: result.video } : {}) };
}

export function formatReport(verdicts: VariationVerdict[]): string {
  const counts = { pass: 0, fail: 0, unsure: 0 };
  for (const v of verdicts) counts[v.verdict] += 1;
  const lines = [`UI variations: ${verdicts.length} checked — ${counts.fail} fail, ${counts.unsure} unsure, ${counts.pass} pass.`, ""];
  for (const v of verdicts) {
    const mark = v.verdict === "pass" ? "PASS" : v.verdict === "fail" ? "FAIL" : "UNSURE";
    lines.push(`- ${mark} ${v.id}${v.title && v.title !== v.id ? ` "${v.title}"` : ""}${v.screenshot ? ` (${v.screenshot})` : ""}${v.video ? ` video: ${v.video}` : ""}`);
    for (const f of v.findings.filter((x) => x.severity !== "warn" || v.verdict !== "pass").slice(0, 6)) lines.push(`    - [${f.severity}/${f.source}] ${f.message}`);
  }
  return lines.join("\n");
}
