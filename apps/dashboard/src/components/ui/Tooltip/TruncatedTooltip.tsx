import {
  cloneElement,
  type PointerEvent,
  type PointerEventHandler,
  type ReactElement,
  type Ref,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../../../utils/classNames';
import { Tooltip, type TooltipProps } from './Tooltip';

// 1px slack absorbs sub-pixel rounding, which reports a fitting label as clipped.
const isClipped = (el: HTMLElement | null): boolean =>
  !!el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);

export interface TruncatedTooltipProps extends Omit<
  TooltipProps,
  'children' | 'content' | 'open' | 'onOpenChange'
> {
  /** The clipping element — must be a host element (or forward its ref), since it is measured. */
  children: ReactElement<{
    ref?: Ref<HTMLElement>;
    onPointerEnter?: PointerEventHandler<HTMLElement>;
  }>;
  /** The full text being clipped; also the re-measure key, hence string and not a node. */
  content: string;
}

/**
 * Tooltip that reveals the full value only when the text is actually cut off.
 *
 * An unclipped child renders bare, with no Radix `Root`/`Trigger` at all. Vetoing
 * via controlled `open` instead would strand the provider's `isOpenDelayedRef`,
 * costing every tooltip in the app its hover delay.
 *
 * @example
 * <TruncatedTooltip content={ticket.title}>
 *   <span className='truncate'>{ticket.title}</span>
 * </TruncatedTooltip>
 */
export const TruncatedTooltip = ({
  children,
  content,
  delayDuration = 500,
  className,
  ...tooltipProps
}: TruncatedTooltipProps): ReactElement => {
  // In state, not a ref: Radix's Slot recomposes the child ref every render.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [clipped, setClipped] = useState(false);
  const isOpenRef = useRef(false);
  const staleWhileOpenRef = useRef(false);

  // Never un-wrap while open — dropping `Root` mid-open skips Radix's close
  // bookkeeping. Hold the verdict and apply it on close instead.
  const applyClipped = useCallback((next: boolean): void => {
    if (!next && isOpenRef.current) {
      staleWhileOpenRef.current = true;
      return;
    }
    setClipped(next);
  }, []);

  const handleOpenChange = (open: boolean): void => {
    isOpenRef.current = open;
    if (!open && staleWhileOpenRef.current) {
      staleWhileOpenRef.current = false;
      setClipped(isClipped(node));
    }
  };

  useLayoutEffect(() => {
    if (!node) return undefined;
    const observer = new ResizeObserver((): void => applyClipped(isClipped(node)));
    observer.observe(node);
    return (): void => observer.disconnect();
  }, [node, applyClipped]);

  // Deliberately not on every commit: this reads `scrollWidth`, and a forced
  // reflow per commit is real cost on lists that re-render while scrolling.
  useLayoutEffect(() => {
    applyClipped(isClipped(node));
  }, [node, content, applyClipped]);

  // Backstop for restyling that changes the clip without resizing the box
  // (a row going bold when unread, a late webfont swap).
  const handlePointerEnter = (event: PointerEvent<HTMLElement>): void => {
    children.props.onPointerEnter?.(event);
    applyClipped(isClipped(node));
  };

  const child = cloneElement(children, { ref: setNode, onPointerEnter: handlePointerEnter });
  if (!clipped) return child;

  return (
    <Tooltip
      {...tooltipProps}
      content={content}
      delayDuration={delayDuration}
      className={cn('max-w-sm whitespace-normal break-words', className)}
      onOpenChange={handleOpenChange}
    >
      {child}
    </Tooltip>
  );
};

TruncatedTooltip.displayName = 'TruncatedTooltip';

export default TruncatedTooltip;
