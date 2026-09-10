import { ReactElement, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FolderOpen, Upload } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { SectionCaption } from '@/components/ClawAgents/SectionCaption';
import { useCreateClawSkill } from '@/hooks/useCreateClawSkill';
import { readSkillFilesFromFileList } from '@/services/claw/clawSkillFileUtils';
import type { PendingSkillFile } from '@/services/claw/clawSkillFileUtils';
import { slugify } from './create/wizardState';

const codeField =
  'w-full resize-none overflow-auto rounded-xl border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground transition-colors focus:border-ring focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring';

const ClawSkillCreateScreen = (): ReactElement => {
  const navigate = useNavigate();
  const createMutation = useCreateClawSkill();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingSkillFile[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);

  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveSlug = slugManual ? slug : slugify(name);
  const canCreate = effectiveSlug.length > 0 && content.trim().length > 0;
  const widthClass = 'max-w-[720px]';

  const cancel = (): void => {
    void navigate('/claw-agents/skills');
  };

  const handlePick = async (
    fileList: FileList | null,
    inputEl: HTMLInputElement | null,
  ): Promise<void> => {
    if (!fileList || fileList.length === 0) return;
    try {
      const pending = await readSkillFilesFromFileList(fileList);
      setPendingFiles(pending);
      setFilesError(null);
    } catch {
      setFilesError('Failed to read selected files');
    } finally {
      if (inputEl) inputEl.value = '';
    }
  };

  const handleCreate = (): void => {
    createMutation.mutate({
      slug: effectiveSlug,
      name: name.trim(),
      description: description.trim(),
      content: content.trim(),
      files: pendingFiles,
    });
  };

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className={cn('mx-auto flex w-full shrink-0 flex-col gap-1 px-6 pt-6', widthClass)}>
        <h1 className='text-2xl font-medium tracking-tight text-foreground'>Create skill</h1>
        <p className='text-sm text-muted-foreground'>
          A markdown playbook your agents can consult while working.
        </p>
      </div>

      <div className={cn('mx-auto w-full min-h-0 flex-1 overflow-y-auto px-6 py-6', widthClass)}>
        <div className='space-y-4'>
          <SectionCaption friendly='Identity' />
          <div className='grid grid-cols-12 gap-3'>
            <div className='col-span-7'>
              <label
                htmlFor='claw-skill-name'
                className='mb-1.5 block text-[12px] font-medium text-foreground/80'
              >
                Name
              </label>
              <input
                id='claw-skill-name'
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder='e.g. PR Review Guidelines'
                autoFocus
                data-track-category='Claw Agents'
                data-track-name='Skill name input'
                className='w-full rounded-lg border border-border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30'
              />
            </div>
            <div className='col-span-5'>
              <label
                htmlFor='claw-skill-slug'
                className='mb-1.5 flex items-center justify-between gap-2 text-[12px] font-medium text-foreground/80'
              >
                Slug
                <button
                  type='button'
                  onClick={() => setSlugManual(!slugManual)}
                  data-track-category='Claw Agents'
                  data-track-name='Toggle skill slug edit'
                  className='text-[11px] font-normal text-muted-foreground transition hover:text-foreground'
                >
                  {slugManual ? 'auto' : 'edit'}
                </button>
              </label>
              <input
                id='claw-skill-slug'
                value={effectiveSlug}
                onChange={e => {
                  setSlugManual(true);
                  setSlug(e.target.value);
                }}
                disabled={!slugManual}
                data-track-category='Claw Agents'
                data-track-name='Skill slug input'
                className='w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[13px] text-foreground/80 transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60'
              />
            </div>
          </div>

          <div>
            <label
              htmlFor='claw-skill-description'
              className='mb-1.5 block text-[12px] font-medium text-foreground/80'
            >
              Description
            </label>
            <input
              id='claw-skill-description'
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder='What this skill does and when agents should use it'
              data-track-category='Claw Agents'
              data-track-name='Skill description input'
              className='w-full rounded-lg border border-border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30'
            />
          </div>

          <div>
            <div className='mb-1.5 flex items-center justify-between'>
              <label
                htmlFor='claw-skill-content'
                className='text-[12px] font-medium text-foreground/80'
              >
                Content
              </label>
              <span className='text-[11px] text-muted-foreground'>{content.length} chars</span>
            </div>
            <textarea
              id='claw-skill-content'
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder='Markdown playbook the agent consults while working…'
              rows={14}
              data-track-category='Claw Agents'
              data-track-name='Skill content input'
              className={cn(codeField, 'min-h-[280px]')}
            />
          </div>

          <div>
            <span className='mb-1.5 block text-[12px] font-medium text-foreground/80'>
              Files <span className='font-normal text-muted-foreground'>(optional)</span>
            </span>
            <input
              ref={dirInputRef}
              type='file'
              multiple
              className='hidden'
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={e => void handlePick(e.target.files, dirInputRef.current)}
            />
            <input
              ref={fileInputRef}
              type='file'
              multiple
              className='hidden'
              onChange={e => void handlePick(e.target.files, fileInputRef.current)}
            />
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => dirInputRef.current?.click()}
                data-track-category='Claw Agents'
                data-track-name='PICK_SKILL_DIRECTORY'
              >
                <FolderOpen className='size-3.5' />
                Upload folder
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={() => fileInputRef.current?.click()}
                data-track-category='Claw Agents'
                data-track-name='PICK_SKILL_FILES'
              >
                <Upload className='size-3.5' />
                Upload files
              </Button>
              {pendingFiles.length > 0 && (
                <span className='text-xs text-muted-foreground'>
                  {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} attached
                </span>
              )}
            </div>
            {filesError && <p className='mt-1 text-[11px] text-destructive'>{filesError}</p>}
          </div>

          {createMutation.error && (
            <p className='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive'>
              {createMutation.error.message}
            </p>
          )}
        </div>
      </div>

      <div className='shrink-0 border-t border-border bg-background'>
        <div
          className={cn(
            'mx-auto flex w-full items-center justify-between gap-3 px-6 py-4',
            widthClass,
          )}
        >
          <Button
            variant='ghost'
            onClick={cancel}
            data-track-category='Claw Agents'
            data-track-name='CANCEL_CREATE_SKILL'
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            data-track-category='Claw Agents'
            data-track-name='CREATE_SKILL'
            loading={createMutation.isPending}
            disabled={!canCreate}
          >
            {!createMutation.isPending && <Check className='size-4' />}
            Create skill
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ClawSkillCreateScreen;
