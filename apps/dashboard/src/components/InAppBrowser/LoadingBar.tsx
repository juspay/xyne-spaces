import { useEffect, useState, type ReactElement } from 'react';
import { cn } from '../../utils/classNames';

/**
 * A page's load, as a bar along the foot of its toolbar: it runs out quickly and
 * slows as it goes, since how long is left is never known, then fills and fades
 * when the page is in.
 */
export function LoadingBar(props: { loading: boolean }): ReactElement | null {
  const [phase, setPhase] = useState<'idle' | 'start' | 'run' | 'done'>('idle');
  useEffect(() => {
    if (props.loading) {
      setPhase('start');
      // Drawn at nothing first, so the run has somewhere to run from.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setPhase('run'));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setPhase(current => (current === 'idle' ? 'idle' : 'done'));
    const timer = window.setTimeout(() => setPhase('idle'), 450);
    return () => window.clearTimeout(timer);
  }, [props.loading]);

  if (phase === 'idle') return null;
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden'
    >
      <div
        className={cn(
          'relative h-full overflow-hidden bg-primary motion-reduce:transition-none',
          phase === 'run' &&
            'transition-[width] duration-[8000ms] ease-[cubic-bezier(0.1,0.7,0.2,1)]',
          phase === 'done' &&
            'opacity-0 transition-[width,opacity] duration-200 [transition-delay:0ms,180ms]',
        )}
        style={{ width: phase === 'start' ? '0%' : phase === 'run' ? '85%' : '100%' }}
      >
        {/* A shine running along it while the page loads: it is working, not stuck. */}
        {phase === 'run' && (
          <span className='absolute inset-y-0 left-0 w-1/3 animate-[xyne-bar-shine_1.1s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/80 to-transparent motion-reduce:hidden' />
        )}
      </div>
    </div>
  );
}
