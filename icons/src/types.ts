import type { SVGProps } from "react";

/** A single SVG child element as a [tag, attributes] tuple. */
export type IconNode = [tag: string, attrs: Record<string, string | number>][];

/** The five Pikaicons render styles. */
export const PIKA_STYLES = ["Stroke", "Solid", "Contrast", "Duo Stroke", "Duo Solid"] as const;
export type PikaStyle = (typeof PIKA_STYLES)[number];

/** An icon's shape data, keyed by style. */
export type IconVariants = Record<PikaStyle, IconNode>;

export interface PikaIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  /** Width & height in px (or any CSS length). Default 24. */
  size?: number | string;
  /** Icon color. Sets CSS `color`, which `currentColor` resolves to. Default: inherit. */
  color?: string;
  /** Stroke width for stroked styles. Default 2. */
  strokeWidth?: number | string;
  /** Keep stroke visually constant regardless of `size`. */
  absoluteStrokeWidth?: boolean;
  /** Which style variant to render. Default "Stroke". */
  variant?: PikaStyle;
}
