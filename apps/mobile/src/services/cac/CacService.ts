import { Platform } from 'react-native';
import { apiGet } from '@/src/services/apiClient';
import { resolveAccessToken } from '@/src/services/authToken';
import { CAC_KEYS } from './constants';
import { CAC_REGISTRY } from './schemas';
import type {
  CacApiResponse,
  CacConfigOf,
  CacKey,
  LotusUpdateConfig,
  PlatformUpdateConfig,
  UpdatePromptDecision,
} from './types';
import {
  evaluateUpdatePrompt,
  getLocalAppVersionInfo,
  openUpdateDestination as openUpdateDestinationUrl,
  readDismissRecord,
  shouldShowUpdatePrompt,
  writeDismissRecord,
} from './utils';

/**
 * Central CAC (Context-Aware Config) service for Lotus.
 *
 * Owns Superposition key fetch/parse + config-specific helpers (e.g. lotus update
 * prompt evaluation). Add new configs as registry entries + methods on this class.
 */
export class CacService {
  getDefault<K extends CacKey>(key: K): CacConfigOf<K> {
    return CAC_REGISTRY[key].fallback as CacConfigOf<K>;
  }

  getStaleTimeMs(key: CacKey): number {
    return CAC_REGISTRY[key].staleTimeMs;
  }

  parse<K extends CacKey>(key: K, raw: unknown): CacConfigOf<K> {
    const entry = CAC_REGISTRY[key];
    const result = entry.schema.safeParse(raw);
    if (result.success) {
      return result.data as CacConfigOf<K>;
    }

    // Falling back here would hand the caller a value it cannot tell apart
    // from a real one — for the beta keys, an empty grant list that reads as
    // "this user lost access". Better a failed query the caller can see.
    if (entry.requireValue) {
      throw new Error(`[CacService] "${key}" is malformed; refusing to substitute a default.`);
    }

    if (__DEV__) {
      console.warn(
        `[CacService] Invalid config for "${key}", using defaults`,
        result.error.flatten(),
      );
    }
    return this.getDefault(key);
  }

  async fetch<K extends CacKey>(key: K): Promise<CacConfigOf<K>> {
    const { token } = await resolveAccessToken();
    if (!token) throw new Error('Not authenticated');

    const res = await apiGet<CacApiResponse>(`/cac-config/${key}`, { token });
    if (res.config == null) {
      // No value for this context: the key is missing from Superposition, or
      // misspelled. Same reasoning as `parse` — for keys that can subtract,
      // "absent" must not be dressed up as "resolved to nothing".
      if (CAC_REGISTRY[key].requireValue) {
        throw new Error(`[CacService] "${key}" resolved to no value.`);
      }
      return this.getDefault(key);
    }
    return this.parse(key, res.config);
  }

  // ─── lotus_update_config ──────────────────────────────────────────────────

  getPlatformUpdateConfig(config: LotusUpdateConfig): PlatformUpdateConfig | undefined {
    return Platform.OS === 'ios' ? config.ios : config.android;
  }

  /**
   * Resolve whether to show an update prompt from a fetched lotus_update_config.
   * Pure decision — does not consider dismiss/snooze.
   */
  resolveUpdateDecision(config: LotusUpdateConfig): UpdatePromptDecision {
    const platformConfig = this.getPlatformUpdateConfig(config);
    return evaluateUpdatePrompt(platformConfig, getLocalAppVersionInfo());
  }

  /**
   * Whether the UI should show the prompt given the decision + local dismiss record.
   * Force prompts always show; optional prompts respect snooze.
   */
  shouldShowPrompt(decision: UpdatePromptDecision): boolean {
    if (decision.kind === 'none') return false;
    if (decision.kind === 'force') return true;

    return shouldShowUpdatePrompt(readDismissRecord(), {
      latestVersion: decision.config.latestVersion,
      latestBuildNumber: decision.config.latestBuildNumber,
    });
  }

  dismissOptionalPrompt(decision: UpdatePromptDecision): void {
    if (decision.kind !== 'optional') return;
    writeDismissRecord({
      targetVersion: decision.config.latestVersion,
      targetBuildNumber: decision.config.latestBuildNumber,
      dismissedAt: Date.now(),
    });
  }

  /** iOS → TestFlight; Android → Play Store URL from config. */
  openUpdateDestination(storeUrl?: string): Promise<void> {
    return openUpdateDestinationUrl(storeUrl);
  }

  /** Convenience: fetch + resolve update decision in one call (non-React). */
  async fetchUpdateDecision(): Promise<UpdatePromptDecision> {
    const config = await this.fetch(CAC_KEYS.lotusUpdateConfig);
    return this.resolveUpdateDecision(config);
  }
}

/** Shared singleton — use from hooks / non-React call sites. */
export const cacService = new CacService();
