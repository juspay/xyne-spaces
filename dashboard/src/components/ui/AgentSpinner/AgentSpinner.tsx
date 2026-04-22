import { useEffect, useState, type CSSProperties, type ReactElement, type FC } from 'react';

/**
 * Text-based agent spinners (ported from expo-agent-spinners, web flavor).
 *
 * Each spinner cycles a Unicode frame array via setInterval into a single <span>.
 * Zero dependencies, monospace-friendly, fits on a single line next to text.
 */

interface AgentSpinnerProps {
  size?: number;
  color?: string;
  intervalMs?: number;
  className?: string;
  style?: CSSProperties;
}

type Variant =
  | 'dots'
  | 'arc'
  | 'clock'
  | 'sparkle'
  | 'pulse'
  | 'earth'
  | 'bounce'
  | 'orbit'
  | 'scan'
  | 'helix';

const FRAMES: Record<Variant, readonly string[]> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  clock: ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚'],
  sparkle: ['⡡⠊⢔⠡', '⠊⡰⡡⡘', '⢔⢅⠈⢢', '⡁⢂⠆⡍', '⢔⠨⢑⢐', '⠨⡑⡠⠊'],
  pulse: ['⠀⠶⠀', '⠰⣿⠆', '⢾⣉⡷', '⣏⠀⣹', '⡁⠀⢈'],
  earth: ['🌍', '🌎', '🌏'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⠄', '⠂'],
  orbit: ['⠃', '⠉', '⠘', '⠰', '⢠', '⣀', '⡄', '⠆'],
  scan: ['⠀⠀⠀⠀', '⡇⠀⠀⠀', '⣿⠀⠀⠀', '⢸⡇⠀⠀', '⠀⣿⠀⠀', '⠀⢸⡇⠀', '⠀⠀⣿⠀', '⠀⠀⢸⡇', '⠀⠀⠀⣿', '⠀⠀⠀⢸'],
  helix: ['⢌⣉⢎⣉', '⣉⡱⣉⡱', '⣉⢎⣉⢎', '⡱⣉⡱⣉', '⢎⣉⢎⣉'],
};

const DEFAULT_INTERVAL: Record<Variant, number> = {
  dots: 80,
  arc: 100,
  clock: 100,
  sparkle: 150,
  pulse: 180,
  earth: 180,
  bounce: 120,
  orbit: 100,
  scan: 70,
  helix: 80,
};

function TextSpinner({
  frames,
  defaultInterval,
  size = 14,
  color = 'currentColor',
  intervalMs,
  className,
  style,
}: AgentSpinnerProps & { frames: readonly string[]; defaultInterval: number }): ReactElement {
  const [i, setI] = useState(0);
  useEffect((): (() => void) => {
    const id = setInterval(() => setI(n => (n + 1) % frames.length), intervalMs ?? defaultInterval);
    return (): void => clearInterval(id);
  }, [frames, intervalMs, defaultInterval]);
  return (
    <span
      className={className}
      aria-live='polite'
      aria-label='loading'
      style={{
        display: 'inline-block',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: size,
        lineHeight: 1,
        color,
        whiteSpace: 'pre',
        ...style,
      }}
    >
      {frames[i]}
    </span>
  );
}
TextSpinner.displayName = 'TextSpinner';

function make(v: Variant, displayName: string): FC<AgentSpinnerProps> {
  const Component: FC<AgentSpinnerProps> = props => (
    <TextSpinner frames={FRAMES[v]} defaultInterval={DEFAULT_INTERVAL[v]} {...props} />
  );
  Component.displayName = displayName;
  return Component;
}

export const DotsSpinner = make('dots', 'DotsSpinner');
export const ArcSpinner = make('arc', 'ArcSpinner');
export const ClockSpinner = make('clock', 'ClockSpinner');
export const SparkleSpinner = make('sparkle', 'SparkleSpinner');
export const PulseSpinner = make('pulse', 'PulseSpinner');
export const EarthSpinner = make('earth', 'EarthSpinner');
export const BounceSpinner = make('bounce', 'BounceSpinner');
export const OrbitSpinner = make('orbit', 'OrbitSpinner');
export const ScanSpinner = make('scan', 'ScanSpinner');
export const HelixSpinner = make('helix', 'HelixSpinner');

/**
 * Generic picker: <AgentSpinner variant="sparkle" />.
 * Useful when the variant is driven by data (e.g. per-agent config).
 */
export function AgentSpinner({
  variant = 'dots',
  ...rest
}: AgentSpinnerProps & { variant?: Variant }): ReactElement {
  return (
    <TextSpinner frames={FRAMES[variant]} defaultInterval={DEFAULT_INTERVAL[variant]} {...rest} />
  );
}

export type { Variant as AgentSpinnerVariant };

/**
 * All available spinner variants. Consumers that want to randomize
 * (e.g. per-agent-run, per-message) should use {@link pickRandomAgentSpinnerVariant}
 * instead of hardcoding a variant — agent identity is deliberately decoupled
 * from spinner identity.
 */
export const AGENT_SPINNER_VARIANTS: readonly Variant[] = [
  'dots',
  'arc',
  'clock',
  'sparkle',
  'pulse',
  'earth',
  'bounce',
  'orbit',
  'scan',
  'helix',
];

/**
 * Pick a random spinner variant. Pass `exclude` to guarantee a different
 * variant than the one already on screen (e.g. when rotating on label change).
 */
export function pickRandomAgentSpinnerVariant(exclude?: Variant): Variant {
  const pool = exclude ? AGENT_SPINNER_VARIANTS.filter(v => v !== exclude) : AGENT_SPINNER_VARIANTS;
  return pool[Math.floor(Math.random() * pool.length)]!;
}
