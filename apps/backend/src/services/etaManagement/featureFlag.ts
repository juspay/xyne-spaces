import { config } from '@/config/env';

/**
 * Deployment-level kill switch (env `ETA_MANAGEMENT_ENABLED`, default off).
 * When active, `evaluateEta` short-circuits to a no-op for every mutation
 * path and the hourly reconciliation worker skips its planning-risk branch
 * entirely - the single global rollback lever, no DB rollback required.
 */
export function isEtaManagementKillSwitchActive(): boolean {
  return !config.etaManagementEnabled;
}
