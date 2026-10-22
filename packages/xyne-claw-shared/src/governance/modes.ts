import type { ComponentMode } from "./types.js";

export const GOVERNANCE_COMPONENTS = ["A", "B", "C1", "C2", "D", "registry", "detonator", "triggers", "kill"] as const;
export type GovernanceComponent = (typeof GOVERNANCE_COMPONENTS)[number];
export type ComponentModes = Record<GovernanceComponent, ComponentMode>;

const MODES: readonly ComponentMode[] = ["off", "shadow", "enforce"];
const isMode = (v: unknown): v is ComponentMode => MODES.includes(v as ComponentMode);

/**
 * GOVERNANCE_MODE sets every component (default shadow: hooks run and record, nothing enforces);
 * GOVERNANCE_COMPONENT_MODES="C2=off,D=enforce" overrides single components. The kill component
 * defaults to enforce: a switch an admin sets is an order, not a classifier's guess, and nothing
 * changes until someone sets one; `kill=shadow` records only, and GOVERNANCE_MODE=off turns it off
 * with the rest. A kill snapshot's platform modes (PR-12) override both at run time.
 */
export function parseComponentModes(env: Record<string, string | undefined>): ComponentModes {
  const base = isMode(env["GOVERNANCE_MODE"]) ? env["GOVERNANCE_MODE"] : "shadow";
  const modes = Object.fromEntries(GOVERNANCE_COMPONENTS.map((c) => [c, base])) as ComponentModes;
  if (base !== "off") modes.kill = "enforce";
  for (const pair of (env["GOVERNANCE_COMPONENT_MODES"] ?? "").split(",")) {
    const [name = "", mode = ""] = pair.split("=").map((s) => s.trim());
    if ((GOVERNANCE_COMPONENTS as readonly string[]).includes(name) && isMode(mode)) modes[name as GovernanceComponent] = mode;
  }
  return modes;
}

let cached: ComponentModes | undefined;

export function componentMode(component: GovernanceComponent): ComponentMode {
  cached ??= parseComponentModes(process.env);
  return cached[component];
}

/** Forget the parsed environment (tests, or after a settings reload). */
export function resetComponentModes(): void {
  cached = undefined;
}
