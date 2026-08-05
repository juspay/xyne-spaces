import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AtMark, PencilEditLine } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { useCreateClawSkill } from '@/hooks/useCreateClawSkill';
import type { PendingSkillFile } from '@/services/claw/clawSkillFileUtils';
import { AutoWidthInput } from '../create-v2/shared/AutoWidthInput';
import { slugify } from '../create/wizardState';
import { SkillFilesField } from './SkillFilesField';
import { readSkillPick } from './skillFilePick';

const LABEL = 'text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground';

const ClawSkillCreateV2 = (): ReactElement => {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';

  const { user } = useAuth();
  const builtBy = user?.name ?? user?.email ?? 'you';
  const create = useCreateClawSkill();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<PendingSkillFile[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);

  const effectiveSlug = slugManual ? slug : slugify(name);
  const canCreate = effectiveSlug.length > 0 && content.trim().length > 0;

  const handlePick = useCallback(
    async (fileList: FileList | null, input: HTMLInputElement | null): Promise<void> => {
      if (!fileList || fileList.length === 0) return;
      try {
        const pick = await readSkillPick(fileList);
        setFiles(pick.files);
        setFilesError(null);
        // A folder upload carries its own SKILL.md and folder name — fill the
        // empty fields from it rather than making the user retype them.
        if (pick.content !== null) setContent(prev => (prev.trim() ? prev : (pick.content ?? '')));
        if (pick.slug && !slugManual && !name.trim()) setName(pick.slug);
      } catch {
        setFilesError('Failed to read selected files');
      } finally {
        if (input) input.value = '';
      }
    },
    [name, slugManual],
  );

  const handleCreate = (): void => {
    if (!canCreate || create.isPending) return;
    create.mutate({
      slug: effectiveSlug,
      name: name.trim(),
      description: description.trim(),
      content: content.trim(),
      files,
    });
  };

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawSkillCreateV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 py-6'>
        <h1 className='text-2xl font-semibold leading-[1.2] tracking-[-0.24px] text-foreground'>
          Create skill
        </h1>

        <div className='flex w-full flex-col gap-4'>
          <div className='flex w-full items-start gap-4 py-4'>
            <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
              <div className='flex w-full items-center gap-2'>
                <AutoWidthInput
                  value={name}
                  onChange={next => {
                    setName(next);
                    if (!slugManual) setSlug(slugify(next));
                  }}
                  placeholder='Name your skill'
                  aria-label='Skill name'
                  autoFocus
                  data-track-category='Claw Agents'
                  data-track-name='Create skill v2: name'
                  className='text-base font-medium leading-6 tracking-[-0.1px] text-foreground placeholder:font-medium placeholder:text-muted-foreground'
                />
                <PencilEditLine className='size-3 shrink-0 text-muted-foreground' aria-hidden />
              </div>

              <div className='flex items-center gap-1.5'>
                <div className='flex items-center gap-0.5 rounded-[10px] bg-muted py-0.5 pl-0.5 pr-1'>
                  <AtMark className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                  <AutoWidthInput
                    value={effectiveSlug}
                    onChange={raw => {
                      const next = slugify(raw);
                      setSlugManual(next.length > 0);
                      setSlug(next);
                    }}
                    placeholder='skill-handle'
                    aria-label='Skill handle'
                    data-track-category='Claw Agents'
                    data-track-name='Create skill v2: handle'
                    className='text-sm font-medium leading-5 tracking-[-0.14px] text-foreground placeholder:font-medium placeholder:text-muted-foreground'
                  />
                </div>
              </div>

              <p className='flex items-center gap-1.5 text-sm leading-[1.5] text-foreground'>
                Built by
                <span className='text-[color:var(--mention-color)]'>@{builtBy}</span>
              </p>
            </div>
          </div>

          <div className='flex w-full flex-col gap-8'>
            <div className='flex w-full flex-col gap-3'>
              <label htmlFor='skill-v2-description' className={LABEL}>
                Description
              </label>
              <textarea
                id='skill-v2-description'
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder='What this skill covers and when agents should reach for it.'
                data-track-category='Claw Agents'
                data-track-name='Create skill v2: description'
                className='h-[86px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>

            <div className='flex w-full flex-col gap-3'>
              <label htmlFor='skill-v2-content' className={LABEL}>
                Instructions
              </label>
              <textarea
                id='skill-v2-content'
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder='The markdown playbook an agent reads while working…'
                data-track-category='Claw Agents'
                data-track-name='Create skill v2: content'
                className='h-[250px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
              <span className='self-end text-xs leading-4 text-muted-foreground'>
                {content.length} characters
              </span>
            </div>

            <SkillFilesField
              files={files}
              onPick={(fileList, input) => void handlePick(fileList, input)}
              onRemove={path => setFiles(prev => prev.filter(f => f.relativePath !== path))}
              error={filesError}
            />
          </div>
        </div>

        {create.error && <p className='text-sm text-destructive'>{create.error.message}</p>}

        <div className='flex w-full items-center justify-end gap-3'>
          <Button
            variant='ghost'
            onClick={() => void navigate(libraryPath)}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name='Create skill v2: cancel'
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            loading={create.isPending}
            disabled={!canCreate}
            className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
            data-track-category='Claw Agents'
            data-track-name='Create skill v2: create'
          >
            Create
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ClawSkillCreateV2;
