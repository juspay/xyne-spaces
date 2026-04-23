import { useState, useEffect, useRef, memo, type ReactElement } from 'react';
import { Code2, Image as ImageIcon, Download, Copy, Check, ChevronLeft } from 'lucide-react';
import { FilesystemGraph } from './FilesystemGraph';
import {
  parseFilesystemJSON,
  isValidFilesystemJSON,
  downloadAsD2Project,
  copyToClipboard,
} from './FilesystemBlock.utils';
import type { FSNode, FilesystemBlockProps, ViewMode } from './FilesystemBlock.types';

const FilesystemBlockComponent = ({ jsonSource }: FilesystemBlockProps): ReactElement => {
  const [navStack, setNavStack] = useState<FSNode[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('diagram');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const hasNavigated = useRef(false);

  // Re-init navStack when streaming completes (jsonSource → valid)
  useEffect(() => {
    if (hasNavigated.current) return;
    const parsed = parseFilesystemJSON(jsonSource);
    if (parsed) setNavStack([parsed]);
  }, [jsonSource]);

  // ── Loading (streaming — JSON incomplete) ─────────────────────────────────
  if (!isValidFilesystemJSON(jsonSource) && navStack.length === 0) {
    return (
      <div className='my-4 p-4 bg-muted/50 border border-border rounded-lg'>
        <div className='flex items-center justify-center gap-2'>
          <div className='animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full' />
          <p className='text-sm text-muted-foreground'>Rendering diagram...</p>
        </div>
      </div>
    );
  }

  const currentNode = navStack[navStack.length - 1];
  const rootNode = navStack[0];
  if (!currentNode || !rootNode) return <div className='my-2' />;

  const hasParent = navStack.length > 1;

  const handleDrillIn = (child: FSNode): void => {
    hasNavigated.current = true;
    setNavStack(prev => [...prev, child]);
  };

  const handleBack = (): void => {
    setNavStack(prev => prev.slice(0, -1));
  };

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(jsonSource);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      await downloadAsD2Project(rootNode);
    } finally {
      setDownloading(false);
    }
  };

  // ── Title label: uppercase, like Image 2 ──────────────────────────────────
  const title = currentNode.name.toUpperCase();

  return (
    <div
      className='my-4'
      style={{ border: '2px dashed #CBD5E1', borderRadius: 14, overflow: 'hidden' }}
    >
      {/* ── Header row (inside dashed border) — title left, toolbar right ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid #E2E8F0',
          background: '#FAFBFC',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {/* Left: back button + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {hasParent && (
            <button
              onClick={handleBack}
              className='flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors'
              data-track-category='FilesystemBlock'
              data-track-name='BACK'
            >
              <ChevronLeft className='w-3 h-3' />
              Back
            </button>
          )}
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#334155',
              fontFamily: 'Inter, ui-sans-serif, sans-serif',
              letterSpacing: '0.06em',
              textTransform: 'uppercase' as const,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {title}
          </span>
        </div>

        {/* Right: toolbar — identical pill to MermaidBlock */}
        <div className='flex items-center gap-1 bg-background rounded-lg border border-border p-1'>
          <button
            onClick={() => setViewMode('diagram')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'diagram' ? 'bg-blue-100 text-blue-700' : 'text-muted-foreground hover:bg-accent'}`}
            data-track-category='FilesystemBlock'
            data-track-name='VIEW_DIAGRAM'
          >
            <ImageIcon className='w-3 h-3' />
            Diagram
          </button>
          <button
            onClick={() => setViewMode('code')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'code' ? 'bg-blue-100 text-blue-700' : 'text-muted-foreground hover:bg-accent'}`}
            data-track-category='FilesystemBlock'
            data-track-name='VIEW_CODE'
          >
            <Code2 className='w-3 h-3' />
            Code
          </button>

          {/* Download .zip D2 project (diagram mode) */}
          {viewMode === 'diagram' && (
            <button
              onClick={() => void handleDownload()}
              disabled={downloading}
              className='flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50'
              title='Download as D2 project (ZIP) — open in d2studio.ai'
              data-track-category='FilesystemBlock'
              data-track-name='DOWNLOAD_D2'
            >
              <Download className='w-3 h-3' />
            </button>
          )}

          {/* Copy JSON (code mode) */}
          {viewMode === 'code' && (
            <button
              onClick={() => void handleCopy()}
              className='flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:bg-accent transition-colors'
              title='Copy JSON source'
              data-track-category='FilesystemBlock'
              data-track-name='COPY_CODE'
            >
              {copied ? (
                <>
                  <Check className='w-3 h-3 text-green-600' />
                  <span className='text-green-600'>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className='w-3 h-3' />
                  Copy
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div style={{ padding: 16, background: '#FAFBFC' }}>
        {viewMode === 'diagram' ? (
          <FilesystemGraph root={currentNode} onDrillIn={handleDrillIn} />
        ) : (
          <pre className='text-sm text-foreground overflow-x-auto whitespace-pre-wrap break-words m-0'>
            {jsonSource}
          </pre>
        )}
      </div>
    </div>
  );
};

export const FilesystemBlock = memo(
  FilesystemBlockComponent,
  (prev, next) => prev.jsonSource === next.jsonSource,
);
