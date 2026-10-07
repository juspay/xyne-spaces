import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, FolderKanban, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CHANNEL_NAME_MAX_LENGTH, normalizeChannelName, validateChannelName } from '@xyne/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import Input from '../../components/ui/Input';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { apiInstance } from '../../services/clients/apiClient';
import { cn } from '../../utils/classNames';
import { queries } from '../../zero/queries';
import { sdlcErrorMessage } from './SdlcRegisterRepositoryForm';

interface SdlcHubDialogProps {
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (channelId: string) => void;
}

/** Create a hub. Repositories are added once it exists. */
export function SdlcHubDialog({
  projectId,
  open,
  onOpenChange,
  onSaved,
}: SdlcHubDialogProps): ReactElement {
  const [name, setName] = useState('');
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPickedProjectId(projectId ?? null);
  }, [open, projectId]);

  const [projectRows] = useCachedQuery(queries.getAllProjectsList(), { enabled: open });
  const projects = useMemo(
    () => (Array.isArray(projectRows) ? (projectRows as Array<{ id: string; name: string }>) : []),
    [projectRows],
  );
  // Seeded from the current hub's project, or the only one there is; still a picker, a
  // new hub need not live in the same project.
  const onlyProjectId = projects.length === 1 ? projects[0]!.id : null;
  const activeProjectId = pickedProjectId ?? onlyProjectId;
  const projectOptions = useMemo<SelectorOption[]>(
    () =>
      projects.map(project => ({
        value: project.id,
        label: project.name,
        icon: <FolderKanban className='size-4 text-muted-foreground' />,
      })),
    [projects],
  );
  const projectPlaceholder =
    projectRows === undefined
      ? 'Loading projects…'
      : projectOptions.length === 0
        ? 'No projects available'
        : 'Select a project';
  const nameError = name ? validateChannelName(name) : null;

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await apiInstance.post<{ channel: { id: string } }>('/sdlc/channels', {
        projectId: activeProjectId,
        name,
      });
      toast.success('Hub created');
      onSaved(response.data.channel.id);
      onOpenChange(false);
    } catch (error) {
      toast.error(sdlcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title='New hub'>
      <form
        className='flex flex-col'
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className='px-6 pt-6'>
          <h2 className='text-lg font-semibold tracking-tight'>New hub</h2>
          <p className='mt-1 text-sm leading-6 text-muted-foreground'>
            A private space for one project — its tracks, artifacts and tickets. It never appears in
            Chat.
          </p>
        </div>

        <div className='space-y-5 px-6 pb-6 pt-5'>
          <div>
            <label htmlFor='sdlc-hub-name' className='block text-sm font-medium'>
              Name
            </label>
            <Input
              id='sdlc-hub-name'
              autoFocus
              value={name}
              onChange={event => setName(normalizeChannelName(event.target.value))}
              maxLength={CHANNEL_NAME_MAX_LENGTH}
              aria-invalid={nameError !== null}
              aria-describedby='sdlc-hub-name-hint'
              className='mt-1.5 h-10'
              placeholder='payments-platform'
            />
            <p
              id='sdlc-hub-name-hint'
              className={cn(
                'mt-1.5 text-xs',
                nameError ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {nameError ?? 'Lowercase letters, numbers, - and _. Spaces become hyphens.'}
            </p>
          </div>

          <div>
            <p id='sdlc-hub-project-label' className='text-sm font-medium'>
              Project
            </p>
            <div className='mt-1.5'>
              <EntitySelector
                options={projectOptions}
                selectedValue={activeProjectId}
                onSelect={setPickedProjectId}
                placeholder={projectPlaceholder}
                searchPlaceholder='Search projects...'
                width='100%'
                matchTriggerWidth
                renderTrigger={({ selectedOption, open: pickerOpen }) => (
                  <button
                    type='button'
                    aria-labelledby='sdlc-hub-project-label'
                    className='flex h-10 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/10'
                    data-track-category='SdlcHub'
                    data-track-name='HubProjectPickerOpened'
                  >
                    <FolderKanban className='size-4 shrink-0 text-muted-foreground' />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        !selectedOption && 'text-muted-foreground',
                      )}
                    >
                      {selectedOption?.label ?? projectPlaceholder}
                    </span>
                    <ChevronDown
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        pickerOpen && 'rotate-180',
                      )}
                    />
                  </button>
                )}
              />
            </div>
          </div>
        </div>

        <div className='flex justify-end gap-2 border-t border-border px-6 py-3.5'>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            data-track-category='SdlcHub'
            data-track-name='HubDialogCancelled'
          >
            Cancel
          </Button>
          <Button
            type='submit'
            loading={busy}
            disabled={!name || nameError !== null || !activeProjectId}
            data-track-category='SdlcHub'
            data-track-name='HubCreated'
          >
            <Plus />
            Create hub
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
