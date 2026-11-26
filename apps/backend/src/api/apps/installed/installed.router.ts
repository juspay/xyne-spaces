import { api, AccessType } from '@xyne/shared';
import { router } from '@/framework/api';
import { activateInstalledPermissions, deleteFetchConfig, getFetchConfig, getInstalledPermissions, listAttachedResources, listInstalledCommands, setAttachedResources, setInstalledPermissions, updateInstalledApp } from './installed.controller';
import { xyneApps } from '@/api/apps/xyne-apps.access';

/** `/apps/installed`: an installed app, edited from the Installed screen (dashboard login + XYNE-APPS access), scoped to the caller's workspace. */
export const installedRouter = router(api.apps.installed, {}, (serve) => ({

  // Per-install edits (Installed screen, workspace admin), scoped to the caller's workspace.
  update: serve('update', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, body, user }) => updateInstalledApp({ params, body, user }),
  }),
  permissions: serve('permissions', {
    ...xyneApps(AccessType.READ),
    controller: ({ params, user }) => getInstalledPermissions({ params, user }),
  }),
  permissionsSet: serve('permissionsSet', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, body, user }) => setInstalledPermissions({ params, body, user }),
  }),
  permissionsActivate: serve('permissionsActivate', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, user }) => activateInstalledPermissions({ params, user }),
  }),
  commands: serve('commands', {
    ...xyneApps(AccessType.READ),
    controller: ({ params, query, user }) => listInstalledCommands({ params, query, user }),
  }),
  resources: serve('resources', {
    ...xyneApps(AccessType.READ),
    controller: ({ params, user }) => listAttachedResources({ params, user }),
  }),
  resourcesSet: serve('resourcesSet', {
    ...xyneApps(AccessType.ADMIN),
    controller: ({ params, body, user }) => setAttachedResources({ params, body, user }),
  }),
  fetchConfig: serve('fetchConfig', {
    ...xyneApps(AccessType.READ),
    controller: ({ params, user }) => getFetchConfig({ params, user }),
  }),
  fetchConfigDelete: serve('fetchConfigDelete', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, user }) => deleteFetchConfig({ params, user }),
  }),
}));
