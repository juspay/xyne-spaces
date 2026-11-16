import type { ToolDefinition } from "../types.js";
import {
  colorVariables,
  parseCssCustomProperties,
  parseTailwindConfig,
  scanComponentPrimitives,
  toBrandColors,
} from "../../brand-repo.js";
import type { BrandColor, BrandScaleValue } from "../../brand-extraction.js";

/**
 * Static token analysis for `/brand <repo>` (XYNE-66819).
 *
 * The model reads files out of a read-only clone with `sandbox-read-file` and
 * passes their CONTENTS here; the parsing happens in the runtime, not in the
 * sandbox and not in the model's head. That is deliberate — it means the
 * parsers carry a fixture suite, and that suite covers the code that actually
 * runs rather than a second implementation of it.
 *
 * Nothing is executed: a Tailwind config is arbitrary JavaScript from an
 * untrusted repository and is only ever scanned as text.
 */

interface NamedFile {
  path: string;
  content: string;
}

function asFiles(value: unknown): NamedFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const path = (item as Record<string, unknown>)["path"];
    const content = (item as Record<string, unknown>)["content"];
    if (typeof path !== "string" || typeof content !== "string") return [];
    return [{ path, content }];
  });
}

export interface RepoTokenAnalysis {
  colors: BrandColor[];
  fonts: Array<{ family: string; fallbacks: string[]; token: string }>;
  radii: BrandScaleValue[];
  /** Everything the analysis could not settle, in the wording that should
   *  reach `brand.json`'s `gaps`. */
  gaps: string[];
  /** Primitives found, so the model can say what corroborated the palette. */
  primitives: string[];
}

export function analyzeRepoTokens(input: {
  tailwindConfig?: string;
  cssFiles?: NamedFile[];
  componentFiles?: NamedFile[];
}): RepoTokenAnalysis {
  const gaps: string[] = [];
  const declared: Array<{ name: string; value: string }> = [];
  const radii: BrandScaleValue[] = [];
  const fonts: RepoTokenAnalysis["fonts"] = [];

  if (input.tailwindConfig) {
    const tw = parseTailwindConfig(input.tailwindConfig);
    declared.push(...tw.colors);
    radii.push(...tw.radii);
    for (const font of tw.fontFamilies) {
      if (font.stack[0]) {
        fonts.push({ family: font.stack[0], fallbacks: font.stack.slice(1), token: font.name });
      }
    }
    gaps.push(...tw.unresolved.map((u) => `tailwind: could not resolve ${u}`));
  }

  for (const file of input.cssFiles ?? []) {
    const tokens = parseCssCustomProperties(file.content);
    for (const color of colorVariables(tokens)) {
      if (!declared.some((d) => d.name === color.name)) declared.push(color);
    }
    for (const variable of tokens.variables) {
      if (/^(?:--)?radius/i.test(variable.name) && !radii.some((r) => r.token === variable.name)) {
        radii.push({ token: variable.name, value: variable.value });
      }
    }
    gaps.push(...tokens.unresolved.map((u) => `${file.path}: could not resolve ${u}`));
  }

  const evidence = scanComponentPrimitives(input.componentFiles ?? []);
  const { colors, unroled } = toBrandColors(declared, evidence);

  if (colors.length === 0) {
    gaps.push("no colour tokens could be resolved from the repository");
  }
  if (evidence.primitives.length === 0) {
    gaps.push("no Button/Card/Badge primitive found, so palette usage is unverified");
  }
  gaps.push(...unroled.map((name) => `no role inferred for token "${name}"`));

  return { colors, fonts, radii, gaps, primitives: evidence.primitives };
}

export const brandParseRepoTokens: ToolDefinition = {
  slug: "brand-parse-repo-tokens",
  name: "Brand Parse Repo Tokens",
  description:
    "Extract design tokens from a repository's source files. Pass the contents of tailwind.config.{js,ts,cjs,mjs} " +
    "(any version — v3 `theme`/`theme.extend` and v4 `@theme` are both read), global stylesheets containing `:root` " +
    "or `@theme` custom properties, and the Button/Card/Badge component files. " +
    "Returns colours annotated with a role and how often each is referenced by those primitives, plus font stacks, " +
    "radii, and a `gaps` list naming everything that could NOT be resolved — put those straight into brand.json's " +
    "`gaps`. Values in colour spaces that cannot be converted exactly (oklch, lab, color-mix) and `var()` indirection " +
    "are reported as gaps rather than approximated. Read the files with sandbox-read-file first; this tool parses " +
    "text only and never executes the config.",
  source: "custom:brand",
  inputSchema: {
    type: "object",
    properties: {
      tailwindConfig: {
        type: "string",
        description: "Full text of tailwind.config.{js,ts,cjs,mjs}, if the repo has one.",
      },
      cssFiles: {
        type: "array",
        description: "Global stylesheets that may declare :root or @theme custom properties.",
        items: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      componentFiles: {
        type: "array",
        description: "Button/Card/Badge source files, used to corroborate which tokens are really used.",
        items: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    },
    required: [],
  },

  // Pure CPU work, but the registry's contract is async.
  async execute(params) {
    const tailwindConfig = params["tailwindConfig"];
    const analysis = analyzeRepoTokens({
      ...(typeof tailwindConfig === "string" ? { tailwindConfig } : {}),
      cssFiles: asFiles(params["cssFiles"]),
      componentFiles: asFiles(params["componentFiles"]),
    });
    return JSON.stringify(analysis, null, 2);
  },
};
