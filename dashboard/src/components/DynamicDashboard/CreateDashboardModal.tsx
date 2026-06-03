import { ReactElement, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { DashboardVisibility } from '@xyne/shared';
import { useCachedQuery } from '@xyne/shared/hooks';
import { useZero } from '../../hooks/useZero';
import { useAuth } from '../../hooks/useAuth';
import { mutators } from '../../zero/mutators';
import { queries } from '../../zero/queries';
import { Button } from '../ui/Button';
import Input from '../ui/Input';
import { Textarea } from '../ui/Textarea';

const DASHBOARD_NAME_LOOKUP_LIMIT = 500;

interface CreateDashboardModalProps {
  onClose: () => void;
}

export const CreateDashboardModal = ({ onClose }: CreateDashboardModalProps): ReactElement => {
  const { user } = useAuth();
  const z = useZero();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<DashboardVisibility>(DashboardVisibility.PRIVATE);
  const [isCreating, setIsCreating] = useState(false);

  const [existingDashboards] = useCachedQuery(
    queries.allDashboards({ limit: DASHBOARD_NAME_LOOKUP_LIMIT }),
  );

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !user?.id || !user?.workspaceId) return;
    const nameClash = (existingDashboards ?? []).some(
      d => d.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (nameClash) {
      toast.error('A dashboard with that name already exists');
      return;
    }
    setIsCreating(true);
    const newId = uuidv4();
    try {
      const result = z.mutate(
        mutators.dashboard.create({
          id: newId,
          workspaceId: user.workspaceId,
          name: trimmed,
          description: description.trim() || undefined,
          visibility,
          timestamp: Date.now(),
          participantId: uuidv4(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Failed to create dashboard', {
          description: res.error instanceof Error ? res.error.message : 'Unknown error',
        });
        return;
      }
      toast.success('Dashboard created');
      void navigate(`/${user.workspaceId}/dashboards/${newId}`);
      onClose();
    } catch (err) {
      toast.error('Failed to create dashboard', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsCreating(false);
    }
  }, [z, user, name, description, visibility, existingDashboards, navigate, onClose]);

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
    [],
  );
  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value),
    [],
  );
  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && name.trim() && !isCreating) {
        e.preventDefault();
        void handleCreate();
      }
    },
    [name, isCreating, handleCreate],
  );

  const handleCreateClick = useCallback(() => {
    void handleCreate();
  }, [handleCreate]);

  return (
    <div className='p-6 w-[420px]'>
      <h2 className='text-lg font-semibold text-foreground mb-1'>Create dashboard</h2>
      <p className='text-sm text-muted-foreground mb-4'>
        Start blank, then add components — or hop into the AI composer to draft one from a
        natural-language prompt.
      </p>
      <div className='space-y-3'>
        <div>
          <label
            htmlFor='create-dash-name'
            className='block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5'
          >
            Name <span className='text-rose-500'>*</span>
          </label>
          <Input
            id='create-dash-name'
            value={name}
            onChange={handleNameChange}
            placeholder='e.g. Q4 sales overview'
            autoFocus
            onKeyDown={handleNameKeyDown}
          />
        </div>
        <div>
          <label
            htmlFor='create-dash-description'
            className='block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5'
          >
            Description
          </label>
          <Textarea
            id='create-dash-description'
            value={description}
            onChange={handleDescriptionChange}
            placeholder='Optional. One line describing the dashboard.'
            rows={2}
          />
        </div>
        <div>
          <div className='block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5'>
            Visibility
          </div>
          <div className='flex items-center gap-2'>
            {(
              [
                {
                  value: DashboardVisibility.PRIVATE,
                  label: 'Private',
                  hint: 'Only you and people you invite',
                },
                {
                  value: DashboardVisibility.PUBLIC,
                  label: 'Public',
                  hint: 'Anyone in the workspace can view',
                },
              ] as const
            ).map(opt => {
              const isActive = visibility === opt.value;
              return (
                <button
                  key={opt.value}
                  type='button'
                  onClick={() => setVisibility(opt.value)}
                  className={`flex-1 text-left rounded-lg border px-3 py-2 transition-colors ${
                    isActive
                      ? 'border-foreground bg-muted/40'
                      : 'border-border hover:border-foreground/30'
                  }`}
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name={`Create_Visibility_${opt.label}`}
                >
                  <div className='text-sm font-medium text-foreground'>{opt.label}</div>
                  <div className='text-[11px] text-muted-foreground mt-0.5'>{opt.hint}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className='flex items-center justify-end gap-2 mt-5'>
        <Button variant='ghost' onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleCreateClick} disabled={!name.trim() || isCreating}>
          {isCreating ? (
            <Loader2 size={14} className='mr-1.5 animate-spin' />
          ) : (
            <Plus size={14} className='mr-1.5' />
          )}
          {isCreating ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  );
};

export default CreateDashboardModal;
