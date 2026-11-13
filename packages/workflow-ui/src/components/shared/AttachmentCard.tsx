import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Attachment } from '@xyne/workflow-sdk';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { MarkdownView } from './MarkdownView.js';
import { DocumentViewer } from './DocumentViewer.js';
import type { Anchor } from './viewers/useDomAnchor.js';
import { useDocPreview } from './DocPreviewContext.js';
import { cn } from './cn.js';

/** Structural check — a value is an Attachment (opaque ref + name + mime). */
export function isAttachment(v: unknown): v is Attachment {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Attachment).handle === 'string' &&
    typeof (v as Attachment).name === 'string' &&
    typeof (v as Attachment).mimeType === 'string'
  );
}

/** A non-empty array whose every element is an Attachment. */
export function isAttachmentArray(v: unknown): v is Attachment[] {
  return Array.isArray(v) && v.length > 0 && v.every(isAttachment);
}

function formatBytes(n?: number): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Conventional file-type identity colors (PDF red, Office blue/green/orange).
// Deliberately fixed rather than theme tokens — they identify the format, the
// same way the formats' own icons do, and must not shift with the host theme.
const EXT_COLORS: Record<string, string> = {
  pdf: '#e5484d',
  doc: '#2563eb',
  docx: '#2563eb',
  xls: '#188038',
  xlsx: '#188038',
  csv: '#188038',
  tsv: '#188038',
  ppt: '#d97706',
  pptx: '#d97706',
  png: '#7c3aed',
  jpg: '#7c3aed',
  jpeg: '#7c3aed',
  gif: '#7c3aed',
  webp: '#7c3aed',
  svg: '#7c3aed',
};

/** Small file-shaped chip carrying the extension — the "PDF logo" of the card.
 *  `sm` fits inside tab strips; `md` is the attachment-card row size. */
export function FileTypeBadge({ name, size = 'md' }: { name: string; size?: 'md' | 'sm' }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const color = EXT_COLORS[ext] ?? 'var(--wui-fg-subtle)';
  const label = (ext || 'file').slice(0, 4).toUpperCase();
  const sm = size === 'sm';
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden',
        sm ? 'h-[18px] w-[15px] rounded-[3.5px]' : 'h-7 w-[24px] rounded-[5px]',
      )}
      style={{ backgroundColor: color }}
    >
      {/* folded corner */}
      <span className={cn('absolute right-0 top-0 bg-white/30', sm ? 'h-[5px] w-[5px] rounded-bl-[2px]' : 'h-[7px] w-[7px] rounded-bl-[3px]')} />
      <span className={cn('font-bold tracking-tight text-white', sm ? 'text-[5.5px]' : 'text-[6.5px]')}>{label}</span>
    </span>
  );
}

/**
 * First-page peek for a PDF: renders page 1 into a canvas strip (cropped to
 * the top of the page) that opens the full preview on click. pdf.js is
 * dynamically imported so non-PDF cards never pay for the library; the
 * document is destroyed as soon as the thumbnail is painted. Hidden entirely
 * if anything fails — the peek is best-effort chrome, not content.
 */
function PdfPeek({ url, onOpen }: { url: string; onOpen: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
        const absUrl = /^https?:/i.test(url) ? url : `${window.location.origin}${url}`;
        const t = pdfjs.getDocument({ url: absUrl, withCredentials: true });
        task = t as unknown as { destroy: () => Promise<void> };
        const doc = await t.promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const cssW = Math.min(wrapRef.current?.clientWidth ?? 360, 480);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (cssW / base.width) * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${String(cssW)}px`;
        await page.render({ canvas, viewport }).promise;
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      } finally {
        void task?.destroy().catch(() => undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (state === 'failed') return null;
  return (
    <button
      ref={wrapRef}
      type="button"
      onClick={onOpen}
      title="Preview"
      aria-label="Preview document"
      className="relative block h-24 w-full overflow-hidden border-t border-[var(--wui-border)] bg-white"
    >
      {state === 'loading' && <div className="absolute inset-0 animate-pulse bg-[var(--wui-bg-muted)]" />}
      <canvas ref={canvasRef} className="mx-auto block" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/10 to-transparent" />
    </button>
  );
}

/** Image peek strip — same affordance as {@link PdfPeek} for image files. */
function ImagePeek({ url, onOpen }: { url: string; onOpen: () => void }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Preview"
      aria-label="Preview image"
      className="block w-full overflow-hidden border-t border-[var(--wui-border)]"
    >
      <img src={url} alt="" onError={() => setOk(false)} className="h-24 w-full object-cover object-top" />
    </button>
  );
}

/**
 * Renders a single {@link Attachment} as a download card with inline preview
 * for images / markdown / text. Generic — used wherever an attachment-typed
 * value appears (step output fields, etc.), not tied to any step type.
 */
export function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const client = useWorkflowClient();
  // Inside the origin panel this opens the doc as a panel tab (keeps the fields
  // in view); elsewhere it's null and we fall back to the modal below.
  const openAsTab = useDocPreview();
  const url = client.uploads.url(attachment);
  const isImage = attachment.mimeType.startsWith('image/');
  const isPdf = attachment.mimeType === 'application/pdf' || attachment.name.toLowerCase().endsWith('.pdf');
  const isMarkdown = attachment.mimeType === 'text/markdown' || attachment.name.endsWith('.md');
  const isHtml = attachment.mimeType === 'text/html' || attachment.name.endsWith('.html') || attachment.name.endsWith('.htm');
  const isText = attachment.mimeType.startsWith('text/') && !isHtml;
  const [preview, setPreview] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!isMarkdown && !(isText && !isImage)) return;
    let cancelled = false;
    void fetch(url)
      .then((r) => r.text())
      .then((t) => { if (!cancelled) setPreview(t); })
      .catch(() => { /* preview is best-effort */ });
    return () => { cancelled = true; };
  }, [url, isMarkdown, isText, isImage]);

  const openPreview = () => { if (openAsTab) openAsTab(attachment); else setPreviewOpen(true); };

  return (
    <div className="rounded-lg border border-[var(--wui-border)] overflow-hidden">
      <div
        onClick={openPreview}
        className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 bg-[var(--wui-bg-subtle)] transition-colors hover:bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileTypeBadge name={attachment.name} />
          <span className="text-[12px] font-medium text-[var(--wui-fg)] truncate">{attachment.name}</span>
          {attachment.size !== undefined && (
            <span className="text-[10px] text-[var(--wui-fg-muted)] shrink-0">{formatBytes(attachment.size)}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openPreview(); }}
            title="Preview"
            aria-label="Preview"
            className="grid place-items-center rounded-md p-1.5 text-[var(--wui-fg-muted)] hover:bg-[color-mix(in_srgb,var(--wui-fg)_8%,transparent)] hover:text-[var(--wui-fg)] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <a
            href={url}
            download={attachment.name}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Download"
            aria-label="Download"
            className="grid place-items-center rounded-md p-1.5 text-[var(--wui-primary)] hover:bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
        </div>
      </div>
      {isPdf && <PdfPeek url={url} onOpen={openPreview} />}
      {isImage && <ImagePeek url={url} onOpen={openPreview} />}
      {isMarkdown && preview !== null && (
        <div className="px-3 py-2 max-h-64 overflow-y-auto"><MarkdownView>{preview}</MarkdownView></div>
      )}
      {!isMarkdown && isText && !isImage && preview !== null && (
        <pre className="px-3 py-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--wui-fg-muted)]">{preview}</pre>
      )}
      {previewOpen && (
        <AttachmentPreviewModal attachment={attachment} url={url} onClose={() => setPreviewOpen(false)} />
      )}
    </div>
  );
}

/**
 * Full-size, any-type document preview in a modal — the generic
 * {@link DocumentViewer} (PDF / image / CSV / XLSX / DOCX / text / json /
 * markdown) behind a portal overlay. Reused everywhere an {@link AttachmentCard}
 * appears (step outputs, the value-origin panel, WAIT display rows), so a single
 * viewer serves every attachment surface.
 */
export function AttachmentPreviewModal({
  attachment,
  url,
  anchor,
  onClose,
}: {
  attachment: Attachment;
  url: string;
  /** Where inside the document to land — a citation's quote and/or address. */
  anchor?: Anchor | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return createPortal(
    // Portals mount on document.body — outside the [data-workflow-ui] theme scope —
    // so re-assert it here or every --wui-* token resolves to nothing.
    <div data-workflow-ui="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />
      <div
        className="relative flex max-h-[88vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-[var(--wui-border)] bg-[var(--wui-bg)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={attachment.name}
      >
        <div className="flex items-center gap-2 border-b border-[var(--wui-border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-[var(--wui-fg)]">{attachment.name}</p>
            <p className="truncate text-[12px] text-[var(--wui-fg-muted)]">
              {attachment.mimeType}
              {attachment.size !== undefined ? ` · ${formatBytes(attachment.size)}` : ''}
            </p>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in new tab"
            className="grid size-8 place-items-center rounded-lg text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
          <a
            href={url}
            download={attachment.name}
            title="Download"
            className="grid size-8 place-items-center rounded-lg text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="grid size-8 place-items-center rounded-lg text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[var(--wui-bg-subtle)]">
          <DocumentViewer
            url={url}
            mimeType={attachment.mimeType}
            name={attachment.name}
            anchor={anchor}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Render one attachment or a list of them. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="space-y-2">
      {attachments.map((att, i) => (
        <AttachmentCard key={`${att.handle}-${i}`} attachment={att} />
      ))}
    </div>
  );
}

/** Text rendering for a non-attachment display value. */
function formatScalar(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}

/**
 * Clamp tall content to a max height while viewing; reveal the rest only when
 * the reviewer clicks "Show more". Keeps a long markdown value from taking over
 * the panel. The toggle appears only when the content actually overflows.
 */
export function Collapsible({
  children,
  className,
  maxClass = 'max-h-72',
}: {
  children: ReactNode;
  className?: string | undefined;
  maxClass?: string | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = innerRef.current;
    if (el) setOverflows(el.scrollHeight - el.clientHeight > 4);
  });

  return (
    <div className={className}>
      <div ref={innerRef} className={cn('relative overflow-hidden', !expanded && maxClass)}>
        {children}
        {overflows && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--wui-bg-subtle)] to-transparent" />
        )}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[11px] font-medium text-[var(--wui-status-paused)] hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/**
 * Render a reviewer-facing display value:
 * - empty (null/undefined/blank) → nothing (no "—" placeholder);
 * - attachment(s) → download/preview cards;
 * - a **string** → Markdown (GFM), clamped to a max height with "Show more";
 * - anything else (objects/arrays/numbers) → text fallback.
 *
 * `className` styles the surrounding box. Generic — detected from the value
 * shape, used by the WAIT pause panels and anywhere data is shown to a reviewer.
 */
export function DisplayValue({ value, className, maxClass }: { value: unknown; className?: string; maxClass?: string }) {
  if (value === null || value === undefined || value === '') return null;
  if (isAttachment(value)) return <AttachmentCard attachment={value} />;
  if (isAttachmentArray(value)) return <AttachmentList attachments={value} />;
  if (typeof value === 'string') {
    return <Collapsible className={className} maxClass={maxClass}><MarkdownView>{value}</MarkdownView></Collapsible>;
  }
  return <div className={className}>{formatScalar(value)}</div>;
}
