import { createElement, forwardRef } from "react";
import type { IconVariants, PikaIconProps } from "./types.js";

/** Baseline <svg> attributes. `fill`/`stroke`/`strokeWidth` are inherited by children. */
const defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const toPascalCase = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (c) => c.toUpperCase());

/**
 * Turns an icon's per-style shape data into a themeable React component.
 * The returned component exposes `size`, `color`, `strokeWidth` and `variant`.
 */
export function createPikaIcon(name: string, variants: IconVariants) {
  const Component = forwardRef<SVGSVGElement, PikaIconProps>(
    (
      {
        size = 24,
        color,
        strokeWidth,
        absoluteStrokeWidth,
        variant = "Stroke",
        className,
        style,
        ...rest
      },
      ref,
    ) => {
      const nodes = variants[variant] ?? variants.Stroke;
      const computedStrokeWidth =
        absoluteStrokeWidth != null && absoluteStrokeWidth
          ? (Number(strokeWidth ?? defaultAttributes.strokeWidth) * 24) / Number(size)
          : strokeWidth;

      return createElement(
        "svg",
        {
          ref,
          ...defaultAttributes,
          width: size,
          height: size,
          ...(computedStrokeWidth != null && { strokeWidth: computedStrokeWidth }),
          className: ["pika", `pika-${name}`, className].filter(Boolean).join(" "),
          style: color ? { color, ...style } : style,
          "aria-hidden": (rest as Record<string, unknown>)["aria-label"] ? undefined : true,
          ...rest,
        },
        nodes.map(([tag, attrs]) => createElement(tag, attrs)),
      );
    },
  );

  Component.displayName = toPascalCase(name);
  return Component;
}
