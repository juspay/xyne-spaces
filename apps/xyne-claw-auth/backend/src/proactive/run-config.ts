export function withProactiveCheck(
  base: Record<string, unknown>,
  deniedToolKeys: string[],
  proactive: { facts: string; fallback: string },
): Record<string, unknown> {
  const existing =
    base["toolPermissions"] && typeof base["toolPermissions"] === "object" && !Array.isArray(base["toolPermissions"])
      ? (base["toolPermissions"] as Record<string, string>)
      : {};
  const denied = Object.fromEntries(deniedToolKeys.map((key) => [key, "deny"]));
  return { ...base, toolPermissions: { ...existing, ...denied }, proactiveCheck: proactive };
}
