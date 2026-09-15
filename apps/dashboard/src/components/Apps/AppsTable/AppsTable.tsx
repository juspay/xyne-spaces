import { ReactElement, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('common');
  const user = useUser(userId);
  return (
    <span className='text-foreground'>
      {user?.name || orgName || t('apps.appsTable.createdByUnknown')}
    </span>
  );
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
}: AppsTableProps): ReactElement => {
  const { t } = useTranslation('common');
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
  // - Org/Marketplace view: editing the app template -> creator only (matches AppsACL.canUpdate).
  const canEditApp = (app: AppRow): boolean => {
    if (appAccessLevel === 'READ' || appAccessLevel === null) return false;
    if (isInstalledView) return hasAdminAccess || app.createdBy === currentUserId;
    return app.createdBy === currentUserId;
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
      toast.error(t('apps.appsTable.toasts.jwtNotAvailable'));
      return;
    }
    try {
      const jwtToken = await onGetJwtToken(appId);
      await copyTextToClipboard(jwtToken);
      toast.success(t('apps.appsTable.toasts.tokenCopied'));
    } catch (error) {
      toast.error(t('apps.appsTable.toasts.jwtCopyFailed'), {
        description:
          error instanceof Error ? error.message : t('apps.appsTable.toasts.unknownError'),
      });
    }
  };

  const handleCopyBotUserId = async (app: AppRow) => {
    const botUserId = getBotUserId(app);
    if (!botUserId) {
      toast.error(t('apps.appsTable.toasts.noBotUserId'));
      return;
    }
    try {
      await copyTextToClipboard(botUserId);
      toast.success(t('apps.appsTable.toasts.botUserIdCopied'));
    } catch (error) {
      toast.error(t('apps.appsTable.toasts.botUserIdCopyFailed'), {
        description:
          error instanceof Error ? error.message : t('apps.appsTable.toasts.unknownError'),
      });
    }
  };

  const handleCopySigningSecret = async (appId: string) => {
    if (!onGetSigningSecret) {
      toast.error(t('apps.appsTable.toasts.signingSecretNotAvailable'));
      return;
    }
    try {
      const signingSecret = await onGetSigningSecret(appId);
      await copyTextToClipboard(signingSecret);
      toast.success(t('apps.appsTable.toasts.signingSecretCopied'));
    } catch (error) {
      toast.error(t('apps.appsTable.toasts.signingSecretCopyFailed'), {
        description:
          error instanceof Error ? error.message : t('apps.appsTable.toasts.unknownError'),
      });
    }
  };

  // Get status from installations
  const columns: ColumnDef<AppRow>[] = [
    {
      field: 'name',
      header: t('apps.appsTable.columns.app'),
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
                title={t('apps.appsTable.copyBotUserId')}
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
      header: t('apps.appsTable.columns.description'),
      renderCell: (_value, app) => (
        <span className='text-muted-foreground truncate max-w-xs block'>
          {app.description || '-'}
        </span>
      ),
    },
    {
      field: 'webhookUrl',
      header: t('apps.appsTable.columns.webhookUrl'),
      renderCell: (_value, app) => {
        const webhookUrl = getWebhookUrl(app);
        return (
          <span className='text-muted-foreground truncate max-w-xs block'>{webhookUrl || '-'}</span>
        );
      },
    },
    {
      field: 'createdBy',
      header: t('apps.appsTable.columns.createdBy'),
      renderCell: (_value, app) => (
        <CreatedByCell
          userId={app.createdBy}
          orgName={app.orgId ? orgNamesById[app.orgId] : undefined}
        />
      ),
    },
    {
      field: 'status',
      header: t('apps.appsTable.columns.status'),
      renderCell: (_value, app) => {
        const status = getStatus(app);
        const statusClass =
          status === 'Installed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
        const statusLabel =
          status === 'Installed'
            ? t('apps.appsTable.statusInstalled')
            : status === 'Available'
              ? t('apps.appsTable.statusAvailable')
              : status;
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass}`}>
            {statusLabel}
          </span>
        );
      },
    },
    {
      field: 'jwtToken',
      header: t('apps.appsTable.columns.jwtToken'),
      renderCell: (_value, app) => {
        const status = getStatus(app);
        const isInstalled = status === 'Installed';
        const canCopy = hasAdminAccess || app.createdBy === currentUserId;

        if (!isInstalled) {
          return (
            <span className='text-muted-foreground text-xs'>
              {t('apps.appsTable.installAppFirst')}
            </span>
          );
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
                canCopy
                  ? t('apps.appsTable.copyJwtToClipboard')
                  : t('apps.appsTable.noPermissionCopyToken')
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
      header: t('apps.appsTable.columns.signingSecret'),
      renderCell: (_value, app) => {
        // Signing secret is app-level — visible/copyable regardless of install state (creator/admin only).
        const canCopy = hasAdminAccess || app.createdBy === currentUserId;

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
                  ? t('apps.appsTable.copySigningSecretToClipboard')
                  : t('apps.appsTable.onlyAdminOrCreatorCopySecret')
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
    header: t('apps.appsTable.columns.actions'),
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
              isDisabledEdit
                ? t('apps.appsTable.onlyCreatorOrAdminEdit')
                : t('apps.appsTable.editAppTitle')
            }
            data-track-category='Apps'
            data-track-name='OpenEditAppModal'
          >
            <Pencil size={14} />
            {t('apps.appsTable.editButton')}
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
              {isInstalling ? t('apps.appsTable.installing') : t('apps.appsTable.install')}
            </Button>
          )}
          {hasAdminAccess && showUpdate && (
            <Button
              variant='outline'
              size='sm'
              disabled={isInstalling}
              onClick={() => onReinstall(app.id)}
              className='gap-1 h-8'
              title={t('apps.appsTable.updateTooltip')}
              data-track-category='Apps'
              data-track-name='UpdateApp'
            >
              <RefreshCw size={14} />
              {isInstalling ? t('apps.appsTable.updating') : t('apps.appsTable.update')}
            </Button>
          )}
          {onPromote && canPromote && (
            <Button
              variant='outline'
              size='sm'
              disabled={isPromoting}
              onClick={() => onPromote(app.id)}
              className='gap-1 h-8'
              title={t('apps.appsTable.promoteTooltip')}
              data-track-category='Apps'
              data-track-name='PromoteApp'
            >
              <Globe size={14} />
              {isPromoting ? t('apps.appsTable.promoting') : t('apps.appsTable.promote')}
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
        emptyState={
          <div className='text-center py-8 text-muted-foreground'>
            {t('apps.appsTable.noAppsFound')}
          </div>
        }
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
          title={t('apps.appsTable.editAppDialogTitle', { name: editingApp.name })}
          description={t('apps.appsTable.editAppDialogDescription')}
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
