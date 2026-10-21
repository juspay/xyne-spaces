import { useRef, useState } from 'react';
import type React from 'react';
import { CheckCircle2, FileJson, Upload, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';

export function getServiceAccountEmail(value: string): string | null {
  try {
    const key = JSON.parse(value) as Record<string, unknown>;
    return key['type'] === 'service_account' &&
      typeof key['client_email'] === 'string' &&
      typeof key['private_key'] === 'string'
      ? key['client_email']
      : null;
  } catch {
    return null;
  }
}

interface GooglePlayServiceAccountKeyInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  trackCategory: string;
}

export const GooglePlayServiceAccountKeyInput: React.FC<GooglePlayServiceAccountKeyInputProps> = ({
  id,
  value,
  onChange,
  trackCategory,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const email = value ? getServiceAccountEmail(value) : null;
  const invalid = Boolean(value) && !email;

  const readFile = (file: File | undefined): void => {
    if (!file) return;
    setFileName(file.name);
    void file.text().then(onChange);
  };

  const clear = (): void => {
    setFileName('');
    onChange('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className='space-y-2'>
      <label htmlFor={id} className='text-sm text-foreground'>
        Service account key <span className='text-muted-foreground'>*</span>
      </label>
      <input
        ref={inputRef}
        id={id}
        type='file'
        accept='application/json,.json'
        className='sr-only'
        onChange={event => readFile(event.target.files?.[0])}
      />

      {value ? (
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border px-3 py-2.5',
            invalid ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-muted/40',
          )}
        >
          <FileJson
            size={20}
            className={cn('shrink-0', invalid ? 'text-destructive' : 'text-muted-foreground')}
          />
          <div className='min-w-0 flex-1'>
            <p className='truncate text-sm font-medium text-foreground'>
              {fileName || 'Service account key'}
            </p>
            {invalid ? (
              <p className='text-xs text-destructive'>
                Not a Google Cloud service account JSON key.
              </p>
            ) : (
              <p className='flex items-center gap-1 truncate text-xs text-muted-foreground'>
                <CheckCircle2 size={12} className='shrink-0 text-green-600' />
                <span className='truncate font-mono'>{email}</span>
              </p>
            )}
          </div>
          <button
            type='button'
            onClick={clear}
            aria-label='Remove key'
            className='shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
            data-track-category={trackCategory}
            data-track-name='REMOVE_GOOGLE_PLAY_SERVICE_ACCOUNT_KEY'
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          type='button'
          onClick={() => inputRef.current?.click()}
          onDragOver={event => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={event => {
            event.preventDefault();
            setIsDragging(false);
            readFile(event.dataTransfer.files[0]);
          }}
          className={cn(
            'flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center transition-colors',
            isDragging
              ? 'border-desk-accent bg-desk-accent-subtle'
              : 'border-border hover:border-desk-accent hover:bg-desk-accent-subtle',
          )}
          data-track-category={trackCategory}
          data-track-name='UPLOAD_GOOGLE_PLAY_SERVICE_ACCOUNT_KEY'
        >
          <Upload size={18} className='text-muted-foreground' />
          <span className='text-sm font-medium text-foreground'>
            Upload JSON key{' '}
            <span className='font-normal text-muted-foreground'>or drag it here</span>
          </span>
          <span className='text-xs text-muted-foreground'>
            Google Cloud &gt; IAM &amp; Admin &gt; Service accounts &gt; Keys
          </span>
        </button>
      )}

      <p className='text-xs text-muted-foreground'>
        In Play Console &gt; Users and permissions, invite{' '}
        {email ? 'this service account' : "the key's client_email"} with{' '}
        <span className='text-foreground'>View app information</span> and{' '}
        <span className='text-foreground'>Reply to reviews</span>.
      </p>
    </div>
  );
};
