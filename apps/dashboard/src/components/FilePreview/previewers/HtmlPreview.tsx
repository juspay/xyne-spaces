import { useEffect, useRef, useState, type ReactElement } from 'react';
import { inlineAuthenticatedImages } from '../../../utils/inlineAuthenticatedImages';
import {
  PreviewControls,
  PreviewSegmented,
  PreviewSkeletonView,
  usePreviewFind,
  usePreviewOpenFind,
} from '../chrome';
import { useFileText } from '../content';
import type { FindProvider } from '../find';
import type { PreviewerProps } from '../types';
import { CodeLines } from './code/CodeLines';
import { CodeFontSizeControls } from './code/codeFontSize';
import { createPageFinder, withPageFind } from './html/pageFind';

type View = 'rendered' | 'source';
const VIEWS = [
  { value: 'rendered', label: 'Preview' },
  { value: 'source', label: 'Source' },
] as const;

/**
 * Scripts run, but from an opaque origin: the page can't reach the app, its session
 * or its storage. Links and window.open go to a new tab rather than replacing the
 * preview.
 */
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

/** Links leave the preview for a tab of their own, unless the page says otherwise. */
function withLinksInNewTabs(html: string): string {
  if (/<base\s/i.test(html)) return html;
  const base = '<base target="_blank">';
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, head => `${head}${base}`)
    : `${base}${html}`;
}

/**
 * The page the file is, drawn in a sandboxed frame — on white, as pages are written
 * to be — or its source, coloured. Both are searchable from the frame's find.
 */
export default function HtmlPreview(props: PreviewerProps): ReactElement {
  const text = useFileText(props.content);
  const [view, setView] = useState<View>('rendered');
  if (text === null) return <PreviewSkeletonView shape='document' />;

  return (
    <>
      <PreviewControls>
        {view === 'source' && <CodeFontSizeControls />}
        <PreviewSegmented label='View' value={view} options={VIEWS} onChange={setView} />
      </PreviewControls>
      {view === 'source' ? (
        <CodeLines text={text} language='xml' wrap />
      ) : (
        <RenderedPage html={text} title={props.file.name} />
      )}
    </>
  );
}

function RenderedPage(props: { html: string; title: string }): ReactElement {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const openFind = usePreviewOpenFind();
  const [finder, setFinder] = useState<FindProvider | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      // A sandboxed page sends no cookies, so images on the app's own, signed-in
      // addresses would fail: they are brought inline first.
      let html = props.html;
      try {
        html = (await inlineAuthenticatedImages(props.html)).html;
      } catch {
        // The page as it is, then.
      }
      if (cancelled) return;
      url = URL.createObjectURL(
        new Blob([withPageFind(withLinksInNewTabs(html))], { type: 'text/html;charset=utf-8' }),
      );
      setPageUrl(url);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [props.html]);

  // The page answers find from inside its own frame.
  useEffect(() => {
    if (!pageUrl) return;
    const { finder: pageFinder, dispose } = createPageFinder(
      () => frameRef.current?.contentWindow ?? null,
      openFind,
    );
    setFinder(pageFinder);
    return () => {
      dispose();
      setFinder(null);
    };
  }, [pageUrl, openFind]);
  usePreviewFind(finder);

  return pageUrl ? (
    <iframe
      ref={frameRef}
      src={pageUrl}
      title={props.title}
      sandbox={SANDBOX}
      referrerPolicy='no-referrer'
      className='h-full w-full border-0 bg-white'
    />
  ) : (
    <PreviewSkeletonView shape='document' />
  );
}
