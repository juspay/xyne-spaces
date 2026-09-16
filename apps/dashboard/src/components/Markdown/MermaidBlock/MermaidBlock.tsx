import { useEffect, useRef, useState, memo, type ReactElement } from 'react';
import mermaid from 'mermaid';
import {
  Code2,
  Image as ImageIcon,
  Download,
  Copy,
  Check,
  X,
  Pencil,
  Maximize2,
  Trash2,
} from 'lucide-react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { type MermaidBlockProps, type ViewMode } from './MermaidBlock.types';
import {
  renderMermaidDiagram,
  copyToClipboard,
  downloadDiagramAsPng,
  isValidMermaidSyntax,
} from './MermaidBlock.utils';

function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'midnight',
  );
  useEffect(() => {
    const root = document.documentElement;
    const update = (): void => setIsDark(root.getAttribute('data-theme') === 'midnight');
    update();
    const observer = new MutationObserver((): void => update());
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

// Initialize Mermaid once.
// securityLevel MUST NOT be 'loose': under 'loose' mermaid skips its internal
// DOMPurify pass entirely, so raw HTML in diagram labels (e.g. `A["<img src=x
// onerror=...>"]`) survives into the rendered SVG and executes when injected via
// dangerouslySetInnerHTML — an XSS sink, because `chart` comes from chat/AI
// messages. 'antiscript' keeps HTML labels working but makes mermaid sanitize the
// SVG (stripping <script>, on* handlers and javascript: URLs). The output is also
// re-sanitized at the injection sink in MermaidBlock.utils.ts (defense-in-depth +
// to clean any SVG cached under the previous 'loose' setting).
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'antiscript',
  fontFamily: 'Inter, sans-serif',
  // On a parse/render failure mermaid.render() (called with no container) appends a
  // temporary <div id="d{id}"> holding its "Syntax error in text" bomb SVG to
  // document.body and then throws WITHOUT removing that div — so every failed diagram
  // leaks a floating bomb into the DOM (very visible in the Electron desktop shell).
  // suppressErrorRendering makes mermaid skip drawing the bomb and clean up the temp
  // node before throwing, so the error is handled solely by our own catch handler in
  // MermaidBlock.utils.ts (which shows an inline red error box instead).
  suppressErrorRendering: true,
});

/**
 * Renders Mermaid diagrams from markdown code blocks
 * Debounces rendering during streaming to prevent flickering
 * Uses IndexedDB caching for improved performance
 * Memoized to prevent re-renders when parent re-renders (e.g., typing in input)
 */
const MermaidBlockComponent = ({
  chart,
  messageId,
  controlsOnHover = false,
  onEdit,
  onDelete,
  previewOnClick = true,
}: MermaidBlockProps): ReactElement => {
  const isDark = useIsDarkTheme();
  const elementRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('diagram');
  const [copied, setCopied] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const renderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRenderedChartRef = useRef<string>('');
  const hasValidSyntaxRef = useRef<boolean>(false);

  useEffect(() => {
    // Update valid syntax ref
    hasValidSyntaxRef.current = isValidMermaidSyntax(chart);

    // Clear previous timeout
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    // Debounce rendering to prevent flickering during streaming
    renderTimeoutRef.current = setTimeout(() => {
      void renderMermaidDiagram({
        chart,
        messageId,
        isDark,
        lastRenderedChart: lastRenderedChartRef.current,
        onSuccess: (renderedSvg, renderedChart) => {
          setSvg(renderedSvg);
          lastRenderedChartRef.current = `${isDark ? 'dark' : 'light'}:${renderedChart}`;
        },
        onError: setError,
        onLoading: setIsRendering,
      });
    }, 400);

    return (): void => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [chart, messageId, isDark]);

  const handleCopyCode = async (): Promise<void> => {
    const success = await copyToClipboard(chart);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadImage = (): void => {
    if (!svg || !elementRef.current) return;

    const svgElement = elementRef.current.querySelector('svg');
    if (!svgElement) return;

    downloadDiagramAsPng(svgElement);
  };

  // If we have an error, show it
  if (error) {
    return (
      <div className='p-4 bg-red-50 border border-red-200 rounded-lg'>
        <p className='text-sm text-red-600'>{error}</p>
        <details className='mt-2'>
          <summary className='text-xs text-red-500 cursor-pointer'>Show diagram code</summary>
          <pre className='mt-2 text-xs text-foreground overflow-x-auto'>{chart}</pre>
        </details>
      </div>
    );
  }

  // If we have SVG, show it
  if (svg) {
    return (
      <div className='group/mermaid relative my-4'>
        {/* View Mode Toggle & Actions */}
        <div
          className={`absolute right-2 top-2 z-10 transition-opacity ${
            controlsOnHover
              ? 'opacity-0 focus-within:opacity-100 group-hover/mermaid:opacity-100'
              : 'opacity-100'
          }`}
        >
          <div className='flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded-lg shadow-sm border border-border p-1'>
            <button
              onClick={() => setViewMode('diagram')}
              className={`flex items-center rounded p-1.5 transition-colors ${
                viewMode === 'diagram'
                  ? 'mermaid-tab-active'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
              title='View diagram'
              aria-label='View diagram'
              data-track-category='Mermaid'
              data-track-name='VIEW_DIAGRAM'
            >
              <ImageIcon className='w-3 h-3' />
            </button>
            <button
              onClick={() => setViewMode('code')}
              className={`flex items-center rounded p-1.5 transition-colors ${
                viewMode === 'code' ? 'mermaid-tab-active' : 'text-muted-foreground hover:bg-accent'
              }`}
              title='View code'
              aria-label='View code'
              data-track-category='Mermaid'
              data-track-name='VIEW_CODE'
            >
              <Code2 className='w-3 h-3' />
            </button>

            {/* Download Button (only in diagram mode) */}
            {viewMode === 'diagram' && (
              <button
                onClick={handleDownloadImage}
                className='flex items-center rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors'
                title='Download as PNG'
                aria-label='Download as PNG'
                data-track-category='Mermaid'
                data-track-name='DOWNLOAD_PNG'
              >
                <Download className='w-3 h-3' />
              </button>
            )}

            {/* Copy Button (only in code mode) */}
            {viewMode === 'code' && (
              <button
                onClick={() => void handleCopyCode()}
                className='flex items-center rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors'
                title='Copy code'
                aria-label='Copy code'
                data-track-category='Mermaid'
                data-track-name='COPY_CODE'
              >
                {copied ? (
                  <Check className='w-3 h-3 text-green-600' />
                ) : (
                  <Copy className='w-3 h-3' />
                )}
              </button>
            )}

            {!previewOnClick && viewMode === 'diagram' && (
              <button
                onClick={() => setShowPreview(true)}
                className='flex items-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent'
                title='Open preview'
                aria-label='Open preview'
                data-track-category='Mermaid'
                data-track-name='OPEN_PREVIEW'
              >
                <Maximize2 className='w-3 h-3' />
              </button>
            )}

            {onEdit && (
              <button
                onClick={onEdit}
                className='flex items-center rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors'
                title='Edit source'
                aria-label='Edit source'
                data-track-category='Mermaid'
                data-track-name='EDIT_SOURCE'
              >
                <Pencil className='w-3 h-3' />
              </button>
            )}

            {onDelete && (
              <button
                onClick={onDelete}
                className='flex items-center rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors'
                title='Delete'
                aria-label='Delete'
                data-track-category='Mermaid'
                data-track-name='DELETE_DIAGRAM'
              >
                <Trash2 className='w-3 h-3' />
              </button>
            )}
          </div>
        </div>

        {/* Content: Diagram or Code */}
        {viewMode === 'diagram' ? (
          <>
            <div
              ref={elementRef}
              className='mermaid-diagram flex justify-center rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/30 cursor-pointer'
              /* eslint-disable-next-line react/no-danger, @typescript-eslint/naming-convention */
              dangerouslySetInnerHTML={{ __html: svg }}
              onClick={previewOnClick ? () => setShowPreview(true) : undefined}
              role={previewOnClick ? 'button' : undefined}
              tabIndex={previewOnClick ? 0 : undefined}
              onKeyDown={
                previewOnClick
                  ? (e): void => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setShowPreview(true);
                      }
                    }
                  : undefined
              }
              title={previewOnClick ? 'Click to preview' : undefined}
              data-track-category='Mermaid'
              data-track-name='OPEN_PREVIEW'
            />
            {/* Show subtle loading indicator if re-rendering */}
            {isRendering && (
              <div className='absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 bg-background/90 rounded shadow-sm text-xs text-muted-foreground'>
                <div className='animate-spin h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full' />
                <span>Updating...</span>
              </div>
            )}
          </>
        ) : (
          <div className='bg-muted/50 border border-border rounded-lg p-4'>
            <pre className='text-sm text-foreground overflow-x-auto whitespace-pre-wrap break-words'>
              {chart}
            </pre>
          </div>
        )}

        {/* Fullscreen Preview Modal */}
        <Dialog
          open={showPreview}
          onOpenChange={setShowPreview}
          title='Mermaid Diagram Preview'
          description='Fullscreen preview of the mermaid diagram'
          className='w-[95vw] h-[95vh] max-w-[95vw] max-h-[95vh] p-0'
        >
          {/* Close Button */}
          <button
            onClick={() => setShowPreview(false)}
            className='absolute top-4 right-4 z-10 p-2 rounded-full bg-muted hover:bg-secondary transition-colors'
            aria-label='Close preview'
            data-track-category='Mermaid'
            data-track-name='CLOSE_PREVIEW'
          >
            <X className='h-5 w-5 text-muted-foreground' />
          </button>

          {/* Preview Content */}
          <div className='h-full w-full flex items-center justify-center p-4 overflow-auto rounded-lg'>
            <div
              className='mermaid-diagram m-10 flex h-[85vh] w-[90vw] justify-center rounded-lg bg-background'
              style={{ maxWidth: '90vw', maxHeight: '85vh' }}
              /* eslint-disable-next-line react/no-danger, @typescript-eslint/naming-convention */
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </Dialog>
      </div>
    );
  }

  // No SVG yet - show loading state if we have valid syntax, otherwise show placeholder
  if (hasValidSyntaxRef.current || isRendering) {
    return (
      <div className='my-4 p-4 bg-muted/50 border border-border rounded-lg'>
        <div className='flex items-center justify-center gap-2'>
          <div className='animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full' />
          <p className='text-sm text-muted-foreground'>Rendering diagram...</p>
        </div>
      </div>
    );
  }

  // Invalid/incomplete syntax - show nothing while streaming
  return <div className='my-2' />;
};

/**
 * Memoized MermaidBlock to prevent re-renders when chart hasn't changed
 * This prevents flickering when user types in input box
 */
export const MermaidBlock = memo(MermaidBlockComponent, (prevProps, nextProps): boolean => {
  // Only re-render if chart or messageId actually changed
  return (
    prevProps.chart === nextProps.chart &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.controlsOnHover === nextProps.controlsOnHover &&
    // Deliberately not comparing onEdit/onDelete: a block spec rebuilds them on
    // every render, so comparing identity would re-render every diagram on the
    // page for every keystroke anywhere in the document. What they do never
    // changes, only which closure carries it.
    Boolean(prevProps.onEdit) === Boolean(nextProps.onEdit) &&
    Boolean(prevProps.onDelete) === Boolean(nextProps.onDelete) &&
    prevProps.previewOnClick === nextProps.previewOnClick
  );
});
