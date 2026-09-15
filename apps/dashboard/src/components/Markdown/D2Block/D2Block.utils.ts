import type { D2, RenderOptions } from '@terrastruct/d2';
import { logger, Event as LogEvent } from '../../../utils/logger';

let d2Promise: Promise<D2> | null = null;

async function getD2(): Promise<D2> {
  if (!d2Promise) {
    d2Promise = import('@terrastruct/d2').then(mod => new mod.D2());
  }
  return d2Promise;
}

let d2Queue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = d2Queue.then(fn, fn);
  d2Queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

const SVG_CACHE_VERSION = 'v6-animated';
const svgCache = new Map<string, string>();
const cacheKey = (source: string, isDark: boolean): string =>
  `${SVG_CACHE_VERSION}:${isDark ? 'd' : 'l'}:${source}`;

const D2_THEME_LIGHT = 0;
const D2_THEME_DARK = 201;

const D2_ANIMATE_INTERVAL_MS = 1400;

export function isLikelyCompleteD2(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return false;
  let balance = 0;
  for (const ch of trimmed) {
    if (ch === '{') balance++;
    else if (ch === '}') balance--;
    if (balance < 0) return false;
  }
  return balance === 0;
}

export function makeSvgResponsive(svg: string): string {
  let out = svg.replace(/<rect\b[^>]*\bfill-N7\b[^>]*\sstroke-width="0"[^>]*>(?:<\/rect>)?/g, '');
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
    const svg = await runExclusive(async () => {
      const d2 = await getD2();
      const result = await withTimeout(
        d2.compile({
          fs: { index: source },
          options: { layout: 'dagre', pad: 20 },
        }),
        RENDER_TIMEOUT_MS,
        'D2 compile',
      );
      const renderOptions: RenderOptions = {
        ...result.renderOptions,
        themeID: isDark ? D2_THEME_DARK : D2_THEME_LIGHT,
        noXMLTag: true,
      };
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
        throw new Error('D2 render returned a non-string result');
      }
      return makeSvgResponsive(rendered);
    });
    svgCache.set(cacheKey(source, isDark), svg);
    onSuccess(svg);
    onError('');
  } catch (err) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      message: 'D2 rendering error',
      error: err,
    });
    onError(err instanceof Error ? err.message : 'Failed to render D2 diagram');
  } finally {
    onLoading(false);
  }
}

export { copyToClipboard, downloadDiagramAsPng } from '../MermaidBlock/MermaidBlock.utils';
