import type { z } from 'zod';
import type { CAC_REGISTRY, PlatformUpdateConfigSchema } from './schemas';

export type CacKey = keyof typeof CAC_REGISTRY;
export type CacConfigOf<K extends CacKey> = z.infer<(typeof CAC_REGISTRY)[K]['schema']>;

export type LotusUpdateConfig = CacConfigOf<'lotus_update_config'>;
export type BetaFlagCatalog = CacConfigOf<'lotus_beta_flag_catalog'>;
export type BetaFlagsEnabled = CacConfigOf<'lotus_beta_flags_enabled'>;
export type BetaAccess = CacConfigOf<'lotus_beta_access'>;
export type PlatformUpdateConfig = z.infer<typeof PlatformUpdateConfigSchema>;
export type UpdatePromptMode = PlatformUpdateConfig['mode'];

export type AppVersionInfo = {
  version: string;
  buildNumber: number;
};

export type UpdatePromptDecision =
  | { kind: 'none' }
  | { kind: 'optional'; config: PlatformUpdateConfig }
  | { kind: 'force'; config: PlatformUpdateConfig };

export type DismissRecord = {
  targetVersion: string;
  targetBuildNumber: number;
  dismissedAt: number;
};

export type CacApiResponse = {
  key: string;
  config?: unknown;
};
