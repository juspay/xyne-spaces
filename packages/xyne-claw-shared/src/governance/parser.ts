import { buildMatcher, type Matcher } from "./aho-corasick.js";
import { sha256Hex } from "./canonical.js";
import { decodeSegments, type DecodedKind } from "./decode.js";
import { isWordUnit, normalizeText } from "./normalize.js";
import { PROFILES, resolveProfile } from "./profiles.js";
import { DEFAULT_PACKS } from "./rules/index.js";
import { CONTENT_KINDS, DYNAMIC_CONTENT_KINDS, PARSER_VERSION, worstVerdict } from "./types.js";
import type {
  ContentKind,
  Finding,
  FindingSource,
  ParserResult,
  Rule,
  RuleFamily,
  RulePack,
  ScanInput,
  ScanOptions,
  Signal,
  SignalKind,
  Span,
  Verdict,
} from "./types.js";

export interface CompiledPacks {
  rules: readonly Rule[];
  /** Lowercased phrases per rule, and the long ones with non-letters removed for letter-spaced runs. */
  phrases: readonly (readonly string[])[];
  squeezed: readonly (readonly string[])[];
  regexes: readonly (RegExp | null)[];
  matcher: Matcher;
  squeezedMatcher: Matcher;
  version: string;
}

// Keyed by reference: a host keeps one packs array, or pays a recompile per scan.
const CACHE = new WeakMap<readonly RulePack[], CompiledPacks>();
const MIN_SQUEEZED = 10;
const MAX_HITS_PER_RULE = 20;
const DYNAMIC: ReadonlySet<string> = new Set(DYNAMIC_CONTENT_KINDS);
const DECODED_SIGNAL: Record<DecodedKind, SignalKind> = {
  base64: "decoded_base64",
  hex: "decoded_hex",
  percent: "decoded_percent",
  entities: "decoded_entities",
  letter_spacing: "letter_spacing",
};

export function compilePacks(packs: readonly RulePack[]): CompiledPacks {
  const cached = CACHE.get(packs);
  if (cached) return cached;
  const rules = packs.flatMap((p) => p.rules);
  const phrases = rules.map((r) => (r.phrases ?? []).map((p) => p.toLowerCase()));
  const squeezed = phrases.map((list) => list.map((p) => p.replace(/[^a-z]/g, "")).filter((p) => p.length >= MIN_SQUEEZED));
  const entries = phrases.flatMap((list, ruleIndex) => list.map((phrase) => ({ phrase, ruleIndex })));
  const squeezedEntries = squeezed.flatMap((list, ruleIndex) => list.map((phrase) => ({ phrase, ruleIndex })));
  const regexes = rules.map((r) => (r.pattern === undefined ? null : new RegExp(r.pattern, (r.flags ?? "").replace(/g/g, "") + "g")));
  const compiled: CompiledPacks = {
    rules,
    phrases,
    squeezed,
    regexes,
    matcher: buildMatcher(entries),
    squeezedMatcher: buildMatcher(squeezedEntries),
    version: `parser-${PARSER_VERSION}+${sha256Hex(JSON.stringify([packs, PROFILES])).slice(0, 12)}`,
  };
  CACHE.set(packs, compiled);
  return compiled;
}

export function scannerVersion(packs: readonly RulePack[]): string {
  return compilePacks(packs).version;
}

interface View {
  text: string;
  flat: string;
  source: FindingSource;
  decoded?: DecodedKind;
  /** Only the squeezed phrases apply: the view has no separators. */
  squeezed?: boolean;
  /** Only the outbound hard rules apply: the view is the whole argument, past the size bound. */
  outboundOnly?: boolean;
  span(start: number, end: number): Span;
}

const OUTBOUND_MAX = 4 * 1024 * 1024;

/** The text without whitespace, so a key typed in groups still has its shape; map[i] is the source index of unit i. */
function squeezeSpaces(text: string): { text: string; map: Uint32Array } {
  const map = new Uint32Array(text.length);
  const parts: string[] = [];
  let j = 0;
  let runStart = -1;
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? text.charCodeAt(i) : 0x20;
    const space = c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0xa0;
    if (!space) {
      if (runStart < 0) runStart = i;
      map[j++] = i;
    } else if (runStart >= 0) {
      parts.push(text.slice(runStart, i));
      runStart = -1;
    }
  }
  return { text: parts.join(""), map: map.subarray(0, j) };
}

interface Hit {
  weight: number;
  span: Span;
  excerpt: string;
  source: FindingSource;
}

function longestEndingAt(list: readonly string[], flat: string, end: number): string {
  let best = "";
  for (const p of list) if (p.length > best.length && flat.endsWith(p, end)) best = p;
  return best;
}

function visibleCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x20 && c < 0x7f) n++;
  }
  return n;
}

function excerptOf(text: string, family: RuleFamily): string {
  const masked = family === "secrets" && text.length > 6 ? text.slice(0, 4) + "*".repeat(text.length - 6) + text.slice(-2) : text;
  return masked.slice(0, 80);
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

export function scanText(input: ScanInput, opts: ScanOptions = {}): ParserResult {
  let kind: ContentKind = "tool_result";
  const findings: Finding[] = [];
  let compiled: CompiledPacks | undefined;
  try {
    if (CONTENT_KINDS.includes(input?.kind)) kind = input.kind;
    compiled = compilePacks(opts.packs ?? DEFAULT_PACKS);
    const { rules, phrases, squeezed, regexes } = compiled;
    const profile = resolveProfile(kind, opts.profile);
    const text = typeof input?.text === "string" ? input.text : "";
    const outbound = input?.outbound === true;
    const now = opts.now ?? Date.now;
    const deadline = opts.deadlineMs;
    const pastDeadline = (): boolean => deadline !== undefined && now() > deadline;
    // A hard rule decides alone for content that becomes static; in dynamic text it flags, except for outbound arguments.
    const hardHere = (r: Rule): boolean => r.hard === true && (r.outboundOnly === true || !DYNAMIC.has(kind));

    // Effective weight per rule for phrase and regex hits; -1 when the rule does not apply to this input.
    const phraseWeight = new Float64Array(rules.length).fill(-1);
    const regexWeight = new Float64Array(rules.length).fill(-1);
    const disabled = new Set(profile.disabledFamilies ?? []);
    rules.forEach((r, i) => {
      const applies =
        (r.kinds === undefined || r.kinds.includes(kind)) &&
        !(r.excludeKinds?.includes(kind) ?? false) &&
        (!r.outboundOnly || outbound) &&
        !disabled.has(r.family);
      if (!applies) return;
      const family = profile.familyMultipliers?.[r.family] ?? 1;
      phraseWeight[i] = r.weight * profile.phraseMultiplier * family;
      regexWeight[i] = r.weight * profile.regexMultiplier * family;
    });

    const norm = normalizeText(text, profile.maxBytes);
    const { map } = norm;
    const signals: Signal[] = norm.signals.slice();
    const mapSpan = (start: number, end: number): Span => {
      if (end <= start || end > map.length) return { start: 0, end: 0 };
      const last = map[end - 1]!;
      const c = text.charCodeAt(last);
      const pair = c >= 0xd800 && c < 0xdc00 && text.charCodeAt(last + 1) >= 0xdc00 && text.charCodeAt(last + 1) < 0xe000;
      return { start: map[start]!, end: last + (pair ? 2 : 1) };
    };
    const first = norm.hiddenSpans[0];
    const lastHidden = norm.hiddenSpans[norm.hiddenSpans.length - 1];
    const hiddenSpan: Span = first && lastHidden ? { start: first.start, end: lastHidden.end } : { start: 0, end: 0 };
    const hiddenVisible = visibleCount(norm.hidden);
    let hard = false;
    if (hiddenVisible >= 3) {
      hard = true;
      findings.push({
        ruleId: "hidden.payload",
        family: "hidden_unicode",
        reasonCode: "GOV-HIDDEN-PAYLOAD",
        verdict: "injection",
        score: 1,
        span: hiddenSpan,
        excerpt: norm.hidden.slice(0, 80),
        source: "hidden_payload",
        foundByCheck: "parser",
      });
    }

    // The words view only serves phrases: regexes need the punctuation it drops.
    const wm = norm.wordsMap;
    const views: View[] = [
      { text: norm.folded, flat: norm.flat, source: "text", span: mapSpan },
      { text: "", flat: norm.words, source: "text", span: (s, e) => mapSpan(wm[s]!, wm[e - 1]! + 1) },
    ];
    if (hiddenVisible > 0) views.push({ text: norm.hidden, flat: norm.hidden.toLowerCase(), source: "hidden_payload", span: () => hiddenSpan });
    const decoded = decodeSegments(norm.folded);
    for (const d of decoded.views) {
      const span = (): Span => mapSpan(d.span.start, d.span.end);
      if (d.kind === "letter_spacing") {
        views.push({ text: "", flat: d.text.toLowerCase(), source: "decoded", decoded: d.kind, squeezed: true, span });
        continue;
      }
      const nd = normalizeText(d.text, profile.maxBytes);
      views.push({ text: nd.folded, flat: nd.flat, source: "decoded", decoded: d.kind, span });
      views.push({ text: "", flat: nd.words, source: "decoded", decoded: d.kind, span });
    }
    if (decoded.capped) signals.push({ kind: "decoder_capped", count: 1, weight: 0 });
    if (outbound && text.length <= OUTBOUND_MAX) {
      // A secret must not leave in any form: the whole argument and the argument with its whitespace removed.
      const raw = (s: number, e: number): Span => ({ start: s, end: e });
      views.push({ text, flat: "", source: "text", outboundOnly: true, span: raw });
      const sq = squeezeSpaces(text);
      if (sq.text.length < text.length) {
        views.push({ text: sq.text, flat: "", source: "text", outboundOnly: true, span: (s, e) => raw(sq.map[s]!, sq.map[e - 1]! + 1) });
      }
    }

    const best: (Hit | undefined)[] = new Array<Hit | undefined>(rules.length);
    const decodedHits = new Map<DecodedKind, number>();
    let budgetExceeded = false;
    let hits = 0;
    const record = (ri: number, weight: number, span: Span, matched: string, source: FindingSource): void => {
      hits++;
      const cur = best[ri];
      if (cur && cur.weight >= weight) return;
      best[ri] = { weight, span, excerpt: matched, source };
    };

    views: for (const v of views) {
      if (pastDeadline()) {
        budgetExceeded = true;
        break;
      }
      const before = hits;
      if (v.squeezed) {
        compiled.squeezedMatcher.scan(v.flat, (ri, end) => {
          if (phraseWeight[ri]! < 0) return;
          record(ri, phraseWeight[ri]!, v.span(0, v.flat.length), longestEndingAt(squeezed[ri]!, v.flat, end), v.source);
        });
      } else {
        const counts = new Uint8Array(rules.length);
        compiled.matcher.scan(v.flat, (ri, end) => {
          if (phraseWeight[ri]! < 0 || counts[ri]! >= MAX_HITS_PER_RULE) return;
          const phrase = longestEndingAt(phrases[ri]!, v.flat, end);
          const start = end - phrase.length;
          // A phrase that starts or ends with a word character must sit on a word boundary.
          if (isWordUnit(phrase.charCodeAt(0)) && start > 0 && isWordUnit(v.flat.charCodeAt(start - 1))) return;
          if (isWordUnit(phrase.charCodeAt(phrase.length - 1)) && end < v.flat.length && isWordUnit(v.flat.charCodeAt(end))) return;
          counts[ri]!++;
          record(ri, phraseWeight[ri]!, v.span(start, end), phrase, v.source);
        });
        for (let ri = 0; ri < rules.length && v.text !== ""; ri++) {
          const re = regexes[ri];
          if (re === null || re === undefined || regexWeight[ri]! < 0 || (v.outboundOnly && rules[ri]!.outboundOnly !== true)) continue;
          if (pastDeadline()) {
            budgetExceeded = true;
            break views;
          }
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          for (let k = 0; k < MAX_HITS_PER_RULE && (m = re.exec(v.text)) !== null; k++) {
            if (m[0].length === 0) re.lastIndex++;
            record(ri, regexWeight[ri]!, v.span(m.index, m.index + m[0].length), m[0], v.source);
          }
        }
      }
      if (v.decoded !== undefined && hits > before) decodedHits.set(v.decoded, (decodedHits.get(v.decoded) ?? 0) + 1);
    }

    for (const [k, count] of decodedHits) signals.push({ kind: DECODED_SIGNAL[k], count, weight: 0.15 });
    // One weight per family, so two rules for the same attack shape do not double count.
    const families = new Map<RuleFamily, number>();
    for (let ri = 0; ri < rules.length; ri++) {
      const hit = best[ri];
      if (!hit) continue;
      const r = rules[ri]!;
      const w = Math.min(1, Math.max(0, hit.weight));
      const hardRule = hardHere(r);
      if (hardRule) hard = true;
      families.set(r.family, Math.max(families.get(r.family) ?? 0, w));
      if (w < 0.1 && !hardRule) continue;
      findings.push({
        ruleId: r.id,
        family: r.family,
        reasonCode: r.reasonCode,
        verdict: hardRule ? "injection" : w >= profile.flagAt ? "suspicious" : "unsure",
        score: round(w),
        span: hit.span,
        excerpt: excerptOf(hit.excerpt, r.family),
        source: hit.source,
        foundByCheck: "parser",
      });
    }
    let clear = hard ? 0 : 1;
    for (const w of families.values()) clear *= 1 - w;
    for (const s of signals) clear *= 1 - s.weight;
    const score = round(1 - clear);
    findings.sort((a, b) => b.score - a.score);
    const band: Verdict = score >= profile.flagAt ? "suspicious" : score >= profile.unsureAt ? "unsure" : "clean";
    const floor: Verdict = budgetExceeded || decoded.capped || norm.truncated ? "unverified" : "clean";
    return {
      verdict: hard ? "injection" : worstVerdict(band, floor),
      score,
      findings,
      signals,
      scannerVersion: compiled.version,
      kind,
      truncated: norm.truncated,
      budgetExceeded,
      ...(hiddenVisible > 0 ? { hiddenPayload: norm.hidden.slice(0, 1024) } : {}),
    };
  } catch {
    const kept = findings.filter((f) => f.verdict === "injection");
    return {
      verdict: kept.length > 0 ? "injection" : "unverified",
      score: kept.length > 0 ? 1 : 0,
      findings: kept,
      signals: [],
      scannerVersion: compiled?.version ?? `parser-${PARSER_VERSION}`,
      kind,
      truncated: false,
      budgetExceeded: false,
    };
  }
}
