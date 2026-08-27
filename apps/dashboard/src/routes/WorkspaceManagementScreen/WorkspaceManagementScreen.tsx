import { ReactElement, useEffect, useState } from 'react';
import { Settings, Mail, ChevronLeft, UserCheck, GitBranch, LayoutGrid } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { GeneralAndMembersTab } from './GeneralAndMembersTab';
import { InvitationsTab } from './InvitationsTab';
import { GuestUsersTab } from './GuestUsersTab';
import { RepositoryCredentialsTab } from './RepositoryCredentialsTab';
import { ToolbarTab } from './ToolbarTab';
import * as Tabs from '@radix-ui/react-tabs';

export const WorkspaceManagementScreen = (): ReactElement => {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(
    searchParams.get('tab') === 'repository-credentials' ? 'repository-credentials' : 'general',
  );
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

  const handleBack = (): void => {
    void navigate(workspaceId ? `/${workspaceId}/chat/dir` : '/');
  };

  return (
    <div data-testid='workspace-management-page' className='h-full bg-muted flex flex-col'>
      {/* Header */}
      <div className='flex items-center gap-4 px-6 py-4 bg-card border-b border-border'>
        <Button
          variant='ghost'
          size='sm'
          onClick={handleBack}
          data-track-category='workspace-management'
          data-track-name='BACK_FROM_WORKSPACE_MANAGEMENT'
          className='gap-2'
        >
          <ChevronLeft className='w-4 h-4' />
          Back
        </Button>
        <div className='flex-1'>
          <h1 className='text-xl font-semibold text-foreground'>Workspace Management</h1>
          <p className='text-sm text-muted-foreground'>
            Manage your workspace settings and members
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className='border-b border-border bg-card'>
        <div className='max-w-7xl mx-auto px-6'>
          <Tabs.Root value={activeTab} onValueChange={setActiveTab} className='w-full'>
            <Tabs.List className='flex gap-0 -mb-px'>
              <TabTrigger value='general' icon={Settings} label='General & Members' />
              <TabTrigger
                value='repository-credentials'
                icon={GitBranch}
                label='Repository credentials'
              />
              <TabTrigger value='invitations' icon={Mail} label='Invitations' />
              <TabTrigger value='guests' icon={UserCheck} label='Guest Users' />
              <TabTrigger value='toolbar' icon={LayoutGrid} label='Toolbar' />
            </Tabs.List>
          </Tabs.Root>
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-hidden bg-muted'>
        <div className='h-full max-w-7xl mx-auto w-full'>
          <Tabs.Root value={activeTab} onValueChange={setActiveTab} className='h-full'>
            <div className='h-full overflow-y-auto p-6'>
              <Tabs.Content value='general' className='outline-none h-full'>
                <GeneralAndMembersTab isActive={activeTab === 'general'} />
              </Tabs.Content>
              <Tabs.Content value='invitations' className='outline-none h-full'>
                <InvitationsTab isActive={activeTab === 'invitations'} />
              </Tabs.Content>
              <Tabs.Content value='repository-credentials' className='outline-none h-full'>
                <RepositoryCredentialsTab isActive={activeTab === 'repository-credentials'} />
              </Tabs.Content>
              <Tabs.Content value='guests' className='outline-none h-full'>
                <GuestUsersTab isActive={activeTab === 'guests'} />
              </Tabs.Content>
              <Tabs.Content value='toolbar' className='outline-none h-full'>
                <ToolbarTab isActive={activeTab === 'toolbar'} />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </div>
      </div>
    </div>
  );
};

const TabTrigger = ({
  value,
  icon: Icon,
  label,
}: {
  value: string;
  icon: React.ElementType;
  label: string;
}): ReactElement => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
      'text-muted-foreground border-transparent hover:text-foreground hover:border-muted',
      'data-[state=active]:text-primary data-[state=active]:border-primary',
    )}
  >
    <Icon className='w-4 h-4' />
    {label}
  </Tabs.Trigger>
);

export default WorkspaceManagementScreen;
