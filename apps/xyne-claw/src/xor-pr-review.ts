/**
 * xor-pr-review: checks the changes on this run's branch against a review skill's rules with
 * the classifier (xor), in the run's own session.
 *
 * The skill's numbered rules (`N. **[🔴 Critical]** rule` under `### Section`, the format of
 * skills/code-reviewer.md) each become one yes/no question. Every changed file is asked every
 * rule whose section applies to it (Frontend rules to UI files, Database rules to schema,
 * migrations and repositories, Testing rules to tests, the rest to all code), with the file's
 * diff as the state. Each classifier call is a judge trace in the debug panel (the diff, the
 * rules asked, the answers); the run's outcome is one judge outcome listing every violation.
 *
 * The answers are the classifier's reading of a diff, so the tool hands them to the model as
 * leads to confirm against the code, not as findings.
 */

import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildSandboxStoreKey, getSandboxSession, sandboxConversationIdFromMeta } from "xyne-claw-shared";
import { collectPrEvidence, type PrFileEvidence } from "./pr-evidence.js";
import { discoverRepoRoot, resolveBaseRef, sandboxGitRunner, type SandboxSession } from "./pr-review-room.js";
import { xor, xorEnabled, xorThreshold, type XorAnswer, type XorQuestion } from "./xor.js";
import { recordJudgeOutcome } from "./judge-trace.js";
import { recordDebug } from "./citations.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("xor-pr-review");

export const XOR_PR_REVIEW_TOOL_NAME = "xor-pr-review";
const DEFAULT_SKILL = "code-reviewer";
/** Rules asked per classifier call. */
const RULES_PER_CALL = 40;
const CALL_CONCURRENCY = 4;
const MAX_DIFF_CHARS = 12_000;
const MAX_FILES = 60;
/** Violations listed in the debug outcome; the tool result lists them all. */
const MAX_OUTCOME_LINES = 20;
const SEVERITY_ORDER = ["Critical", "High", "Medium", "Low", "Nitpick"];
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|sql|prisma|css|scss|sh)$/i;

export interface ReviewRule {
  /** The rule's number in the skill: `R<n>`, or the skill's own prefix (`S<n>`). */
  id: string;
  section: string;
  severity: string;
  text: string;
}

export interface Violation {
  rule: ReviewRule;
  file: string;
  /** The classifier's probability that the change breaks the rule. */
  p: number;
}

/** One changed file's tally: every rule asked of it, and what xor said. */
export interface FileReview {
  file: string;
  calls: number;
  /** Rules xor answered for this file. */
  checked: number;
  passed: number;
  violations: Violation[];
  /** Rules not checked because their call failed. */
  unchecked: number;
}

export interface ReviewOutcome {
  skill: string;
  baseRef: string;
  rules: number;
  files: string[];
  skipped: string[];
  calls: number;
  unavailable: number;
  violations: Violation[];
  perFile: FileReview[];
}

/** The numbered rules of a review skill, with their section and severity. */
export function parseReviewRules(markdown: string): ReviewRule[] {
  const rules: ReviewRule[] = [];
  let section = "General";
  for (const line of markdown.split("\n")) {
    // The nearest `##`/`###` heading, without trailing notes like "*(NEW SECTION)*".
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = heading[1]!.replace(/\s*\*\(.*\)\*\s*$/, "").trim();
      continue;
    }
    // `12. **[🔴 Critical]** rule`, `S4. **[🔴 Critical]** rule` or `306. [🔴 Critical] rule`.
    const rule = /^([A-Z]?)(\d+)\.\s+(?:\*\*)?\[([^\]]+)\](?:\*\*)?\s+(.+?)\s*$/.exec(line);
    if (rule) {
      rules.push({ id: `${rule[1] || "R"}${rule[2]}`, section, severity: rule[3]!.replace(/^[^\p{L}]+/u, "").trim(), text: rule[4]! });
    }
  }
  return rules;
}

/** Sections whose rules apply to some files only; every other section applies to all code. */
const SECTION_SCOPE: Record<string, (path: string) => boolean> = {
  Frontend: (p) => /\.(tsx|jsx|css|scss)$/i.test(p) || /(^|\/)(dashboard|frontend|mobile|dashboard-external)\//.test(p),
  Database: (p) => /prisma|migration|\.sql$|repositor|mutator|zero\/schema/i.test(p),
  Testing: (p) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p),
};

/** The rules that apply to a changed file. */
export function rulesFor(path: string, rules: ReviewRule[]): ReviewRule[] {
  return rules.filter((r) => SECTION_SCOPE[r.section]?.(path) ?? true);
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

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

function fileState(file: PrFileEvidence): string {
  const diff = file.hunks.length > MAX_DIFF_CHARS ? `${file.hunks.slice(0, MAX_DIFF_CHARS)}\n… [diff cut at ${MAX_DIFF_CHARS} chars]` : file.hunks;
  return (
    `A code reviewer is checking one file of a pull request against the team's engineering rules.\n` +
    `File: ${file.path} (${file.status}, +${file.insertions} -${file.deletions})\n\nDiff:\n${diff}`
  );
}

type Ask = typeof xor;

/** Ask every applicable rule of every changed file; collect the violations. */
export async function reviewFiles(
  files: PrFileEvidence[],
  rules: ReviewRule[],
  opts: { skill: string; baseRef: string; threshold?: number; ask?: Ask; signal?: AbortSignal },
): Promise<ReviewOutcome> {
  const ask = opts.ask ?? xor;
  const threshold = opts.threshold ?? xorThreshold("XOR_PR_REVIEW_THRESHOLD", 0.7);
  const reviewable = files.filter((f) => CODE_FILE.test(f.path) && f.hunks.trim().length > 0 && rulesFor(f.path, rules).length > 0);
  const skipped = files.filter((f) => !reviewable.includes(f)).map((f) => f.path);
  const jobs = reviewable.flatMap((file) => chunk(rulesFor(file.path, rules), RULES_PER_CALL).map((batch) => ({ file, batch })));
  let unavailable = 0;
  const perFile = new Map<string, FileReview>(
    reviewable.map((f) => [f.path, { file: f.path, calls: 0, checked: 0, passed: 0, violations: [], unchecked: 0 }]),
  );
  const found = await mapLimit(jobs, CALL_CONCURRENCY, async ({ file, batch }) => {
    const questions: Record<string, XorQuestion> = Object.fromEntries(
      batch.map((r) => [r.id, { type: "noul" as const, instructions: `The change in this file breaks this rule: ${r.text}` }]),
    );
    const answers: Record<string, XorAnswer> | null = await ask({
      state: fileState(file),
      questions,
      purpose: "xor-pr-review",
      cache: true,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const tally = perFile.get(file.path)!;
    tally.calls += 1;
    if (!answers) {
      unavailable += 1;
      tally.unchecked += batch.length;
      return [] as Violation[];
    }
    const out: Violation[] = [];
    for (const rule of batch) {
      const p = answers[rule.id]?.noul;
      if (typeof p !== "number") {
        tally.unchecked += 1;
        continue;
      }
      tally.checked += 1;
      if (p >= threshold) out.push({ rule, file: file.path, p });
      else tally.passed += 1;
    }
    tally.violations.push(...out);
    return out;
  });
  const rank = (s: string) => {
    const i = SEVERITY_ORDER.indexOf(s);
    return i < 0 ? SEVERITY_ORDER.length : i;
  };
  const bySeverity = (a: Violation, b: Violation) => rank(a.rule.severity) - rank(b.rule.severity) || b.p - a.p;
  const violations = found.flat().sort(bySeverity);
  for (const tally of perFile.values()) tally.violations.sort(bySeverity);
  return {
    skill: opts.skill,
    baseRef: opts.baseRef,
    rules: rules.length,
    files: reviewable.map((f) => f.path),
    skipped,
    calls: jobs.length,
    unavailable,
    violations,
    perFile: [...perFile.values()],
  };
}

export function formatOutcome(o: ReviewOutcome): string {
  const lines = [
    `Checked ${o.rules} rules from the ${o.skill} skill against ${o.files.length} changed file(s) vs ${o.baseRef} (${o.calls} classifier call(s)` +
      (o.unavailable ? `, ${o.unavailable} unavailable — those rules were not checked` : "") +
      `).`,
  ];
  if (o.skipped.length) lines.push(`Not checked (not code, or no rule applies): ${o.skipped.join(", ")}`);
  if (o.violations.length === 0) {
    lines.push("No likely violations.");
  } else {
    lines.push(`${o.violations.length} likely violation(s):`);
    for (const v of o.violations) lines.push(`- [${v.rule.severity}] ${v.rule.id} (${v.rule.section}) ${v.file} — p=${v.p.toFixed(2)} — ${v.rule.text}`);
    lines.push("These are the classifier's reading of the diff. Read the code for each one and report only the ones that hold, with file:line.");
  }
  return lines.join("\n");
}

type RunSkill = { slug?: string; name: string; content: string };

/** The skill's text: one loaded in this run, else the one bundled with xyne-claw (skills/<slug>.md). */
async function skillContent(name: string, skills: RunSkill[]): Promise<string | null> {
  const loaded = skills.find((s) => s.slug === name || s.name === name);
  if (loaded) return loaded.content;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  return readFile(new URL(`../skills/${name}.md`, import.meta.url), "utf8").catch(() => null);
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }], details: {} };
}

/**
 * The tool. `meta` locates the run's sandbox (as the sandbox tools do); `skills` are the
 * skills loaded for this run.
 */
export function buildXorPrReviewTool(
  meta: Record<string, string>,
  skills: RunSkill[],
  deps: { session?: () => SandboxSession | undefined; ask?: Ask } = {},
): ToolDefinition {
  return {
    name: XOR_PR_REVIEW_TOOL_NAME,
    label: "xor PR review",
    description:
      "Check the changes on this branch against a review skill's engineering rules, rule by rule, with the classifier. " +
      "Diffs the sandbox repository against its base branch and asks every rule that applies to each changed file. " +
      "Returns the likely violations (rule, severity, file, probability) to confirm against the code before reporting. " +
      "Run it after the changes are committed in the sandbox, before or after opening the PR.",
    parameters: Type.Object({
      skill: Type.Optional(Type.String({ description: `Review skill with the rules (slug). Default: ${DEFAULT_SKILL}.` })),
      base: Type.Optional(Type.String({ description: "Branch or ref to diff against. Default: the repository's default branch." })),
      repo: Type.Optional(Type.String({ description: "Repository folder under /workspace, when the sandbox has more than one." })),
    }),
    async execute(toolCallId, params, signal) {
      const p = (params ?? {}) as { skill?: string; base?: string; repo?: string };
      if (!xorEnabled()) return text("Error: the classifier (xor) is not available in this deployment.");
      const skillName = p.skill?.trim() || DEFAULT_SKILL;
      const content = await skillContent(skillName, skills);
      if (!content) {
        const loaded = skills.map((s) => s.slug ?? s.name).join(", ") || "none";
        return text(`Error: no skill named "${skillName}" (loaded in this run: ${loaded}).`);
      }
      const rules = parseReviewRules(content);
      if (rules.length === 0) return text(`Error: the ${skillName} skill has no numbered rules ("N. **[Severity]** rule") to check.`);

      const session =
        deps.session?.() ??
        (() => {
          const key = buildSandboxStoreKey(meta["userId"], sandboxConversationIdFromMeta(meta), meta["agentSlug"]);
          return key ? getSandboxSession(key) : undefined;
        })();
      if (!session) return text("Error: no sandbox in this run. Create one and check out the branch, then call this again.");
      const repoRoot = await discoverRepoRoot(session, { repo: p.repo });
      if (!repoRoot) return text("Error: no git checkout under /workspace in the sandbox.");
      const git = sandboxGitRunner(session, repoRoot);
      const baseRef = await resolveBaseRef(git, p.base);
      if (!baseRef) return text(`Error: could not find the base branch${p.base ? ` "${p.base}"` : ""} in ${repoRoot}.`);
      const evidence = await collectPrEvidence({ git, repoRoot, baseRef, headRef: "HEAD", maxFiles: MAX_FILES });
      if (evidence.diffFailure) return text(`Error: could not diff ${repoRoot} against ${baseRef}: ${evidence.diffFailure}`);
      const files = [...evidence.newFiles, ...evidence.editedFiles];
      if (files.length === 0) return text(`No changes between ${baseRef} and HEAD in ${repoRoot}.`);

      const started = Date.now();
      const outcome = await reviewFiles(files, rules, { skill: skillName, baseRef, ...(deps.ask ? { ask: deps.ask } : {}), ...(signal ? { signal } : {}) });
      const ms = Date.now() - started;
      // One debug row per file: how many times xor was asked about it, and what passed and failed.
      for (const f of outcome.perFile) {
        recordJudgeOutcome(
          "xor-pr-review",
          `${f.file} · ${f.checked} rules checked · ${f.violations.length} violated · ${f.passed} passed · ${f.calls} xor call(s)` +
            (f.unchecked ? ` · ${f.unchecked} not checked (call failed)` : ""),
          {
            violated: f.violations
              .slice(0, MAX_OUTCOME_LINES)
              .map((v) => `${v.rule.id} [${v.rule.severity}] p=${v.p.toFixed(2)} — ${v.rule.text.slice(0, 100)}`),
            ...(f.violations.length > MAX_OUTCOME_LINES ? { more: f.violations.length - MAX_OUTCOME_LINES } : {}),
          },
        );
      }
      const checks = outcome.perFile.reduce((n, f) => n + f.checked, 0);
      const passed = outcome.perFile.reduce((n, f) => n + f.passed, 0);
      const summary =
        `${skillName}: ${outcome.files.length} file(s) · ${checks} rule checks · ${outcome.violations.length} violated · ${passed} passed · ` +
        `${outcome.calls} xor call(s)${outcome.unavailable ? ` · ${outcome.unavailable} failed` : ""}`;
      // The debug panel keeps 4,000 characters of this detail: one compact line per violation
      // (the full rule texts are in each judge call's questions).
      recordJudgeOutcome("xor-pr-review", summary, {
        skill: skillName,
        baseRef,
        files: outcome.files.length,
        skipped: outcome.skipped,
        violations: outcome.violations
          .slice(0, MAX_OUTCOME_LINES)
          .map((v) => `${v.rule.id} [${v.rule.severity}] p=${v.p.toFixed(2)} ${v.file} — ${v.rule.text.slice(0, 80)}`),
        ...(outcome.violations.length > MAX_OUTCOME_LINES ? { more: outcome.violations.length - MAX_OUTCOME_LINES } : {}),
      });
      recordDebug(toolCallId, { xorPrReview: { rules: outcome.rules, files: outcome.files.length, calls: outcome.calls, unavailable: outcome.unavailable, violations: outcome.violations.length, ms } });
      metric.count("xor_pr_review", { violations: String(outcome.violations.length > 0), unavailable: String(outcome.unavailable > 0) });
      log.info(`[xor-pr-review] ${summary} in ${ms}ms`);
      return text(formatOutcome(outcome));
    },
  };
}
