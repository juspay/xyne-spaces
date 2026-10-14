import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { API_BASE_URL } from '../../config';
import { fetchFile } from '../../services/clients/fileFetchService';
import { FilePreview } from '../FilePreview';
import ReadmeViewer from '../FileViewer/ReadmeViewer';
import { LoadError } from '../InAppBrowser/LoadError';
import { previewFileFor } from './itemDescriptor';
import { previewFrameMode, type PreviewFrameMode } from './previewFrame';

export { IFRAME_SANDBOX, previewFrameMode, type PreviewFrameMode } from './previewFrame';

const FRAME_LOAD_TIMEOUT_MS = 20_000;

export function Centered({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
      {children}
    </div>
  );
}

export function Spinner(): ReactElement {
  return (
    <div className='flex h-full items-center justify-center'>
      <div className='h-6 w-6 animate-spin rounded-full border-b-2 border-ring' />
    </div>
  );
}

export function useRemoteFile(
  url: string,
  fileName: string,
  mimeType: string,
): { file: File | null; loading: boolean; error: boolean } {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setFile(null);
    void fetchFile(url, fileName, mimeType)
      .then(loaded => {
        if (!cancelled) setFile(loaded);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, fileName, mimeType]);

  return { file, loading, error };
}

function PreviewFrame({
  url,
  title,
  mode,
  onRetry,
}: {
  url: string;
  title: string;
  mode: Extract<PreviewFrameMode, { kind: 'frame' }>;
  onRetry: () => void;
}): ReactElement {
  const [status, setStatus] = useState<'loading' | 'ready' | 'timedOut'>('loading');

  useEffect(() => {
    if (status !== 'loading') return undefined;
    const timer = window.setTimeout(() => setStatus('timedOut'), FRAME_LOAD_TIMEOUT_MS);
    return (): void => window.clearTimeout(timer);
  }, [status]);

  return (
    <div className='relative h-full w-full'>
      <iframe
        src={url}
        title={title}
        sandbox={mode.sandbox}
        {...(mode.allow ? { allow: mode.allow } : {})}
        onLoad={() => setStatus('ready')}
        className='h-full w-full border-0 bg-background'
        referrerPolicy='no-referrer'
      />
      {status === 'loading' && (
        <div className='absolute inset-0 bg-background'>
          <Spinner />
        </div>
      )}
      {status === 'timedOut' && (
        <LoadError
          error={{ code: -7, description: '', url }}
          onRetry={onRetry}
          trackCategory='Workspace'
        />
      )}
    </div>
  );
}

export function SandboxedFrame({ url, title }: { url: string; title: string }): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const mode = previewFrameMode(url);

  if (mode.kind === 'shares-dashboard-origin') {
    return (
      <Centered>
        This preview needs the dedicated preview host and can&apos;t be shown here.
      </Centered>
    );
  }

  return (
    <PreviewFrame
      key={`${url}:${attempt}`}
      url={url}
      title={title}
      mode={mode}
      onRetry={() => setAttempt(current => current + 1)}
    />
  );
}

/** A file, drawn by the app's file previewer. */
export function FileView({
  url,
  title,
  mimeType,
  size,
}: {
  url: string;
  title: string;
  mimeType?: string | undefined;
  size?: number | undefined;
}): ReactElement {
  const file = useMemo(
    () => previewFileFor({ source: url, name: title, mimeType, size }, API_BASE_URL),
    [url, title, mimeType, size],
  );
  return <FilePreview key={url} file={file} />;
}

export function MarkdownView({ url, title }: { url: string; title: string }): ReactElement {
  const { file, loading, error } = useRemoteFile(url, title, 'text/markdown');

  if (loading) return <Spinner />;
  if (error) return <Centered>Could not load this document.</Centered>;

  return (
    <div className='relative h-full min-h-0'>
      <ReadmeViewer source={file} fileName={title} />
    </div>
  );
}

export function HtmlDocView({
  url,
  title,
  inject,
  onFrame,
}: {
  url: string;
  title: string;
  inject?: string;
  onFrame?: (frame: HTMLIFrameElement | null) => void;
}): ReactElement {
  const { file, loading, error } = useRemoteFile(url, title, 'text/html');
  const [html, setHtml] = useState('');

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    void file.text().then(text => {
      if (!cancelled) setHtml(text);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (loading) return <Spinner />;
  if (error) return <Centered>Could not load this document.</Centered>;

  const source = inject
    ? html.includes('</body>')
      ? html.replace('</body>', `${inject}</body>`)
      : html + inject
    : html;

  return (
    <iframe
      title={title}
      ref={onFrame}
      srcDoc={source}
      sandbox='allow-scripts allow-popups'
      referrerPolicy='no-referrer'
      className='h-full w-full border-0 bg-background'
    />
  );
}
