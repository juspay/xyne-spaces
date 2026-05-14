import React from 'react';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  label,
  id,
  disabled = false,
}) => {
  return (
    <div className='flex items-center gap-3'>
      <button
        id={id}
        role='switch'
        aria-checked={checked}
        onClick={() => !disabled && onCheckedChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${checked ? 'bg-blue-600' : 'bg-muted'}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
      {label && (
        <label htmlFor={id} className='cursor-pointer select-none text-sm text-foreground'>
          {label}
        </label>
      )}
    </div>
  );
};
