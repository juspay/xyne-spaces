import { describe, expect, it } from 'vitest';

import {
  expandBundle,
  keyVersion,
  matchRule,
  objectPath,
  resolve,
  type RequestView,
} from './match.js';
import { parseRules } from './schema.js';

function view(overrides: Partial<RequestView> = {}): RequestView {
  return { path: '/', headers: {}, cookies: {}, userAgent: '', ...overrides };
}

function rulesFrom(
  json: unknown,
): ReturnType<typeof parseRules> extends infer R
  ? R extends { ok: true; rules: infer Rules }
    ? Rules
    : never
  : never {
  const parsed = parseRules(JSON.stringify(json));
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.rules;
}

describe('objectPath', () => {
  it('maps root and trailing slashes to index.html and strips the rule prefix', () => {
    expect(objectPath({}, '/')).toBe('index.html');
    expect(objectPath({}, '/assets/app.js')).toBe('assets/app.js');
    expect(objectPath({}, '/settings/')).toBe('settings/index.html');
    expect(objectPath({ stripPrefix: '/sdlc-app' }, '/sdlc-app/assets/x.js')).toBe('assets/x.js');
    expect(objectPath({ stripPrefix: '/sdlc-app' }, '/sdlc-app')).toBe('index.html');
    expect(objectPath({}, '/a/../b')).toBeNull();
  });
});

describe('matchRule', () => {
  const rules = rulesFrom({
    rules: [
      { id: 'hdr', match: { header: { name: 'X-Route-Env', exact: 'playground' } }, bundle: 'p' },
      { id: 'ck', match: { cookie: { name: 'x-route-env', regex: '^play' } }, bundle: 'p' },
      {
        id: 'ua',
        match: { user_agent: { regex: 'devqa-xyne-([A-Za-z0-9_-]+)' } },
        bundle: 'devqa-xyne-$1',
      },
      {
        id: 'both',
        match: { path_prefix: '/api/', header: { name: 'x', exact: 'y' } },
        bundle: 'b',
      },
      { id: 'default', match: { path_prefix: '/' }, bundle: 'main' },
    ],
  });
  const byId = Object.fromEntries(rules.map((r) => [r.id, r]));

  it('matches headers case-insensitively by name and cookies by regex', () => {
    expect(matchRule(byId.hdr!, view({ headers: { 'x-route-env': 'playground' } })).ok).toBe(true);
    expect(matchRule(byId.hdr!, view({ headers: { 'x-route-env': 'onyx' } })).ok).toBe(false);
    expect(matchRule(byId.ck!, view({ cookies: { 'x-route-env': 'playground' } })).ok).toBe(true);
  });

  it('returns captures from the user agent and requires every matcher', () => {
    const ua = matchRule(byId.ua!, view({ userAgent: 'Mozilla devqa-xyne-picaf-2878 Chrome' }));
    expect(ua).toEqual({ ok: true, captures: ['picaf-2878'] });
    expect(expandBundle(byId.ua!.bundle, ua.captures)).toBe('devqa-xyne-picaf-2878');
    expect(matchRule(byId.both!, view({ path: '/api/x', headers: { x: 'y' } })).ok).toBe(true);
    expect(matchRule(byId.both!, view({ path: '/api/x' })).ok).toBe(false);
  });
});

describe('resolve', () => {
  const rules = rulesFrom({
    rules: [
      {
        id: 'ua',
        match: { user_agent: { regex: 'devqa-xyne-([a-z0-9-]+)' } },
        bundle: 'devqa-xyne-$1',
        cache: 'never',
      },
      { id: 'default', match: { path_prefix: '/' }, bundle: 'main', version: 7 },
    ],
  });

  it('falls through to the next rule with a reason when a dynamic bundle is missing', async () => {
    const exists = async (
      bundle: string,
    ): Promise<{ exists: true; fingerprint: string } | { exists: false }> =>
      bundle === 'devqa-xyne-ok'
        ? ({ exists: true, fingerprint: 'abc' } as const)
        : ({ exists: false } as const);
    const missing = await resolve(rules, view({ userAgent: 'devqa-xyne-nope' }), exists);
    expect(missing.resolution?.rule.id).toBe('default');
    expect(missing.skipped).toEqual([{ id: 'ua', reason: 'bundle not found: devqa-xyne-nope' }]);

    const found = await resolve(rules, view({ userAgent: 'devqa-xyne-ok', path: '/x/y' }), exists);
    expect(found.resolution).toMatchObject({
      bundle: 'devqa-xyne-ok',
      object: 'x/y',
      cache: 'never',
      fingerprint: 'abc',
    });
  });

  it('builds the cache key version from version, fingerprint and ttl bucket', () => {
    const base = { rule: rules[1]!, bundle: 'main', version: '7', object: 'index.html' };
    expect(keyVersion({ ...base, cache: 'versioned' })).toBe('7');
    expect(keyVersion({ ...base, cache: 'versioned', fingerprint: 'f1' })).toBe('7-f1');
    expect(keyVersion({ ...base, cache: 'ttl', ttl: 30, fingerprint: 'f1' }, 95)).toBe('7-f1.3');
  });
});

describe('parseRules', () => {
  it('rejects a file whose last rule is not the catch-all default', () => {
    const r = parseRules(
      JSON.stringify({ rules: [{ id: 'a', match: { path_prefix: '/x/' }, bundle: 'b' }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toMatch(/last rule/);
  });

  it('rejects capture references without a regex matcher and bad regexes', () => {
    const noRegex = parseRules(
      JSON.stringify({ rules: [{ id: 'a', match: { path_prefix: '/' }, bundle: 'x-$1' }] }),
    );
    expect(noRegex.ok ? '' : noRegex.error).toMatch(/no regex matcher/);
    const bad = parseRules(
      JSON.stringify({
        rules: [
          { id: 'a', match: { path_regex: '(' }, bundle: 'x' },
          { id: 'd', match: { path_prefix: '/' }, bundle: 'm' },
        ],
      }),
    );
    expect(bad.ok ? '' : bad.error).toMatch(/bad regex/);
  });

  it('normalises version, ttl and strip_prefix', () => {
    const r = parseRules(
      JSON.stringify({
        rules: [
          {
            id: 's',
            match: { path_prefix: '/sdlc-app/' },
            bundle: 'sdlc',
            strip_prefix: '/sdlc-app/',
            cache: 'ttl',
            ttl: '5m',
            version: 3,
          },
          { id: 'd', match: { path_prefix: '/' }, bundle: 'main' },
        ],
      }),
    );
    expect(r.ok && r.rules[0]).toMatchObject({
      version: '3',
      ttl: 300,
      stripPrefix: '/sdlc-app',
      cache: 'ttl',
    });
  });
});

describe('normalisePath', () => {
  it('drops the query, resolves dot segments, collapses slashes and decodes', async () => {
    const { normalisePath } = await import('../http/resolve.js');
    expect(normalisePath('/assets/app.js?v=1')).toBe('/assets/app.js');
    expect(normalisePath('/a/./b/../c')).toBe('/a/c');
    expect(normalisePath('//x///y')).toBe('/x/y');
    expect(normalisePath('/settings/?tab=1')).toBe('/settings/');
    expect(normalisePath('/caf%C3%A9/x')).toBe('/café/x');
    expect(normalisePath('/')).toBe('/');
    expect(normalisePath('/..')).toBeNull();
    expect(normalisePath('/%zz')).toBeNull();
  });
});
