import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../utils/classNames';
import { fetchFile } from '../../services/clients/fileFetchService';
import { detectFileType } from '../FileViewer/utils';
import ReadmeViewer from '../FileViewer/ReadmeViewer';

export const IFRAME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups';

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

export function SandboxedFrame({ url, title }: { url: string; title: string }): ReactElement {
  return (
    <iframe
      src={url}
      title={title}
      sandbox={IFRAME_SANDBOX}
      className='h-full w-full border-0 bg-background'
      referrerPolicy='no-referrer'
    />
  );
}

export function FileView({
  url,
  title,
  mimeType,
}: {
  url: string;
  title: string;
  mimeType?: string | undefined;
}): ReactElement {
  const fileType = detectFileType(mimeType ?? '', title);
  const { file, loading, error } = useRemoteFile(
    url,
    title,
    fileType?.type === 'pdf' ? 'application/pdf' : (mimeType ?? 'application/octet-stream'),
  );
  const ViewerComponent = fileType?.component;

  if (loading) return <Spinner />;
  if (error) return <Centered>Could not load this file.</Centered>;
  if (!file || !ViewerComponent) return <Centered>Preview not available for this file.</Centered>;

  return (
    <div className={cn(fileType.wrapperClass, 'h-full max-h-full max-w-full bg-background')}>
      <ViewerComponent source={file} fileName={title} />
    </div>
  );
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
