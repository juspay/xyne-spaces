/** XYNE-67466: external per-turn reminders are retired, not renamed.
 * Keep this at the direct Agent write boundary so stale clients, clones, provisioning
 * and tool-driven config edits cannot persist either spelling again.
 */
export function stripRetiredPromptConfig<T>(config: T): T {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  if (!Object.hasOwn(config, "promptInjection") && !Object.hasOwn(config, "promptInjections")) return config;
  const next = { ...config } as Record<string, unknown>;
  delete next["promptInjection"];
  delete next["promptInjections"];
  return next as T;
}

function cleanData<T>(data: T): T {
  if (Array.isArray(data)) return data.map(cleanData) as T;
  if (!data || typeof data !== "object" || !Object.hasOwn(data, "config")) return data;
  const row = data as Record<string, unknown>;
  return { ...row, config: stripRetiredPromptConfig(row["config"]) } as T;
}

/** Prisma query extension input: preserve null sentinels and non-config writes. */
export function sanitizeAgentWriteArgs<T>(model: string | undefined, operation: string, args: T): T {
  if (model !== "Agent" || !args || typeof args !== "object") return args;
  const input = args as Record<string, unknown>;
  switch (operation) {
    case "create":
    case "createMany":
    case "createManyAndReturn":
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      return { ...input, data: cleanData(input["data"]) } as T;
    case "upsert":
      return { ...input, create: cleanData(input["create"]), update: cleanData(input["update"]) } as T;
    default:
      return args;
  }
}
