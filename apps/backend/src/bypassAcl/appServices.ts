import { repositories } from '@/database/repositories';
import { db } from '@/database/client';
import { asSystem, rawQuery } from './base';

/**
 * Relocated from apps/controllers/appController.ts's promoteApp. Promotion is authorised by org
 * ownership (checked by the caller before this runs), not by who created the app. The app row
 * carries its creating workspace's id, which for a sibling workspace in the same org is not the
 * caller's — so neither the creator predicate nor workspace scope would match it.
 */
export function promoteAppToGlobal(appId: string) {
  return asSystem(
    ['Apps'],
    'app row carries its creating workspace\'s id, not necessarily the caller\'s — org ownership is already checked by the caller',
    () => repositories.apps.update(appId, { scope: 'GLOBAL' }),
  );
}

/**
 * Relocated from apps/core/appUtils' installApp. The write is atomic (COALESCE) so concurrent
 * first-installs cannot generate competing secrets: only the first writer sets it and every
 * caller reads back the persisted (winning) value. Statement unchanged.
 */
export async function claimAppSigningSecret(appId: string, fresh: string) {
  return rawQuery(
    ['Apps'],
    'app install: atomic COALESCE claim of the per-app signing secret so concurrent first-installs cannot generate competing secrets',
    () => db.$queryRaw<{ signingSecret: string | null }[]>`
        UPDATE apps SET "signingSecret" = COALESCE("signingSecret", ${fresh})
        WHERE id = ${appId} RETURNING "signingSecret"`,
  );
}
