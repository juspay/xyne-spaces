import { ReactElement, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { useSelf } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { usePlatform } from '../../hooks/usePlatform';
import { WorkspaceChannelEmailCard } from '../../components/xyne-desk/WorkspaceChannelEmailCard/WorkspaceChannelEmailCard';

const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement => (
  <div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>
    {children}
  </div>
);

interface GeneralTabProps {
  isActive?: boolean;
}

export const GeneralTab = ({ isActive = false }: GeneralTabProps): ReactElement => {
  const self = useSelf();
  const z = useZero();
  const workspaceId = self?.workspaceId;

  // General settings state
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId || '' }), {
    enabled: !!workspaceId,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const { isMobile } = usePlatform();
  const workspaceNameInputRef = useRef<HTMLInputElement>(null);

  // Load workspace data when available
  useEffect(() => {
    if (workspace) {
      setName(workspace.name || '');
      setDescription(workspace.description || '');
      setHasChanges(false);
    }
  }, [workspace]);

  // Track changes
  useEffect(() => {
    if (workspace) {
      const nameChanged = name !== (workspace.name || '');
      const descChanged = description !== (workspace.description || '');
      setHasChanges(nameChanged || descChanged);
    }
  }, [name, description, workspace]);

  // The mailbox OAuth flow returns here with its outcome in the query string.
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  useEffect(() => {
    const connected = searchParams.get('channelEmailMailboxConnected');
    const errorMessage = searchParams.get('emailError');

    if (connected === 'true') {
      const provider = searchParams.get('provider') ?? 'Email';
      toast.success(
        `${provider.charAt(0).toUpperCase() + provider.slice(1)} channel email mailbox connected successfully`,
      );
      void queryClient.invalidateQueries({
        queryKey: ['workspace-channel-email-mailbox-status'],
      });
    } else if (errorMessage) {
      toast.error(errorMessage);
    }

    if (connected || errorMessage) {
      const next = new URLSearchParams(searchParams);
      next.delete('channelEmailMailboxConnected');
      next.delete('emailError');
      next.delete('provider');
      setSearchParams(next, { replace: true });
    }
  }, [queryClient, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isActive || isMobile) return;
    const rafId = requestAnimationFrame(() => {
      workspaceNameInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive, isMobile]);

  const handleSaveGeneral = (): void => {
    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }

    if (!name.trim()) {
      toast.error('Workspace name is required');
      return;
    }

    z.mutate(
      mutators.workspace.update({
        workspaceId,
        timestamp: Date.now(),
        updates: {
          name: name.trim(),
          description: description.trim() || undefined,
        },
      }),
    );
    toast.success('Workspace settings saved');
    setHasChanges(false);
  };

  return (
    <div className='space-y-6'>
      {/* General Settings Section */}
      <div className='space-y-4'>
        {/* Header */}
        <div>
          <h2 className='text-lg font-semibold text-foreground'>General Settings</h2>
          <p className='text-sm text-muted-foreground'>
            Manage your workspace name and description
          </p>
        </div>

        {/* Settings Form */}
        <Card className='p-6'>
          <div className='space-y-6'>
            {/* Workspace Name */}
            <div>
              <label
                htmlFor='workspace-name'
                className='block text-sm font-medium text-foreground mb-2'
              >
                Workspace Name <span className='text-destructive'>*</span>
              </label>
              <Input
                ref={workspaceNameInputRef}
                id='workspace-name'
                type='text'
                placeholder='Enter workspace name...'
                value={name}
                onChange={e => setName(e.target.value)}
                className='w-full max-w-lg'
              />
              <p className='text-xs text-muted-foreground mt-1.5'>
                This is the name that will be displayed to all workspace members.
              </p>
            </div>

            {/* Workspace Description */}
            <div>
              <label
                htmlFor='workspace-description'
                className='block text-sm font-medium text-foreground mb-2'
              >
                Description
              </label>
              <textarea
                id='workspace-description'
                placeholder='Enter workspace description...'
                value={description}
                onChange={e => setDescription(e.target.value)}
                data-track-category='workspace-management'
                data-track-name='edit-workspace-description'
                rows={4}
                className={cn(
                  'w-full max-w-lg px-3 py-2 rounded-md border border-input bg-background',
                  'text-sm text-foreground placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring',
                  'resize-none',
                )}
              />
              <p className='text-xs text-muted-foreground mt-1.5'>
                A brief description of your workspace and its purpose.
              </p>
            </div>

            {/* Save Button */}
            <div className='flex items-center gap-4 pt-2'>
              <Button
                onClick={() => void handleSaveGeneral()}
                data-track-category='workspace-management'
                data-track-name='SAVE_WORKSPACE_GENERAL'
                disabled={!hasChanges || !name.trim()}
                className='gap-2'
              >
                <Save className='w-4 h-4' />
                Save Changes
              </Button>
              {hasChanges && (
                <span className='text-sm text-amber-600'>You have unsaved changes</span>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className='space-y-4'>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Email alerts to channel</h2>
          <p className='text-sm text-muted-foreground'>
            Connect the workspace mailbox used to route inbound email alerts into channels.
          </p>
        </div>
        <WorkspaceChannelEmailCard />
      </div>
    </div>
  );
};

export default GeneralTab;
