/**
 * Compile org → space → leaf guidance into one capped prefix (leaf wins).
 * Product guidance for agent runs — not the repo AGENTS.md for this codebase.
 */

export const SPACE_DOC_MAX_BYTES = 32_768;

export interface GuidanceLayer {
  /** org | space | leaf */
  tier: "org" | "space" | "leaf";
  label: string;
  body: string;
}

export interface CompiledGuidance {
  text: string;
  truncated: boolean;
  layersKept: number;
  bytes: number;
}

/**
 * Concatenate root→leaf. If the cap would cut a layer, keep broader layers and
 * truncate the leaf (or the last included layer).
 */
export function compileGuidanceChain(
  layers: GuidanceLayer[],
  maxBytes: number = SPACE_DOC_MAX_BYTES,
): CompiledGuidance {
  const nonEmpty = layers
    .map((layer) => ({
      ...layer,
      body: layer.body.replace(/\r\n/g, "\n").trim(),
    }))
    .filter((layer) => layer.body.length > 0);

  if (nonEmpty.length === 0) {
    return { text: "", truncated: false, layersKept: 0, bytes: 0 };
  }

  const encoder = new TextEncoder();
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  let layersKept = 0;

  for (let i = 0; i < nonEmpty.length; i++) {
    const layer = nonEmpty[i]!;
    const header = `<!-- guidance:${layer.tier} ${layer.label} -->\n`;
    const chunk = `${header}${layer.body}`;
    const sep = parts.length > 0 ? "\n\n" : "";
    const candidate = sep + chunk;
    const candidateBytes = encoder.encode(candidate).length;
    if (used + candidateBytes <= maxBytes) {
      parts.push(chunk);
      used += candidateBytes;
      layersKept += 1;
      continue;
    }
    // Prefer keeping broader layers: if this is not the first layer, truncate it.
    const remaining = Math.max(0, maxBytes - used - encoder.encode(sep + header).length);
    if (remaining > 64) {
      const bodyBytes = encoder.encode(layer.body);
      const sliced = new TextDecoder().decode(bodyBytes.slice(0, remaining));
      parts.push(`${header}${sliced}\n…[truncated]`);
      layersKept += 1;
      truncated = true;
    } else if (parts.length === 0) {
      // Even org layer is too big — hard truncate.
      const bodyBytes = encoder.encode(layer.body);
      const sliced = new TextDecoder().decode(bodyBytes.slice(0, Math.max(0, maxBytes - encoder.encode(header).length)));
      parts.push(`${header}${sliced}\n…[truncated]`);
      layersKept = 1;
      truncated = true;
    } else {
      truncated = true;
    }
    break;
  }

  const text = parts.join("\n\n");
  return {
    text,
    truncated,
    layersKept,
    bytes: encoder.encode(text).length,
  };
}
