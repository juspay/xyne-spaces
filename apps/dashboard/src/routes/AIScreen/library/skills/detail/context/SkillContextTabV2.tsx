import { useRef, type ChangeEvent, type ReactElement } from 'react';
import { FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawSkillFiles } from '@/hooks/useClawSkills';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import { readSkillBundleFromFileList } from '@/services/claw/clawSkillFileUtils';
import { ProseBox } from '../../../shared/primitives/ProseBox';
import {
  DetailCard,
  DetailEmptyState,
  DetailLockedNote,
  DetailSection,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import type { SkillDetailActions } from '../useSkillDetailActions';

const LOCK_NOTE = 'Only the person who created this skill, or an admin, can change it.';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadButton({
  label,
  busy,
  accept,
  multiple,
  trackName,
  onFiles,
}: {
  label: string;
  busy: boolean;
  accept?: string;
  multiple?: boolean;
  trackName: string;
  onFiles: (files: FileList) => void;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type='button'
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={label}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className='flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-muted px-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
      >
        {busy ? (
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
        ) : (
          <Upload className='size-3.5' aria-hidden />
        )}
        {label}
      </button>
      <input
        ref={inputRef}
        type='file'
        className='hidden'
        {...(accept ? { accept } : {})}
        {...(multiple ? { multiple: true } : {})}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const picked = event.target.files;
          if (picked && picked.length > 0) onFiles(picked);
          event.target.value = '';
        }}
      />
    </>
  );
}

export function SkillContextTabV2({
  skill,
  actions,
}: {
  skill: Skill;
  actions: SkillDetailActions;
}): ReactElement {
  const files = useClawSkillFiles(skill.slug);
  const { canEdit, busy } = actions;

  const readAll = async (list: FileList): Promise<void> => {
    // Split the pick the same way create does: the SKILL.md body is the skill's
    // instructions (Skill.content), everything else is a sibling file. Sending
    // SKILL.md to the files endpoint would be rejected as a reserved path, so
    // route it to saveContent and only replace the siblings.
    const { files: pending, mainContent } = await readSkillBundleFromFileList(list);
    if (mainContent !== null) {
      await actions.saveContent(mainContent);
    }
    await actions.uploadFiles(
      pending.map(({ relativePath, content, contentType }) => ({
        relativePath,
        content,
        ...(contentType ? { contentType } : {}),
      })),
    );
  };

  const readMarkdown = async (list: FileList): Promise<void> => {
    const file = list[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.md')) {
      toast.error('Pick a .md file — the instructions are markdown.');
      return;
    }
    await actions.saveContent(await file.text());
  };

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Files'
        info='Sibling files that ship alongside the instructions'
        trailing={
          canEdit ? (
            <UploadButton
              label='Upload Files'
              busy={busy.uploading}
              multiple
              trackName='Skill detail v2: upload files'
              onFiles={list => void readAll(list)}
            />
          ) : (
            <ReadOnlyBadge />
          )
        }
        trailingAlign='end'
      >
        <DetailCard>
          {!canEdit && <DetailLockedNote>{LOCK_NOTE}</DetailLockedNote>}

          {files.isLoading ? (
            <div className='flex w-full flex-col'>
              {[0, 1].map(row => (
                <div
                  key={row}
                  className='flex items-center gap-3 border-b border-border p-4 last:border-b-0'
                >
                  <Skeleton className='size-8 shrink-0 rounded-lg' />
                  <Skeleton className='h-3.5 w-48' />
                </div>
              ))}
            </div>
          ) : (files.data ?? []).length === 0 ? (
            <DetailEmptyState
              icon={<FileText className='size-6' aria-hidden />}
              title='No Files Uploaded'
              description='Scripts, examples and data that ship alongside this skill show up here.'
            />
          ) : (
            (files.data ?? []).map(file => (
              <div
                key={file.id}
                className='flex w-full items-center gap-3 border-b border-border p-4 last:border-b-0'
              >
                <span
                  className='flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground'
                  aria-hidden
                >
                  <FileText className='size-4' />
                </span>
                <span className='min-w-0 flex-1 truncate text-sm font-medium leading-[22px] text-foreground'>
                  {file.relativePath}
                </span>
                <span className='shrink-0 whitespace-nowrap text-xs leading-4 text-muted-foreground'>
                  {formatSize(file.sizeBytes)}
                </span>
              </div>
            ))
          )}
        </DetailCard>
      </DetailSection>

      <DetailSection
        label='System Prompt'
        info='The instructions an agent reads when it runs this skill'
        trailing={
          canEdit ? (
            <UploadButton
              label='Upload .md'
              busy={busy.uploading}
              accept='.md,text/markdown'
              trackName='Skill detail v2: upload markdown'
              onFiles={list => void readMarkdown(list)}
            />
          ) : (
            <ReadOnlyBadge />
          )
        }
        trailingAlign='end'
      >
        {skill.content ? (
          <ProseBox>{skill.content}</ProseBox>
        ) : (
          <DetailCard>
            <DetailEmptyState
              icon={<FileText className='size-6' aria-hidden />}
              title='No instructions yet'
              description='Upload a SKILL.md to give this skill its instructions.'
            />
          </DetailCard>
        )}
      </DetailSection>
    </div>
  );
}
