import { ReactElement, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createPreviewUrl } from '../../services/clients/fileFetchService';

export function TranscriptTab({ attachmentId }: { attachmentId: string | null }): ReactElement {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(
    attachmentId ? 'loading' : 'loaded',
  );
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!attachmentId) {
      setText(null);
      setState('loaded');
      return;
    }
    let cancelled = false;
    setState('loading');
    createPreviewUrl(attachmentId)
      .then(blob => blob.text())
      .then(content => {
        if (cancelled) return;
        setText(content);
        setState('loaded');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return (): void => {
      cancelled = true;
    };
  }, [attachmentId]);

  if (state === 'loading') {
    return (
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <Loader2 className='size-4 animate-spin' />
        <span>Loading transcript...</span>
      </div>
    );
  }
  if (state === 'error') {
    return <p className='text-sm text-muted-foreground'>Failed to load transcript.</p>;
  }
  if (!text) {
    return <p className='text-sm text-muted-foreground'>No transcript available for this call.</p>;
  }
  return (
    <pre className='whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed'>
      {text}
    </pre>
  );
}
