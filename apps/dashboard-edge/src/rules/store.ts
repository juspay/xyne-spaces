// Rules file: loading, validation, health checks, origin fingerprints and hot
// reload. The file (a mounted ConfigMap key) is re-read on a timer. When its
// content changes it is parsed and validated, every static bundle is checked
// at the origin, and the result becomes the active set. Static bundles are
// re-checked on a second timer even when the file is unchanged, so an
// in-place re-upload gets a new fingerprint (and cache key) by itself.
//
// A rule whose bundle is missing keeps the target it previously served (if
// any) and is reported unhealthy; with nothing to fall back to it is disabled
// and requests fall through to later rules.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { log } from '../log.js';
import { metrics } from '../metrics.js';
import { fingerprintOf, type Origin } from '../origin/index.js';
import type { Existence } from './match.js';
import { isDynamicBundle, parseRules, type Rule } from './schema.js';

export interface RuleSet {
  rules: Rule[];
  generation: number;
  loadedAt: number;
}

export interface RulesStoreOptions {
  file: string;
  reloadIntervalMs: number;
  healthIntervalMs: number;
  origin: Origin;
  /** Positive existence cache for dynamic bundles, ms. */
  existsTtlMs?: number;
  /** Negative existence cache for dynamic bundles, ms. */
  missingTtlMs?: number;
}

interface ExistenceEntry {
  value: Existence;
  expiresAt: number;
}

export interface RuleStatus {
  id: string;
  match: Rule['matchSpec'];
  bundle: string;
  version: string;
  fingerprint?: string;
  cache: Rule['cache'];
  ttl?: number;
  strip_prefix?: string;
  healthy: boolean;
  enabled: boolean;
  error?: string;
}

export interface StoreStatus {
  file: string;
  generation: number;
  loaded_at?: string;
  last_error?: string;
  last_health_check?: string;
  reload_interval_s: number;
  health_interval_s: number;
  rules: RuleStatus[];
}

const EXISTS_TTL_MS = 60_000;
const MISSING_TTL_MS = 15_000;
const HISTORY_DEPTH = 8;
const LANES_TTL_MS = 5 * 60_000;

export class RulesStore {
  private active: RuleSet | null = null;
  private generation = 0;
  private hash = '';
  private lastError: string | undefined;
  private lastHealthCheck = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private readonly existence = new Map<string, ExistenceEntry>();
  private readonly history = new Map<string, string[]>();
  private lanes: { names: string[]; expiresAt: number } | null = null;

  constructor(private readonly opts: RulesStoreOptions) {}

  /** Load once (awaited), then keep polling. */
  async start(): Promise<void> {
    await this.tick(true);
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  current(): RuleSet | null {
    return this.active;
  }

  ready(): { ready: boolean; reason?: string } {
    if (!this.active) {
      return { ready: false, reason: 'rules not loaded' };
    }
    const last = this.active.rules[this.active.rules.length - 1] as Rule;
    if (!last.enabled) {
      return {
        ready: false,
        reason: `default rule ${last.id} disabled: ${last.error ?? 'unknown'}`,
      };
    }
    return { ready: true };
  }

  status(): StoreStatus {
    const out: StoreStatus = {
      file: this.opts.file,
      generation: this.active?.generation ?? 0,
      reload_interval_s: this.opts.reloadIntervalMs / 1000,
      health_interval_s: this.opts.healthIntervalMs / 1000,
      rules: [],
    };
    if (this.active) {
      out.loaded_at = new Date(this.active.loadedAt).toISOString();
    }
    if (this.lastError !== undefined) {
      out.last_error = this.lastError;
    }
    if (this.lastHealthCheck > 0) {
      out.last_health_check = new Date(this.lastHealthCheck).toISOString();
    }
    for (const r of this.active?.rules ?? []) {
      const rs: RuleStatus = {
        id: r.id,
        match: r.matchSpec,
        bundle: r.bundle,
        version: r.version,
        cache: r.cache,
        healthy: r.healthy,
        enabled: r.enabled,
      };
      if (r.fingerprint !== undefined) {
        rs.fingerprint = r.fingerprint;
      }
      if (r.ttl !== undefined) {
        rs.ttl = r.ttl;
      }
      if (r.stripPrefix !== undefined) {
        rs.strip_prefix = r.stripPrefix;
      }
      if (r.error !== undefined) {
        rs.error = r.error;
      }
      out.rules.push(rs);
    }
    return out;
  }

  private async bucketLanes(): Promise<string[]> {
    const now = Date.now();
    if (this.lanes && this.lanes.expiresAt > now) {
      return this.lanes.names;
    }
    let names: string[] = [];
    try {
      names = await this.opts.origin.listPrefixes('');
    } catch (err) {
      log.warn('cannot list bucket lanes for asset fallback', { err });
      return this.lanes?.names ?? [];
    }
    const releases = names
      .filter((n) => /^release-\d{8}$/.test(n))
      .sort()
      .reverse();
    const rest = names
      .filter((n) => !/^release-\d{8}$/.test(n) && n !== 'main' && !n.startsWith('devqa-'))
      .sort();
    names = [...releases, ...(names.includes('main') ? ['main'] : []), ...rest];
    this.lanes = { names, expiresAt: now + LANES_TTL_MS };
    return names;
  }

  async fallbackBundles(ruleId: string, bundle: string): Promise<string[]> {
    const sdlc = bundle.endsWith('-sdlc');
    const fits = (b: string): boolean => b !== bundle && b.endsWith('-sdlc') === sdlc;
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (b: string): void => {
      if (fits(b) && !seen.has(b)) {
        seen.add(b);
        out.push(b);
      }
    };
    for (const b of this.history.get(ruleId) ?? []) {
      add(b);
    }
    for (const r of this.active?.rules ?? []) {
      if (r.enabled && !isDynamicBundle(r.bundle)) {
        add(r.bundle);
      }
    }
    for (const lane of await this.bucketLanes()) {
      add(lane);
    }
    return out;
  }

  /** Existence + fingerprint for a dynamic bundle (regex captures), cached briefly. */
  async exists(bundle: string): Promise<Existence> {
    const now = Date.now();
    const cached = this.existence.get(bundle);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    let value: Existence;
    try {
      const info = await this.opts.origin.head(`${bundle}/index.html`);
      value = info ? { exists: true, fingerprint: fingerprintOf(info) } : { exists: false };
    } catch (err) {
      value = { error: (err as Error).message };
    }
    if (!('error' in value)) {
      const ttl = value.exists
        ? (this.opts.existsTtlMs ?? EXISTS_TTL_MS)
        : (this.opts.missingTtlMs ?? MISSING_TTL_MS);
      this.existence.set(bundle, { value, expiresAt: now + ttl });
    }
    return value;
  }

  async reload(force = true): Promise<void> {
    while (this.running) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (force) {
      this.existence.clear();
    }
    await this.tick(force);
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick(false).finally(() => this.schedule());
    }, this.opts.reloadIntervalMs);
  }

  private async tick(force: boolean): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.load(force);
    } catch (err) {
      log.error('rules reload failed', { err });
    } finally {
      this.running = false;
    }
  }

  private recheckDue(): boolean {
    if (this.lastError !== undefined || !this.active) {
      return false;
    }
    return Date.now() - this.lastHealthCheck >= this.opts.healthIntervalMs;
  }

  private async load(force: boolean): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.opts.file, 'utf8');
    } catch (err) {
      this.lastError = `cannot read ${this.opts.file}: ${(err as Error).message}`;
      log.error('cannot read rules file', { file: this.opts.file, err });
      return;
    }
    const hash = createHash('sha256').update(text).digest('hex');
    const unchanged = hash === this.hash;
    if (!force && unchanged && !this.recheckDue()) {
      return;
    }

    const parsed = parseRules(text);
    if (!parsed.ok) {
      this.lastError = parsed.error;
      this.hash = hash; // do not re-log the same broken file every tick
      log.error('rules file rejected, keeping last good set', { error: parsed.error });
      return;
    }

    const changed = await this.healthCheck(parsed.rules, this.active);
    this.lastHealthCheck = Date.now();
    if (unchanged && !force && !changed) {
      return;
    }

    for (const rule of parsed.rules) {
      const prev = this.active?.rules.find((r) => r.id === rule.id);
      if (prev && prev.bundle !== rule.bundle && !isDynamicBundle(prev.bundle)) {
        const list = [prev.bundle, ...(this.history.get(rule.id) ?? [])].filter(
          (b, i, arr) => b !== rule.bundle && arr.indexOf(b) === i,
        );
        this.history.set(rule.id, list.slice(0, HISTORY_DEPTH));
      }
    }

    this.generation += 1;
    this.active = { rules: parsed.rules, generation: this.generation, loadedAt: Date.now() };
    this.hash = hash;
    this.lastError = undefined;
    for (const r of parsed.rules) {
      metrics.setRuleHealth(r.id, r.healthy);
    }
    log.info('rules loaded', {
      file: this.opts.file,
      generation: this.generation,
      rules: parsed.rules.length,
      unhealthy: parsed.rules.filter((r) => !r.healthy).map((r) => r.id),
    });
  }

  /**
   * HEAD every static bundle and record its fingerprint. Returns true when
   * anything differs from `previous` (health, target or fingerprint).
   */
  private async healthCheck(rules: Rule[], previous: RuleSet | null): Promise<boolean> {
    const prevById = new Map((previous?.rules ?? []).map((r) => [r.id, r]));
    let changed = previous === null || previous.rules.length !== rules.length;

    for (const rule of rules) {
      const prev = prevById.get(rule.id);
      if (!isDynamicBundle(rule.bundle)) {
        let info: Awaited<ReturnType<Origin['head']>>;
        let failure: string | undefined;
        try {
          info = await this.opts.origin.head(`${rule.bundle}/index.html`);
        } catch (err) {
          info = null;
          failure = `bundle check failed: ${(err as Error).message}`;
        }
        if (info) {
          rule.fingerprint = fingerprintOf(info);
          if (
            prev?.healthy &&
            prev.bundle === rule.bundle &&
            prev.fingerprint !== undefined &&
            prev.fingerprint !== rule.fingerprint
          ) {
            log.info('bundle changed at origin, cache invalidated', {
              rule: rule.id,
              bundle: rule.bundle,
              fingerprint: rule.fingerprint,
            });
          }
        } else {
          const reason = failure ?? `bundle not found: ${rule.bundle}`;
          rule.healthy = false;
          rule.error = reason;
          if (prev && prev.enabled) {
            rule.bundle = prev.bundle;
            rule.version = prev.version;
            rule.cache = prev.cache;
            if (prev.ttl !== undefined) {
              rule.ttl = prev.ttl;
            }
            if (prev.stripPrefix !== undefined) {
              rule.stripPrefix = prev.stripPrefix;
            }
            if (prev.fingerprint !== undefined) {
              rule.fingerprint = prev.fingerprint;
            }
            rule.error = `${reason} (serving previous ${prev.bundle})`;
            if (prev.error === undefined) {
              log.warn('rule unhealthy, serving previous bundle', {
                rule: rule.id,
                error: rule.error,
              });
            }
          } else {
            rule.enabled = false;
            if (!prev || prev.enabled) {
              log.error('rule disabled', { rule: rule.id, error: reason });
            }
          }
        }
      }
      if (!changed) {
        changed =
          prev === undefined ||
          prev.bundle !== rule.bundle ||
          prev.version !== rule.version ||
          prev.fingerprint !== rule.fingerprint ||
          prev.healthy !== rule.healthy ||
          prev.enabled !== rule.enabled ||
          prev.cache !== rule.cache ||
          prev.ttl !== rule.ttl ||
          prev.stripPrefix !== rule.stripPrefix;
      }
    }
    return changed;
  }
}
