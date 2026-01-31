import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Circle } from 'lucide-react';
import { cn } from '../../../utils/classNames';

function RadioGroupRoot({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>): React.ReactElement {
  return (
    <RadioGroupPrimitive.Root
      data-slot='radio-group'
      className={cn('grid gap-3', className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>): React.ReactElement {
  return (
    <RadioGroupPrimitive.Item
      data-slot='radio-group-item'
      className={cn(
        'border-input text-sidebar-badge-accent focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot='radio-group-indicator'
        className='relative flex items-center justify-center'
      >
        <Circle className='fill-sidebar-badge-accent absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2' />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

interface RadioGroupProps {
  name?: string;
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

const RadioGroup = ({
  name,
  label,
  value,
  onChange,
  children,
  className,
}: RadioGroupProps): React.ReactElement => {
  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className='text-sm font-medium text-gray-700' htmlFor={name}>
          {label}
        </label>
      )}
      <RadioGroupRoot
        value={value ?? null}
        {...(onChange && { onValueChange: onChange })}
        {...(name && { name })}
      >
        {children}
      </RadioGroupRoot>
    </div>
  );
};

interface RadioProps {
  value: string;
  subtext?: string;
  children: React.ReactNode;
  className?: string;
}

const Radio = ({ value, subtext, children, className }: RadioProps): React.ReactElement => {
  return (
    <div className={cn('flex items-center justify-start space-x-3', className)}>
      <RadioGroupItem value={value} id={value} />
      <div className='flex-1 space-y-0.5 '>
        <label
          htmlFor={value}
          className='text-sm font-medium text-gray-900 cursor-pointer leading-1'
        >
          {children}
        </label>
        {subtext && <p className='text-xs text-gray-500  leading-none'>{subtext}</p>}
      </div>
    </div>
  );
};

export { RadioGroup, Radio, RadioGroupRoot, RadioGroupItem };
