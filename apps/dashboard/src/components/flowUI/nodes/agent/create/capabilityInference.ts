/**
 * Job-semantic capability inference for Hub create.
 *
 * Product bar: users often won't name MCP / Slack / builtins. Infer needed
 * hubs from the job description so create can auto-select on the first go.
 * User not naming a product ≠ that capability is not needed.
 */

export type CapabilityClass = 'mcp' | 'builtin' | 'subagent' | 'skills' | 'knowledge';

/** Soft product cues: job language → catalog needles (no hard product name required). */
export const SOFT_PRODUCT_CUES: ReadonlyArray<{ re: RegExp; needles: readonly string[] }> = [
  {
    re: /\b(slack|standup|stand-?up|channel|thread|dm\b|direct message)\b/i,
    needles: ['slack'],
  },
  {
    re: /\b(e-?mails?|inbox|gmail|outlook|mails?\b|digest)\b/i,
    needles: ['gmail', 'outlook', 'google-mail', 'email', 'mail'],
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
  { re: /\b(x\.com|twitter|tweets?)\b/i, needles: ['twitter', 'x.com', 'x-'] },
  { re: /\b(confluence|wiki)\b/i, needles: ['confluence'] },
];

/** Explicit product / MCP / tool nouns (legacy named path). */
const EXPLICIT_TOOL_NOUN =
  /\b(mcp|tools?|integrations?|servers?|slack|github|jira|notion|linear|gmail|outlook|e-?mails?|discord|teams|calendars?|browse|web\s*search|x\.com|\btwitter\b|sub-?agents?|delegate|delegat(?:e|ion))\b/i;

const BUILTIN_JOB =
  /\b(built-?ins?|browse|web\s*search|filesystem|terminal|research|researches|search(?:es|ing)?|look\s*up|competitor|on\s+the\s+web|web\s+research|code\s*search)\b/i;

const SUBAGENT_JOB =
  /\b(sub-?agents?|delegate|delegat(?:e|ion)|research\s+agent|web-?research)\b/i;

const SKILL_JOB = /\b(skills?|workflow|recipe|playbook)\b/i;

const KNOWLEDGE_JOB =
  /\b(knowledge(?:\s+base)?|\bkb\b|my\s+docs?|our\s+docs?|documentation|confluence|wiki|handbook|product\s+docs?)\b/i;

/** External IO / messaging / tickets — implies an MCP (or gateway) even without product names. */
const MCP_JOB_IO =
  /\b(post|posts|send|sends|notify|notifies|message|messages|channel|inbox|e-?mails?|digest|standup|stand-?up|ticket|tickets|pull.?request|\bprs?\b|repo|repos|calendar|schedule)\b/i;

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
  return needles;
}

export function intentImpliesMcp(intent: string): boolean {
  if (EXPLICIT_TOOL_NOUN.test(intent)) return true;
  if (softProductNeedles(intent).length > 0) return true;
  return MCP_JOB_IO.test(intent);
}

export function intentImpliesBuiltin(intent: string): boolean {
  return BUILTIN_JOB.test(intent);
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
