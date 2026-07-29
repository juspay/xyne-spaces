/**
 * Tooltip — thin wrapper around Radix Tooltip styled with xyne design tokens.
 *
 * Two exports:
 *   - <Tooltip content="…">{trigger}</Tooltip>  for arbitrary trigger elements
 *   - <InfoIcon text="…" />                     for the V1 "(i)" hover-explainer
 *
 * Wrap the app (or a subtree) in <TooltipProvider> once. We provide a sensible
 * default delay so tooltips feel responsive without firing on accidental flyovers.
 */

import * as React from "react";
import {
  Tooltip as RadixTooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipPortal,
  TooltipProvider as RadixTooltipProvider,
} from "@radix-ui/react-tooltip";
import { InfoIcon as PhInfoIcon } from "@phosphor-icons/react";

export function TooltipProvider({
  children,
  delayDuration = 200,
}: {
  children: React.ReactNode;
  delayDuration?: number;
}) {
  return (
    <RadixTooltipProvider delayDuration={delayDuration} skipDelayDuration={100}>
      {children}
    </RadixTooltipProvider>
  );
}

interface TooltipProps {
  /** Tooltip body — short sentence, no markdown. */
  content: React.ReactNode;
  /** The element that receives hover/focus. */
  children: React.ReactElement;
  /** "top" | "bottom" | "left" | "right". Defaults to "top". */
  side?: "top" | "right" | "bottom" | "left";
  /** Horizontal alignment relative to the trigger. */
  align?: "start" | "center" | "end";
  /** Constrain width. Default 260px keeps tooltips readable. */
  maxWidthPx?: number;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  maxWidthPx = 260,
}: TooltipProps) {
  return (
    <RadixTooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={6}
          style={{ maxWidth: `${maxWidthPx}px` }}
          className="z-[var(--comp-z-tooltip)] rounded-md border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[11px] leading-snug text-xyne-fg-secondary shadow-lg"
        >
          {content}
        </TooltipContent>
      </TooltipPortal>
    </RadixTooltip>
  );
}

interface InfoIconProps {
  /** Tooltip body. */
  text: React.ReactNode;
  /** Icon pixel size. Defaults to 12. */
  size?: number;
  /** Optional extra classes on the icon (e.g. positioning). */
  className?: string;
}

/**
 * Small information icon with a hover/focus tooltip — the V1 pattern.
 * Use next to button labels or section headings to explain meaning without
 * cluttering the surface.
 */
export function InfoIcon({ text, size = 12, className = "" }: InfoIconProps) {
  return (
    <Tooltip content={text}>
      <button
        type="button"
        aria-label="More info"
        className={`inline-flex items-center justify-center rounded text-xyne-fg-tertiary hover:text-xyne-fg-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-xyne-brand ${className}`}
      >
        <PhInfoIcon size={size} />
      </button>
    </Tooltip>
  );
}
