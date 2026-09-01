import { ReactElement, useEffect, useState } from 'react';
import { DownloadDown } from '@xyne/icons';
import { detectFileType, formatFileSize } from '../../components/FileViewer/utils';
import { downloadFile, fetchFile } from '../../services/clients/fileFetchService';

/**
 * One attachment, rendered inside a column.
 *
 * The app shows a file in a full-screen modal, and a modal is the one shape a
 * stream cannot use: it covers everything, which is the opposite of the promise
 * that opening a thing does not cost you the thing beside it. So this renders
 * the same viewer components the modal renders — `detectFileType` returns the
 * right one for the mime type — and nothing else. No carousel, no chrome, no
 * zoom controls: the column header already carries the name and the close.
 *
 * Deliberately not a wrapper around `FilePreviewModal`. That component owns a
 * Dialog, keyboard scoping, a global XState actor and prev/next across a
 * gallery; borrowing it here would mean fighting all four to get a plain
 * rectangle of file.
 */

/** Where the attachment bytes live. Derived rather than stored — see `Streams.types`. */
const downloadPath = (attachmentId: string): string => `/attachments/${attachmentId}/download`;

export interface FileColumnProps {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  fileSize?: number | undefined;
}

const Centred = ({ children }: { children: React.ReactNode }): ReactElement => (
  <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[12px] text-muted-foreground'>
    {children}
  </div>
);

const FileColumn = ({
  attachmentId,
  fileName,
  mimeType,
  fileSize,
}: FileColumnProps): ReactElement => {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileType = detectFileType(mimeType, fileName);
  // Video streams from its own endpoint rather than being downloaded whole, so
  // it is the one type that must *not* be fetched here first.
  const isVideo = fileType?.displayName === 'Video';
  const needsFetch = Boolean(fileType) && !isVideo;

  useEffect(() => {
    if (!needsFetch) return undefined;
    // A column can be closed, or scrolled far away and unmounted, long before a
    // large attachment finishes arriving.
    let live = true;
    setFile(null);
    setError(null);
    fetchFile(downloadPath(attachmentId), fileName, mimeType)
      .then(loaded => {
        if (live) setFile(loaded);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Could not load this file.');
      });
    return () => {
      live = false;
    };
  }, [attachmentId, fileName, mimeType, needsFetch]);

  const download = (): void => {
    void downloadFile(downloadPath(attachmentId), fileName);
  };

  const DownloadButton = (): ReactElement => (
    <button
      type='button'
      onClick={download}
      className='streams-press flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent'
      data-track-category='Streams'
      data-track-name='DownloadFileColumn'
    >
      <DownloadDown className='size-3.5' />
      DownloadDown
      {fileSize !== undefined && (
        <span className='text-muted-foreground'>{formatFileSize(fileSize)}</span>
      )}
    </button>
  );

  if (error) {
    return (
      <Centred>
        <p className='text-destructive'>{error}</p>
        <DownloadButton />
      </Centred>
    );
  }

  // No renderer for this type. An archive or an unknown binary is not a failure,
  // so it says what it is and offers the only useful verb rather than an error.
  if (!fileType) {
    return (
      <Centred>
        <p>No preview for {mimeType || 'this file type'}.</p>
        <DownloadButton />
      </Centred>
    );
  }

  const Viewer = fileType.component;

  if (isVideo) {
    return (
      <div className='h-full w-full bg-black'>
        <Viewer source={null} fileName={fileName} attachmentId={attachmentId} />
      </div>
    );
  }

  if (!file) {
    return (
      <Centred>
        <div className='size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-none' />
      </Centred>
    );
  }

  return (
    <div className={`h-full w-full overflow-auto ${fileType.wrapperClass}`}>
      {/* `searchable` off: the app's find bar is a single global target, and a
          stream can have several file columns open at once — each registering
          would leave the bar racing on whose match count it is showing. */}
      <Viewer source={file} fileName={fileName} searchable={false} />
    </div>
  );
};

FileColumn.displayName = 'FileColumn';

export default FileColumn;
