import type { RepoSetupConfig } from "./tools.js";
import { REPO_CONFIGS } from "./repo-configs.js";

export type RepoConfigMap = Record<string, RepoSetupConfig>;
export type RepoConfigLoader = () => Promise<RepoConfigMap>;

export interface RepoConfigOverride {
  key: string;
  config: RepoSetupConfig;
  enabled: boolean;
}

const TTL_MS = Math.max(5_000, Number(process.env["SANDBOX_REPO_CONFIG_TTL_MS"] ?? 60_000));
const ERROR_RETRY_MS = 10_000;

let loader: RepoConfigLoader | null = null;
let cached: RepoConfigMap | null = null;
let nextFetchAt = 0;
let inflight: Promise<RepoConfigMap> | null = null;

export function buildEffectiveRepoConfigs(
  overrides: readonly RepoConfigOverride[],
  base: RepoConfigMap = REPO_CONFIGS,
): RepoConfigMap {
  const merged: RepoConfigMap = { ...base };
  for (const override of overrides) {
    if (override.enabled) merged[override.key] = override.config;
    else delete merged[override.key];
  }
  return merged;
}

export function setRepoConfigLoader(next: RepoConfigLoader | null): void {
  loader = next;
  cached = null;
  nextFetchAt = 0;
  inflight = null;
}

export function getCachedRepoConfigs(): RepoConfigMap {
  return cached ?? REPO_CONFIGS;
}

function refresh(): Promise<RepoConfigMap> {
  if (!inflight && loader) {
    const current = loader;
    inflight = current()
      .then((map) => {
        if (loader === current) {
          cached = map;
          nextFetchAt = Date.now() + TTL_MS;
        }
        return map;
      })
      .catch(() => {
        if (loader === current) nextFetchAt = Date.now() + ERROR_RETRY_MS;
        return cached ?? REPO_CONFIGS;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight ?? Promise.resolve(cached ?? REPO_CONFIGS);
}

export async function getRepoConfigs(): Promise<RepoConfigMap> {
  if (!loader) return REPO_CONFIGS;
  if (Date.now() < nextFetchAt) return cached ?? REPO_CONFIGS;
  if (cached) {
    void refresh();
    return cached;
  }
  return refresh();
}

export async function getRepoConfig(key: string): Promise<RepoSetupConfig | undefined> {
  return (await getRepoConfigs())[key];
}
