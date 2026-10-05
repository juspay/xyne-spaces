import type { SpacesTriggerPropertySchema } from "./api";

/** Keys owned by the workflow binding / claw prompt, never sent as filters. */
const RESERVED_KEYS = new Set(["channelIds", "context"]);

const splitCsv = (value: string): string[] =>
  value.split(",").map((v) => v.trim()).filter((v) => v.length > 0);

/**
 * Turn the modal's string-valued `configValues` into a typed native Spaces
 * trigger config using the trigger's config schema: comma-separated text →
 * string[] for array fields, "true"/"false" → boolean, numeric text → number.
 * Empty values are omitted so the trigger's own defaults apply.
 */
export function buildTypedTriggerConfig(
  configValues: Record<string, string>,
  props: Record<string, SpacesTriggerPropertySchema>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    if (RESERVED_KEYS.has(key)) continue;
    const raw = configValues[key]?.trim();
    if (!raw) continue;
    switch (prop.type) {
      case "array": {
        const items = splitCsv(raw);
        if (items.length > 0) out[key] = items;
        break;
      }
      case "boolean":
        if (raw === "true" || raw === "false") out[key] = raw === "true";
        break;
      case "number":
      case "integer": {
        const n = Number(raw);
        if (Number.isFinite(n)) out[key] = n;
        break;
      }
      default:
        out[key] = raw;
    }
  }
  return out;
}
