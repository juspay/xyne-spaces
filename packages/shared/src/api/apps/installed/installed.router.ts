import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsInstalledCommands, appsInstalledFetchConfig, appsInstalledFetchConfigDelete, appsInstalledPermissions, appsInstalledPermissionsActivate, appsInstalledPermissionsSet, appsInstalledResources, appsInstalledResourcesSet, appsInstalledUpdate } from './installed.contracts.js';

/** `/apps/installed`: an installed app (dashboard). Key order is the mount order. */
export const installedRouter = defineRouter('/installed', {
  update: appsInstalledUpdate,
  permissions: appsInstalledPermissions,
  permissionsSet: appsInstalledPermissionsSet,
  permissionsActivate: appsInstalledPermissionsActivate,
  commands: appsInstalledCommands,
  resources: appsInstalledResources,
  resourcesSet: appsInstalledResourcesSet,
  fetchConfig: appsInstalledFetchConfig,
  fetchConfigDelete: appsInstalledFetchConfigDelete,
});
