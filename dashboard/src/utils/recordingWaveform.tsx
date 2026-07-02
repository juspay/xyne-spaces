/**
 * Animated recording waveform, shared by the floating RecordingOverlay and the
 * /recordings RecordingControlBar so the two surfaces never visually drift.
 *
 * Bar heights are driven by the `recWaveOverlay` / `recWaveBar` keyframes in
 * global.css. Default bar counts / timings live in constants/recording.ts.
 * The bar fill uses Tailwind's `emerald-500`, so no recording-specific color
 * token is needed.
 */

import { CSSProperties, ReactElement } from 'react';
import { WAVEFORM_DEFAULTS, WaveformVariant } from '../constants/recording';

interface WaveformProps {
  /**
   * 'overlay' — 16 flex bars that fill the width (floating popup).
   * 'bar'     — a small fixed-width cluster (sticky control bar).
   */
  variant: WaveformVariant;
  /** Freezes the animation (used while a recording is paused). */
  paused?: boolean;
  /** Override the bar count (defaults from WAVEFORM_DEFAULTS). */
  barCount?: number;
  /** Animation duration in seconds (defaults from WAVEFORM_DEFAULTS). */
  durationSec?: number;
  /** Per-bar animation stagger in seconds (defaults from WAVEFORM_DEFAULTS). */
  staggerSec?: number;
  /** Extra classes for the container (e.g. spacing). */
  className?: string;
}

export function Waveform({
  variant,
  paused = false,
  barCount,
  durationSec,
  staggerSec,
  className,
}: WaveformProps): ReactElement {
  const isOverlay = variant === 'overlay';
  const defaults = WAVEFORM_DEFAULTS[variant];
  const count = barCount ?? defaults.barCount;
  const duration = durationSec ?? defaults.durationSec;
  const stagger = staggerSec ?? defaults.staggerSec;
  const keyframe = isOverlay ? 'recWaveOverlay' : 'recWaveBar';

  const container = isOverlay
    ? 'flex items-center justify-between gap-[3px] h-8'
    : 'flex items-center gap-[3px] h-8';

  return (
    <div className={className ? `${container} ${className}` : container}>
      {/*
        Index-as-key is safe here: `count` is deterministic per variant and the
        bars are never inserted/removed/reordered mid-life (only their animation
        style changes). If bar count ever becomes dynamic, switch to a stable id.
      */}
      {Array.from({ length: count }, (_, i) => {
        const style: CSSProperties = {
          animation: `${keyframe} ${duration}s ease-in-out ${i * stagger}s infinite alternate`,
          animationPlayState: paused ? 'paused' : 'running',
        };
        if (!isOverlay) {
          style.height = '40%';
        }
        return (
          <div
            key={i}
            className={`${isOverlay ? 'flex-1' : 'w-[3px]'} bg-emerald-500 rounded-full`}
            style={style}
          />
        );
      })}
    </div>
  );
}
