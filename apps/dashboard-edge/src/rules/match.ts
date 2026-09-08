// Pure request-to-bundle matching: rules x request -> bundle + object.
import type { CacheMode } from '../contentType.js';
import { isDynamicBundle, type Rule, type ValueMatcher } from './schema.js';

export interface RequestView {
  /** Normalised, decoded request path (nginx's $uri). */
  path: string;
  /** Header names lower-cased. */
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
  userAgent: string;
}

export interface Resolution {
  rule: Rule;
  bundle: string;
  version: string;
  fingerprint?: string;
  object: string;
  cache: CacheMode;
  ttl?: number;
}

export interface Skipped {
  id: string;
  reason: string;
}

export type Existence =
  | { exists: true; fingerprint: string }
  | { exists: false }
  | { error: string };

export type ExistsFn = (bundle: string) => Promise<Existence>;

/**
 * Turn a request path into the object key inside a bundle prefix.
 * strip_prefix is removed first, "/" and "" become index.html, and a trailing
 * "/" gets index.html appended. Parent segments are refused.
 */
export function objectPath(rule: Pick<Rule, 'stripPrefix'>, path: string): string | null {
  let p = path || '/';
  const prefix = rule.stripPrefix;
  if (prefix) {
    if (p === prefix) {
      p = '/';
    } else if (p.startsWith(`${prefix}/`)) {
      p = p.slice(prefix.length);
    }
  }
  if (p.split('/').includes('..')) {
    return null;
  }
  if (p.endsWith('/')) {
    p += 'index.html';
  }
  p = p.replace(/^\/+/, '');
  return p === '' ? 'index.html' : p;
}

function regexCaptures(subject: string | undefined, regex: RegExp, captures: string[]): boolean {
  if (subject === undefined) {
    return false;
  }
  const m = regex.exec(subject);
  if (!m) {
    return false;
  }
  for (let i = 1; i < m.length; i += 1) {
    captures.push(m[i] ?? '');
  }
  return true;
}

function valueMatches(
  subject: string | undefined,
  spec: ValueMatcher,
  captures: string[],
): boolean {
  if (spec.exact !== undefined) {
    return subject === spec.exact;
  }
  return spec.regex !== undefined && regexCaptures(subject, spec.regex, captures);
}

/**
 * Every matcher present in the rule must hold. Captures are the numbered
 * groups of every regex matcher in the order path_regex, header, cookie,
 * user_agent.
 */
export function matchRule(rule: Rule, req: RequestView): { ok: boolean; captures: string[] } {
  const m = rule.match;
  const captures: string[] = [];
  if (m.pathPrefix !== undefined && !req.path.startsWith(m.pathPrefix)) {
    return { ok: false, captures };
  }
  if (m.pathRegex !== undefined && !regexCaptures(req.path, m.pathRegex, captures)) {
    return { ok: false, captures };
  }
  if (m.header !== undefined && !valueMatches(req.headers[m.header.name], m.header, captures)) {
    return { ok: false, captures };
  }
  if (m.cookie !== undefined && !valueMatches(req.cookies[m.cookie.name], m.cookie, captures)) {
    return { ok: false, captures };
  }
  if (m.userAgent !== undefined && !regexCaptures(req.userAgent, m.userAgent.regex, captures)) {
    return { ok: false, captures };
  }
  return { ok: true, captures };
}

/** "$1".."$9" in a bundle template refer to regex captures. */
export function expandBundle(template: string, captures: string[]): string {
  return template.replace(/\$(\d)/g, (_all, n: string) => captures[Number(n) - 1] ?? '');
}

/**
 * Walk the rules in order and return the first usable match. Rules that
 * matched but could not be used are reported in `skipped` with the reason.
 * `exists` is consulted only for dynamic bundles (regex captures); static
 * ones are checked when the rules file is loaded.
 */
export async function resolve(
  rules: Rule[],
  req: RequestView,
  exists: ExistsFn,
): Promise<{ resolution: Resolution | null; skipped: Skipped[] }> {
  const skipped: Skipped[] = [];
  for (const rule of rules) {
    const { ok, captures } = matchRule(rule, req);
    if (!ok) {
      continue;
    }
    const bundle = expandBundle(rule.bundle, captures);
    let fingerprint = rule.fingerprint;
    let reason: string | undefined;
    if (!rule.enabled) {
      reason = rule.error ?? 'rule disabled';
    } else if (isDynamicBundle(rule.bundle)) {
      const existence = await exists(bundle);
      if ('error' in existence) {
        reason = `bundle check failed: ${existence.error}`;
      } else if (!existence.exists) {
        reason = `bundle not found: ${bundle}`;
      } else {
        fingerprint = existence.fingerprint;
      }
    }
    if (reason !== undefined) {
      skipped.push({ id: rule.id, reason });
      continue;
    }
    const object = objectPath(rule, req.path);
    if (object === null) {
      skipped.push({ id: rule.id, reason: 'invalid path' });
      continue;
    }
    const resolution: Resolution = {
      rule,
      bundle,
      version: rule.version,
      object,
      cache: rule.cache,
    };
    if (fingerprint !== undefined) {
      resolution.fingerprint = fingerprint;
    }
    if (rule.ttl !== undefined) {
      resolution.ttl = rule.ttl;
    }
    return { resolution, skipped };
  }
  return { resolution: null, skipped };
}

/**
 * Cache key version: the rule version, the origin fingerprint of the bundle's
 * index.html (so an in-place re-upload invalidates by itself) and, for ttl
 * mode, a time bucket so entries roll over on a timer.
 */
export function keyVersion(
  res: Resolution,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  let v = res.version;
  if (res.fingerprint !== undefined) {
    v += `-${res.fingerprint}`;
  }
  if (res.cache === 'ttl' && res.ttl !== undefined) {
    v += `.${Math.floor(nowSeconds / res.ttl)}`;
  }
  return v;
}
