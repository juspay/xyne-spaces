interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Checkbox({ checked, onChange, label = 'Edit entire series' }: CheckboxProps) {
  return (
    <label className='group inline-flex items-start gap-2 cursor-pointer select-none w-fit'>
      {/* Hidden native checkbox for accessibility */}
      <input
        type='checkbox'
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className='sr-only'
      />

      {/* Custom checkbox box */}
      <span
        className={`
          relative flex items-center justify-center
          w-[18px] h-[18px] rounded-[4px] shrink-0
          border transition-all duration-150 ease-in-out
          ${checked ? 'bg-primary border-primary ' : 'bg-card border-border '}
        `}
      >
        {/* Checkmark SVG */}
        <svg
          viewBox='0 0 10 8'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          className={`w-[10px] h-[8px] transition-all duration-150 ${
            checked ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
          }`}
        >
          <path
            d='M1 4L3.5 6.5L9 1'
            stroke='hsl(var(--primary-foreground))'
            strokeWidth='1.6'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </span>

      {/* Label text */}
      {label && <span className='text-[13px] font-medium text-foreground'>{label}</span>}
    </label>
  );
}
