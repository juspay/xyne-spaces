import type { AccessType } from '@xyne/shared';
import { resourceAccess } from '@/framework/dashboardAccess';

/** The dashboard login plus access to the XYNE-APPS resource at `level` (the dashboard side of /apps). */
export const xyneApps = (level: AccessType) => ({ xyneApps: resourceAccess('XYNE-APPS', level) });
