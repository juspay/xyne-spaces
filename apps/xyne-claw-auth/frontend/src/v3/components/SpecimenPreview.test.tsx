import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SpecimenPreview,
  activePalette,
  hasUsableDarkSet,
  resolveSpecimenPalette,
} from "./SpecimenPreview";
import type { BrandColor } from "../../lib/api";

const light: BrandColor[] = [
  { hex: "#FFFFFF", token: "brand-background", role: "background" },
  { hex: "#0F172A", token: "brand-text", role: "text" },
  { hex: "#1A73E8", token: "brand-primary", role: "primary" },
];

const dark: BrandColor[] = [
  { hex: "#0B1120", token: "brand-background", role: "background" },
  { hex: "#F8FAFC", token: "brand-text", role: "text" },
  { hex: "#60A5FA", token: "brand-primary", role: "primary" },
];

describe("hasUsableDarkSet", () => {
  it("accepts a dark palette that states its provenance", () => {
    expect(hasUsableDarkSet({ colors: light, colorsDark: dark, darkThemeSource: "class" })).toBe(
      true,
    );
  });

  it("rejects a dark palette with no provenance", () => {
    expect(hasUsableDarkSet({ colors: light, colorsDark: dark })).toBe(false);
  });

  it("rejects a provenance with no palette behind it", () => {
    expect(hasUsableDarkSet({ colors: light, darkThemeSource: "theme-file" })).toBe(false);
    expect(hasUsableDarkSet({ colors: light, colorsDark: [], darkThemeSource: "class" })).toBe(
      false,
    );
  });

  it("rejects a single-theme summary", () => {
    expect(hasUsableDarkSet({ colors: light })).toBe(false);
  });
});

describe("activePalette", () => {
  const themed = { colors: light, colorsDark: dark, darkThemeSource: "class" as const };

  it("returns the light set when the toggle is light", () => {
    expect(activePalette(themed, false)).toEqual({ colors: light, showingDark: false });
  });

  it("returns the dark set when the toggle is dark", () => {
    expect(activePalette(themed, true)).toEqual({ colors: dark, showingDark: true });
  });

  it("falls back to light when the toggle says dark but no usable set exists", () => {
    const got = activePalette({ colors: light }, true);

    expect(got.colors).toEqual(light);
    expect(got.showingDark).toBe(false);
  });

  it("falls back to light when the dark set has no provenance", () => {
    const got = activePalette({ colors: light, colorsDark: dark }, true);

    expect(got.colors).toEqual(light);
    expect(got.showingDark).toBe(false);
  });
});

describe("resolveSpecimenPalette", () => {
  it("uses the set's own values and substitutes nothing when all roles are present", () => {
    const full: BrandColor[] = [
      ...light,
      { hex: "#F8FAFC", token: "brand-surface", role: "surface" },
      { hex: "#64748B", token: "brand-muted", role: "muted" },
      { hex: "#E2E8F0", token: "brand-border", role: "border" },
    ];

    const got = resolveSpecimenPalette(full, false);

    expect(got.substituted).toEqual([]);
    expect(got.resolved.background).toBe("#FFFFFF");
    expect(got.resolved.primary).toBe("#1A73E8");
  });

  it("names every role it had to stand in for", () => {
    const got = resolveSpecimenPalette(light, false);

    expect(got.substituted).toEqual(["surface", "muted", "border"]);
  });

  it("stands in with dark neutrals for a dark specimen, not light ones", () => {
    const lightFallback = resolveSpecimenPalette([], false);
    const darkFallback = resolveSpecimenPalette([], true);

    expect(lightFallback.resolved.background).toBe("#FFFFFF");
    expect(darkFallback.resolved.background).toBe("#0B1120");
    expect(darkFallback.substituted).toHaveLength(6);
  });

  it("prefers the set's value over a fallback even for one role", () => {
    const got = resolveSpecimenPalette(
      [{ hex: "#123456", token: "brand-border", role: "border" }],
      true,
    );

    expect(got.resolved.border).toBe("#123456");
    expect(got.substituted).not.toContain("border");
  });
});

describe("SpecimenPreview markup", () => {
  const render = (colors: BrandColor[], isDark: boolean) =>
    renderToStaticMarkup(
      <SpecimenPreview
        colors={colors}
        fonts={[{ family: "Inter", role: "body", fallbacks: ["sans-serif"] }]}
        typeScale={[{ name: "h1", sizePx: 48, weight: 700 }]}
        dark={isDark}
      />,
    );

  it("stamps data-theme so the rendered theme is visible in the DOM", () => {
    expect(render(light, false)).toContain('data-theme="light"');
    expect(render(dark, true)).toContain('data-theme="dark"');
  });

  it("paints the dark set's own surface when dark", () => {
    const markup = render(dark, true);

    expect(markup).toContain("#0B1120");
    expect(markup).not.toContain("#FFFFFF");
  });

  it("renders a swatch for every colour in the set", () => {
    const markup = render(dark, true);

    for (const color of dark) {
      expect(markup).toContain(color.hex);
    }
  });

  it("shows assembled components, not only swatches", () => {
    const markup = render(light, false);

    expect(markup).toContain("Primary action");
    expect(markup).toContain("Input placeholder");
    expect(markup).toContain("Card title");
  });

  it("caps an outsized type step instead of blowing out the card", () => {
    const markup = renderToStaticMarkup(
      <SpecimenPreview
        colors={light}
        fonts={[{ family: "Inter", role: "heading" }]}
        typeScale={[{ name: "display", sizePx: 96 }]}
        dark={false}
      />,
    );

    expect(markup).toContain("font-size:24px");
    expect(markup).not.toContain("font-size:96px");
  });

  it("names its stand-ins in the rendered footnote", () => {
    expect(render(light, false)).toContain("neutral stand-in");
  });

  it("renders without a type scale or fonts at all", () => {
    expect(() =>
      renderToStaticMarkup(
        <SpecimenPreview colors={light} fonts={[]} typeScale={[]} dark={false} />,
      ),
    ).not.toThrow();
  });
});
