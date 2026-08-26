import { logger } from '@/utils/logger';
import { config as appConfig } from '@/config/env';

/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) and leading
 * prose from an LLM response so it can be parsed as JSON.
 *
 * LLMs frequently wrap JSON in fences or prefix it with text like
 * "Here is the response:" despite "STRICT JSON only" instructions. This
 * recovers the JSON object/array without throwing.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const withoutOpeningFence = trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (withoutOpeningFence && withoutOpeningFence !== trimmed) {
    candidates.push(withoutOpeningFence);
  }

  // Best-effort candidate to return when nothing parses cleanly. Prefer the
  // fence-stripped text over the raw fenced text so downstream repair gets
  // markdown-free input.
  let bestEffort = withoutOpeningFence || trimmed;

  for (const candidate of candidates) {
    // Fast path: already valid JSON.
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // fall through to extraction
    }

    // Strip fenced blocks: ```json\n{...}\n``` or ```\n[...]\n```
    const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      const inner = fenceMatch[1].trim();
      try {
        JSON.parse(inner);
        return inner;
      } catch {
        if (inner) {
          bestEffort = inner;
        }
      }
    }

    // Some fragments drop object braces and start with a field key before the
    // first array/object value: items: [...] or items":[...]. Try wrapping that
    // before generic brace extraction, otherwise we would return only the array.
    const normalizedMemberCandidate = candidate
      .replace(/^([A-Za-z_$][\w$]*)"\s*:/, '"$1":')
      .replace(/^([A-Za-z_$][\w$]*)\s*:/, '"$1":');
    if (
      normalizedMemberCandidate !== candidate &&
      /^"[^"]+"\s*:/.test(normalizedMemberCandidate)
    ) {
      const wrapped = `{${normalizedMemberCandidate.replace(/,\s*$/, '')}}`;
      try {
        JSON.parse(wrapped);
        return wrapped;
      } catch {
        // fall through to generic brace extraction
      }
    }

    // Extract the outermost {...} or [...] span.
    const firstBrace = candidate.search(/[[{]/);
    if (firstBrace !== -1) {
      const opener = candidate[firstBrace];
      const closer = opener === '{' ? '}' : ']';
      const lastClose = candidate.lastIndexOf(closer);
      if (lastClose > firstBrace) {
        const slice = candidate.slice(firstBrace, lastClose + 1);
        try {
          JSON.parse(slice);
          return slice;
        } catch {
          // The brace slice is the cleanest malformed candidate we have;
          // prefer it for downstream repair over a fenced/raw string.
          bestEffort = slice;
        }
      }
    }

    // Some models omit the surrounding braces for section fragments while still
    // producing valid quoted JSON object members.
    if (/^"[^"]+"\s*:/.test(candidate)) {
      const wrapped = `{${candidate.replace(/,\s*$/, '')}}`;
      try {
        JSON.parse(wrapped);
        return wrapped;
      } catch {
        // give up below
      }
    }

  }

  // Return the best-effort (fence-stripped / brace-sliced) candidate rather
  // than the raw fenced text, so the caller's JSON.parse produces a meaningful
  // syntax error and a repair pass receives markdown-free input.
  return bestEffort;
}

/**
 * Parse an LLM response as JSON, tolerating markdown fences, leading/trailing
 * prose, and common syntax malformations (missing commas/colons, trailing
 * commas) via an in-house deterministic repair. Throws if the content still
 * cannot be parsed — the caller's fallback flow handles that.
 */
export function parseLlmJson(raw: string): unknown {
  const extracted = extractJson(raw);
  try {
    return JSON.parse(extracted);
  } catch {
    return JSON.parse(repairJson(extracted));
  }
}

/**
 * In-house, dependency-free JSON repair. CONSERVATIVE by design: it only
 * applies transforms that can never change the meaning of the data, so a
 * malformed response is either fixed correctly or left for the text-format
 * fallback (Tier 2). It never risks parsing-to-wrong-data.
 *
 * Fixes:
 *   - trailing commas before } or ]
 *   - missing commas, but ONLY when a value-end token is followed by a quoted
 *     KEY (a string immediately followed by ':'). This is unambiguous; the
 *     ambiguous "value then value" / missing-colon cases are deliberately left
 *     alone for the text fallback.
 *
 * Callers must try `JSON.parse` first and only call this on failure.
 */
export function repairJson(input: string): string {
  let s = input;

  // 1. Remove trailing commas before a closing } or ].
  s = s.replace(/,\s*([}\]])/g, '$1');

  // 2. Insert a missing comma before a quoted key ("...":) that follows a
  //    value-end token (closing quote, }, ], or a digit). The colon lookahead
  //    guarantees we only insert between value-then-KEY, never corrupting a
  //    missing-colon (key-then-value) case.
  s = s.replace(
    /(?<=[\"\}\]\d])(\s+)("(?:[^"\\]|\\.)*"\s*:)/g,
    ',$1$2'
  );

  return s;
}

/**
 * Lenient shape check used by the section fallback. True when `obj` is a plain
 * object whose own-keys are a subset of the shape's keys (the model may omit
 * optional fields). Array-typed shape values must correspond to arrays in `obj`
 * when present. Strict field/enum/evidence validation is done downstream by the
 * service normalization, so this only guards the top-level structure.
 */
export function validateShape(obj: unknown, outputShape: Record<string, unknown>): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  const record = obj as Record<string, unknown>;
  const shapeKeys = new Set(Object.keys(outputShape));
  for (const key of Object.keys(record)) {
    if (!shapeKeys.has(key)) {
      return false;
    }
  }
  // When a shape value is an array (e.g. ['string'] / [itemShape]) and the
  // model provided that key, it must be an array.
  for (const [key, shapeValue] of Object.entries(outputShape)) {
    if (Array.isArray(shapeValue) && key in record && !Array.isArray(record[key])) {
      // Coerce a single object into a one-element array rather than failing.
      if (record[key] && typeof record[key] === 'object') {
        record[key] = [record[key]];
      } else {
        record[key] = [];
      }
    }
  }
  return true;
}

/**
 * Parse a structured-text LLM response into records. Tolerates the format:
 *
 *   ### ITEM
 *   title: ...
 *   status: IN_PROGRESS
 *   projects: Dashboard, Analytics
 *   evidenceIds: commit_x9f2, ticket_TITEST-3
 *   ### ITEM
 *   ...
 *
 * Splits on `### ` headers (ITEM/FACT/WORK/etc.), reads `key: value` lines
 * (splitting on the FIRST colon), and keeps the rest as a single record. Blank
 * lines and leading prose are ignored. Values are returned as strings; callers
 * may coerce comma-separated values to arrays via `coerceArraysForShape`.
 */
export function parseStructuredText(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+(ITEM|FACT|WORK|BLOCKER|RISK|SIGNAL|DECISION|GAP|ENTRY|RECORD)\b/i.test(trimmed)) {
      if (current) {
        records.push(current);
      }
      current = {};
      continue;
    }
    if (!current) {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon <= 0) {
      // Non key:value line (prose, blank, fence). Ignore.
      continue;
    }
    const key = trimmed.slice(0, colon).trim().replace(/^["']|["']$/g, '');
    const value = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (!key) {
      continue;
    }
    current[key] = value;
  }
  if (current) {
    records.push(current);
  }
  return records;
}

/**
 * Given a parsed text record and the shape of one item, coerce comma-separated
 * string values into arrays for fields whose shape is an array, and drop keys
 * that are not part of the item shape.
 */
export function coerceItemForShape(
  record: Record<string, unknown>,
  itemShape: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, shapeValue] of Object.entries(itemShape)) {
    const raw = record[key];
    if (raw === undefined) {
      continue;
    }
    if (Array.isArray(shapeValue)) {
      const str = typeof raw === 'string' ? raw : String(raw);
      const items = str.split(',').map((part) => part.trim()).filter(Boolean);
      out[key] = items;
    } else {
      out[key] = typeof raw === 'string' ? raw : String(raw);
    }
  }
  return out;
}

function arrayShapeOf(outputShape: Record<string, unknown>): {
  key: string;
  itemShape: Record<string, unknown> | null;
} | null {
  for (const [key, value] of Object.entries(outputShape)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return { key, itemShape: value[0] as Record<string, unknown> };
    }
    if (Array.isArray(value)) {
      return { key, itemShape: null };
    }
  }
  return null;
}

function singleTopLevelArrayShapeOf(outputShape: Record<string, unknown>): {
  key: string;
  itemShape: Record<string, unknown> | null;
} | null {
  const keys = Object.keys(outputShape);
  if (keys.length !== 1) {
    return null;
  }
  const key = keys[0];
  const value = outputShape[key];
  if (!Array.isArray(value)) {
    return null;
  }
  if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
    return { key, itemShape: value[0] as Record<string, unknown> };
  }
  return { key, itemShape: null };
}

function shouldPreferTextFirst(outputShape: Record<string, unknown>): boolean {
  // Text-first is safest for the common extraction shape:
  // `{ items: [{ title, description, priority, ... }] }`.
  // Complex object sections still use JSON first because a flat text parser can
  // accidentally erase fields like momentum/direction/final summary.
  return singleTopLevelArrayShapeOf(outputShape) !== null;
}

function parsePipeRecord(
  line: string,
  itemShape: Record<string, unknown>
): Record<string, unknown> | null {
  const parts = line.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const shapeKeys = new Set(Object.keys(itemShape));
  const record: Record<string, unknown> = {};
  const priorityKey = ['priority', 'importance', 'severity', 'riskLevel']
    .find((key) => shapeKeys.has(key));
  if (priorityKey) {
    record[priorityKey] = parts.shift();
  }

  const statusKey = ['status', 'movement', 'category', 'type', 'signalType']
    .find((key) => shapeKeys.has(key));
  if (statusKey && parts.length > 2) {
    record[statusKey] = parts.shift();
  }

  const titleKey = ['title', 'action', 'question', 'signal', 'capability', 'decision']
    .find((key) => shapeKeys.has(key));
  if (titleKey && parts.length > 0) {
    record[titleKey] = parts.shift();
  }

  const detailKey = [
    'description',
    'text',
    'detail',
    'progress',
    'progressDescription',
    'whyCritical',
    'reason',
    'context',
    'impact',
    'recommendedAction',
    'why',
  ].find((key) => shapeKeys.has(key) && record[key] === undefined);
  if (detailKey && parts.length > 0) {
    record[detailKey] = parts.join(' | ');
  }

  return Object.keys(record).length > 0 ? record : null;
}

function parsePipeRecords(
  text: string,
  itemShape: Record<string, unknown>
): Record<string, unknown>[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line.includes('|'))
    .map((line) => parsePipeRecord(line, itemShape))
    .filter((record): record is Record<string, unknown> => record !== null);
}

/**
 * Build a typed object from a structured-text response, guided by the section's
 * outputShape. Handles the common `{ items: [itemShape] }` shape by returning
 * `{ items: [...] }`; otherwise wraps a single coerced record.
 */
export function buildObjectFromText(
  text: string,
  outputShape: Record<string, unknown>
): Record<string, unknown> {
  const arrayShape = arrayShapeOf(outputShape);
  let records = parseStructuredText(text);

  // Some models still return valid JSON despite a text-format request. Accept
  // it rather than turning it into an empty section.
  if (records.length === 0) {
    try {
      const parsed = parseLlmJson(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to pipe-line parsing / blank handling below.
    }
  }

  if (records.length === 0 && arrayShape?.itemShape) {
    records = parsePipeRecords(text, arrayShape.itemShape);
  }

  if (arrayShape?.itemShape) {
    return {
      [arrayShape.key]: records.map((record) =>
        coerceItemForShape(record, arrayShape.itemShape as Record<string, unknown>)
      ),
    };
  }
  if (arrayShape) {
    const items = records
      .map((record) => {
        const raw =
          record[arrayShape.key] ??
          record.text ??
          record.value ??
          record.summary ??
          Object.values(record).find((value) => String(value).trim());
        return raw === undefined ? '' : String(raw).trim();
      })
      .filter(Boolean);
    return { [arrayShape.key]: items };
  }
  return coerceItemForShape(records[0] ?? {}, outputShape);
}

/**
 * Produce a blank section object matching the shape (empty arrays / empty
 * strings) so a failed section flows through normalization as "no data" instead
 * of failing the whole job.
 */
export function blankForShape(outputShape: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, shapeValue] of Object.entries(outputShape)) {
    if (Array.isArray(shapeValue)) {
      out[key] = [];
    } else if (shapeValue && typeof shapeValue === 'object') {
      out[key] = {};
    } else {
      out[key] = '';
    }
  }
  return out;
}

/**
 * Maximum length for any single string value when compacting prior-section
 * context. Long prose (descriptions, progress, reasons) is truncated to its
 * first sentence-ish so the final synthesis call keeps the gist without paying
 * for the full text in every section it already generated.
 */
const PRIOR_SECTION_MAX_STRING_CHARS = 240;

/**
 * Produce a compact view of prior-section results for the final
 * `final-dependent-summary` call. The final section only synthesizes a
 * high-level executive summary + bullets + confidence from the section
 * outputs; it does not need full evidence-ref arrays or long prose fields.
 *
 * This drops `evidenceRefs` / `evidenceIds` arrays entirely (the final summary
 * does not re-cite per-item evidence) and truncates long string values. Object
 * identity keys (id, title, status, priority, etc.) are preserved. The output
 * shape is not changed — only the *context* passed to the final LLM call, so
 * the typed summary schema is unaffected.
 */
export function compactForPriorSections(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => compactForPriorSections(item));
  }
  if (!value || typeof value !== 'object') {
    return truncateString(value);
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === 'evidenceRefs' || key === 'evidenceIds') {
      continue;
    }
    out[key] = compactForPriorSections(child);
  }
  return out;
}

function truncateString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length <= PRIOR_SECTION_MAX_STRING_CHARS) {
    return value;
  }
  // Cut at the first newline or sentence boundary within the limit, then add an
  // ellipsis so the model knows it was trimmed.
  const slice = value.slice(0, PRIOR_SECTION_MAX_STRING_CHARS);
  const cut = Math.max(
    slice.lastIndexOf('\n'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? ')
  );
  return `${slice.slice(0, cut > 40 ? cut + 1 : PRIOR_SECTION_MAX_STRING_CHARS).trim()}…`;
}

export type TeamIntelligenceSectionScope = 'user' | 'team' | 'org';

type SectionConcurrencyValue = number | 'all';

// Cap wave-1 section parallelism per job. The LiteLLM key allows ~10
// concurrent requests shared across ALL consumers, so firing 10 (user) / 15
// (team) / 17 (org) sections at once saturates the budget and triggers 429s.
// 3 keeps a single job well under the cap with headroom for other jobs/workers.
const DEFAULT_SECTION_CONCURRENCY: Record<TeamIntelligenceSectionScope, SectionConcurrencyValue> = {
  user: 3,
  team: 3,
  org: 3,
};

function parseSectionConcurrency(value: string | undefined, maxConcurrency: number): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all' || normalized === 'max' || normalized === 'full') {
    return maxConcurrency;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function getTeamIntelligenceSectionConcurrency(
  scope: TeamIntelligenceSectionScope,
  maxConcurrency: number
): number {
  const max = Math.max(1, Math.floor(maxConcurrency));
  const scopedValue =
    scope === 'user'
      ? appConfig.teamIntelligence.userSectionConcurrency
      : scope === 'team'
        ? appConfig.teamIntelligence.teamSectionConcurrency
        : appConfig.teamIntelligence.orgSectionConcurrency;
  const configured =
    parseSectionConcurrency(appConfig.teamIntelligence.sectionConcurrency, max) ??
    parseSectionConcurrency(scopedValue, max);
  if (configured !== null) {
    return configured;
  }
  const defaultValue = DEFAULT_SECTION_CONCURRENCY[scope];
  return defaultValue === 'all' ? max : defaultValue;
}

type LlmGateContext = {
  scope: TeamIntelligenceSectionScope | 'digest';
  purpose: string;
  promptChars?: number;
};

type LlmGateWaiter = {
  context: LlmGateContext;
  enqueuedAt: number;
  resolve: (release: () => void) => void;
};

const DEFAULT_LLM_GLOBAL_CONCURRENCY = 8;
let activeTeamIntelligenceLlmCalls = 0;
const pendingTeamIntelligenceLlmCalls: LlmGateWaiter[] = [];

function getTeamIntelligenceLlmGlobalConcurrency(): number {
  const configured = Number(appConfig.teamIntelligence.llmGlobalConcurrency);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_LLM_GLOBAL_CONCURRENCY;
}

function releaseTeamIntelligenceLlmSlot(): void {
  activeTeamIntelligenceLlmCalls = Math.max(0, activeTeamIntelligenceLlmCalls - 1);
  drainTeamIntelligenceLlmQueue();
}

function drainTeamIntelligenceLlmQueue(): void {
  const max = getTeamIntelligenceLlmGlobalConcurrency();
  while (activeTeamIntelligenceLlmCalls < max && pendingTeamIntelligenceLlmCalls.length > 0) {
    const waiter = pendingTeamIntelligenceLlmCalls.shift();
    if (!waiter) {
      return;
    }
    activeTeamIntelligenceLlmCalls += 1;
    const waitMs = Date.now() - waiter.enqueuedAt;
    logger.info('[TEAM-INTEL-LLM-GATE] LLM slot acquired after queue wait', {
      ...waiter.context,
      waitMs,
      activeCalls: activeTeamIntelligenceLlmCalls,
      maxConcurrency: max,
      queuedCalls: pendingTeamIntelligenceLlmCalls.length,
    });
    waiter.resolve(releaseTeamIntelligenceLlmSlot);
  }
}

async function acquireTeamIntelligenceLlmSlot(context: LlmGateContext): Promise<() => void> {
  const max = getTeamIntelligenceLlmGlobalConcurrency();
  if (activeTeamIntelligenceLlmCalls < max && pendingTeamIntelligenceLlmCalls.length === 0) {
    activeTeamIntelligenceLlmCalls += 1;
    return releaseTeamIntelligenceLlmSlot;
  }

  logger.info('[TEAM-INTEL-LLM-GATE] LLM call queued', {
    ...context,
    activeCalls: activeTeamIntelligenceLlmCalls,
    maxConcurrency: max,
    queuedCalls: pendingTeamIntelligenceLlmCalls.length + 1,
  });

  return new Promise((resolve) => {
    pendingTeamIntelligenceLlmCalls.push({
      context,
      enqueuedAt: Date.now(),
      resolve,
    });
    drainTeamIntelligenceLlmQueue();
  });
}

export async function withTeamIntelligenceLlmSlot<T>(
  context: LlmGateContext,
  fn: () => Promise<T>
): Promise<T> {
  const release = await acquireTeamIntelligenceLlmSlot(context);
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

export function isTransientLlmCallError(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  while (current && typeof current === 'object') {
    const maybeMessage = (current as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') {
      messages.push(maybeMessage);
    }
    current = (current as { cause?: unknown }).cause;
  }
  if (messages.length === 0 && error !== undefined && error !== null) {
    messages.push(String(error));
  }
  const message = messages.join(' ').toLowerCase();
  return [
    '429',
    'too many requests',
    'rate limit',
    'terminated',
    'timeout',
    'timed out',
    'aborterror',
    'econnreset',
    'etimedout',
    'fetch failed',
    'socket hang up',
    '503',
    '502',
    '504',
  ].some((needle) => message.includes(needle));
}

/**
 * Derive a text-output prompt by appending a format override to the JSON prompt
 * the service already built. The JSON prompt contains the full evidence/identity
 * block, so reusing it preserves per-session data isolation. We only override
 * the output format: ask for `### ITEM / key: value` text instead of JSON.
 */
export function buildTextSectionPrompt(opts: {
  jsonPrompt: string;
  outputShape: Record<string, unknown>;
}): string {
  const arrayShape = arrayShapeOf(opts.outputShape);
  const itemShape = arrayShape?.itemShape ?? null;
  const fields = itemShape
    ? Object.keys(itemShape)
    : arrayShape
      ? ['text']
      : Object.keys(opts.outputShape);
  return [
    opts.jsonPrompt,
    '',
    'FINAL OUTPUT OVERRIDE: Ignore the earlier JSON-output instruction for this call.',
    'Do NOT output JSON. Do NOT use markdown tables. Output plain text items only.',
    'Use exactly this format (one block per item; omit a field if unsupported):',
    '### ITEM',
    ...fields.map((field) => `${field}: <value>`),
    'For array fields, use a comma-separated list on a single line.',
    'If there are no evidence-backed items, return no ITEM blocks.',
    'Use only evidence/signal ID values that appear in the input. Never invent evidence.',
  ].join('\n');
}

/**
 * Options for the 3-tier section fallback. `llmCall` is the service's bound
 * streaming generator (keeps each service's logging prefix/impl); it receives
 * the prompt and a purpose label.
 */
export interface SectionFallbackOptions {
  llmCall: (prompt: string, purpose: string) => Promise<string>;
  jsonPrompt: string;
  outputShape: Record<string, unknown>;
  purpose: string;
  label: string;
  logTag: string;
  preferTextFirst?: boolean;
}

/**
 * Run one section with fallback, returning a parseable object (or a
 * blank matching the shape) so the caller's normalization always gets valid
 * input and the job never fails on a single bad LLM response.
 *
 * For simple item-list sections, the primary tier is structured text because
 * it avoids malformed JSON and lets the backend own final schema construction.
 * Complex object sections use JSON first, then structured text, then blank.
 *
 * Each `llmCall` is stateless and single-message, scoped to the entity's own
 * evidence — no cross-user/team/org data can leak between calls.
 */
export async function runSectionWithFallback<T>(
  opts: SectionFallbackOptions
): Promise<T> {
  const runTextTier = async (purpose: string): Promise<T | null> => {
    const textPrompt = buildTextSectionPrompt({
      jsonPrompt: opts.jsonPrompt,
      outputShape: opts.outputShape,
    });
    const text = await opts.llmCall(textPrompt, purpose);
    const obj = buildObjectFromText(text, opts.outputShape);
    if (validateShape(obj, opts.outputShape)) {
      return obj as T;
    }
    return null;
  };

  const preferTextFirst = opts.preferTextFirst ?? shouldPreferTextFirst(opts.outputShape);
  if (preferTextFirst) {
    try {
      const obj = await runTextTier(`${opts.purpose}-text`);
      if (obj) {
        logger.info(`${opts.logTag} text tier completed`, {
          purpose: opts.purpose,
          label: opts.label,
          mode: 'text-first',
        });
        return obj;
      }
      logger.warn(`${opts.logTag} text parsed but shape invalid; trying JSON`, {
        purpose: opts.purpose,
        label: opts.label,
      });
    } catch (error) {
      if (isTransientLlmCallError(error)) {
        logger.warn(`${opts.logTag} text LLM call failed; blanking section without JSON retry`, {
          purpose: opts.purpose,
          label: opts.label,
          error: error instanceof Error ? error.message : String(error),
        });
        return blankForShape(opts.outputShape) as T;
      }
      logger.warn(`${opts.logTag} text tier failed; trying JSON`, {
        purpose: opts.purpose,
        label: opts.label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Tier 1: JSON (with in-house deterministic repair).
  try {
    const raw = await opts.llmCall(opts.jsonPrompt, opts.purpose);
    const obj = parseLlmJson(raw);
    if (validateShape(obj, opts.outputShape)) {
      return obj as T;
    }
    logger.warn(`${opts.logTag} JSON parsed but shape invalid; trying text`, {
      purpose: opts.purpose,
      label: opts.label,
    });
  } catch (error) {
    if (isTransientLlmCallError(error)) {
      logger.warn(`${opts.logTag} JSON LLM call failed; blanking section without text retry`, {
        purpose: opts.purpose,
        label: opts.label,
        error: error instanceof Error ? error.message : String(error),
      });
      return blankForShape(opts.outputShape) as T;
    }
    logger.warn(`${opts.logTag} JSON tier failed; trying text`, {
      purpose: opts.purpose,
      label: opts.label,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Tier 2: structured text -> object. Skip this when text was already the
  // primary tier; a bad JSON retry should not trigger a third LLM call.
  if (preferTextFirst) {
    logger.warn(`${opts.logTag} section blanked after text-first and JSON tiers failed`, {
      purpose: opts.purpose,
      label: opts.label,
    });
    return blankForShape(opts.outputShape) as T;
  }

  try {
    const obj = await runTextTier(`${opts.purpose}-text`);
    if (obj) {
      return obj;
    }
  } catch (error) {
    logger.warn(`${opts.logTag} text tier failed; blanking section`, {
      purpose: opts.purpose,
      label: opts.label,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Tier 3: blank — move on without failing the job.
  logger.warn(`${opts.logTag} section blanked after all tiers failed`, {
    purpose: opts.purpose,
    label: opts.label,
  });
  return blankForShape(opts.outputShape) as T;
}
