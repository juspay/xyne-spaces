import { asSystem } from './base';
import { db } from '@/database/client';

/**
 * Slack desk source names are globally unique, but the tenant ACL hides other workspaces' rows.
 * Connecting a Slack channel must see those rows to reject a cross-workspace clash with a 409.
 */
export function findSlackDeskSourceWorkspace(name: string): Promise<{ workspaceId: string } | null> {
  return asSystem(
    ['ExternalSource'],
    'slack-desk connect: detect a Slack channel already bound in another workspace',
    () => db.externalSource.findUnique({ where: { name }, select: { workspaceId: true } }),
  );
}
