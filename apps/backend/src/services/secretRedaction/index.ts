/**
 * Secret redaction for text going into Vespa.
 *
 * Runs gitleaks' built-in rules (compiled into rules.generated.ts) plus CUSTOM_RULES below,
 * and mirrors gitleaks' detection: keyword prefilter -> regex -> secret group -> entropy ->
 * global and rule allowlists. Patterns are Go RE2 syntax, so they run on re2js (linear time,
 * no catastrophic backtracking on user content).
 *
 * Not ported: gitleaks' base64/hex/url decoding pass and `gitleaks:allow` comments (chat
 * content must not be able to opt itself out).
 */
import { RE2JS } from 're2js';
import { GLOBAL_ALLOWLISTS, RULES } from './rules.generated';
import type { AllowlistSpec, RedactionResult, SecretFinding, SecretRuleSpec } from './types';

interface CompiledAllowlist {
  regexes: RE2JS[];
  regexTarget: 'secret' | 'match' | 'line';
  stopwords: string[];
}

interface CompiledRule {
  id: string;
  regex: RE2JS;
  keywords: string[];
  entropy?: number;
  secretGroup?: number;
  allowlists: CompiledAllowlist[];
}

const compileAllowlist = (a: AllowlistSpec): CompiledAllowlist => ({
  regexes: (a.regexes ?? []).map((r) => RE2JS.compile(r)),
  regexTarget: a.regexTarget ?? 'secret',
  stopwords: a.stopwords ?? [],
});

/** Our rules on top of gitleaks' built-ins, in the same shape. */
const CUSTOM_RULES: SecretRuleSpec[] = [
  {
    // LiteLLM virtual key: sk- plus secrets.token_urlsafe(16). Fixed length, so any non-key
    // character (`.`, `)`, `<`, ...) ends it, and `Bearer sk-...` is caught too.
    id: 'litellm-virtual-key',
    regex: String.raw`\b(sk-[A-Za-z0-9_-]{22})(?:[^A-Za-z0-9_-]|$)`,
    keywords: ['sk-'],
    entropy: 3.5,
  },
  {
    // Value of an x-web-logintoken header, e.g. from a pasted curl or request log.
    id: 'x-web-logintoken',
    regex: String.raw`(?i)x-web-logintoken["']?\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{16,})`,
    keywords: ['x-web-logintoken'],
    entropy: 3,
  },
  {
    id: 'pomerium-session-cookie',
    regex: String.raw`_pomerium=(eyJ[A-Za-z0-9_.\-]{40,})`, // group = value only, so the cookie name stays
    keywords: ['_pomerium='],
  },
];

/**
 * Extra allowlists for gitleaks rules, merged into that rule's own. Values under these names are
 * identifiers, not credentials (found as false positives in real chat).
 */
const CUSTOM_ALLOWLISTS: Record<string, AllowlistSpec[]> = {
  'generic-api-key': [
    {
      regexTarget: 'match',
      regexes: [
        String.raw`(?i)\bkey\s+sha(?:1|256|384|512):`, // SSH host-key fingerprints (public)
        String.raw`(?i)idempotency[_.-]?key|page[_.-]?token|token[_.-]?id|refund[_.-]?token`,
      ],
    },
  ],
};

/**
 * gitleaks' private-key rule matches from any BEGIN marker to the next `KEY-----`, so prose or code
 * that only quotes the markers would lose whole paragraphs. Returns the key's [start, end) inside
 * the match, or null when there is no key in it:
 * - a match closing on another BEGIN header ran into the next key, so it stops before that header;
 * - real PEM/PGP bodies always have a long base64 run, so a match without one is no key;
 * - the key starts at the BEGIN header nearest its data, not at a marker quoted earlier.
 */
function privateKeySpan(secret: string): [number, number] | null {
  const begins = [...secret.matchAll(/-----BEGIN/gi)].map((m) => m.index ?? 0);
  const lastBegin = begins[begins.length - 1] ?? -1;
  const lastEnd = [...secret.matchAll(/-----END/gi)].pop()?.index ?? -1;
  const cut = lastBegin > 0 && lastBegin > lastEnd ? lastBegin : secret.length; // 0 is its own header
  const data = secret.slice(0, cut).search(/[A-Za-z0-9+/=]{40,}/);
  if (data === -1) return null;
  const start = begins.filter((b) => b < data).pop() ?? 0;
  return [start, start + secret.slice(start, cut).trimEnd().length];
}

let compiled: { rules: CompiledRule[]; globalAllowlists: CompiledAllowlist[] } | null = null;

function getCompiled() {
  if (!compiled) {
    compiled = {
      rules: [...RULES, ...CUSTOM_RULES].map((r: SecretRuleSpec) => ({
        id: r.id,
        regex: RE2JS.compile(r.regex),
        keywords: r.keywords,
        entropy: r.entropy,
        secretGroup: r.secretGroup,
        allowlists: [...(r.allowlists ?? []), ...(CUSTOM_ALLOWLISTS[r.id] ?? [])].map(compileAllowlist),
      })),
      globalAllowlists: GLOBAL_ALLOWLISTS.map(compileAllowlist),
    };
  }
  return compiled;
}

/** gitleaks' entropy: counts per code point, divided by UTF-8 byte length. */
function shannonEntropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const len = Buffer.byteLength(s, 'utf8');
  let entropy = 0;
  for (const count of counts.values()) {
    const freq = count / len;
    entropy -= freq * Math.log2(freq);
  }
  return entropy;
}

function isAllowed(lists: CompiledAllowlist[], secret: string, match: string, line: string): boolean {
  const lowerSecret = secret.toLowerCase();
  return lists.some((a) => {
    const target = a.regexTarget === 'match' ? match : a.regexTarget === 'line' ? line : secret;
    const regexHit = target !== '' && a.regexes.some((r) => r.matcher(target).find());
    const stopwordHit = a.stopwords.some((w) => lowerSecret.includes(w));
    return regexHit || stopwordHit;
  });
}

function lineAround(text: string, start: number, end: number): string {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  return text.slice(lineStart, nl === -1 ? text.length : nl);
}

function detectRule(rule: CompiledRule, text: string, globalAllowlists: CompiledAllowlist[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const m = rule.regex.matcher(text);
  for (let from = 0; from <= text.length && m.find(from); ) {
    // Same as a plain find(): continue after this match (one past an empty one).
    from = m.end() > m.start() ? m.end() : m.start() + 1;
    const raw = m.group() ?? '';
    const lead = raw.length - raw.replace(/^\n+/, '').length;
    const match = raw.replace(/^\n+|\n+$/g, '');
    if (!match) continue;
    const matchStart = m.start() + lead;

    // Like gitleaks, the secret group comes from re-running the rule on the match alone.
    let secret = match;
    let secretOffset = 0;
    const sub = rule.regex.matcher(match);
    if (sub.find() && sub.groupCount() >= 1) {
      const groups = rule.secretGroup ? [rule.secretGroup] : Array.from({ length: sub.groupCount() }, (_, i) => i + 1);
      for (const g of groups) {
        if (g > sub.groupCount()) break;
        const value = sub.group(g);
        if (value) {
          secret = value;
          secretOffset = sub.start(g);
          break;
        }
      }
    }

    if (rule.entropy && shannonEntropy(secret) <= rule.entropy) continue;
    if (rule.id === 'private-key') {
      const span = privateKeySpan(secret);
      if (!span) {
        from = matchStart + 1; // a real key may start inside the rejected span
        continue;
      }
      const [keyStart, keyEnd] = span;
      if (keyEnd < secret.length) from = matchStart + keyEnd; // the cut-off header starts the next key
      secret = secret.slice(keyStart, keyEnd);
      secretOffset += keyStart;
    }

    const line = lineAround(text, matchStart, matchStart + match.length);
    if (isAllowed(globalAllowlists, secret, match, line)) continue;
    if (isAllowed(rule.allowlists, secret, match, line)) continue;

    const start = matchStart + secretOffset;
    findings.push({ ruleId: rule.id, start, end: start + secret.length });
  }
  return findings;
}

// gitleaks scans files in 100kb fragments, each extended to the next blank line (up to 25kb more).
// Same here: it keeps parity at fragment edges and keeps re2js cost linear on large documents.
const FRAGMENT_SIZE = 100_000;
const MAX_PEEK = 25_000;

function fragmentEnd(text: string, from: number): number {
  const end = Math.min(from + FRAGMENT_SIZE, text.length);
  const limit = Math.min(end + MAX_PEEK, text.length);
  let newlines = 0;
  for (let i = end; i < limit; i++) {
    const ch = text[i];
    if (ch === '\n') {
      if (++newlines >= 2) return i + 1;
    } else if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
      newlines = 0;
    }
  }
  return limit;
}

function findInFragment(fragment: string, offset: number, out: SecretFinding[]): void {
  const { rules, globalAllowlists } = getCompiled();
  const lower = fragment.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.length && !rule.keywords.some((k) => lower.includes(k))) continue;
    if (!rule.regex.test(fragment)) continue; // DFA check, much cheaper than the capturing matcher
    for (const f of detectRule(rule, fragment, globalAllowlists)) {
      out.push({ ruleId: f.ruleId, start: f.start + offset, end: f.end + offset });
    }
  }
}

const isGeneric = (ruleId: string) => ruleId.startsWith('generic-');
const CUSTOM_RULE_IDS = new Set(CUSTOM_RULES.map((r) => r.id));
/** Tie-break on an identical span: our rules, then gitleaks' specific rules, then generic ones. */
const labelRank = (ruleId: string) => (CUSTOM_RULE_IDS.has(ruleId) ? 0 : isGeneric(ruleId) ? 2 : 1);

export function findSecrets(text: string): SecretFinding[] {
  if (!text) return [];
  const findings: SecretFinding[] = [];
  for (let start = 0; start < text.length; ) {
    const end = fragmentEnd(text, start);
    findInFragment(text.slice(start, end), start, findings);
    start = end;
  }
  // gitleaks drops a generic finding when a specific rule already covers it. We only drop it when
  // it sits inside the specific span, so a second copy elsewhere on the line is still redacted.
  const specific = findings.filter((f) => !isGeneric(f.ruleId));
  const kept = findings.filter(
    (f) => !isGeneric(f.ruleId) || !specific.some((s) => s.start <= f.start && f.end <= s.end),
  );
  // Earliest first, longest first, then labelRank decides which rule names an identical span.
  return kept.sort((a, b) => a.start - b.start || b.end - a.end || labelRank(a.ruleId) - labelRank(b.ruleId));
}

export const redactionPlaceholder = (ruleId: string) => `[REDACTED:${ruleId}]`;

/** Replaces every detected secret with `[REDACTED:<rule-id>]`. Overlapping findings are merged. */
export function redactSecrets(text: string): RedactionResult {
  const findings = findSecrets(text);
  if (!findings.length) return { text, findings };

  let out = '';
  let cursor = 0;
  for (const f of findings) {
    if (f.end <= cursor) continue;
    if (f.start < cursor) {
      cursor = f.end; // extends the span already replaced
      continue;
    }
    out += text.slice(cursor, f.start) + redactionPlaceholder(f.ruleId);
    cursor = f.end;
  }
  out += text.slice(cursor);
  return { text: out, findings };
}

/**
 * Where redaction applies today: the free-text fields of chat messages, tickets and desk mail,
 * including the derived copies Vespa also indexes or embeds (`chunks`, `description_clean`). Field
 * list checked against vespa-core main. Other schemas, files included, pass through untouched.
 */
export const REDACTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  chat_message: ['text', 'chunks'],
  ticket: ['title', 'description', 'description_clean', 'chunks', 'initialMessage'],
  mail: ['subject', 'chunks'],
};

/** Redacts the schema's text fields in place. Returns the rule ids that fired. */
export function redactDocumentSecrets(schema: string | undefined, fields: Record<string, any>): string[] {
  const ruleIds: string[] = [];
  const redact = (value: string): string => {
    const result = redactSecrets(value);
    for (const f of result.findings) ruleIds.push(f.ruleId);
    return result.text;
  };
  for (const key of (schema && REDACTED_FIELDS[schema]) || []) {
    const value = fields[key];
    if (typeof value === 'string') fields[key] = redact(value);
    else if (Array.isArray(value)) fields[key] = value.map((v) => (typeof v === 'string' ? redact(v) : v));
  }
  return ruleIds;
}
