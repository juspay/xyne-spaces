import { cn } from '../../../utils/classNames';
import Tooltip from '../../ui/Tooltip';

/**
 * Visual language for the call control bar, modelled on Google Meet's Material 3
 * dark theme: neutral grey discs, red for "you are off / leave", and a pale-blue
 * fill for anything currently switched on (sharing, hand raised, panel open).
 */
export type ControlTone = 'neutral' | 'off' | 'active' | 'pushToTalk';

/**
 * - `round`: the primary media controls in the centre of the bar.
 * - `flat`: borderless icons on the right of the bar that open side panels.
 * - `leave`: the wide red "leave call" pill.
 */
export type ControlShape = 'round' | 'flat' | 'leave';

export interface ControlSizing {
  /** Full-screen Meet layout. False for the resizable mini window. */
  isFullView: boolean;
  /** Mini window scales icon/padding with its width. */
  hasCustomSizing: boolean;
  iconSize: number;
  buttonPadding: number;
}

const ROUND_TONES: Record<ControlTone, string> = {
  neutral: 'bg-[#333537] text-[#e3e3e3] hover:bg-[#404245]',
  off: 'bg-[#dc362e] text-white hover:bg-[#e3554e]',
  active: 'bg-[#a8c7fa] text-[#062e6f] hover:bg-[#bcd4fb]',
  pushToTalk: 'bg-green-500 text-white hover:bg-green-600 ring-4 ring-green-500/30',
};

const FLAT_TONES: Record<ControlTone, string> = {
  neutral: 'text-[#e3e3e3] hover:bg-white/10',
  off: 'text-[#f2b8b5] hover:bg-white/10',
  active: 'bg-[#a8c7fa]/[0.16] text-[#a8c7fa] hover:bg-[#a8c7fa]/25',
  pushToTalk: ROUND_TONES.pushToTalk,
};

export function controlClassName({
  sizing,
  shape = 'round',
  tone = 'neutral',
  inactive = false,
}: {
  sizing: ControlSizing;
  shape?: ControlShape | undefined;
  tone?: ControlTone | undefined;
  inactive?: boolean | undefined;
}): string {
  const base =
    'relative inline-flex flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#a8c7fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#131314]';

  if (!sizing.isFullView) {
    // Mini window: every control is a small disc sized from the window width.
    return cn(
      base,
      'shadow-md',
      !sizing.hasCustomSizing && 'p-2.5 sm:p-4',
      ROUND_TONES[shape === 'leave' ? 'off' : tone],
      inactive && 'cursor-not-allowed opacity-50',
    );
  }

  return cn(
    base,
    shape === 'round' && 'h-12 w-12',
    shape === 'leave' && 'h-12 w-16',
    shape === 'flat' && 'h-12 w-12',
    shape === 'flat' ? FLAT_TONES[tone] : ROUND_TONES[shape === 'leave' ? 'off' : tone],
    inactive && 'cursor-not-allowed opacity-50',
  );
}

export function controlIconProps(sizing: ControlSizing): {
  className?: string;
  style?: React.CSSProperties;
} {
  if (sizing.hasCustomSizing) {
    return { style: { width: `${sizing.iconSize}px`, height: `${sizing.iconSize}px` } };
  }
  return { className: sizing.isFullView ? 'h-[22px] w-[22px]' : 'h-5 w-5 sm:h-6 sm:w-6' };
}

export function controlStyle(sizing: ControlSizing): React.CSSProperties | undefined {
  return sizing.hasCustomSizing ? { padding: `${sizing.buttonPadding}px` } : undefined;
}

// Lucide icons and our own SVG icon components both accept className + style.
type IconComponent = React.ElementType;

export interface ControlButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  icon: IconComponent;
  /** Accessible name; also the tooltip unless `tooltip` is given. */
  label: string;
  tooltip?: React.ReactNode;
  tone?: ControlTone | undefined;
  shape?: ControlShape | undefined;
  /** Styled as unavailable while staying focusable (e.g. blocked by the host). */
  inactive?: boolean | undefined;
  sizing: ControlSizing;
  iconStyle?: React.CSSProperties | undefined;
  /** Badges and other overlays rendered inside the button. */
  children?: React.ReactNode;
}

export function ControlButton({
  icon: iconComponent,
  label,
  tooltip,
  tone,
  shape,
  inactive,
  sizing,
  iconStyle,
  className,
  style,
  children,
  ...buttonProps
}: ControlButtonProps): React.ReactElement {
  const Icon = iconComponent;
  const icon = controlIconProps(sizing);
  return (
    <Tooltip
      content={tooltip ?? label}
      side='top'
      sideOffset={10}
      collisionPadding={8}
      className={cn(
        'whitespace-normal text-center leading-snug',
        sizing.isFullView ? 'max-w-64' : 'max-w-44',
      )}
    >
      <span className='inline-flex flex-shrink-0'>
        <button
          type='button'
          aria-label={label}
          className={cn(controlClassName({ sizing, shape, tone, inactive }), className)}
          style={{ ...controlStyle(sizing), ...style }}
          {...buttonProps}
        >
          <Icon className={icon.className} style={{ ...icon.style, ...iconStyle }} />
          {children}
        </button>
      </span>
    </Tooltip>
  );
}

/** Small count bubble pinned to a control's top-right corner. */
export function ControlBadge({
  count,
  className,
  ...rest
}: {
  count: number;
  className?: string | undefined;
} & React.HTMLAttributes<HTMLSpanElement>): React.ReactElement {
  return (
    <span
      className={cn(
        'pointer-events-none absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#dc362e] px-1 text-[10px] font-semibold leading-none text-white',
        className,
      )}
      {...rest}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
