import { useEffect, useRef, useState, memo, type ReactElement, type CSSProperties } from 'react';
import { Code2, Image as ImageIcon, Download, Copy, Check, X } from 'lucide-react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { type D2BlockProps, type ViewMode } from './D2Block.types';
import {
  renderD2Diagram,
  isLikelyCompleteD2,
  copyToClipboard,
  downloadDiagramAsPng,
} from './D2Block.utils';

function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'midnight',
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = (): void => setIsDark(el.getAttribute('data-theme') === 'midnight');
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

const D2BlockComponent = ({ source }: D2BlockProps): ReactElement => {
  const elementRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDarkTheme();
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('diagram');
  const [copied, setCopied] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const renderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRenderedRef = useRef<string>('');

  useEffect(() => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    const renderKey = `${isDark ? 'd' : 'l'}:${source}`;
    if (!isLikelyCompleteD2(source) || lastRenderedRef.current === renderKey) {
      return;
    }

    renderTimeoutRef.current = setTimeout(() => {
      void renderD2Diagram({
        source,
        isDark,
        onSuccess: renderedSvg => {
          setSvg(renderedSvg);
          lastRenderedRef.current = renderKey;
        },
        onError: setError,
        onLoading: setIsRendering,
      });
    }, 300);

    return (): void => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [source, isDark]);

  const handleCopyCode = async (): Promise<void> => {
    const success = await copyToClipboard(source);
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

  if (error) {
    return (
      <div className='my-4 rounded-2xl border border-red-200 bg-red-50 p-4'>
        <p className='text-sm text-red-600'>Failed to render D2 diagram</p>
        <p className='mt-1 text-xs text-red-500'>{error}</p>
        <details className='mt-2'>
          <summary className='text-xs text-red-500 cursor-pointer'>Show diagram code</summary>
          <pre className='mt-2 text-xs text-foreground overflow-x-auto whitespace-pre-wrap break-words'>
            {source}
          </pre>
        </details>
      </div>
    );
  }

  if (svg) {
    const iconBtn = (active: boolean): string =>
      `flex items-center justify-center rounded-md p-1 transition-colors ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`;
    return (
      <div className='group/d2 relative my-4 overflow-hidden rounded-xl border border-border/60 bg-muted/30'>
        <div className='absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/70 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity focus-within:opacity-100 group-hover/d2:opacity-100'>
          <button
            onClick={() => setViewMode('diagram')}
            className={iconBtn(viewMode === 'diagram')}
            title='Diagram'
            data-track-category='D2'
            data-track-name='VIEW_DIAGRAM'
          >
            <ImageIcon className='h-3.5 w-3.5' />
          </button>
          <button
            onClick={() => setViewMode('code')}
            className={iconBtn(viewMode === 'code')}
            title='Code'
            data-track-category='D2'
            data-track-name='VIEW_CODE'
          >
            <Code2 className='h-3.5 w-3.5' />
          </button>

          <span className='mx-0.5 h-4 w-px bg-border' />

          {viewMode === 'diagram' ? (
            <button
              onClick={handleDownloadImage}
              className='flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground'
              title='Download as PNG'
              data-track-category='D2'
              data-track-name='DOWNLOAD_PNG'
            >
              <Download className='h-3.5 w-3.5' />
            </button>
          ) : (
            <button
              onClick={() => void handleCopyCode()}
              className='flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground'
              title='Copy code'
              data-track-category='D2'
              data-track-name='COPY_CODE'
            >
              {copied ? (
                <Check className='h-3.5 w-3.5 text-green-600' />
              ) : (
                <Copy className='h-3.5 w-3.5' />
              )}
            </button>
          )}
        </div>

        {viewMode === 'diagram' ? (
          <div
            ref={elementRef}
            className='d2-diagram flex cursor-zoom-in items-center justify-center p-4'
            /* eslint-disable-next-line react/no-danger, @typescript-eslint/naming-convention */
            dangerouslySetInnerHTML={{ __html: svg }}
            onClick={() => setShowPreview(true)}
            role='button'
            tabIndex={0}
            onKeyDown={(e): void => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowPreview(true);
              }
            }}
            title='Click to preview'
            data-track-category='D2'
            data-track-name='OPEN_PREVIEW'
          />
        ) : (
          <div className='p-3 pt-10'>
            <pre className='overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-[12.5px] leading-relaxed text-foreground'>
              {source}
            </pre>
          </div>
        )}

        {isRendering && (
          <div className='absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm'>
            <div className='h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent' />
            <span>Updating...</span>
          </div>
        )}

        <Dialog
          open={showPreview}
          onOpenChange={setShowPreview}
          title='D2 Diagram Preview'
          description='Fullscreen preview of the D2 diagram'
          className='w-[95vw] h-[95vh] max-w-[95vw] max-h-[95vh] p-0'
        >
          <button
            onClick={() => setShowPreview(false)}
            className='absolute top-4 right-4 z-10 p-2 rounded-full bg-muted hover:bg-secondary transition-colors'
            aria-label='Close preview'
            data-track-category='D2'
            data-track-name='CLOSE_PREVIEW'
          >
            <X className='h-5 w-5 text-muted-foreground' />
          </button>
          <div className='h-full w-full flex items-center justify-center p-4 overflow-auto rounded-lg'>
            <div
              className='d2-diagram flex items-center justify-center w-[90vw] h-[85vh] bg-background rounded-lg m-10'
              style={
                {
                  maxWidth: '90vw',
                  maxHeight: '85vh',
                  ['--d2-max-w']: '88vw',
                  ['--d2-max-h']: '82vh',
                } as CSSProperties
              }
              /* eslint-disable-next-line react/no-danger, @typescript-eslint/naming-convention */
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </Dialog>
      </div>
    );
  }

  if (isRendering || isLikelyCompleteD2(source)) {
    return (
      <div className='my-4 rounded-xl border border-border/60 bg-muted/30 p-8'>
        <div className='flex items-center justify-center gap-2'>
          <div className='animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full' />
          <p className='text-sm text-muted-foreground'>Rendering diagram...</p>
        </div>
      </div>
    );
  }

  return <div className='my-2' />;
};

export const D2Block = memo(
  D2BlockComponent,
  (prev, next) => prev.source === next.source && prev.messageId === next.messageId,
);
