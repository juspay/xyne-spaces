import { ReactElement, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MultipleCrossCancelCircle, UploadUp } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import Tooltip from '@/components/ui/Tooltip';
import { useUploadDigitalTwinMd } from '@/hooks/useClawDigitalTwin';
import { V2Dialog } from '@/routes/AIScreen/library/shared/primitives/V2Dialog';

const MAX_FILE_BYTES = 200 * 1024; // 200 KB — matches backend limit
const DESCRIPTION = 'Memories extracted from it land in Proposals for your review.';

export const UploadModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement => {
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [sizeLabel, setSizeLabel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadDigitalTwinMd();

  const reset = (): void => {
    setContent('');
    setFilename('');
    setSizeLabel(null);
    setErr(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'md' && ext !== 'markdown') {
      setErr('Only .md / .markdown files are supported.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErr(
        `File too large — maximum is 200 KB (this file is ${(file.size / 1024).toFixed(0)} KB).`,
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setErr(null);
    setFilename(file.name);
    setSizeLabel(`${(file.size / 1024).toFixed(0)} KB`);
    const reader = new FileReader();
    reader.onload = (ev): void =>
      setContent(typeof ev.target?.result === 'string' ? ev.target.result : '');
    reader.onerror = (): void => {
      setErr('Failed to read file. Please try again.');
      setFilename('');
      setSizeLabel(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const submit = (): void => {
    if (!filename || !content.trim()) return;
    uploadMutation.mutate(
      { filename, content: content.trim() },
      {
        onSuccess: data => {
          toast.success(
            `Added ${data.candidatesCreated} candidate${data.candidatesCreated === 1 ? '' : 's'} for review`,
          );
          reset();
          onClose();
        },
      },
    );
  };

  const close = (): void => {
    reset();
    onClose();
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={next => {
        if (!next) close();
      }}
      title='Upload markdown file'
      description={DESCRIPTION}
      testId='digital-twin-upload-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            size='sm'
            onClick={close}
            disabled={uploadMutation.isPending}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin: cancel upload'
          >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={submit}
            loading={uploadMutation.isPending}
            disabled={!filename || !content.trim()}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin: confirm upload'
          >
            Upload
          </Button>
        </>
      }
    >
      <p className='text-sm font-normal leading-5 text-muted-foreground'>{DESCRIPTION}</p>

      <input
        ref={fileInputRef}
        type='file'
        accept='.md,.markdown,text/markdown'
        onChange={handleFileSelect}
        className='hidden'
      />

      <div className='flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-3'>
        <span className='flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground'>
          <UploadUp className='size-4' aria-hidden />
        </span>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium text-foreground'>
            {filename || 'No file chosen'}
          </p>
          <p className='text-xs text-muted-foreground'>
            {sizeLabel ?? '.md or .markdown · up to 200 KB'}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin choose upload file'
        >
          {filename ? 'Change' : 'Choose file'}
        </Button>
        {filename && (
          <Tooltip side='top' content='Remove file'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              onClick={reset}
              disabled={uploadMutation.isPending}
              aria-label='Remove file'
              className='size-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:bg-muted focus-visible:ring-0'
            >
              <MultipleCrossCancelCircle className='size-4' aria-hidden />
            </Button>
          </Tooltip>
        )}
      </div>

      {content && (
        <div>
          <span className='mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            Content preview
          </span>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin upload content preview'
            rows={6}
            className='w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-muted-foreground focus:border-ring focus:outline-none'
          />
        </div>
      )}

      {err && (
        <div className='rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive'>
          {err}
        </div>
      )}
    </V2Dialog>
  );
};
