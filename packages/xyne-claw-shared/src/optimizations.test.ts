import { describe, expect, it } from "vitest";
import {
  OPTIMIZATIONS,
  OPTIMIZATION_GROUPS,
  OPTIMIZATION_KEYS,
  OPTIMIZATION_TIER_DEFAULTS,
  optimizationCatalog,
} from "./optimizations.js";

describe("optimization catalog", () => {
  it("puts every switch in a known group, with copy for the dashboard", () => {
    const groups = new Set(OPTIMIZATION_GROUPS.map((g) => g.id));
    for (const o of optimizationCatalog()) {
      expect(groups.has(o.group), o.key).toBe(true);
      expect(o.label.trim(), o.key).not.toBe("");
      expect(o.summary.trim(), o.key).not.toBe("");
      expect(o.detail.trim(), o.key).not.toBe("");
    }
  });

  it("only points `requires` at an agent-scoped switch that exists", () => {
    for (const o of optimizationCatalog()) {
      if (!o.requires) continue;
      expect(OPTIMIZATION_KEYS, o.key).toContain(o.requires);
      expect(OPTIMIZATIONS[o.requires as keyof typeof OPTIMIZATIONS].scope, o.key).toBe("agent");
    }
  });

  it("only names known switches in tier defaults", () => {
    for (const defaults of Object.values(OPTIMIZATION_TIER_DEFAULTS)) {
      for (const key of Object.keys(defaults)) expect(OPTIMIZATION_KEYS).toContain(key);
    }
  });

  it("keeps keys safe for the XYNE_OPT_<KEY> env flag and claw-auth's spec filter", () => {
    for (const key of OPTIMIZATION_KEYS) expect(key).toMatch(/^[a-z0-9_]{1,60}$/);
  });
});
