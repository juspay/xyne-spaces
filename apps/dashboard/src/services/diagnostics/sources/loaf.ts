import { diagnosticsStore } from '../store';
import { logger, Event } from '../../../utils/logger';
import { currentRouteTemplate } from '../../otel/perfMetrics';

/**
 * Long Animation Frames — the attribution source.
 *
 * `longtask` tells you the main thread was blocked but reports nothing about
 * by what. LoAF breaks each slow frame into the scripts that ran inside it,
 * with the real source URL, function name, and how much of the cost was forced
 * style/layout. That is what makes "what is draining my battery" answerable
 * rather than guessable.
 */
interface ScriptTiming extends PerformanceEntry {
  invoker?: string;
  invokerType?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  forcedStyleAndLayoutDuration?: number;
}
interface LongAnimationFrameTiming extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: ScriptTiming[];
}

/** Below this a script is noise; LoAF lists every call, including trivial ones. */
const MIN_SCRIPT_MS = 5;

/**
 * Only frames this slow are reported to the bridge. Matches the existing
 * `long_task_slow` gate so the two streams line up, and keeps volume low —
 * the local panel still aggregates every frame regardless.
 */
const FRAME_REPORT_MS = 200;

export function startLoafSource(): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => undefined;

  const supported = (
    PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }
  ).supportedEntryTypes?.includes('long-animation-frame');

  if (!supported) return () => undefined;

  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as LongAnimationFrameTiming[]) {
        let worst: ScriptTiming | undefined;
        for (const script of entry.scripts ?? []) {
          if (script.duration < MIN_SCRIPT_MS) continue;
          diagnosticsStore.recordScript({
            source: shortenSource(script.sourceURL),
            fn: script.sourceFunctionName || '(anonymous)',
            invoker: script.invoker || script.invokerType || '',
            totalMs: script.duration,
            forcedLayoutMs: script.forcedStyleAndLayoutDuration ?? 0,
          });
          if (!worst || script.duration > worst.duration) worst = script;
        }

        // The attribution the `longtask` stream cannot provide: which script,
        // which function, and how much of it was forced style/layout.
        if (entry.duration >= FRAME_REPORT_MS && worst) {
          logger.info(Event.CLIENT_SCRIPT_DRAIN, {
            frameDurationMs: Math.round(entry.duration),
            blockingDurationMs: Math.round(entry.blockingDuration ?? 0),
            route: currentRouteTemplate(),
            scriptMs: Math.round(worst.duration),
            forcedLayoutMs: Math.round(worst.forcedStyleAndLayoutDuration ?? 0),
            source: shortenSource(worst.sourceURL),
            sourceUrl: worst.sourceURL ?? '',
            fn: worst.sourceFunctionName || '(anonymous)',
            invoker: worst.invoker || '',
            invokerType: worst.invokerType || '',
          });
        }
      }
    });
    observer.observe({ type: 'long-animation-frame', buffered: true });
    return () => observer.disconnect();
  } catch {
    return () => undefined;
  }
}

/** Keep the last path segment; bundle URLs are long and the filename is the useful part. */
function shortenSource(url: string | undefined): string {
  if (!url) return '(unknown source)';
  try {
    const parsed = new URL(url, window.location.href);
    const file = parsed.pathname.split('/').filter(Boolean).pop();
    return file || parsed.hostname;
  } catch {
    return url.length > 60 ? `…${url.slice(-60)}` : url;
  }
}

/** True when the browser can attribute main-thread time to specific scripts. */
export function isLoafSupported(): boolean {
  return Boolean(
    typeof PerformanceObserver !== 'undefined' &&
    (
      PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }
    ).supportedEntryTypes?.includes('long-animation-frame'),
  );
}
