import type { RepoSetupConfig } from "./tools.js";
import { REPO_CONFIGS } from "./repo-configs.js";

export type RepoConfigMap = Record<string, RepoSetupConfig>;
export type RepoConfigLoader = () => Promise<RepoConfigMap>;

export interface RepoConfigOverride {
  key: string;
  config: RepoSetupConfig;
  enabled: boolean;
  workspaceId?: string | null;
}

const TTL_MS = Math.max(5_000, Number(process.env["SANDBOX_REPO_CONFIG_TTL_MS"] ?? 60_000));
const ERROR_RETRY_MS = 10_000;

let loader: RepoConfigLoader | null = null;
let cached: RepoConfigMap | null = null;
let nextFetchAt = 0;
let inflight: Promise<RepoConfigMap> | null = null;

/**
 * Built-ins overlaid by stored rows. A row overriding a built-in key stays global. Any other row
 * needs a workspace: an unowned row shows nowhere, and with `workspaceId` given only that workspace's
 * rows are kept (undefined keeps every workspace's, stamped with `workspaceId`, for the runtime cache).
 */
export function buildEffectiveRepoConfigs(
  overrides: readonly RepoConfigOverride[],
  base: RepoConfigMap = REPO_CONFIGS,
  workspaceId?: string | null,
): RepoConfigMap {
  const merged: RepoConfigMap = { ...base };
  for (const override of overrides) {
    const builtIn = Object.hasOwn(base, override.key);
    const owner = override.workspaceId ?? null;
    if (!builtIn && (!owner || (workspaceId !== undefined && owner !== workspaceId))) continue;
    if (!override.enabled) delete merged[override.key];
    else merged[override.key] = builtIn ? override.config : { ...override.config, workspaceId: owner! };
  }
  return merged;
}

/** Built-ins plus the given workspace's profiles; no workspace → built-ins only. */
export function repoConfigsForWorkspace(configs: RepoConfigMap, workspaceId: string | undefined): RepoConfigMap {
  return Object.fromEntries(
    Object.entries(configs).filter(([, config]) => !config.workspaceId || config.workspaceId === workspaceId),
  );
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

export async function getRepoConfigsFor(workspaceId: string | undefined): Promise<RepoConfigMap> {
  return repoConfigsForWorkspace(await getRepoConfigs(), workspaceId);
}

export async function getRepoConfig(key: string): Promise<RepoSetupConfig | undefined> {
  return (await getRepoConfigs())[key];
}
