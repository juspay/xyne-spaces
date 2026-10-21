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
 * or its storage. A link the page itself opens in a new window opens sandboxed too —
 * never `allow-popups-to-escape-sandbox`, which would let an uploaded page open
 * itself unsandboxed — and the page is given as srcdoc rather than a blob: address,
 * which would carry the app's own origin wherever it was opened.
 */
const SANDBOX = 'allow-scripts allow-popups';

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
  // The page as the frame is given it: its images inline, and the find script in it.
  const [page, setPage] = useState<string | null>(null);
  const openFind = usePreviewOpenFind();
  const [finder, setFinder] = useState<FindProvider | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A sandboxed page sends no cookies, so images on the app's own, signed-in
      // addresses would fail: they are brought inline first.
      let html = props.html;
      try {
        html = (await inlineAuthenticatedImages(props.html)).html;
      } catch {
        // The page as it is, then.
      }
      if (!cancelled) setPage(withPageFind(html));
    })();
    return () => {
      cancelled = true;
    };
  }, [props.html]);

  // The page answers find from inside its own frame.
  useEffect(() => {
    if (page === null) return;
    const { finder: pageFinder, dispose } = createPageFinder(
      () => frameRef.current?.contentWindow ?? null,
      openFind,
    );
    setFinder(pageFinder);
    return () => {
      dispose();
      setFinder(null);
    };
  }, [page, openFind]);
  usePreviewFind(finder);

  return page !== null ? (
    <iframe
      ref={frameRef}
      srcDoc={page}
      title={props.title}
      sandbox={SANDBOX}
      referrerPolicy='no-referrer'
      className='h-full w-full border-0 bg-white'
    />
  ) : (
    <PreviewSkeletonView shape='document' />
  );
}
