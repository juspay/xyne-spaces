import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ThreeDotsMenuVertical } from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/classNames';
import { PROPERTY_MENU_PANEL } from './AddPropertyMenu';
import { useExclusiveMenu } from './useExclusiveMenu';

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
  /** Items for the three-dot menu that appears left of the label on row hover. */
  menu?: ReactNode;
  /** Names the menu button for assistive tech, e.g. the property title. */
  menuLabel?: string;
  menuTestId?: string;
  /** No menu at all: a read-only row (a saved agent before Edit) has nothing to remove. */
  menuDisabled?: boolean;
}

const LABEL_CLASS = 'w-[200px] text-sm font-normal leading-[1.3] tracking-[-0.1px] text-foreground';

/** Sits just left of the label, with a gap, and reveals on row hover, focus or while open. */
const MENU_HANDLE_CLASS =
  'pointer-events-none absolute right-full top-1/2 z-10 mr-1.5 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 pr-1.5 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/proprow:pointer-events-auto group-hover/proprow:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:bg-accent data-[state=open]:opacity-100';

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
  menu,
  menuLabel,
  menuTestId,
  menuDisabled = false,
}: PropertyRowProps): ReactElement {
  const labelRef = useRef<HTMLDivElement>(null);
  const rowMenu = useExclusiveMenu();
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
      className={cn(
        'group/proprow relative flex min-h-9 w-full items-start gap-12 before:absolute before:right-full before:top-0 before:h-full before:w-10 before:content-[""]',
        className,
      )}
      data-component='PropertyRow'
      data-align={align}
    >
      <div
        ref={labelRef}
        className={cn(labelClassName ?? LABEL_CLASS, 'relative flex h-9 shrink-0 items-center')}
      >
        {menu && !menuDisabled ? (
          <DropdownMenu open={rowMenu.open} onOpenChange={rowMenu.onOpenChange}>
            <DropdownMenuTrigger
              className={MENU_HANDLE_CLASS}
              data-testid={menuTestId}
              aria-label={`${menuLabel ?? 'Property'} options`}
            >
              <ThreeDotsMenuVertical className='size-4' aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' sideOffset={6} className={PROPERTY_MENU_PANEL}>
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
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
