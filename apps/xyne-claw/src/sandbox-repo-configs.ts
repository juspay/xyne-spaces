import { getRepoConfigs, setRepoConfigLoader, type RepoConfigMap } from "xyne-claw-shared";
import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("sandbox-repo-configs");

const FETCH_TIMEOUT_MS = 5_000;

async function fetchRepoConfigs(): Promise<RepoConfigMap> {
  const res = await fetch(`${SERVER.authServiceUrl}/claw/api/v1/internal/sandbox-repos`, {
    headers: { "x-s2s-key": SERVER.s2sKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`sandbox-repos ${res.status}`);
  const body = (await res.json()) as { success?: boolean; data?: RepoConfigMap; error?: string };
  if (!body.success || !body.data || typeof body.data !== "object") {
    throw new Error(`sandbox-repos invalid response${body.error ? `: ${body.error}` : ""}`);
  }
  return body.data;
}

export function installSandboxRepoConfigLoader(): void {
  setRepoConfigLoader(async () => {
    try {
      return await fetchRepoConfigs();
    } catch (err) {
      log.warn(`[sandbox-repo-configs] fetch failed, using cached/static configs: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  });
  void getRepoConfigs().then((configs) => {
    log.info(`[sandbox-repo-configs] loaded ${Object.keys(configs).length} repo configs: ${Object.keys(configs).join(", ")}`);
  });
}
