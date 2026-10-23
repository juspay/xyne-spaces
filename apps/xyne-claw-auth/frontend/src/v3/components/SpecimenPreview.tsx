import { useMemo } from "react";
import type { BrandColor, BrandFont, BrandSummary, BrandTypeStep } from "../../lib/api";

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
  substituted: RoleKey[];
}

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

  return { resolved, substituted };
}

type ThemeableSummary = Pick<BrandSummary, "colors" | "colorsDark" | "darkThemeSource">;

export function hasUsableDarkSet(summary: ThemeableSummary): boolean {
  return (summary.colorsDark?.length ?? 0) > 0 && Boolean(summary.darkThemeSource);
}

export function activePalette(
  summary: ThemeableSummary,
  dark: boolean,
): { colors: BrandColor[]; showingDark: boolean } {
  const showingDark = hasUsableDarkSet(summary) && dark;
  return { colors: showingDark ? (summary.colorsDark ?? []) : summary.colors, showingDark };
}

function fontStack(font: BrandFont | undefined): string | undefined {
  if (!font) return undefined;
  return `${JSON.stringify(font.family)}, ${(font.fallbacks ?? ["sans-serif"]).join(", ")}`;
}

const MAX_SPECIMEN_STEP_PX = 24;
const SPECIMEN_STEP_COUNT = 3;

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

  const steps = useMemo(
    () => [...typeScale].sort((a, b) => b.sizePx - a.sizePx).slice(0, SPECIMEN_STEP_COUNT),
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
                fontSize: `${Math.min(step.sizePx, MAX_SPECIMEN_STEP_PX)}px`,
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
          style={{ backgroundColor: resolved.primary, color: resolved.background }}
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
