import { Combobox } from "@base-ui-components/react/combobox";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "../../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  disabled?: boolean;
  options: SelectOption[];
  id?: string;
  className?: string;
}

export function SelectField({
  label,
  hint,
  error,
  placeholder = "Select…",
  value,
  defaultValue,
  onValueChange,
  disabled,
  options,
  id,
  className,
}: SelectFieldProps) {
  const fieldId = id ?? `select-${label?.toLowerCase().replace(/\s+/g, "-") ?? "field"}`;
  const hasError = Boolean(error);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={fieldId} className="text-[12px] font-medium text-xyne-fg-secondary">
          {label}
        </label>
      )}

      <Combobox.Root
        items={options}
        value={value ? options.find((o) => o.value === value) ?? null : null}
        defaultValue={defaultValue ? options.find((o) => o.value === defaultValue) ?? null : undefined}
        onValueChange={(item) => onValueChange?.(item ? (item as SelectOption).value : null)}
        disabled={disabled}
      >
        <div
          className={cn(
            "relative flex h-9 w-full items-center outline-none ring-0",
            "rounded-[var(--comp-input-radius)] border bg-xyne-surface",
            "transition-[border-color] duration-[var(--comp-duration-normal)] ease-in",
            hasError
              ? "border-xyne-border-error"
              : "border-xyne-border focus-within:border-xyne-border-focus",
            "[&_input]:outline-none [&_input]:ring-0 [&_input]:shadow-none",
            "focus-within:outline-none focus-within:ring-0 focus-within:shadow-none",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <Combobox.Input
            id={fieldId}
            placeholder={placeholder}
            className={cn(
              "h-full w-full bg-transparent pl-3 pr-8 text-[14px] text-xyne-fg-primary outline-none",
              "placeholder:text-xyne-fg-placeholder",
              "disabled:cursor-not-allowed",
            )}
          />
          <Combobox.Trigger
            aria-label="Toggle options"
            className={cn(
              "absolute right-0 top-0 flex h-full w-8 items-center justify-center",
              "text-xyne-fg-muted",
              "data-[popup-open]:rotate-180 transition-transform duration-[var(--comp-duration-normal)]",
            )}
          >
            <ChevronDown size={14} className="shrink-0" />
          </Combobox.Trigger>
        </div>

        <Combobox.Portal>
          <Combobox.Positioner
            side="bottom"
            sideOffset={4}
            className="z-[350] w-[var(--anchor-width)]"
          >
            <Combobox.Popup
              className={cn(
                "w-full overflow-hidden",
                "rounded-xl border border-xyne-border bg-xyne-surface",
                "shadow-lg",
                "origin-[var(--transform-origin)]",
                "transition-[transform,opacity] duration-[var(--comp-duration-normal)]",
                "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
                "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
              )}
            >
              <Combobox.Empty className="px-3 py-2 text-[13px] text-xyne-fg-muted">
                No results
              </Combobox.Empty>
              <Combobox.List className="max-h-56 overflow-y-auto py-1">
                {(item: SelectOption) => (
                  <Combobox.Item
                    key={item.value}
                    value={item}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-2",
                      "text-[14px] text-xyne-fg-primary outline-none",
                      "hover:bg-xyne-surface-subtle",
                      "data-[highlighted]:bg-xyne-surface-subtle",
                      "data-[selected]:font-medium",
                      "transition-colors duration-75",
                    )}
                  >
                    <Combobox.ItemIndicator className="w-4 shrink-0">
                      <Check size={12} className="text-xyne-fg-primary" />
                    </Combobox.ItemIndicator>
                    <span>{item.label}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      {(error || hint) && (
        <span className={cn("text-[11px]", hasError ? "text-xyne-error-fg" : "text-xyne-fg-muted")}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
