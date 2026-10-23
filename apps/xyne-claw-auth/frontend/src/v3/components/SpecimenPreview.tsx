import { useMemo } from "react";
import type { BrandColor, BrandFont, BrandTypeStep } from "../../lib/api";

/**
 * A specimen of a design system rendered in one theme.
 *
 * Swatches alone do not show whether a system WORKS: a palette can look fine as
 * ten squares and still produce unreadable body text or an invisible border once
 * it is assembled. So this renders the real thing — button, field, card — from
 * the same tokens, which is also the only way a reviewer sees a dark set fail.
 *
 * Every value is inline-styled from the palette rather than themed with CSS
 * classes, because the host app has its own theme and must not leak into a
 * preview of someone else's brand.
 *
 * It lives next to the Brand Review Card rather than on a route of its own:
 * there is no design-system catalog page yet (XYNE-66820), and a specimen behind
 * an unreachable URL would be a feature nobody finds.
 */

/** Neutral stand-ins, used ONLY when the extraction has no value for a role.
 *  Substitutions are listed in the footnote rather than passed off as brand
 *  values — an invented token is wrong everywhere it is later used. */
const LIGHT_FALLBACK = {
  background: "#FFFFFF",
  surface: "#F8FAFC",
  text: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  primary: "#2563EB",
} as const;

const DARK_FALLBACK = {
  background: "#0B1120",
  surface: "#151B2B",
  text: "#F8FAFC",
  muted: "#94A3B8",
  border: "#273246",
  primary: "#60A5FA",
} as const;

type RoleKey = keyof typeof LIGHT_FALLBACK;

const ROLE_KEYS: RoleKey[] = ["background", "surface", "text", "muted", "border", "primary"];

export interface SpecimenPalette {
  resolved: Record<RoleKey, string>;
  /** Roles the set did not define, so the card can say which values are
   *  stand-ins instead of letting them read as extracted. */
  substituted: RoleKey[];
}

/** Resolve the roles a specimen needs from a flat colour list. Exported for the
 *  tests, which assert the substitution list rather than the pixels. */
export function resolveSpecimenPalette(colors: BrandColor[], dark: boolean): SpecimenPalette {
  const fallback = dark ? DARK_FALLBACK : LIGHT_FALLBACK;
  const resolved = {} as Record<RoleKey, string>;
  const substituted: RoleKey[] = [];

  for (const key of ROLE_KEYS) {
    const found = colors.find((color) => color.role === key);
    if (found) {
      resolved[key] = found.hex;
    } else {
      resolved[key] = fallback[key];
      substituted.push(key);
    }
  }

  // `accent` is optional in a specimen: with no accent the secondary button
  // simply uses the border colour, which is what a one-colour brand looks like.
  return { resolved, substituted };
}

function fontStack(font: BrandFont | undefined): string | undefined {
  if (!font) return undefined;
  return `${JSON.stringify(font.family)}, ${(font.fallbacks ?? ["sans-serif"]).join(", ")}`;
}

export function SpecimenPreview({
  colors,
  fonts,
  typeScale,
  dark,
}: {
  colors: BrandColor[];
  fonts: BrandFont[];
  typeScale: BrandTypeStep[];
  dark: boolean;
}): React.JSX.Element {
  const { resolved, substituted } = useMemo(
    () => resolveSpecimenPalette(colors, dark),
    [colors, dark],
  );

  const headingFont = fonts.find((font) => font.role === "heading") ?? fonts[0];
  const bodyFont = fonts.find((font) => font.role === "body") ?? headingFont;
  const accent = colors.find((color) => color.role === "accent")?.hex;

  // Largest three steps, so the specimen shows the scale's shape without
  // becoming a type catalog.
  const steps = useMemo(
    () => [...typeScale].sort((a, b) => b.sizePx - a.sizePx).slice(0, 3),
    [typeScale],
  );

  return (
    <div
      data-id="specimen-preview"
      data-theme={dark ? "dark" : "light"}
      className="rounded-lg border p-4"
      style={{
        backgroundColor: resolved.background,
        borderColor: resolved.border,
        color: resolved.text,
        fontFamily: fontStack(bodyFont),
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {colors.map((color) => (
          <div
            key={`${color.token}-${color.hex}`}
            className="h-7 w-7 rounded"
            style={{ backgroundColor: color.hex, border: `1px solid ${resolved.border}` }}
            title={`${color.token} — ${color.hex}`}
          />
        ))}
      </div>

      {steps.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {steps.map((step) => (
            <div
              key={step.name}
              className="truncate"
              style={{
                fontFamily: fontStack(headingFont),
                // Capped: a 96px display step would otherwise blow out the card.
                fontSize: `${Math.min(step.sizePx, 24)}px`,
                ...(step.weight ? { fontWeight: step.weight } : {}),
              }}
            >
              {step.name} — Design system specimen
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-[12px] leading-5" style={{ color: resolved.muted }}>
        Body copy at rest. This paragraph is the one to read for contrast: muted
        text on a surface is where a theme usually fails.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium"
          style={{
            backgroundColor: resolved.primary,
            // Brand primaries are mid-to-dark far more often than not, so the
            // background colour is the safer label colour than the text token,
            // which on a dark theme is near-white on near-white.
            color: resolved.background,
          }}
        >
          Primary action
        </span>
        <span
          className="inline-flex h-8 items-center rounded-md border px-3 text-[12px] font-medium"
          style={{ borderColor: accent ?? resolved.border, color: resolved.text }}
        >
          Secondary
        </span>
      </div>

      <div
        className="mt-2 flex h-8 items-center rounded-md border px-2.5 text-[12px]"
        style={{
          backgroundColor: resolved.surface,
          borderColor: resolved.border,
          color: resolved.muted,
        }}
      >
        Input placeholder
      </div>

      <div
        className="mt-2 rounded-md border p-2.5"
        style={{ backgroundColor: resolved.surface, borderColor: resolved.border }}
      >
        <div className="text-[12px] font-medium" style={{ fontFamily: fontStack(headingFont) }}>
          Card title
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: resolved.muted }}>
          Surface, border and muted text together.
        </div>
      </div>

      {substituted.length > 0 && (
        <p className="mt-3 text-[10px]" style={{ color: resolved.muted }}>
          Not in this set, shown with a neutral stand-in: {substituted.join(", ")}.
        </p>
      )}
    </div>
  );
}
