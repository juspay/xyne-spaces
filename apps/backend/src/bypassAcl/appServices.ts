import { repositories } from '@/database/repositories';
import { asSystem } from './base';

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
