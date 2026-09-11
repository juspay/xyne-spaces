// Rules file: JSON shape, validation and normalisation into Rule objects.
import { z } from 'zod';

import type { CacheMode } from '../contentType.js';

const valueMatcherSchema = z
  .object({
    name: z.string().min(1),
    exact: z.string().optional(),
    regex: z.string().min(1).optional(),
  })
  .strict();

const userAgentMatcherSchema = z.object({ regex: z.string().min(1) }).strict();

const matchSchema = z
  .object({
    path_prefix: z.string().startsWith('/').optional(),
    path_regex: z.string().min(1).optional(),
    header: valueMatcherSchema.optional(),
    cookie: valueMatcherSchema.optional(),
    user_agent: userAgentMatcherSchema.optional(),
  })
  .strict();

const ruleSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_.-]+$/, 'id must match [A-Za-z0-9_.-]+'),
    match: matchSchema,
    bundle: z.string().min(1),
    version: z.union([z.string(), z.number()]).optional(),
    cache: z.enum(['versioned', 'never', 'ttl']).default('versioned'),
    ttl: z.union([z.string(), z.number()]).optional(),
    strip_prefix: z.string().optional(),
  })
  .strict();

const rulesFileSchema = z.object({ rules: z.array(ruleSchema).min(1) }).strict();

export type RawRule = z.infer<typeof ruleSchema>;
export type RawMatch = z.infer<typeof matchSchema>;

export interface ValueMatcher {
  name: string;
  exact?: string;
  regex?: RegExp;
}

export interface Matchers {
  pathPrefix?: string;
  pathRegex?: RegExp;
  header?: ValueMatcher;
  cookie?: ValueMatcher;
  userAgent?: { regex: RegExp };
}

export interface Rule {
  id: string;
  match: Matchers;
  /** The match block as written, for /_edge/status. */
  matchSpec: RawMatch;
  bundle: string;
  version: string;
  cache: CacheMode;
  ttl?: number;
  stripPrefix?: string;
  /** False when the bundle is missing and there was no previous target to keep. */
  enabled: boolean;
  healthy: boolean;
  error?: string;
  /** Origin fingerprint of <bundle>/index.html; part of the cache key. */
  fingerprint?: string;
}

export type ParseResult = { ok: true; rules: Rule[] } | { ok: false; error: string };

export function isDynamicBundle(template: string): boolean {
  return /\$\d/.test(template);
}

function parseDuration(value: string | number): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  const match = /^(\d+)([smh]?)$/.exec(value);
  if (!match) {
    return undefined;
  }
  const n = Number(match[1]);
  switch (match[2]) {
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    default:
      return n;
  }
}

function compileRegex(source: string, where: string): RegExp | string {
  try {
    return new RegExp(source);
  } catch (err) {
    return `${where}: bad regex ${JSON.stringify(source)}: ${(err as Error).message}`;
  }
}

function normaliseValueMatcher(
  spec: z.infer<typeof valueMatcherSchema>,
  where: string,
): ValueMatcher | string {
  if (spec.exact === undefined && spec.regex === undefined) {
    return `${where} needs exact or regex`;
  }
  const out: ValueMatcher = { name: spec.name };
  if (spec.exact !== undefined) {
    out.exact = spec.exact;
  }
  if (spec.regex !== undefined) {
    const re = compileRegex(spec.regex, where);
    if (typeof re === 'string') {
      return re;
    }
    out.regex = re;
  }
  return out;
}

function normaliseRule(raw: RawRule): Rule | string {
  const where = `rule ${raw.id}`;
  const m = raw.match;
  if (Object.keys(m).length === 0) {
    return `${where}: match needs at least one matcher`;
  }

  const match: Matchers = {};
  if (m.path_prefix !== undefined) {
    match.pathPrefix = m.path_prefix;
  }
  if (m.path_regex !== undefined) {
    const re = compileRegex(m.path_regex, `${where}: path_regex`);
    if (typeof re === 'string') {
      return re;
    }
    match.pathRegex = re;
  }
  if (m.header !== undefined) {
    const vm = normaliseValueMatcher(
      { ...m.header, name: m.header.name.toLowerCase() },
      `${where}: header`,
    );
    if (typeof vm === 'string') {
      return vm;
    }
    match.header = vm;
  }
  if (m.cookie !== undefined) {
    const vm = normaliseValueMatcher(m.cookie, `${where}: cookie`);
    if (typeof vm === 'string') {
      return vm;
    }
    match.cookie = vm;
  }
  if (m.user_agent !== undefined) {
    const re = compileRegex(m.user_agent.regex, `${where}: user_agent`);
    if (typeof re === 'string') {
      return re;
    }
    match.userAgent = { regex: re };
  }

  const bundle = raw.bundle;
  if (
    !/^[A-Za-z0-9._$/-]+$/.test(bundle) ||
    bundle.includes('..') ||
    bundle.startsWith('/') ||
    bundle.endsWith('/')
  ) {
    return `${where}: bundle ${JSON.stringify(bundle)} is not a valid bucket prefix`;
  }
  const refs = [...bundle.matchAll(/\$(\d)/g)].map((x) => Number(x[1]));
  if (refs.length > 0) {
    const hasRegex =
      match.pathRegex !== undefined ||
      match.header?.regex !== undefined ||
      match.cookie?.regex !== undefined ||
      match.userAgent !== undefined;
    if (!hasRegex) {
      return `${where}: bundle uses $${Math.max(...refs)} but no regex matcher provides captures`;
    }
  }

  let version = '1';
  if (typeof raw.version === 'number') {
    version = String(Math.floor(raw.version));
  } else if (typeof raw.version === 'string') {
    if (!/^[A-Za-z0-9._-]+$/.test(raw.version)) {
      return `${where}: version must be a number or [A-Za-z0-9._-]+`;
    }
    version = raw.version;
  }

  const rule: Rule = {
    id: raw.id,
    match,
    matchSpec: m,
    bundle,
    version,
    cache: raw.cache,
    enabled: true,
    healthy: true,
  };

  if (raw.cache === 'ttl') {
    const ttl = raw.ttl === undefined ? undefined : parseDuration(raw.ttl);
    if (ttl === undefined || ttl <= 0) {
      return `${where}: cache ttl needs ttl like 60, "60s" or "5m"`;
    }
    rule.ttl = ttl;
  }

  if (raw.strip_prefix !== undefined) {
    if (!raw.strip_prefix.startsWith('/')) {
      return `${where}: strip_prefix must start with /`;
    }
    const trimmed = raw.strip_prefix.replace(/\/+$/, '');
    if (trimmed !== '') {
      rule.stripPrefix = trimmed;
    }
  }

  return rule;
}

function isCatchAll(rule: Rule): boolean {
  const keys = Object.keys(rule.matchSpec);
  return keys.length === 1 && rule.match.pathPrefix === '/';
}

/** Parse and validate the rules file text. */
export function parseRules(text: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `rules file is not valid JSON: ${(err as Error).message}` };
  }
  const parsed = rulesFileSchema.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    return {
      ok: false,
      error: `rules file invalid at ${path || '<root>'}: ${issue?.message ?? 'unknown'}`,
    };
  }

  const rules: Rule[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.data.rules) {
    const rule = normaliseRule(raw);
    if (typeof rule === 'string') {
      return { ok: false, error: rule };
    }
    if (seen.has(rule.id)) {
      return { ok: false, error: `duplicate rule id ${JSON.stringify(rule.id)}` };
    }
    seen.add(rule.id);
    rules.push(rule);
  }

  const last = rules[rules.length - 1] as Rule;
  if (!isCatchAll(last) || isDynamicBundle(last.bundle)) {
    return {
      ok: false,
      error: `last rule (${last.id}) must be the default: match only path_prefix "/" with a static bundle`,
    };
  }
  return { ok: true, rules };
}
