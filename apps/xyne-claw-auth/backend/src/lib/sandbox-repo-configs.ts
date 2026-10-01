import { z } from "zod";
import {
  REPO_CONFIGS,
  buildEffectiveRepoConfigs,
  type RepoConfigMap,
  type RepoConfigOverride,
  type RepoSetupConfig,
} from "xyne-claw-shared";
import { sandboxRepoConfigRepository } from "../repositories/index.js";
import { createLogger } from "../logger.js";

const log = createLogger("sandbox-repo-configs");

export const SANDBOX_REPO_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const positiveMs = z.number().int().positive();

const healthCheckSchema = z.looseObject({
  cmd: z.string().min(1),
  successCondition: z.enum(["all-healthy", "all-up"]),
  intervalMs: positiveMs,
  timeoutMs: positiveMs,
});

const setupStepSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("install"), packages: z.array(z.string()), cmd: z.string().optional() }),
  z.looseObject({
    type: z.literal("services"),
    cmd: z.string().min(1),
    healthCheck: healthCheckSchema.optional(),
    markerPath: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal("devserver"),
    name: z.string().min(1),
    cmd: z.string().min(1),
    cwd: z.string().min(1),
    markerPath: z.string().optional(),
  }),
  z.looseObject({
    type: z.literal("run"),
    label: z.string().min(1),
    cmd: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: positiveMs.optional(),
  }),
]);

const auxRepoSchema = z.looseObject({
  name: z.string().min(1),
  url: z.string().min(1),
  defaultBranch: z.string().min(1),
  workDir: z.string().min(1),
});

export const repoSetupConfigSchema = z.looseObject({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  repoUrl: z.string().min(1).optional(),
  defaultBranch: z.string(),
  cloneDepth: z.number().int().nonnegative().optional(),
  cloneTimeoutMs: positiveMs.optional(),
  workDir: z.string().min(1),
  template: z.string().min(1),
  sessionTimeoutMs: positiveMs.optional(),
  idleTimeoutMs: positiveMs.optional(),
  readyTimeoutMs: positiveMs.optional(),
  writeSessionTimeoutMs: positiveMs.optional(),
  writeIdleTimeoutMs: positiveMs.optional(),
  readFirst: z.boolean().optional(),
  steps: z.array(setupStepSchema),
  ports: z.record(z.string(), z.number().int().positive()).optional(),
  auxRepos: z.array(auxRepoSchema).optional(),
  skipBakedCloneWait: z.boolean().optional(),
});

export type RepoConfigParseResult = { ok: true; config: RepoSetupConfig } | { ok: false; error: string };

export function parseRepoSetupConfig(input: unknown): RepoConfigParseResult {
  const parsed = repoSetupConfigSchema.safeParse(input);
  if (parsed.success) {
    // Ownership lives on the row; a pasted or stored workspaceId must not re-scope the profile.
    const { workspaceId: _ignored, ...config } = parsed.data;
    return { ok: true, config: config as RepoSetupConfig };
  }
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, error: `${where}${issue?.message ?? "invalid config"}` };
}

export async function loadRepoConfigOverrides(): Promise<RepoConfigOverride[]> {
  const rows = await sandboxRepoConfigRepository.list();
  const overrides: RepoConfigOverride[] = [];
  for (const row of rows) {
    const parsed = parseRepoSetupConfig(row.config);
    if (!parsed.ok) {
      log.warn(`[sandbox-repo-configs] skipping invalid stored config "${row.key}": ${parsed.error}`);
      continue;
    }
    overrides.push({ key: row.key, config: parsed.config, enabled: row.enabled, workspaceId: row.workspaceId });
  }
  return overrides;
}

/** Omit workspaceId for every workspace's profiles (the claw runtime cache); null keeps built-ins only. */
export async function loadEffectiveRepoConfigs(workspaceId?: string | null): Promise<RepoConfigMap> {
  return buildEffectiveRepoConfigs(await loadRepoConfigOverrides(), REPO_CONFIGS, workspaceId);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/** Same config regardless of key order: tells a stored copy of a built-in from a real edit. */
export function sameRepoConfig(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
