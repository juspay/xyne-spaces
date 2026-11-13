import { Component, lazy, Suspense, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { ViewerLoading } from './viewers/chrome.js';
import ImageView from './viewers/ImageView.js';
import type { Anchor } from './viewers/useDomAnchor.js';

// Heavy renderers are code-split: their dependency (papaparse / SheetJS /
// docx-preview) only loads when a file of that type is actually opened.
const CsvView = lazy(() => import('./viewers/CsvView.js'));
const SheetView = lazy(() => import('./viewers/SheetView.js'));
const DocxView = lazy(() => import('./viewers/DocxView.js'));
const TextView = lazy(() => import('./viewers/TextView.js'));
const HtmlView = lazy(() => import('./viewers/HtmlView.js'));
// pdf.js is code-split so its sizable lib only loads when a PDF is opened.
const PdfView = lazy(() => import('./viewers/PdfView.js'));

type Kind = 'pdf' | 'image' | 'markdown' | 'json' | 'csv' | 'docx' | 'sheet' | 'html' | 'text' | 'unsupported';

// Resolve a renderer kind from the MIME type, falling back to the file
// extension (extraction/upload sources aren't always reliable about MIME).
function kindOf(mimeType: string, name: string): Kind {
  const m = (mimeType || '').toLowerCase();
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (m === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown';
  if (m === 'application/json' || ext === 'json') return 'json';
  if (m === 'text/csv' || ext === 'csv' || ext === 'tsv') return 'csv';
  if (
    ext === 'docx' ||
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx';
  if (
    ext === 'xlsx' ||
    ext === 'xls' ||
    m.includes('spreadsheetml') ||
    m === 'application/vnd.ms-excel'
  )
    return 'sheet';
  if (m === 'text/html' || ext === 'html' || ext === 'htm') return 'html';
  if (m.startsWith('text/') || ext === 'txt' || ext === 'log') return 'text';
  return 'unsupported';
}

// Generic, themeable document preview. Renders images inline; lazy-loads the
// PDF (pdf.js viewer) / CSV / XLSX / DOCX / text / json / markdown renderers;
// everything else (and any renderer failure) degrades to a download link.
// `url` is the raw same-origin attachment URL (cookie auth).
//
// `anchor` points at a passage inside the document — a citation's quote and, when
// the source exposed one, a structural address. Every DOM-rendered viewer honours
// it through the shared `useDomAnchor`; PDF goes through pdf.js's own find
// controller. Formats that can't anchor (image, and html — sandboxed in an opaque
// iframe we deliberately can't reach into) simply open, which is the honest
// degradation.
export function DocumentViewer({
  url,
  mimeType,
  name,
  anchor,
}: {
  url: string;
  mimeType: string;
  name: string;
  anchor?: Anchor | undefined;
}) {
  const kind = kindOf(mimeType, name);

  if (kind === 'image') {
    return <ImageView url={url} name={name} />;
  }

  const quote = anchor?.quote;
  const initialPage = anchor?.locator?.at === 'page' ? anchor.locator.page : undefined;

  const view =
    kind === 'pdf' ? (
      <PdfView url={url} name={name} initialPage={initialPage} highlightQuery={quote} />
    ) : kind === 'csv' ? (
      <CsvView url={url} anchor={anchor} />
    ) : kind === 'sheet' ? (
      <SheetView url={url} anchor={anchor} />
    ) : kind === 'docx' ? (
      <DocxView url={url} anchor={anchor} />
    ) : kind === 'html' ? (
      <HtmlView url={url} />
    ) : kind === 'markdown' ? (
      <TextView url={url} mode="markdown" anchor={anchor} />
    ) : kind === 'json' ? (
      <TextView url={url} mode="json" anchor={anchor} />
    ) : kind === 'text' ? (
      <TextView url={url} mode="text" anchor={anchor} />
    ) : null;

  if (!view) return <DownloadFallback url={url} name={name} />;

  return (
    <ViewerBoundary key={`${kind}:${url}`} fallback={<DownloadFallback url={url} name={name} />}>
      <Suspense fallback={<ViewerLoading />}>{view}</Suspense>
    </ViewerBoundary>
  );
}

function DownloadFallback({ url, name }: { url: string; name: string }) {
  return (
    <div className="grid min-h-[30vh] place-items-center p-8 text-center">
      <div className="flex flex-col items-center gap-3 text-[var(--wui-fg-muted)]">
        <FileText className="size-8" />
        <p className="text-[13px]">No inline preview for this file type.</p>
        <a
          href={url}
          download={name}
          className="rounded-lg bg-[var(--wui-primary)] px-4 py-2 text-[13px] font-semibold text-[var(--wui-primary-fg)] transition-opacity hover:opacity-90"
        >
          Download {name}
        </a>
      </div>
    </div>
  );
}

// Catches both lazy-chunk load failures (e.g. a missing optional dep) and
// in-viewer parse/fetch errors (viewers throw during render on failure) →
// shows the download fallback instead of a blank/broken pane.
class ViewerBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
