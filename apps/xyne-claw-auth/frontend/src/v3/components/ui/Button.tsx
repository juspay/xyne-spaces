import { forwardRef, type ReactNode } from "react";
import { Button as BaseButton } from "@base-ui-components/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../../lib/utils";

/* ------------------------------------------------------------------ */
/*  Variants                                                            */
/* ------------------------------------------------------------------ */

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center whitespace-nowrap select-none",
    "rounded-full font-medium leading-none cursor-pointer",
    "transition-[background-color,color,border-color,box-shadow]",
    "duration-[var(--comp-duration-normal)] ease-in",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus focus-visible:ring-offset-1",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ],
  {
    variants: {
      /* ── Visual intent ─────────────────────────────────────── */
      variant: {
        /* Primary — neutral-950 fill, white text */
        primary: [
          "bg-xyne-brand text-xyne-fg-inverse border border-transparent",
          "hover:bg-xyne-brand-hover",
          "dark:bg-xyne-fg-primary dark:text-xyne-surface dark:hover:bg-xyne-fg-secondary",
        ],
        /* Secondary — bordered, surface bg (page header CTAs) */
        secondary: [
          "bg-xyne-surface text-xyne-fg-primary border border-xyne-border",
          "hover:bg-xyne-surface-subtle hover:border-xyne-border-strong",
        ],
        /* Ghost — no border or fill */
        ghost: [
          "bg-transparent text-xyne-fg-muted border border-transparent",
          "hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary",
        ],
        /* Destructive */
        destructive: [
          "bg-xyne-error text-white border border-transparent",
          "hover:bg-xyne-error-fg",
        ],
      },
      /* ── Size ──────────────────────────────────────────────── */
      size: {
        sm: "h-7  px-3 text-[12px] gap-1",
        md: "h-8  px-3.5 text-[13px] gap-1.5",
        lg: "h-10 px-5 text-[14px] gap-2",
        /* Icon-only square buttons */
        icon: "h-8 w-8 p-0 gap-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size:    "md",
    },
  }
);

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface ButtonProps
  extends Omit<React.ComponentProps<typeof BaseButton>, "render">,
    VariantProps<typeof buttonVariants> {
  /** Icon rendered to the left of the label */
  leadingIcon?: ReactNode;
  /** Icon rendered to the right of the label */
  trailingIcon?: ReactNode;
  children?: ReactNode;
  type?: "button" | "submit" | "reset";
  form?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, leadingIcon, trailingIcon, className, children, ...props },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {leadingIcon  && <span className="shrink-0">{leadingIcon}</span>}
      {children}
      {trailingIcon && <span className="shrink-0">{trailingIcon}</span>}
    </BaseButton>
  );
});
