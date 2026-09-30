import { useState, type FocusEvent, type ReactElement, type ReactNode } from 'react';
import { motion, type Transition, type Variants } from 'motion/react';
import { MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { DashedOutline } from '@/components/flowUI/nodes/agent/create/DashedOutline';
import { cn } from '@/utils/classNames';

/**
 * The 28px icon tile at the start of a capability pill (Figma "Claw Agents"
 * 1956:34170). Tokens: `bg-card` = surface/primary, `border-border` =
 * border/strong, `text-muted-foreground` = the icon grey.
 */
export const CAPABILITY_TILE_CLASS =
  'flex size-7 shrink-0 items-center justify-center rounded-lg border-[0.622px] border-solid border-border bg-card text-muted-foreground shadow-[0px_2.333px_1.556px_0px_rgba(0,0,0,0.02),0px_0.778px_0.778px_0px_rgba(0,0,0,0.03),0px_0px_0.778px_0px_rgba(0,0,0,0.03)]';

export function CapabilityIconTile({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className={CAPABILITY_TILE_CLASS} aria-hidden>
      {children}
    </span>
  );
}

/** Label + optional dimmed meta ("3 files"): Inter 550 / 450 at 14px. */
export function CapabilityChipText({
  label,
  meta,
  dimmed = false,
}: {
  label: string;
  meta?: string | null | undefined;
  dimmed?: boolean;
}): ReactElement {
  return (
    <>
      <span
        className={cn(
          'max-w-[200px] truncate py-0.5 text-sm font-normal leading-[1.3]',
          dimmed ? 'text-foreground/80' : 'text-foreground',
        )}
      >
        {label}
      </span>
      {meta ? (
        <span className='shrink-0 text-sm font-[450] leading-tight text-foreground/40'>{meta}</span>
      ) : null}
    </>
  );
}

interface CapabilityChipProps {
  label: string;
  selected: boolean;
  /** 16px glyph shown in the 28px tile. Without it (or `content`) the pill is text only. */
  icon?: ReactNode;
  /** Dimmed trailing text, e.g. "3 files". */
  meta?: string | null | undefined;
  content?: ReactNode;
  onOpen?: () => void;
  onToggle: () => void;
  shellClassName?: string;
  trackName: string;
}

/**
 * The pill's fill lives in `--chip-fill` so the hover action can fade into
 * exactly that colour. Opaque mixes rather than alpha, so the fade really
 * covers the label underneath.
 */
const SELECTED_FILL =
  '[--chip-fill:color-mix(in_srgb,hsl(var(--foreground))_4%,hsl(var(--background)))] hover:[--chip-fill:color-mix(in_srgb,hsl(var(--foreground))_7%,hsl(var(--background)))] focus-within:[--chip-fill:color-mix(in_srgb,hsl(var(--foreground))_7%,hsl(var(--background)))]';
const SUGGESTED_FILL =
  '[--chip-fill:hsl(var(--card))] hover:[--chip-fill:color-mix(in_srgb,hsl(var(--muted))_50%,hsl(var(--card)))] focus-within:[--chip-fill:color-mix(in_srgb,hsl(var(--muted))_50%,hsl(var(--card)))]';

/**
 * The + / × sits over the end of the label, on a strip of the pill's own
 * colour that fades out to the left. It appears on hover or keyboard focus with
 * a small spring pop (always shown on touch screens, which have no hover).
 */
const ACTION_OVERLAY =
  'absolute inset-y-0 right-0 flex items-center pl-7 pr-2 text-muted-foreground bg-[linear-gradient(to_left,var(--chip-fill)_55%,transparent)]';

const NO_HOVER =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: none)').matches;

const OVERLAY_VARIANTS: Variants = { rest: { opacity: 0 }, shown: { opacity: 1 } };
const ICON_VARIANTS: Variants = {
  rest: { opacity: 0, scale: 0.5, x: 3 },
  shown: { opacity: 1, scale: 1, x: 0 },
};
const OVERLAY_FADE: Transition = { duration: 0.14, ease: 'easeOut' };
const ICON_SPRING: Transition = { type: 'spring', duration: 0.28, bounce: 0.35 };

/**
 * Hover or focus anywhere on the pill reveals its action. `shape` names the pill's
 * root element: accepting or removing swaps it, and the old element takes its focus
 * with it without a blur event, so focus starts over on the new one.
 */
function useRevealAction(shape: string): {
  revealed: boolean;
  handlers: {
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    onFocus?: () => void;
    onBlur?: (event: FocusEvent<HTMLElement>) => void;
  };
} {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusedShape, setFocusedShape] = useState(shape);
  if (focusedShape !== shape) {
    setFocusedShape(shape);
    setFocused(false);
  }
  if (NO_HOVER) return { revealed: true, handlers: {} };
  return {
    revealed: hovered || focused,
    handlers: {
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: (event): void => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      },
    },
  };
}

function ActionIcon({ selected }: { selected: boolean }): ReactElement {
  return (
    <motion.span variants={ICON_VARIANTS} transition={ICON_SPRING} className='flex'>
      {selected ? (
        <MultipleCrossCancelDefault className='size-3 shrink-0' aria-hidden />
      ) : (
        <PlusDefault className='size-3 shrink-0' aria-hidden />
      )}
    </motion.span>
  );
}

export function CapabilityChip({
  label,
  selected,
  icon,
  meta,
  content,
  onOpen,
  onToggle,
  shellClassName,
  trackName,
}: CapabilityChipProps): ReactElement {
  const openable = selected && Boolean(onOpen);
  const { revealed, handlers } = useRevealAction(openable ? 'span' : 'button');
  const overlayMotion = {
    initial: false,
    animate: revealed ? 'shown' : 'rest',
    variants: OVERLAY_VARIANTS,
    transition: OVERLAY_FADE,
  } as const;

  // No trailing icon at rest, so the right padding balances the label alone.
  const shell = cn(
    'group/chip relative box-border flex h-9 shrink-0 items-center gap-1.5 overflow-hidden rounded-xl border-[0.8px] border-transparent bg-[var(--chip-fill)] pl-1 pr-2.5 outline-none transition-colors',
    !icon && !content && 'pl-2.5',
    shellClassName,
    selected ? SELECTED_FILL : SUGGESTED_FILL,
  );

  const body =
    content ??
    (icon ? (
      <span className='flex min-w-0 items-center gap-1.5'>
        <CapabilityIconTile>{icon}</CapabilityIconTile>
        <CapabilityChipText label={label} meta={meta} dimmed={!selected} />
      </span>
    ) : (
      <CapabilityChipText label={label} meta={meta} dimmed={!selected} />
    ));

  // aria-labels only: a native `title` tooltip would pop up over the pill on hover.
  if (!openable) {
    return (
      <button
        type='button'
        onClick={onToggle}
        aria-label={`${selected ? 'Remove' : 'Add'} ${label}`}
        aria-pressed={selected}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className={shell}
        {...handlers}
      >
        {body}
        <motion.span
          {...overlayMotion}
          className={cn(ACTION_OVERLAY, 'pointer-events-none')}
          aria-hidden
        >
          <ActionIcon selected={selected} />
        </motion.span>
        {/* After the fade in the DOM, so the fade never paints over the dashed border. */}
        {selected ? null : <DashedOutline />}
      </button>
    );
  }

  return (
    <span className={shell} {...handlers}>
      <button
        type='button'
        onClick={onOpen}
        aria-label={`Open ${label}`}
        data-track-category='Claw Agents'
        data-track-name={`${trackName} (open)`}
        className='flex min-w-0 items-center rounded-md outline-none'
      >
        {body}
      </button>
      <motion.button
        {...overlayMotion}
        type='button'
        onClick={onToggle}
        aria-label={`Remove ${label}`}
        data-track-category='Claw Agents'
        data-track-name={`${trackName} (remove)`}
        style={{ pointerEvents: revealed ? 'auto' : 'none' }}
        className={cn(
          ACTION_OVERLAY,
          'outline-none hover:text-foreground focus-visible:text-foreground',
        )}
      >
        <ActionIcon selected />
      </motion.button>
    </span>
  );
}
