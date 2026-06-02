import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../../lib/utils";
import { useTheme } from "../../hooks/useTheme";

/* ------------------------------------------------------------------ */
/*  Variants                                                            */
/* ------------------------------------------------------------------ */

const badgeVariants = cva(
  /* base — shape, transition; font-weight & size set per variant/size */
  [
    "inline-flex items-center justify-center whitespace-nowrap select-none",
    "rounded-full leading-none",
    /* ease-in on bg, text, border, shadow */
    "transition-[background-color,color,border-color,box-shadow]",
    "duration-[var(--comp-duration-normal)] ease-in",
  ],
  {
    variants: {
      /* ── Visual intent ─────────────────────────────────────── */
      variant: {
        /* Default — visible border, no fill, regular weight */
        neutral: [
          "bg-transparent font-normal text-xyne-fg-muted border border-xyne-border",
          "hover:border-xyne-border-strong hover:text-xyne-fg-primary",
        ],
        /* Selected — neutral-950 fill + white text (inverted in dark mode) */
        selected: [
          "bg-xyne-brand text-xyne-fg-inverse",
          "dark:bg-xyne-fg-primary dark:text-xyne-surface",
          "font-medium border border-transparent",
          "hover:bg-xyne-brand-hover dark:hover:bg-xyne-fg-secondary",
        ],
        /* Status variants — non-interactive, informational */
        success: [
          "bg-xyne-success-bg text-xyne-success-fg font-medium border border-xyne-success-border",
          "hover:brightness-95",
        ],
        error: [
          "bg-xyne-error-bg text-xyne-error-fg font-medium border border-xyne-error-border",
          "hover:brightness-95",
        ],
        warning: [
          "bg-xyne-warning-bg text-xyne-warning-fg font-medium border border-xyne-warning-border",
          "hover:brightness-95",
        ],
        info: [
          "bg-xyne-info-bg text-xyne-info-fg font-medium border border-xyne-info-border",
          "hover:brightness-95",
        ],
      },
      /* ── Size — fixed 24px height, 13px text ───────────────── */
      size: {
        sm: "h-5    px-2   text-[11px] gap-1",
        md: "h-8 px-2.5 text-[13px] gap-1",
        lg: "h-7    px-3   text-[13px] gap-1.5",
      },
      /* ── Interactive (adds pointer + focus ring) ────────────── */
      interactive: {
        true:  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus focus-visible:ring-offset-1",
        false: "cursor-default",
      },
    },
    defaultVariants: {
      variant:     "neutral",
      size:        "md",
      interactive: false,
    },
  }
);

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface BadgeProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof badgeVariants> {
  label: string;
  /** When true, renders as a <span> (no click, no focus ring) */
  as?: "button" | "span";
  /** Forces the `selected` variant regardless of the `variant` prop */
  selected?: boolean;
  /** Optional leading dot for status badges */
  dot?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function Badge({
  label,
  variant    = "neutral",
  size       = "md",
  as         = "button",
  selected   = false,
  interactive,
  dot        = false,
  className,
  onClick,
  ...props
}: BadgeProps) {
  /* Selected overrides variant to "selected" visually */
  const resolvedVariant = selected ? "selected" : variant;

  /* Non-interactive when no onClick and not explicitly set */
  const resolvedInteractive = interactive ?? (onClick !== undefined);

  const { theme } = useTheme();

  const classes = cn(
    badgeVariants({ variant: resolvedVariant, size, interactive: resolvedInteractive }),
    className
  );

  /* Inline style fallback — guarantees the selected fill paints
     even if the Tailwind class system has a caching/scan issue. */
  const inlineStyle =
    resolvedVariant === "selected"
      ? theme === "dark"
        ? { backgroundColor: "var(--color-xyne-fg-primary)", color: "var(--color-xyne-surface)" }
        : { backgroundColor: "var(--color-xyne-brand)", color: "var(--color-xyne-fg-inverse)" }
      : undefined;

  const content = (
    <>
      {dot && (
        <span
          aria-hidden
          className={cn(
            "shrink-0 rounded-full",
            size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
            {
              "bg-xyne-success":  resolvedVariant === "success",
              "bg-xyne-error":    resolvedVariant === "error",
              "bg-xyne-warning":  resolvedVariant === "warning",
              "bg-xyne-info":     resolvedVariant === "info",
              "bg-xyne-fg-muted":  resolvedVariant === "neutral",
              "bg-xyne-fg-inverse dark:bg-xyne-surface": resolvedVariant === "selected",
            }
          )}
        />
      )}
      {label}
    </>
  );

  if (as === "span" || (!onClick && !resolvedInteractive)) {
    return (
      <span
        className={classes}
        style={inlineStyle}
        {...(props as React.HTMLAttributes<HTMLSpanElement>)}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      style={inlineStyle}
      onClick={onClick}
      {...props}
    >
      {content}
    </button>
  );
}
