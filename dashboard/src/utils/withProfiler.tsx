import React, { Profiler, forwardRef } from 'react';
import { componentRenderDuration, safeRecordMetric } from '../services/otel';

const SLOW_RENDER_THRESHOLD_MS = 16; // ~1 frame at 60fps

function onRender(id: string, phase: 'mount' | 'update' | 'nested-update', actualDuration: number) {
  if (actualDuration < SLOW_RENDER_THRESHOLD_MS) return;
  safeRecordMetric(() => {
    componentRenderDuration.record(actualDuration, {
      component: id,
      phase,
    });
  });
}

/**
 * HOC that wraps a component with React.Profiler to track render durations.
 * Only reports renders slower than 16ms (one frame) to reduce noise.
 */
export function withProfiler<P extends object>(
  Component: React.ComponentType<P>,
  displayName: string,
): React.FC<P> {
  const Wrapped: React.FC<P> = props => (
    <Profiler id={displayName} onRender={onRender}>
      <Component {...props} />
    </Profiler>
  );
  Wrapped.displayName = `Profiled(${displayName})`;
  return Wrapped;
}

/**
 * HOC for forwardRef components.
 */
export function withProfilerRef<P extends object, R>(
  Component: React.ForwardRefExoticComponent<React.PropsWithoutRef<P> & React.RefAttributes<R>>,
  displayName: string,
) {
  const Wrapped = forwardRef<R, P>((props, ref) => (
    <Profiler id={displayName} onRender={onRender}>
      <Component {...props} ref={ref} />
    </Profiler>
  ));
  Wrapped.displayName = `Profiled(${displayName})`;
  return Wrapped;
}
