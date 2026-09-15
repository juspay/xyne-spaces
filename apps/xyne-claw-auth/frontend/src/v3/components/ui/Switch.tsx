interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function Switch({ checked, onChange, disabled, ariaLabel }: SwitchProps) {
  return (
    <button
      data-id="agent-switch"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`relative inline-flex h-5 w-8 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-xyne-success-fg bg-xyne-success-fg"
          : "border-xyne-border-strong bg-xyne-surface"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-xyne-fg-inverse shadow-sm transition-transform dark:bg-xyne-surface ${
          checked ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
