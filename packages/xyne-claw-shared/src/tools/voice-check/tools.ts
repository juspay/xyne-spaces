/**
 * The voice and tone QA step a design run calls before it delivers
 * (XYNE-66830).
 *
 * The check itself is pure and lives in `../../voice-tone-qa.js`; this is the
 * thin tool shell around it, so a `/design` or `/dashboard` run can hold its
 * own artifact to the brand's voice and fix what it finds. It is advisory on
 * purpose — it reports, and the model decides. Nothing here blocks a delivery.
 *
 * Rules come from the design system's `## Voice` section. The run already has
 * that text injected into its prompt, but a tool cannot read a prompt, so the
 * runtime pins the section into `context.meta.designVoice` the same way it pins
 * `sandboxRepo` — taken from the injection's result, so this can only report
 * against rules the model was given. A caller can also pass `designMd`
 * explicitly, which is what makes this testable without a run.
 */

import { parseVoiceSection, type VoiceRules } from "../../voice-tone.js";
import { checkVoiceToneCompliance, type VoiceToneFinding } from "../../voice-tone-qa.js";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";

export interface VoiceCheckInput {
  /** The delivered artifact — HTML or markdown. */
  content: string;
  /** The design system's DESIGN.md, or just its `## Voice` section. */
  designMd?: string;
}

export interface VoiceCheckResult {
  passed: boolean;
  findings: VoiceToneFinding[];
  /** The rules the content was held to, so a caller can show what was checked
   *  rather than only what failed. */
  rules: VoiceRules;
}

/**
 * Resolve the voice rules and check the content against them.
 *
 * `passed` is true when there are no findings, which includes the case where
 * the system states no voice rules at all — there is nothing to comply with, so
 * nothing to fail. `rules` is returned so a caller can tell those two apart.
 */
export function runVoiceCheck(input: VoiceCheckInput): VoiceCheckResult {
  const rules = parseVoiceSection(input.designMd ?? "");
  const findings = checkVoiceToneCompliance(input.content ?? "", rules);
  return { passed: findings.length === 0, findings, rules };
}

const ruleCount = (rules: VoiceRules): number =>
  rules.bannedPhrases.length +
  rules.preferredWording.length +
  (rules.casing.headings ? 1 : 0) +
  (rules.casing.buttons ? 1 : 0);

/** One line per finding, in the order they appear in the artifact. */
function formatReport(result: VoiceCheckResult): string {
  const checked = ruleCount(result.rules);
  if (checked === 0) {
    return (
      "Voice QA: this design system states no checkable voice rules (no banned phrases, " +
      "wording pairs or casing rules), so there is nothing to check. Deliver as normal."
    );
  }
  if (result.passed) {
    return `Voice QA passed: no issues against ${checked} voice ${checked === 1 ? "rule" : "rules"}.`;
  }

  const lines = result.findings.map(
    (finding) =>
      `- line ${finding.line} [${finding.type}] ${finding.message}` +
      (finding.suggestion ? ` → use "${finding.suggestion}"` : ""),
  );
  return [
    `Voice QA found ${result.findings.length} ${result.findings.length === 1 ? "issue" : "issues"} against this design system's voice rules:`,
    ...lines,
    "",
    "Fix these in the artifact, then run design-voice-check again before delivering. " +
      "Where a finding names words to lower-case, keep genuine proper nouns capitalised.",
  ].join("\n");
}

/** 512 KB. A delivered artifact is tens of KB; a bundled React one can reach a
 *  few hundred. Past that it is not a document being QA'd. */
const MAX_CONTENT_CHARS = 512 * 1024;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export const designVoiceCheck: ToolDefinition = {
  slug: "design-voice-check",
  name: "Design voice check",
  description:
    "Check a design artifact's copy against the active design system's voice and tone rules: banned phrases, " +
    "wording to prefer, and heading and button capitalisation. Call this on the finished HTML before " +
    "sandbox-deliver-files, fix what it reports, then call it again. Pass the artifact in `content`. The design " +
    "system's voice rules are supplied automatically; pass `designMd` only when checking a system other than the " +
    "run's own. Reports issues — it does not block delivery.",
  source: "custom:voice-check",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The artifact to check — the full HTML document, or markdown.",
      },
      designMd: {
        type: "string",
        description:
          "Optional. A DESIGN.md (or just its `## Voice` section) to check against, overriding the run's own design system.",
      },
    },
    required: ["content"],
  },
  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const content = asString(params["content"]);
    if (!content.trim()) {
      return "Error: content is required — pass the artifact's HTML or markdown.";
    }
    // The check runs synchronously in the claw process, so an artifact far
    // larger than any real one would hold the event loop and stall other runs.
    // The scan itself is linear now, but a bound belongs here regardless: this
    // is a QA step on a document, not a bulk text pipeline.
    if (content.length > MAX_CONTENT_CHARS) {
      return (
        `Error: content is ${(content.length / 1024).toFixed(0)} KB, over the ` +
        `${MAX_CONTENT_CHARS / 1024} KB limit for one voice check. Check the ` +
        "document in parts, or check only the copy."
      );
    }
    // Explicit param wins, so a run can check against another system; otherwise
    // the run's own design system, pinned into meta by the runtime. The runtime
    // takes that pin from the prompt injection's result, so whatever reaches
    // here is what the model was given — see custom-tools.ts.
    //
    // KNOWN GAP, blocked on XYNE-66821. The injection it is taken from still
    // reads the legacy `agentConfig.designSystem`. Once that ticket lands its
    // `designSystemRef`, a chat pinned to system B would be checked against
    // system A — but the fix belongs in the injection, which that ticket owns,
    // and this now inherits whatever the injection decides.
    const designMd = asString(params["designMd"]) || asString(context?.meta?.["designVoice"]);
    if (!designMd.trim()) {
      return (
        "Voice QA: no voice rules are in effect for this run — it was given no design system, or its " +
        "system states no `## Voice` section — so there is nothing to check. Deliver as normal."
      );
    }
    return formatReport(runVoiceCheck({ content, designMd }));
  },
};
