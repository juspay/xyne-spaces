import { useEffect, useState, type ReactElement } from 'react';
import { apiInstance } from '../../../services/clients/apiClient';
import { logger, Event as LogEvent } from '../../../utils/logger';
import { FileWarning } from 'lucide-react';
import { PreviewMessage, PreviewSkeletonView, usePreviewDownload } from '../chrome';
import { previewerFor } from '../registry';
import type { PreviewerProps } from '../types';
import LegacyPreview from './LegacyPreview';
import { PdfDocumentView } from './PdfPreview';

/** A Word document or a deck, drawn as the PDF the server converts it to. */
export default function OfficePreview(props: PreviewerProps): ReactElement {
  const { content } = props;
  const download = usePreviewDownload();
  // A Word document has a viewer that draws it without the converter; a deck's
  // asks this same endpoint again, so for one there is a fallback and not the other.
  const drawnWithoutConverting = previewerFor(props.file)?.id === 'word';
  const [state, setState] = useState<
    { kind: 'converting' } | { kind: 'ready'; pdf: Uint8Array } | { kind: 'failed' }
  >({ kind: 'converting' });

  useEffect(() => {
    if (!content) return;
    let cancelled = false;
    setState({ kind: 'converting' });

    const form = new FormData();
    form.append('file', content, content.name);

    apiInstance
      .post<ArrayBuffer>('/office-conversion/pdf', form, { responseType: 'arraybuffer' })
      .then(response => {
        if (cancelled) return;
        setState({ kind: 'ready', pdf: new Uint8Array(response.data) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'office_conversion_failed',
          message: 'Office document could not be converted to PDF; falling back',
          error: error instanceof Error ? error.message : String(error),
        });
        setState({ kind: 'failed' });
      });

    return (): void => {
      cancelled = true;
    };
  }, [content]);

  if (state.kind === 'ready') return <PdfDocumentView source={state.pdf} />;
  if (!content || (state.kind === 'failed' && drawnWithoutConverting)) {
    return <LegacyPreview {...props} />;
  }
  if (state.kind === 'failed') {
    return (
      <PreviewMessage
        icon={<FileWarning className='size-10 text-muted-foreground' />}
        title="Couldn't prepare this file for preview"
        body='Converting it to a preview failed. Download it to open it in the app it was made with.'
        actions={[
          { label: 'Download', onClick: download, primary: true, trackName: 'PreviewDownloaded' },
        ]}
      />
    );
  }
  return <PreviewSkeletonView shape='document' />;
}
