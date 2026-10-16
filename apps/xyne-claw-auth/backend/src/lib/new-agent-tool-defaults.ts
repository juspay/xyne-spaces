export const DEFAULT_NEW_AGENT_TOOL_SOURCES = ["custom:sandbox", "custom:webfetch", "custom:agent-introspect"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function mergeNewAgentToolDefaults(
  config: Record<string, unknown> | undefined,
  defaultCustomSlugs: string[],
): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...(config ?? {}) };
  const tools: Record<string, unknown> = { ...(asRecord(cfg["tools"]) ?? {}) };
  const custom = new Set(stringArray(tools["custom"]));
  for (const slug of defaultCustomSlugs) custom.add(slug);
  tools["custom"] = [...custom];
  cfg["tools"] = tools;
  cfg["optimizations"] = { ...(asRecord(cfg["optimizations"]) ?? {}), active_tool_cap: true };
  return cfg;
}
