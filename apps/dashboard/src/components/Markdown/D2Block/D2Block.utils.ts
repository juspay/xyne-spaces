import type { D2, RenderOptions } from '@terrastruct/d2';

// ─── Lazy WASM loader ─────────────────────────────────────────────────────────
//
// The browser build of @terrastruct/d2 is ~7.8MB (the D2 compiler + fonts are
// embedded as base64 WASM, and the worker is spawned from a Blob — so there is
// no external .wasm to serve and no Vite worker/wasm config required). We NEVER
// want that in the initial bundle, so the module is pulled in via dynamic
// import() the first time a D2 diagram actually renders. Vite code-splits it
// into its own chunk. The instance (and its worker) is created once and reused.

let d2Promise: Promise<D2> | null = null;

async function getD2(): Promise<D2> {
  if (!d2Promise) {
    d2Promise = import('@terrastruct/d2').then(mod => new mod.D2());
  }
  return d2Promise;
}

// ─── Serialization ────────────────────────────────────────────────────────────
//
// The @terrastruct/d2 instance is NOT concurrency-safe: its worker keeps a
// single `currentResolve`/`currentReject` slot (see dist/browser/index.js), so
// two in-flight compile/render calls clobber each other's promise — one hangs
// (→ 15s timeout) and responses cross (→ a render receives a compile object →
// "[object Object]"). A page with N diagrams fires N calls at once and hits
// exactly that. Funnel every worker op through a single-file queue so only one
// runs at a time. The worker is single-threaded, so this costs no throughput.

let d2Queue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = d2Queue.then(fn, fn);
  // Keep the chain alive regardless of this job's outcome so one failure/timeout
  // doesn't wedge every subsequent diagram.
  d2Queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// Cache rendered SVGs by source so re-renders (view toggles, scroll remounts,
// identical diagrams) never recompile through the WASM worker. The key is
// versioned: bump SVG_CACHE_VERSION whenever the compile options or the
// post-processing in makeSvgResponsive change, so stale SVGs from an earlier
// build are invalidated instead of being served from this long-lived Map.
const SVG_CACHE_VERSION = 'v6-animated';
const svgCache = new Map<string, string>();
const cacheKey = (source: string, isDark: boolean): string =>
  `${SVG_CACHE_VERSION}:${isDark ? 'd' : 'l'}:${source}`;

// D2 theme IDs, forced at render time (overrides any theme-id in the source) so
// the diagram matches the app theme. Light = Neutral default (near-black ink on
// light). Dark = Dark Flagship Terrastruct — near-white ink #F4F6FA on very dark
// #000410 (measured 18.9:1 contrast, higher than Dark Mauve's 11.3:1), so labels
// stay crisp on the transparent dark card.
const D2_THEME_LIGHT = 0;
const D2_THEME_DARK = 201;

// Frame interval (ms) for multi-board (steps/scenarios) animations. Matches the
// D2 blog's default; long enough to read each frame before it transitions.
const D2_ANIMATE_INTERVAL_MS = 1400;

/**
 * Heuristic for whether a D2 source looks complete enough to compile. During
 * streaming, opening braces outrun closing ones; compiling a half-streamed
 * block just produces noise. Balanced braces (and non-empty) is a cheap, stable
 * signal that the block has finished streaming.
 */
export function isLikelyCompleteD2(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  let balance = 0;
  for (const ch of trimmed) {
    if (ch === '{') balance++;
    else if (ch === '}') balance--;
    if (balance < 0) return false; // stray closer — malformed, but let it render+error
  }
  return balance === 0;
}

/**
 * Cleans up D2's raw SVG for embedding in the Spaces-themed chat:
 *
 * 1. Strips D2's opaque full-canvas background rect (the first <rect> inside the
 *    inner `d2-svg` group — the only one with stroke-width="0"). D2 paints a
 *    solid theme background (e.g. white `fill-N7`) behind every diagram; removing
 *    it makes the diagram transparent so it blends with the card instead of
 *    showing a hard white/colored block.
 *
 * 2. Rewrites the outer <svg> to be responsive, centered, and bounded:
 *    - width:100% up to --d2-max-w → small diagrams grow to a comfortable size,
 *      wide ones fill the column; never past the cap.
 *    - height:auto + the viewBox ratio → no distortion.
 *    - max-height:--d2-max-h → tall diagrams are capped; preserveAspectRatio
 *      ("meet", which D2 sets) scales the content to fit inside, centered.
 *
 * Both caps are CSS variables so the fullscreen preview can override them. Only
 * the outer <svg> is restyled; the inner one scales along with it.
 */
export function makeSvgResponsive(svg: string): string {
  // 1) Drop D2's opaque board-background rects → transparent diagram. Backgrounds
  //    are uniquely `stroke-width="0"` + the `fill-N7` neutral class; real nodes
  //    use B-scale fills, so this never removes a shape. Global (all matches)
  //    because an animated multi-board SVG has one background per frame — strip
  //    only the first and later frames flash white.
  let out = svg.replace(/<rect\b[^>]*\bfill-N7\b[^>]*\sstroke-width="0"[^>]*>(?:<\/rect>)?/g, '');
  // 2) Responsive + centered + bounded outer <svg>.
  //    Force preserveAspectRatio to xMidYMid: D2 defaults the outer <svg> to
  //    "xMinYMin meet", which LEFT-aligns the content whenever the diagram is
  //    letterboxed (e.g. a tall diagram capped by max-height sitting in a wider
  //    box). xMidYMid centers it both ways.
  out = out.replace(/<svg\b([^>]*)>/, (_full, attrs: string) => {
    const cleaned = attrs
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace(/\sstyle="[^"]*"/g, '')
      .replace(/\spreserveAspectRatio="[^"]*"/g, '');
    const style =
      'width:100%;max-width:var(--d2-max-w,560px);height:auto;' +
      'max-height:var(--d2-max-h,400px);display:block;margin:0 auto;';
    return `<svg${cleaned} preserveAspectRatio="xMidYMid meet" style="${style}">`;
  });
  return out;
}

interface RenderD2Params {
  source: string;
  isDark: boolean;
  onSuccess: (svg: string) => void;
  onError: (error: string) => void;
  onLoading: (isLoading: boolean) => void;
}

const RENDER_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Compiles + renders D2-language source to an SVG string. Always resolves the
 * loading state and always surfaces errors (never an infinite spinner) — the
 * exact failure mode that made the old filesystem/d2 handler hang on non-JSON.
 */
export async function renderD2Diagram({
  source,
  isDark,
  onSuccess,
  onError,
  onLoading,
}: RenderD2Params): Promise<void> {
  if (!source.trim()) return;

  const cached = svgCache.get(cacheKey(source, isDark));
  if (cached) {
    onSuccess(cached);
    onError('');
    onLoading(false);
    return;
  }

  onLoading(true);
  try {
    // One diagram at a time on the shared worker (see runExclusive). The timeout
    // wraps only the actual worker calls, which start when it's this job's turn
    // — queue-wait does not count against it.
    const svg = await runExclusive(async () => {
      const d2 = await getD2();
      // Use the fully-typed CompileRequest form ({ fs, options }) — the string
      // overload's option type is mistyped in @terrastruct/d2's .d.ts (it demands
      // a nested `options`), so passing flat CompileOptions trips TS2353.
      const result = await withTimeout(
        d2.compile({
          fs: { index: source },
          options: { layout: 'dagre', pad: 20 },
        }),
        RENDER_TIMEOUT_MS,
        'D2 compile',
      );
      // Force the theme at render time (overrides any theme-id in the source) so
      // the diagram matches the app theme; the opaque background is stripped in
      // makeSvgResponsive so it sits on the transparent, theme-aware card.
      const renderOptions: RenderOptions = {
        ...result.renderOptions,
        themeID: isDark ? D2_THEME_DARK : D2_THEME_LIGHT,
        noXMLTag: true,
      };
      // Multi-board animation: `steps` (progressive reveal) and `scenarios`
      // (alternate states) are packaged into ONE animated SVG that cycles through
      // the boards. This only happens when we render all boards (`target: '*'`)
      // with a positive `animateInterval` — the default render would drop every
      // board but the root. (Layers are for click-navigation, not animation, so
      // they're intentionally left as the root board.)
      const boardCount =
        (result.diagram.steps?.length ?? 0) + (result.diagram.scenarios?.length ?? 0);
      if (boardCount > 0) {
        renderOptions.target = '*';
        renderOptions.animateInterval = D2_ANIMATE_INTERVAL_MS;
      }
      const rendered = await withTimeout(
        d2.render(result.diagram, renderOptions),
        RENDER_TIMEOUT_MS,
        'D2 render',
      );
      if (typeof rendered !== 'string') {
        // Defensive: should never happen once serialized, but never feed a
        // non-string to dangerouslySetInnerHTML (that's the "[object Object]").
        throw new Error('D2 render returned a non-string result');
      }
      return makeSvgResponsive(rendered);
    });
    svgCache.set(cacheKey(source, isDark), svg);
    onSuccess(svg);
    onError('');
  } catch (err) {
    console.error('D2 rendering error:', err);
    onError(err instanceof Error ? err.message : 'Failed to render D2 diagram');
  } finally {
    onLoading(false);
  }
}

export { copyToClipboard, downloadDiagramAsPng } from '../MermaidBlock/MermaidBlock.utils';
