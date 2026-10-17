import { SYSTEM_USER_ID } from '@/database/tenant/context';
import { installApp } from '@/apps/core/appUtils';
import { asService } from './base';

/**
 * Wraps appUtils' installApp for the S2S route: org eligibility is checked by the caller,
 * same gate as AppController.installApp. Lives OUTSIDE appServices: appUtils imports
 * appServices, so the wrapper static-importing appUtils would close a module cycle (and
 * `await import()` in a tenant context breaks AsyncLocalStorage under tsx).
 */
export function installOrgAppForWorkspace(appId: string, workspaceId: string) {
  return asService(
    ['Apps', 'InstalledApps', 'AppPermission', 'InstalledAppPermission', 'AppCommand', 'InstalledAppCommand', 'User', 'OrgMember', 'Workspace'],
    'S2S app install into the caller-named workspace; org eligibility checked by the caller',
    SYSTEM_USER_ID,
    workspaceId,
    () => installApp(appId, workspaceId),
  );
}
