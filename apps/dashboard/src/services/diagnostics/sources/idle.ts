import { diagnosticsStore } from '../store';

/**
 * Tracks when the user last did something, and attributes CPU spent while they
 * were not.
 *
 * Idle cost is the battery-relevant half: an app that works hard while being
 * used is doing its job, whereas one that keeps a core busy while untouched is
 * draining a laptop for nothing.
 */
const IDLE_AFTER_MS = 30_000;
const SAMPLE_MS = 5000;

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function startIdleSource(): () => void {
  const onInteraction = (): void => diagnosticsStore.markInteraction();

  for (const event of INTERACTION_EVENTS) {
    window.addEventListener(event, onInteraction, { passive: true, capture: true });
  }

  const timer = setInterval(() => {
    // A hidden tab is throttled, so its CPU says nothing about idle cost.
    if (typeof document !== 'undefined' && document.hidden) return;
    if (diagnosticsStore.idleForMs() < IDLE_AFTER_MS) return;

    const appCpu = diagnosticsStore.getSnapshot().cpu.appCpuPercent;
    if (appCpu !== null) diagnosticsStore.recordIdleCpu(appCpu);
  }, SAMPLE_MS);

  return () => {
    clearInterval(timer);
    for (const event of INTERACTION_EVENTS) {
      window.removeEventListener(event, onInteraction, { capture: true });
    }
  };
}
