import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { cn } from '@/utils/classNames';

export type AutoWidthInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange'> & {
  value: string;
  onChange: (next: string) => void;
};

export function AutoWidthInput({
  value,
  onChange,
  placeholder,
  className,
  style,
  size = 1,
  type = 'text',
  ...rest
}: AutoWidthInputProps): ReactElement {
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const measure = (): void => {
      const el = mirrorRef.current;
      if (el) setWidth(el.getBoundingClientRect().width);
    };
    measure();
    void document.fonts.ready.then(measure);
  }, [value, placeholder, className]);

  const measured: CSSProperties | undefined =
    width === null ? undefined : { width: `${Math.ceil(width) + 2}px` };

  return (
    <span className='relative inline-flex min-w-0 max-w-full'>
      <span
        ref={mirrorRef}
        aria-hidden
        className={cn(
          'pointer-events-none invisible absolute left-0 top-0 whitespace-pre',
          className,
        )}
      >
        {value || placeholder || ' '}
      </span>
      <input
        data-track-category='Claw Agents'
        data-track-name='Auto-width input'
        type={type}
        size={size}
        value={value}
        onChange={event => onChange(event.target.value)}
        {...(placeholder === undefined ? {} : { placeholder })}
        style={{ ...measured, ...style }}
        className={cn('min-w-0 max-w-full bg-transparent focus:outline-none', className)}
        {...rest}
      />
    </span>
  );
}
