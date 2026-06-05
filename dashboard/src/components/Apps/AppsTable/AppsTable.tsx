import { ReactElement, useMemo, useState } from 'react';
import { Table } from '../../ui/Table/Table';
import { Button } from '../../ui/Button/Button';
import UserAvatar from '../../UserAvatar/UserAvatar';
import type { ColumnDef } from '../../ui/Table/Table.types';
import type { InstalledApps } from '@xyne/shared';
import { Download, Pencil, Copy, RefreshCw } from 'lucide-react';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { toast } from 'sonner';
import { Dialog } from '../../ui/Dialog/Dialog';
import EditAppForm from '../EditAppForm/EditAppForm';
import { useUser } from '../../../hooks/useUsers';

interface AppRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  installations?: readonly InstalledApps[] | undefined;
  webhookUrl?: string;
  status?: string;
  actions?: unknown;
  jwtToken?: string;
}

const CreatedByCell = ({ userId }: { userId: string }): ReactElement => {
  const user = useUser(userId);
  return <span className='text-foreground'>{user?.name || 'Unknown'}</span>;
};

interface AppsTableProps {
  apps: AppRow[];
  currentUserId: string;
  onInstall: (appId: string) => void;
  onReinstall: (appId: string) => void;
  onUpdateApp?: (
    appId: string,
    data: { name?: string; description?: string; webhookUrl?: string },
  ) => Promise<void>;
  onGetJwtToken?: (appId: string) => Promise<string>;
  onGetSigningSecret?: (appId: string) => Promise<string>;
  onUploadPicture?: (appId: string, file: File) => Promise<void>;
  userPermissions: Array<{ resourceName: string; accessType: string }>;
  isInstalling?: boolean;
  isUpdatingApp?: boolean;
}

export const AppsTable = ({
  apps,
  currentUserId,
  onInstall,
  onReinstall,
  onUpdateApp,
  onGetJwtToken,
  onGetSigningSecret,
  onUploadPicture,
  userPermissions,
  isInstalling = false,
  isUpdatingApp = false,
}: AppsTableProps): ReactElement => {
  const appAccessLevel = useMemo(() => {
    const appPerms = userPermissions.filter(p => p.resourceName === 'XYNE-APPS');
    if (appPerms.some(p => p.accessType === 'ADMIN')) return 'ADMIN';
    if (appPerms.some(p => p.accessType === 'WRITE')) return 'WRITE';
    if (appPerms.some(p => p.accessType === 'READ')) return 'READ';
    return null;
  }, [userPermissions]);

  // Check if user has admin access
  const hasAdminAccess = appAccessLevel === 'ADMIN';

  // Check if user can edit a specific app (ADMIN or WRITE creator only, not READ)
  const canEditApp = (app: AppRow): boolean => {
    if (appAccessLevel === 'READ') return false;
    if (hasAdminAccess) return true;
    if (appAccessLevel === 'WRITE') return app.createdBy === currentUserId;
    return false;
  };

  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [editingApp, setEditingApp] = useState<AppRow | null>(null);

  const uploadPictureHandler = onUploadPicture as
    | ((appId: string, file: File) => Promise<void>)
    | undefined;

  const getStatus = (app: AppRow): string => {
    const installations = app.installations || [];
    return installations.length > 0 ? 'Installed' : 'Pending';
  };

  const getWebhookUrl = (app: AppRow): string => {
    const installations = app.installations || [];
    const firstInstallation = installations[0];
    return firstInstallation?.webhookUrl || '';
  };

  const getBotUserId = (app: AppRow): string | undefined => {
    const installations = app.installations || [];
    const firstInstallation = installations[0];
    return firstInstallation?.userId;
  };

  const handleStartEdit = (app: AppRow) => {
    setEditingApp(app);
    setEditingAppId(app.id);
  };

  const handleSaveEdit = async (data: { description: string; webhookUrl: string }) => {
    if (!editingApp) return;
    const updateData: { description?: string; webhookUrl?: string } = {};
    if (data.description) {
      updateData.description = data.description;
    }
    if (data.webhookUrl) {
      updateData.webhookUrl = data.webhookUrl;
    }
    await onUpdateApp?.(editingApp.id, updateData);
    setEditingAppId(null);
    setEditingApp(null);
  };

  const handleCopyToken = async (appId: string) => {
    if (!onGetJwtToken) {
      toast.error('JWT token generation not available');
      return;
    }
    try {
      const jwtToken = await onGetJwtToken(appId);
      await copyTextToClipboard(jwtToken);
      toast.success('Token copied to clipboard');
    } catch (error) {
      toast.error('Failed to generate and copy JWT', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleCopyBotUserId = async (app: AppRow) => {
    const botUserId = getBotUserId(app);
    if (!botUserId) {
      toast.error('No bot user ID available');
      return;
    }
    try {
      await copyTextToClipboard(botUserId);
      toast.success('Bot user ID copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy bot user ID', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleCopySigningSecret = async (appId: string) => {
    if (!onGetSigningSecret) {
      toast.error('Signing secret retrieval not available');
      return;
    }
    try {
      const signingSecret = await onGetSigningSecret(appId);
      await copyTextToClipboard(signingSecret);
      toast.success('Signing secret copied to clipboard');
    } catch (error) {
      toast.error('Failed to retrieve signing secret', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // Get status from installations
  const columns: ColumnDef<AppRow>[] = [
    {
      field: 'name',
      header: 'App',
      renderCell: (_value, app) => {
        const botUserId = getBotUserId(app);

        return (
          <div className='flex items-center gap-3'>
            <UserAvatar userId={botUserId ?? null} showActiveStatus={false} />
            <span className='font-medium text-foreground'>{app.name}</span>
            {botUserId && (
              <Button
                variant='ghost'
                size='sm'
                onClick={e => {
                  e.stopPropagation();
                  void handleCopyBotUserId(app);
                }}
                title='Copy bot user ID'
                className='h-6 w-6 p-0'
              >
                <Copy size={14} />
              </Button>
            )}
          </div>
        );
      },
    },
    {
      field: 'description',
      header: 'Description',
      renderCell: (_value, app) => (
        <span className='text-muted-foreground truncate max-w-xs block'>
          {app.description || '-'}
        </span>
      ),
    },
    {
      field: 'webhookUrl',
      header: 'Webhook URL',
      renderCell: (_value, app) => {
        const webhookUrl = getWebhookUrl(app);
        return (
          <span className='text-muted-foreground truncate max-w-xs block'>{webhookUrl || '-'}</span>
        );
      },
    },
    {
      field: 'createdBy',
      header: 'Created By',
      renderCell: (_value, app) => <CreatedByCell userId={app.createdBy} />,
    },
    {
      field: 'status',
      header: 'Status',
      renderCell: (_value, app) => {
        const status = getStatus(app);
        const statusClass =
          status === 'Installed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass}`}>
            {status}
          </span>
        );
      },
    },
    {
      field: 'jwtToken',
      header: 'JWT Token',
      renderCell: (_value, app) => {
        const status = getStatus(app);
        const isInstalled = status === 'Installed';
        const canCopy = hasAdminAccess || app.createdBy === currentUserId;

        if (!isInstalled) {
          return <span className='text-muted-foreground text-xs'>Install app first</span>;
        }

        return (
          <div className='flex items-center gap-2'>
            <code className='text-xs bg-muted px-2 py-1 rounded truncate max-w-[120px] font-mono'>
              ****
            </code>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void handleCopyToken(app.id)}
              disabled={!canCopy}
              className='h-6 w-6 p-0'
              title={
                canCopy ? 'Copy JWT to clipboard' : "You don't have permission to copy this token"
              }
            >
              <Copy size={14} />
            </Button>
          </div>
        );
      },
    },
    {
      field: 'signingSecret',
      header: 'Signing Secret',
      renderCell: (_value, app) => {
        const status = getStatus(app);
        const isInstalled = status === 'Installed';
        const canCopy = hasAdminAccess || app.createdBy === currentUserId;

        if (!isInstalled) {
          return <span className='text-muted-foreground text-xs'>Install app first</span>;
        }

        return (
          <div className='flex items-center gap-2'>
            <code className='text-xs bg-muted px-2 py-1 rounded truncate max-w-[120px] font-mono'>
              ****
            </code>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void handleCopySigningSecret(app.id)}
              disabled={!canCopy}
              className='h-6 w-6 p-0'
              title={
                canCopy
                  ? 'Copy signing secret to clipboard'
                  : 'Only admin or app creator can copy this secret'
              }
            >
              <Copy size={14} />
            </Button>
          </div>
        );
      },
    },
  ];

  // Add actions column for ADMIN or creator
  columns.push({
    field: 'actions',
    header: 'Actions',
    renderCell: (_value, app) => {
      const status = getStatus(app);
      const isInstalled = status === 'Installed';
      const canEdit = canEditApp(app);

      const isDisabledEdit = !canEdit;
      return (
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => handleStartEdit(app)}
            disabled={isDisabledEdit}
            className='gap-1 h-8'
            title={isDisabledEdit ? 'Only creator or admin can edit' : 'Edit app'}
            data-track-category='Apps'
            data-track-name='OpenEditAppModal'
          >
            <Pencil size={14} />
            Edit
          </Button>
          {hasAdminAccess && !isInstalled && (
            <Button
              variant='default'
              size='sm'
              disabled={isInstalling}
              onClick={() => onInstall(app.id)}
              className='gap-1 h-8'
              data-track-category='Apps'
              data-track-name='InstallApp'
            >
              <Download size={14} />
              {isInstalling ? 'Installing...' : 'Install'}
            </Button>
          )}
          {hasAdminAccess && isInstalled && (
            <Button
              variant='outline'
              size='sm'
              disabled={isInstalling}
              onClick={() => onReinstall(app.id)}
              className='gap-1 h-8'
              title='Regenerate JWT token (use after updating permissions)'
              data-track-category='Apps'
              data-track-name='ReinstallApp'
            >
              <RefreshCw size={14} />
              {isInstalling ? 'Reinstalling...' : 'Reinstall'}
            </Button>
          )}
        </div>
      );
    },
  });

  return (
    <>
      <Table
        data={apps}
        columns={columns}
        idField='id'
        variant='bordered'
        size='md'
        hoverable={true}
        serverSidePagination={true}
        emptyState={<div className='text-center py-8 text-muted-foreground'>No apps found</div>}
      />

      {editingApp && (
        <Dialog
          open={editingAppId !== null}
          onOpenChange={open => {
            if (!open) {
              setEditingAppId(null);
              setEditingApp(null);
            }
          }}
          title={`Edit App: ${editingApp.name}`}
          description='Update the app description and webhook URL'
          className='max-w-lg max-h-[85vh]'
        >
          <EditAppForm
            appId={editingApp.id}
            appName={editingApp.name}
            appDescription={editingApp.description}
            appInstallations={editingApp.installations}
            onSave={handleSaveEdit}
            onUploadPicture={uploadPictureHandler}
            isLoading={isUpdatingApp}
            onCancel={() => {
              setEditingAppId(null);
              setEditingApp(null);
            }}
          />
        </Dialog>
      )}
    </>
  );
};

export default AppsTable;
