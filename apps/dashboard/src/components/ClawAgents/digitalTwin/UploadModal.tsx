import { ReactElement, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useUploadDigitalTwinMd } from '@/hooks/useClawDigitalTwin';
import { DigitalTwinModal } from './DigitalTwinModal';

const MAX_FILE_BYTES = 200 * 1024; // 200 KB — matches backend limit

export const UploadModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement => {
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadDigitalTwinMd();

  const reset = (): void => {
    setContent('');
    setFilename('');
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
    const reader = new FileReader();
    reader.onload = (ev): void =>
      setContent(typeof ev.target?.result === 'string' ? ev.target.result : '');
    reader.onerror = (): void => {
      setErr('Failed to read file. Please try again.');
      setFilename('');
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
    <DigitalTwinModal
      open={open}
      onClose={close}
      title='Upload markdown file'
      description='Attach a markdown file (e.g. an “about me”, working preferences, project context). The curator extracts candidate memories and adds them under the Documents cluster for your review.'
      footer={
        <>
          <Button variant='ghost' size='sm' onClick={close} disabled={uploadMutation.isPending}>
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={submit}
            loading={uploadMutation.isPending}
            disabled={!filename || !content.trim()}
          >
            Upload
          </Button>
        </>
      }
    >
      <div>
        <label
          htmlFor='digital-twin-markdown-file'
          className='mb-2 block text-xs font-medium text-foreground'
        >
          Markdown file
        </label>
        <Input
          id='digital-twin-markdown-file'
          ref={fileInputRef}
          type='file'
          accept='.md,.markdown,text/markdown'
          onChange={handleFileSelect}
          className='h-auto min-h-9 py-1.5 text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:text-xs file:font-medium file:text-foreground'
        />
        {filename && <p className='mt-2 text-xs text-muted-foreground'>{filename}</p>}
      </div>

      {content && (
        <div>
          <label
            htmlFor='digital-twin-markdown-content'
            className='mb-2 block text-xs font-medium text-foreground'
          >
            Content preview
          </label>
          <textarea
            id='digital-twin-markdown-content'
            value={content}
            onChange={e => setContent(e.target.value)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin upload content preview'
            rows={6}
            className='w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/10'
          />
        </div>
      )}

      {err && (
        <div
          role='alert'
          className='rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'
        >
          {err}
        </div>
      )}
    </DigitalTwinModal>
  );
};
