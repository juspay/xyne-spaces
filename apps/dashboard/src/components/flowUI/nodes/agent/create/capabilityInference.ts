/**
 * Job-semantic capability inference for Hub create.
 *
 * Product bar: users often won't name MCP / Slack / builtins. Infer needed
 * hubs from the job description so create can auto-select on the first go.
 * Prefer precision over recall for MCP — only bind products clearly implicated.
 */

export type CapabilityClass = 'mcp' | 'builtin' | 'subagent' | 'skills' | 'knowledge';

/**
 * Soft product cues: job language → catalog needles (MCP/gateway).
 * Precision rules:
 * - Slack only from Slack/standup (not bare DM — Spaces DM ≠ Slack)
 * - Spaces DM / Xyne Spaces → Spaces hubs
 * - Bare email/digest prefers builtins (see BUILTIN cues); Gmail/Outlook MCP
 *   only when those products are named
 * - X/Twitter needles must not collapse to a bare "x" substring
 */
export const SOFT_PRODUCT_CUES: ReadonlyArray<{ re: RegExp; needles: readonly string[] }> = [
  {
    re: /\b(slack|standup|stand-?up)\b/i,
    needles: ['slack'],
  },
  {
    // "eng channel" / "#channel" Slack-style — not Spaces channels when Spaces is named.
    re: /\b(?:eng|team|slack)\s+channel\b|\bchannel\s+(?:standup|digest|update|post)/i,
    needles: ['slack'],
  },
  {
    re: /\b(xyne\s*spaces|spaces?\s*dms?|\bin\s+spaces\b|\bspaces\s+(?:dm|dms|message|messages|channel))\b/i,
    needles: ['spaces', 'xyne-spaces', 'xyne spaces', 'xyne-spaces-app'],
  },
  {
    re: /\b(gmail|outlook|google\s*mail|google-mail)\b/i,
    needles: ['gmail', 'outlook', 'google-mail'],
  },
  {
    re: /\b(github|gh\b|pull.?requests?|\bprs?\b|repos?(itory)?|code\s*review)\b/i,
    needles: ['github', 'gh'],
  },
  { re: /\b(jira|tickets?|issue\s*tracker)\b/i, needles: ['jira'] },
  { re: /\b(notion)\b/i, needles: ['notion'] },
  { re: /\b(linear)\b/i, needles: ['linear'] },
  { re: /\b(discord)\b/i, needles: ['discord'] },
  { re: /\b(teams|microsoft\s*teams)\b/i, needles: ['teams', 'microsoft-teams'] },
  {
    re: /\b(calendar|schedule|meeting|invite)\b/i,
    needles: ['calendar', 'google-calendar'],
  },
  {
    // Do NOT include bare "x-" — normalizeToken("x-") === "x" matches Xyne Spaces.
    re: /\b(x\.com|twitter|tweets?)\b/i,
    needles: ['twitter', 'x.com'],
  },
  { re: /\b(confluence|wiki)\b/i, needles: ['confluence'] },
];

/**
 * Builtin capability cues — precision groups only.
 * Needles are matched against builtin label/source/tool slugs; keep them
 * specific so "agent" / "web" / "message" do not spray every custom:* row.
 */
export const BUILTIN_SOFT_CUES: ReadonlyArray<{
  re: RegExp;
  needles: readonly string[];
  /** Prefer entries whose label/source matches this (category gate). */
  entryRe: RegExp;
}> = [
  {
    re: /\b(e-?mails?|inbox|mails?\b|digest|send\s+email)\b/i,
    needles: ['send email', 'send-email', 'send_email', 'email'],
    entryRe: /send[-_\s]?email|e-?mail|^mail$|gmail/i,
  },
  {
    re: /\b(dm\b|dms\b|direct\s+messages?|send\s+messages?|spaces?\s*dms?)\b/i,
    needles: ['send message', 'send-message', 'send_message'],
    entryRe: /send[-_\s]?message/i,
  },
  {
    re: /\b(browse|web\s*search|web\s*fetch|webfetch|on\s+the\s+web|web\s+research|from\s+x\.com|from\s+twitter|look\s*up|competitor|researches?\b)\b/i,
    needles: ['web search', 'web-search', 'web_search', 'webfetch', 'web fetch'],
    entryRe: /web[-_\s]?search|webfetch|web[-_\s]?fetch|^browse$|research\s*agent/i,
  },
];

/** Explicit product / MCP / tool nouns (legacy named path). */
const EXPLICIT_TOOL_NOUN =
  /\b(mcp|tools?|integrations?|servers?|slack|github|jira|notion|linear|gmail|outlook|e-?mails?|discord|teams|calendars?|browse|web\s*search|x\.com|\btwitter\b|spaces?\s*dms?|xyne\s*spaces|sub-?agents?|delegate|delegat(?:e|ion))\b/i;

const BUILTIN_JOB =
  /\b(built-?ins?|browse|web\s*search|web\s*fetch|webfetch|filesystem|terminal|research|researches|search(?:es|ing)?|look\s*up|competitor|on\s+the\s+web|web\s+research|code\s*search|e-?mails?|inbox|mails?\b|digest|dm\b|dms\b|direct\s+messages?|send\s+(?:email|message)|from\s+x\.com|from\s+twitter)\b/i;

const SUBAGENT_JOB =
  /\b(sub-?agents?|delegate|delegat(?:e|ion)|research\s+agent|web-?research)\b/i;

const SKILL_JOB = /\b(skills?|workflow|recipe|playbook)\b/i;

const KNOWLEDGE_JOB =
  /\b(knowledge(?:\s+base)?|\bkb\b|my\s+docs?|our\s+docs?|documentation|confluence|wiki|handbook|product\s+docs?)\b/i;

/** External IO / messaging / tickets — implies an MCP (or gateway) even without product names. */
const MCP_JOB_IO =
  /\b(post|posts|send|sends|notify|notifies|message|messages|channel|inbox|e-?mails?|digest|standup|stand-?up|ticket|tickets|pull.?request|\bprs?\b|repo|repos|calendar|schedule|x\.com|twitter|spaces?\s*dms?|xyne\s*spaces)\b/i;

const EXPLICIT_SLACK = /\bslack\b/i;
const SPACES_MESSAGING =
  /\b(xyne\s*spaces|spaces?\s*dms?|\bin\s+spaces\b|\bspaces\s+(?:dm|dms|message|messages))\b/i;

export function softProductNeedles(intent: string): string[] {
  const needles: string[] = [];
  const seen = new Set<string>();
  for (const cue of SOFT_PRODUCT_CUES) {
    if (!cue.re.test(intent)) continue;
    for (const needle of cue.needles) {
      const key = needle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      needles.push(needle);
    }
  }
  // Spaces DM / Xyne Spaces wins over Slack spray — drop Slack unless named.
  if (SPACES_MESSAGING.test(intent) && !EXPLICIT_SLACK.test(intent)) {
    return needles.filter(n => normalizeLoose(n) !== 'slack');
  }
  return needles;
}

function normalizeLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Needles used to score/bind builtin catalog rows for this job. */
export function softBuiltinNeedles(intent: string): string[] {
  const needles: string[] = [];
  const seen = new Set<string>();
  for (const cue of BUILTIN_SOFT_CUES) {
    if (!cue.re.test(intent)) continue;
    for (const needle of cue.needles) {
      const key = needle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      needles.push(needle);
    }
  }
  return needles;
}

/** Active builtin cue categories for this job (precision gates for catalog rows). */
export function softBuiltinCuesForIntent(intent: string): typeof BUILTIN_SOFT_CUES[number][] {
  return BUILTIN_SOFT_CUES.filter(cue => cue.re.test(intent));
}

export function intentImpliesMcp(intent: string): boolean {
  if (EXPLICIT_TOOL_NOUN.test(intent)) return true;
  if (softProductNeedles(intent).length > 0) return true;
  return MCP_JOB_IO.test(intent);
}

export function intentImpliesBuiltin(intent: string): boolean {
  if (BUILTIN_JOB.test(intent)) return true;
  return softBuiltinNeedles(intent).length > 0;
}

export function intentImpliesSubagent(intent: string): boolean {
  return SUBAGENT_JOB.test(intent);
}

export function intentImpliesSkills(intent: string): boolean {
  return SKILL_JOB.test(intent);
}

export function intentImpliesKnowledge(intent: string): boolean {
  return KNOWLEDGE_JOB.test(intent);
}

/**
 * Capability classes the drafted job needs.
 * Empty for greetings / vague “make an agent” with no job nouns.
 */
export function inferNeededCapabilities(intent: string): CapabilityClass[] {
  const text = intent.trim();
  if (!text) return [];
  const needed: CapabilityClass[] = [];
  if (intentImpliesMcp(text)) needed.push('mcp');
  if (intentImpliesBuiltin(text)) needed.push('builtin');
  if (intentImpliesSubagent(text)) needed.push('subagent');
  if (intentImpliesSkills(text)) needed.push('skills');
  if (intentImpliesKnowledge(text)) needed.push('knowledge');
  return needed;
}

/** Hub draft fields to reveal from job semantics (tools / skills / knowledge). */
export function inferredCapabilityFields(
  text: string,
): Array<'tools' | 'skills' | 'knowledge'> {
  const needed = inferNeededCapabilities(text);
  const fields: Array<'tools' | 'skills' | 'knowledge'> = [];
  if (needed.includes('mcp') || needed.includes('builtin') || needed.includes('subagent')) {
    fields.push('tools');
  }
  if (needed.includes('skills')) fields.push('skills');
  if (needed.includes('knowledge')) fields.push('knowledge');
  return fields;
}
