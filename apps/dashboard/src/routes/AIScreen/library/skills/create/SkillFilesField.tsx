import { useRef, type ReactElement } from 'react';
import { FolderDefault, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import type { PendingSkillFile } from '@/services/claw/clawSkillFileUtils';

const CAPTION = 'Scripts, templates and data that ship alongside the instructions.';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SkillFilesFieldProps {
  files: readonly PendingSkillFile[];
  onPick: (fileList: FileList | null, input: HTMLInputElement | null) => void;
  onRemove: (relativePath: string) => void;
  error: string | null;
}

export function SkillFilesField({
  files,
  onPick,
  onRemove,
  error,
}: SkillFilesFieldProps): ReactElement {
  const dirRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-4'>
          <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
            Files
          </span>
          {files.length > 0 && (
            <span className='text-xs leading-5 tracking-[-0.24px] text-muted-foreground'>
              {files.length} attached
            </span>
          )}
        </div>

        <div className='flex shrink-0 items-center gap-1.5'>
          <input
            ref={dirRef}
            type='file'
            multiple
            className='hidden'
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={e => onPick(e.target.files, dirRef.current)}
          />
          <input
            ref={fileRef}
            type='file'
            multiple
            className='hidden'
            onChange={e => onPick(e.target.files, fileRef.current)}
          />
          <button
            type='button'
            onClick={() => dirRef.current?.click()}
            aria-label='Upload folder'
            title='Upload folder'
            data-track-category='Claw Agents'
            data-track-name='Create skill v2: upload folder'
            className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <FolderDefault className='size-4' aria-hidden />
          </button>
          <button
            type='button'
            onClick={() => fileRef.current?.click()}
            aria-label='Upload files'
            title='Upload files'
            data-track-category='Claw Agents'
            data-track-name='Create skill v2: upload files'
            className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <PlusDefault className='size-4' aria-hidden />
          </button>
        </div>
      </div>

      <p className='text-sm leading-5 text-muted-foreground'>{CAPTION}</p>

      {files.length > 0 && (
        <div className='flex w-full flex-col gap-2 pt-1'>
          {files.map(file => (
            <div
              key={file.relativePath}
              className='flex h-9 w-full items-center gap-2 rounded-[10px] border-[0.8px] border-border bg-muted px-3'
            >
              <span className='min-w-0 flex-1 truncate text-sm font-normal leading-5 text-foreground'>
                {file.relativePath}
              </span>
              <span className='shrink-0 text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
                {formatSize(file.sizeBytes)}
              </span>
              <button
                type='button'
                onClick={() => onRemove(file.relativePath)}
                aria-label={`Remove ${file.relativePath}`}
                title={`Remove ${file.relativePath}`}
                data-track-category='Claw Agents'
                data-track-name='Create skill v2: remove file'
                className='flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground'
              >
                <MultipleCrossCancelDefault className='size-3' aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className='text-xs leading-4 text-destructive'>{error}</p>}
    </div>
  );
}
