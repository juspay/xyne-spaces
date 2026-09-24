/**
 * Compile product guidance (org / space / leaf) for a run. Injected as a
 * static prefix tier after tool definitions. Does not rename repo AGENTS.md.
 */

import {
  compileGuidanceChain,
  SPACE_DOC_MAX_BYTES,
  type GuidanceLayer,
  type CompiledGuidance,
} from "xyne-claw-shared";

export interface RunGuidanceInput {
  orgGuidance?: string | null;
  spaceGuidance?: string | null;
  leafGuidance?: string | null;
  orgLabel?: string;
  spaceLabel?: string;
  leafLabel?: string;
  maxBytes?: number;
}

export function compileRunGuidance(input: RunGuidanceInput): CompiledGuidance {
  const layers: GuidanceLayer[] = [];
  if (input.orgGuidance?.trim()) {
    layers.push({
      tier: "org",
      label: input.orgLabel ?? "organization",
      body: input.orgGuidance,
    });
  }
  if (input.spaceGuidance?.trim()) {
    layers.push({
      tier: "space",
      label: input.spaceLabel ?? "space",
      body: input.spaceGuidance,
    });
  }
  if (input.leafGuidance?.trim()) {
    layers.push({
      tier: "leaf",
      label: input.leafLabel ?? "leaf",
      body: input.leafGuidance,
    });
  }
  return compileGuidanceChain(layers, input.maxBytes ?? SPACE_DOC_MAX_BYTES);
}
