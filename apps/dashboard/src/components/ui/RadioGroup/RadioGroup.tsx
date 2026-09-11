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
        'border-[1.5px] border-secondary-foreground/50 text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-[1.5px] data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot='radio-group-indicator'
        className='flex w-full h-full items-center justify-center'
      >
        <Circle className='fill-primary stroke-none size-2' />
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
  disabled?: boolean;
}

const RadioGroup = ({
  name,
  label,
  value,
  onChange,
  children,
  className,
  disabled,
}: RadioGroupProps): React.ReactElement => {
  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className='text-sm font-normal text-muted-foreground' htmlFor={name}>
          {label}
        </label>
      )}
      <RadioGroupRoot
        value={value ?? null}
        {...(onChange && { onValueChange: onChange })}
        {...(name && { name })}
        {...(disabled !== undefined && { disabled })}
      >
        {children}
      </RadioGroupRoot>
    </div>
  );
};

interface RadioProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  subtext?: string;
  children: React.ReactNode;
}

const Radio = ({
  value,
  subtext,
  children,
  className,
  ...rest
}: RadioProps): React.ReactElement => {
  return (
    // rest carries data-track-* through to the DOM; the click tracker's
    // ancestor walk covers both the radio item and its label from here.
    <div className={cn('flex items-center justify-start space-x-3', className)} {...rest}>
      <RadioGroupItem value={value} id={value} />
      <div className='flex-1 space-y-0.5'>
        <label
          htmlFor={value}
          className='text-sm font-normal text-foreground cursor-pointer align-text-bottom'
        >
          {children}
        </label>
        {subtext && <p className='text-xs text-muted-foreground leading-none'>{subtext}</p>}
      </div>
    </div>
  );
};

export { RadioGroup, Radio, RadioGroupRoot, RadioGroupItem };
