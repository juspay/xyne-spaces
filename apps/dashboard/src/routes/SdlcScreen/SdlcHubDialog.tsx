import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { FolderKanban, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CHANNEL_NAME_MAX_LENGTH, normalizeChannelName, validateChannelName } from '@xyne/shared';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import Input from '../../components/ui/Input';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';
import { sdlcErrorMessage } from './SdlcRegisterRepositoryForm';

interface SdlcHubDialogProps {
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (channelId: string) => void;
}

/** Create a hub. Repositories are added afterwards from the hub sidebar. */
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
        className='p-6'
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className='text-lg font-semibold tracking-tight'>New hub</h2>
        <p className='mt-1.5 text-sm leading-6 text-muted-foreground'>
          A private workspace for a project. Add repositories from the sidebar. It never appears in
          Chat.
        </p>

        <div className='mt-6 space-y-5'>
          <div>
            <p className='mb-2 text-sm font-medium'>
              Project <span className='text-destructive'>*</span>
            </p>
            <EntitySelector
              options={projectOptions}
              selectedValue={activeProjectId}
              onSelect={setPickedProjectId}
              placeholder={
                projectRows === undefined
                  ? 'Loading projects…'
                  : projectOptions.length === 0
                    ? 'No projects available'
                    : 'Select a project'
              }
              searchPlaceholder='Search projects...'
              width='100%'
              matchTriggerWidth
            />
          </div>

          <div>
            <label htmlFor='sdlc-hub-name' className='block text-sm font-medium'>
              Name <span className='text-destructive'>*</span>
            </label>
            <Input
              id='sdlc-hub-name'
              autoFocus
              value={name}
              onChange={event => setName(normalizeChannelName(event.target.value))}
              maxLength={CHANNEL_NAME_MAX_LENGTH}
              aria-invalid={nameError !== null}
              className='mt-2 h-10'
              placeholder='e.g. payments-platform'
            />
            {nameError && <p className='mt-1.5 text-sm text-destructive'>{nameError}</p>}
          </div>
        </div>

        <div className='mt-7 flex justify-end gap-2'>
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
