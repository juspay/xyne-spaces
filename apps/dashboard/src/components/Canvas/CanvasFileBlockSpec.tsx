import { defaultBlockSpecs } from '@blocknote/core';
import { AddFileButton, createReactBlockSpec, FileBlockWrapper } from '@blocknote/react';
import axios from 'axios';
import { Download, FileText } from 'lucide-react';
import type { ReactElement } from 'react';
import { toast } from 'sonner';

const fileConfig = defaultBlockSpecs.file.config;

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : 'FILE';
};

/**
 * Download rather than navigate.
 *
 * `<a download>` only applies same-origin, and uploads are served from storage,
 * so the file is pulled down and handed over as a blob. Falling back to opening
 * it keeps a blocked request from looking like a dead button.
 */
async function downloadFile(url: string, name: string): Promise<void> {
  try {
    const response = await axios.get<Blob>(url, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(response.data);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = name || 'download';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    toast.error('Could not download', { description: 'Opened the file instead.' });
  }
}

function FileCard({ url, name }: { url: string; name: string }): ReactElement {
  const label = name || url;

  return (
    <div
      contentEditable={false}
      className='canvas-file-card group/file my-1 flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/60'
    >
      <span className='grid size-10 shrink-0 place-items-center rounded-md bg-background text-muted-foreground'>
        <FileText size={18} />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium text-foreground' title={label}>
          {label}
        </span>
        <span className='block text-xs text-muted-foreground'>{extensionOf(label)}</span>
      </span>
      <button
        type='button'
        title='Download'
        aria-label={`Download ${label}`}
        className='grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground'
        onMouseDown={event => {
          // The editor reclaims the selection on mouseup, so a click never lands.
          event.preventDefault();
          event.stopPropagation();
          void downloadFile(url, label);
        }}
      >
        <Download size={16} />
      </button>
    </div>
  );
}

/**
 * A file in the document, shown as a card you can download from.
 *
 * BlockNote renders an uploaded file as an icon and its name and nothing else,
 * with no way to get the file back out. Before anything is uploaded this defers
 * to BlockNote's own add-file button, so the upload flow is untouched.
 */
export const canvasFileBlockSpec = createReactBlockSpec(
  fileConfig,
  {
    render: ({ block, editor }) => {
      const url = String(block.props.url ?? '');
      const name = String(block.props.name ?? '');

      return (
        <FileBlockWrapper block={block} editor={editor}>
          {url ? (
            <FileCard url={url} name={name} />
          ) : (
            <AddFileButton block={block} editor={editor} />
          )}
        </FileBlockWrapper>
      );
    },
  },
  defaultBlockSpecs.file.extensions,
)();
