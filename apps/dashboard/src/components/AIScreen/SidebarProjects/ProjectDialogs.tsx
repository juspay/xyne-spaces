import { useEffect, useState, type ReactElement } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button';
import { cn } from '../../../utils/classNames';
import { SectionEmojiPicker } from '../../Chat/SectionEmojiPicker';
import { useV2ChatProjects, useV2ChatProjectActions } from '../../../hooks/useAskAISessionsV2';
import type { ProjectDialogsProps } from './SidebarProjects.types';
import { DEFAULT_PROJECT_ICON, PROJECT_NAME_MAX_CHARS } from './SidebarProjects.utils';

export function ProjectDialogs({
  kind,
  project,
  onClose,
}: ProjectDialogsProps): ReactElement | null {
  const { createProject, updateProject, deleteProject } = useV2ChatProjectActions();
  const { projects } = useV2ChatProjects();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(DEFAULT_PROJECT_ICON);
  const [touched, setTouched] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!kind) return;
    setName(kind === 'create' ? '' : (project?.name ?? ''));
    setIcon(project?.icon ?? DEFAULT_PROJECT_ICON);
    setTouched(false);
  }, [kind, project]);

  if (!kind) return null;

  const close = (): void => {
    if (isBusy) return;
    onClose();
  };

  const run = async (action: () => Promise<unknown>, failure: string): Promise<void> => {
    setIsBusy(true);
    try {
      await action();
      onClose();
    } catch {
      toast.error(failure);
    } finally {
      setIsBusy(false);
    }
  };

  if (kind === 'delete') {
    const label = project?.name ?? 'this project';
    return (
      <Dialog
        open
        onOpenChange={open => {
          if (!open) close();
        }}
        title='Delete project?'
        description={`Delete "${label}"? Chats in this project will not be deleted.`}
        className='max-w-[420px] p-0'
        testId='delete-project-dialog'
      >
        <div>
          <DialogHeader
            title='Delete project?'
            onClose={close}
            trackName='CLOSE_DELETE_PROJECT_DIALOG'
          />
          <p className='px-5 pb-5 text-sm leading-relaxed text-foreground'>
            <span className='font-semibold'>{label}</span> will be deleted. Chats in this project
            will not be deleted; they will move back to All Chats.
          </p>
          <div className='flex justify-end gap-2 px-5 pb-4'>
            <Button
              variant='outline'
              onClick={close}
              disabled={isBusy}
              data-track-category='XyneAI'
              data-track-name='CANCEL_DELETE_PROJECT'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              loading={isBusy}
              onClick={() => {
                if (project) void run(() => deleteProject(project.id), 'Could not delete project');
              }}
              data-track-category='XyneAI'
              data-track-name='CONFIRM_DELETE_PROJECT'
              data-track-metadata={JSON.stringify({ surface: 'page', projectId: project?.id })}
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  const heading = kind === 'create' ? 'New project' : 'Rename project';
  const trimmed = name.trim();
  const nameError = !trimmed
    ? 'Project name is required'
    : trimmed.length > PROJECT_NAME_MAX_CHARS
      ? `Project name must be ${PROJECT_NAME_MAX_CHARS} characters or less`
      : projects.some(
            other =>
              other.id !== project?.id && other.name.trim().toLowerCase() === trimmed.toLowerCase(),
          )
        ? 'A project with this name already exists'
        : null;
  const showError = touched && Boolean(nameError);

  const submit = (): void => {
    if (nameError || isBusy) {
      setTouched(true);
      return;
    }
    if (kind === 'create') {
      void run(() => createProject({ name: trimmed, icon }), 'Could not create project');
      return;
    }
    if (!project) return;
    void run(() => updateProject(project.id, { name: trimmed, icon }), 'Could not save project');
  };

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
      title={heading}
      className='max-w-[420px] p-0'
      testId={`${kind}-project-dialog`}
    >
      <div>
        <DialogHeader title={heading} onClose={close} trackName='CLOSE_PROJECT_DIALOG' />
        <div className='space-y-4 px-5 pb-5'>
          <div className='space-y-1.5'>
            <label htmlFor='project-name' className='text-sm font-medium text-foreground'>
              Project name
            </label>
            <div
              className={cn(
                'flex items-center gap-1 rounded-md border bg-background px-2 transition-colors',
                showError
                  ? 'border-destructive'
                  : 'border-border focus-within:ring-2 focus-within:ring-ring',
              )}
            >
              <SectionEmojiPicker value={icon} onChange={setIcon} trackName='PROJECT_ICON' />
              <input
                id='project-name'
                value={name}
                maxLength={PROJECT_NAME_MAX_CHARS}
                autoFocus
                autoComplete='off'
                aria-invalid={showError}
                onChange={event => {
                  setName(event.target.value);
                  setTouched(true);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') submit();
                }}
                placeholder='Ex: Billing revamp'
                className='flex-1 border-0 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'
                data-track-category='XyneAI'
                data-track-name='EDIT_PROJECT_NAME'
              />
            </div>
            {showError && <p className='text-sm text-destructive'>{nameError}</p>}
          </div>
        </div>
        <div className='flex justify-end gap-2 px-5 pb-4'>
          <Button
            variant='outline'
            onClick={close}
            disabled={isBusy}
            data-track-category='XyneAI'
            data-track-name='CANCEL_PROJECT_DIALOG'
          >
            Cancel
          </Button>
          <Button
            loading={isBusy}
            disabled={Boolean(nameError)}
            onClick={submit}
            data-track-category='XyneAI'
            data-track-name={
              kind === 'create' ? 'CONFIRM_CREATE_PROJECT' : 'CONFIRM_UPDATE_PROJECT'
            }
          >
            {kind === 'create' ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DialogHeader({
  title,
  onClose,
  trackName,
}: {
  title: string;
  onClose: () => void;
  trackName: string;
}): ReactElement {
  return (
    <div className='flex items-start justify-between gap-3 px-5 py-4'>
      <h2 className='pr-2 text-base font-semibold leading-tight text-foreground'>{title}</h2>
      <button
        type='button'
        onClick={onClose}
        className='shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        aria-label='Close'
        data-track-category='XyneAI'
        data-track-name={trackName}
      >
        <X className='size-4' aria-hidden />
      </button>
    </div>
  );
}
