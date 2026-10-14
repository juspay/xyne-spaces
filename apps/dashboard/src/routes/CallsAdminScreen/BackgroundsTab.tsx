import { useRef, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useCopyButton } from '@/hooks/useCopyButton';
import { callBackgroundImageUrl, callBackgroundsApi } from '@/api/callBackgroundsApi';
import { imageFileToPresetJpegs } from '@/utils/callBackground';
import { CALLS_ADMIN_TRACK } from './CallsAdminScreen.utils';

/** Superposition key the call background picker reads (see callBackgroundController). */
const SUPERPOSITION_KEY = 'call_backgrounds';

interface Uploaded {
  id: string;
  label: string;
}

function CopyBlock({ label, text }: { label: string; text: string }): ReactElement {
  const { copied, copy } = useCopyButton();
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center justify-between'>
        <span className='text-xs font-medium text-muted-foreground'>{label}</span>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => copy(text)}
          data-track-category={CALLS_ADMIN_TRACK}
          data-track-name='Calls admin: copy background snippet'
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className='overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs'>
        {text}
      </pre>
    </div>
  );
}

/**
 * Upload preset call backgrounds. Images go to storage here; which ones users see is
 * set by hand in Superposition, so this tab hands back the entry to add there.
 */
export function BackgroundsTab(): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);

  const upload = useMutation({
    mutationFn: async ({ source, name }: { source: File; name: string }): Promise<Uploaded> => {
      const { image, thumb } = await imageFileToPresetJpegs(source);
      const id = await callBackgroundsApi.uploadPreset(image, thumb);
      return { id, label: name };
    },
    onSuccess: result => {
      setUploaded(result);
      setFile(null);
      setLabel('');
      toast.success('Background uploaded');
    },
    onError: () => toast.error('Could not upload background'),
  });

  const canUpload = !!file && label.trim().length > 0 && !upload.isPending;
  const entry = uploaded ? JSON.stringify({ id: uploaded.id, label: uploaded.label }) : '';
  const exampleValue = uploaded
    ? JSON.stringify({ items: [{ id: uploaded.id, label: uploaded.label }] }, null, 2)
    : '';

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6'>
      <section className='flex max-w-xl flex-col gap-3'>
        <h2 className='text-base font-semibold'>Upload a call background</h2>
        <p className='text-sm text-muted-foreground'>
          Landscape images work best. They are resized to 1280×720 before upload.
        </p>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => fileInputRef.current?.click()}
            data-track-category={CALLS_ADMIN_TRACK}
            data-track-name='Calls admin: choose background image'
          >
            {file ? 'Change image' : 'Choose image'}
          </Button>
          <span className='truncate text-sm text-muted-foreground'>
            {file?.name ?? 'No image selected'}
          </span>
        </div>
        <Input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder='Label shown in the picker, e.g. Office'
          maxLength={40}
          aria-label='Background label'
        />
        <div>
          <Button
            type='button'
            disabled={!canUpload}
            onClick={() => file && upload.mutate({ source: file, name: label.trim() })}
            data-track-category={CALLS_ADMIN_TRACK}
            data-track-name='Calls admin: upload background'
          >
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type='file'
          accept='image/*'
          className='hidden'
          onChange={e => {
            const next = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (next && !next.type.startsWith('image/')) {
              toast.error('Please choose an image file');
              return;
            }
            setFile(next);
          }}
        />
      </section>

      {uploaded && (
        <section className='flex max-w-2xl flex-col gap-4 rounded-lg border p-4'>
          <div className='flex items-center gap-4'>
            <img
              src={callBackgroundImageUrl(uploaded.id, 'thumb')}
              alt={uploaded.label}
              className='aspect-video w-40 rounded-md object-cover'
            />
            <div className='text-sm'>
              <div className='font-medium'>{uploaded.label}</div>
              <div className='text-muted-foreground'>Uploaded — not visible to users yet</div>
            </div>
          </div>
          <CopyBlock label='Image URL' text={callBackgroundImageUrl(uploaded.id)} />
          <CopyBlock label='Entry to add in Superposition' text={entry} />
        </section>
      )}

      <section className='flex max-w-2xl flex-col gap-2 text-sm'>
        <h2 className='text-base font-semibold'>Making it visible in calls (Superposition)</h2>
        <ol className='list-decimal space-y-1 pl-5 text-muted-foreground'>
          <li>
            Open the config key <code className='text-foreground'>{SUPERPOSITION_KEY}</code> (type:
            object). Create it with value{' '}
            <code className='text-foreground'>{'{ "items": [] }'}</code> if it does not exist.
          </li>
          <li>
            Add the entry above to <code className='text-foreground'>items</code>. Each entry is{' '}
            <code className='text-foreground'>
              {'{ "id": "<uploaded id>", "label": "<name>" }'}
            </code>
            ; the order of <code className='text-foreground'>items</code> is the order in the
            picker.
          </li>
          <li>
            To show a different set to one workspace, add a context override on{' '}
            <code className='text-foreground'>workspaceId</code> with its own{' '}
            <code className='text-foreground'>items</code>.
          </li>
          <li>
            Remove an entry to hide a background; to replace one, upload the new image and swap the
            id. Users see changes within about a minute.
          </li>
        </ol>
        {exampleValue && <CopyBlock label='Example full value' text={exampleValue} />}
      </section>
    </div>
  );
}
