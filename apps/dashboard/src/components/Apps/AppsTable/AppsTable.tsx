import { ReactElement, useMemo, useState } from 'react';
import { Table } from '../../ui/Table/Table';
import { Button } from '../../ui/Button/Button';
import UserAvatar from '../../UserAvatar/UserAvatar';
import type { ColumnDef } from '../../ui/Table/Table.types';
import type { InstalledApps } from '@xyne/shared';
import { Download, Pencil, Copy, RefreshCw, Globe } from 'lucide-react';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { toast } from 'sonner';
import { Dialog } from '../../ui/Dialog/Dialog';
import EditAppForm from '../EditAppForm/EditAppForm';
import { useUser } from '../../../hooks/useUsers';
import { AccessType } from '@xyne/shared';
import type { UserPermission } from '../../../machines/stateMachine';

interface AppRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  orgId?: string;
  createdAt: number;
  updatedAt: number;
  version?: number;
  scope?: string;
  installations?: readonly InstalledApps[] | undefined;
  webhookUrl?: string;
  status?: string;
  actions?: unknown;
  jwtToken?: string;
}

// Apps are org-shared, so a creator in another workspace/org isn't synced locally. Show the
// resolved user name when available, else fall back to the app's origin org name, else Unknown.
const CreatedByCell = ({
  userId,
  orgName,
}: {
  userId: string;
  orgName?: string | undefined;
}): ReactElement => {
  const user = useUser(userId);
  return <span className='text-foreground'>{user?.name || orgName || 'Unknown'}</span>;
};

interface AppsTableProps {
  apps: AppRow[];
  currentUserId: string;
  onInstall: (appId: string) => void;
  onReinstall: (appId: string) => void;
  // Edit the app TEMPLATE (Org/Marketplace view, creator only).
  onUpdateApp?: (
    appId: string,
    data: { name?: string; description?: string; webhookUrl?: string },
  ) => Promise<void>;
  // Edit the caller's INSTALL (Installed view, workspace admin). Webhook only for now.
  onUpdateInstall?: (installedAppId: string, data: { webhookUrl?: string }) => Promise<void>;
  onGetJwtToken?: (appId: string) => Promise<string>;
  onGetSigningSecret?: (appId: string) => Promise<string>;
  onUploadPicture?: (appId: string, file: File) => Promise<void>;
  userPermissions: UserPermission[];
  isInstalling?: boolean;
  isUpdatingApp?: boolean;
  // Promote ORG -> GLOBAL (marketplace). Shown on org-view apps when the user is a XYNE-APPS admin.
  onPromote?: (appId: string) => void;
  canPromote?: boolean;
  isPromoting?: boolean;
  // Where row fields come from: 'install' = installed_apps (Installed view), 'app' = apps template (Org/Marketplace).
  dataSource?: 'app' | 'install';
  // For Org/Marketplace views: appId -> installed version in the caller's workspace. Used to
  // show Installed status and gate the Update button (app.version > installed version).
  installedVersionByAppId?: Record<string, number>;
  // appId's origin orgId -> org name, for "Created by" attribution on cross-workspace/org apps.
  orgNamesById?: Record<string, string>;
  // appId -> the caller's collaborator role ('ADMIN' | 'CONTRIBUTOR'). Collaborators may edit the
  // template like the creator; admins can also manage collaborators (from getMyAppCollaborations).
  myCollaborationsByAppId?: Record<string, string>;
}

export const AppsTable = ({
  apps,
  currentUserId,
  onInstall,
  onReinstall,
  onUpdateApp,
  onUpdateInstall,
  onGetJwtToken,
  onGetSigningSecret,
  onUploadPicture,
  userPermissions,
  isInstalling = false,
  isUpdatingApp = false,
  onPromote,
  canPromote = false,
  isPromoting = false,
  dataSource = 'app',
  installedVersionByAppId = {},
  orgNamesById = {},
  myCollaborationsByAppId = {},
}: AppsTableProps): ReactElement => {
  const isInstalledView = dataSource === 'install';
  const appAccessLevel = useMemo(() => {
    const appPerms = userPermissions.filter(p => p.resourceName === 'XYNE-APPS');
    if (appPerms.some(p => p.accessType === AccessType.ADMIN)) return 'ADMIN';
    if (appPerms.some(p => p.accessType === AccessType.WRITE)) return 'WRITE';
    if (appPerms.some(p => p.accessType === AccessType.READ)) return 'READ';
    return null;
  }, [userPermissions]);

  // Check if user has admin access
  const hasAdminAccess = appAccessLevel === 'ADMIN';

  // Who may OPEN the edit dialog, by screen:
  // - Installed view: any XYNE-APPS admin, plus the app's creator (webhooks only -- see below).
  // - Org/Marketplace view: editing the app template -> creator or a collaborator
  //   (matches AppsACL.canUpdate).
  const canEditApp = (app: AppRow): boolean => {
    if (appAccessLevel === 'READ' || appAccessLevel === null) return false;
    if (isInstalledView) return hasAdminAccess || app.createdBy === currentUserId;
    return app.createdBy === currentUserId || !!myCollaborationsByAppId[app.id];
  };

  const canEditInstallSettings = (): boolean => !isInstalledView || hasAdminAccess;

  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [editingApp, setEditingApp] = useState<AppRow | null>(null);

  const uploadPictureHandler = onUploadPicture as
    | ((appId: string, file: File) => Promise<void>)
    | undefined;

  // Installed version of this app in the caller's workspace, or undefined if not installed.
  // Installed view: the row IS the install. Org/Marketplace: look it up by appId.
  const getInstalledVersion = (app: AppRow): number | undefined => {
    // version is nullable (until backfilled) — normalize null to undefined.
    if (isInstalledView) return app.installations?.[0]?.version ?? undefined;
    return installedVersionByAppId[app.id];
  };

  const getStatus = (app: AppRow): string => {
    // Installed in my workspace -> 'Installed'; otherwise show the app's scope.
    if (getInstalledVersion(app) !== undefined) return 'Installed';
    return (app['scope'] as string) || 'Available';
  };

  // True when the creator has bumped the app template past the version I installed.
  const hasUpdate = (app: AppRow): boolean => {
    const installedVersion = getInstalledVersion(app);
    if (installedVersion === undefined) return false;
    const appVersion = (app.version as number) ?? 1;
    return appVersion > installedVersion;
  };

  const getWebhookUrl = (app: AppRow): string => {
    // Installed view -> the install's webhook copy; Org/Marketplace -> the app template webhook.
    if (isInstalledView) {
      return app.installations?.[0]?.webhookUrl || '';
    }
    return (app.webhookUrl as string) || '';
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
    if (isInstalledView) {
      // Installed screen: edit the install copy (webhook only; description is template-owned).
      const installedAppId = editingApp.installations?.[0]?.id;
      if (installedAppId) {
        await onUpdateInstall?.(installedAppId, { webhookUrl: data.webhookUrl });
      }
    } else {
      // Org/Marketplace screen: edit the app template.
      const updateData: { description?: string; webhookUrl?: string } = {};
      if (data.description) updateData.description = data.description;
      if (data.webhookUrl) updateData.webhookUrl = data.webhookUrl;
      await onUpdateApp?.(editingApp.id, updateData);
    }
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
                data-track-category='Apps'
                data-track-name='COPY_BOT_USER_ID'
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
      renderCell: (_value, app) => (
        <CreatedByCell
          userId={app.createdBy}
          orgName={app.orgId ? orgNamesById[app.orgId] : undefined}
        />
      ),
    },
    {
      field: 'status',
      header: 'Status',
      renderCell: (_value, app) => {
        const status = getStatus(app);
        const statusClass =
          status === 'Installed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
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
        const canCopy =
          hasAdminAccess || app.createdBy === currentUserId || !!myCollaborationsByAppId[app.id];

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
              data-track-category='Apps'
              data-track-name='COPY_APP_TOKEN'
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
        // Signing secret is app-level — visible/copyable regardless of install state
        // (creator, collaborator or admin only).
        const canCopy =
          hasAdminAccess || app.createdBy === currentUserId || !!myCollaborationsByAppId[app.id];

        return (
          <div className='flex items-center gap-2'>
            <code className='text-xs bg-muted px-2 py-1 rounded truncate max-w-[120px] font-mono'>
              ****
            </code>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void handleCopySigningSecret(app.id)}
              data-track-category='Apps'
              data-track-name='COPY_APP_SIGNING_SECRET'
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
      const isInstalled = getStatus(app) === 'Installed';
      const showUpdate = hasUpdate(app);
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
            title={
              isDisabledEdit ? 'Only the creator, a collaborator or admin can edit' : 'Edit app'
            }
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
          {hasAdminAccess && showUpdate && (
            <Button
              variant='outline'
              size='sm'
              disabled={isInstalling}
              onClick={() => onReinstall(app.id)}
              className='gap-1 h-8'
              title='Update to the latest app version (the creator changed commands or permissions)'
              data-track-category='Apps'
              data-track-name='UpdateApp'
            >
              <RefreshCw size={14} />
              {isInstalling ? 'Updating...' : 'Update'}
            </Button>
          )}
          {onPromote && canPromote && (
            <Button
              variant='outline'
              size='sm'
              disabled={isPromoting}
              onClick={() => onPromote(app.id)}
              className='gap-1 h-8'
              title='Promote to the cross-org marketplace (make this app global)'
              data-track-category='Apps'
              data-track-name='PromoteApp'
            >
              <Globe size={14} />
              {isPromoting ? 'Promoting...' : 'Promote'}
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
          className='max-w-3xl max-h-[85vh] overflow-hidden'
        >
          <EditAppForm
            appId={editingApp.id}
            appName={editingApp.name}
            appDescription={editingApp.description}
            appWebhookUrl={editingApp.webhookUrl ?? null}
            appInstallations={editingApp.installations}
            editMode={isInstalledView ? 'install' : 'template'}
            installedAppId={isInstalledView ? (editingApp.installations?.[0]?.id ?? null) : null}
            appCreatedBy={editingApp.createdBy}
            currentUserId={currentUserId}
            canEditInstallSettings={canEditInstallSettings()}
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
