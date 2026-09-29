import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';

interface PropertyRowProps {
  label: ReactNode;
  children: ReactNode;
  labelClassName?: string;
  className?: string;
  /**
   * Accepted so existing callers compile. The label always pins to the
   * vertical center of the first line, for a placeholder and after the value grows.
   */
  align?: 'center' | 'start';
}

const LABEL_CLASS = 'w-[200px] text-sm font-normal leading-[1.3] tracking-[-0.1px] text-foreground';

function isInFlowBox(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') {
    return false;
  }
  return el.getBoundingClientRect().height > 0;
}

/** Height of the first line, not the whole wrapped block. */
function firstLineHeight(node: HTMLElement): number {
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
    const line = Number.parseFloat(getComputedStyle(node).lineHeight);
    if (Number.isFinite(line) && line > 0) return line;
  }

  const style = getComputedStyle(node);
  const wraps = style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse';
  if ((style.display === 'flex' || style.display === 'inline-flex') && wraps) {
    const chip = [...node.children].find(
      (child): child is HTMLElement => child instanceof HTMLElement && isInFlowBox(child),
    );
    if (chip) return chip.getBoundingClientRect().height;
  }

  return node.getBoundingClientRect().height;
}

function valueLineHeight(root: HTMLElement): number {
  let node =
    [...root.children].find(
      (child): child is HTMLElement => child instanceof HTMLElement && isInFlowBox(child),
    ) ?? null;

  while (node && node.childElementCount === 1) {
    const only = node.firstElementChild;
    if (!(only instanceof HTMLElement) || !isInFlowBox(only)) break;
    const parentHeight = node.getBoundingClientRect().height;
    const childHeight = only.getBoundingClientRect().height;
    if (Math.abs(parentHeight - childHeight) > 1) break;
    node = only;
  }

  return node ? firstLineHeight(node) : 0;
}

/** Label on the left, value on the right. Profile properties use this. */
export function PropertyRow({
  label,
  children,
  labelClassName,
  className,
  align = 'center',
}: PropertyRowProps): ReactElement {
  const labelRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLDivElement>(null);
  const [pad, setPad] = useState(0);

  useLayoutEffect(() => {
    const labelEl = labelRef.current;
    const valueEl = valueRef.current;
    if (!labelEl || !valueEl) return;

    const measure = (): void => {
      const slot = labelEl.getBoundingClientRect().height;
      const line = valueLineHeight(valueEl);
      const next = line > 0 && line < slot - 0.5 ? (slot - line) / 2 : 0;
      setPad(prev => (Math.abs(prev - next) < 0.25 ? prev : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(labelEl);
    observer.observe(valueEl);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn('flex min-h-9 w-full items-start gap-12', className)}
      data-component='PropertyRow'
      data-align={align}
    >
      <div
        ref={labelRef}
        className={cn(labelClassName ?? LABEL_CLASS, 'flex h-9 shrink-0 items-center')}
      >
        {label}
      </div>
      <div
        ref={valueRef}
        className='flex min-h-9 min-w-0 flex-1 flex-col'
        style={pad > 0 ? { paddingTop: pad } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
