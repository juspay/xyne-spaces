import { forwardRef, type ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { InfoIcon } from "./Tooltip";

/* ------------------------------------------------------------------ */
/*  TextField — label + input with focus ring (token-driven)            */
/* ------------------------------------------------------------------ */

interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  /**
   * Optional info-icon tooltip rendered after the label. Same visual
   * pattern V1 uses next to every field caption (a small "ⓘ" that
   * shows the explanation on hover/focus).
   */
  info?: ReactNode;
  /** Use textarea instead of input */
  multiline?: boolean;
  rows?: number;
}

export const TextField = forwardRef<HTMLInputElement | HTMLTextAreaElement, TextFieldProps>(
  function TextField(
    { label, hint, error, info, multiline, rows = 4, className, id, ...props },
    ref,
  ) {
    const fieldId = id ?? `field-${label?.toLowerCase().replace(/\s+/g, "-") ?? "input"}`;
    const hasError = Boolean(error);

    const fieldClasses = cn(
      "w-full bg-xyne-surface text-[14px] text-xyne-fg-primary",
      "placeholder:text-xyne-fg-placeholder outline-none",
      "rounded-[var(--comp-input-radius)] border",
      hasError ? "border-xyne-border-error" : "border-xyne-border",
      "transition-[border-color,box-shadow] duration-[var(--comp-duration-normal)] ease-in",
      "focus:border-xyne-border-focus",
      multiline ? "px-3 py-2 resize-y" : "h-9 px-3",
      className,
    );

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={fieldId}
            className="flex items-center gap-1 text-[12px] font-medium text-xyne-fg-secondary"
          >
            {label}
            {info && <InfoIcon text={info} />}
          </label>
        )}
        {multiline ? (
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            id={fieldId}
            rows={rows}
            className={fieldClasses}
            {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input
            ref={ref as React.Ref<HTMLInputElement>}
            id={fieldId}
            className={fieldClasses}
            {...props}
          />
        )}
        {(error || hint) && (
          <span
            className={cn(
              "text-[11px]",
              hasError ? "text-xyne-error-fg" : "text-xyne-fg-muted",
            )}
          >
            {error ?? hint}
          </span>
        )}
      </div>
    );
  },
);
