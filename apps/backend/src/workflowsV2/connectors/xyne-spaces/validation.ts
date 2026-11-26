import { db } from '@/database/client';
import type { XyneCtx } from '../../types';
import { boardOptions, channelOptions } from './options';

/** The SDK's `ConfigIssue`, which it does not export. */
export interface ConfigIssue {
  readonly path?: string;
  readonly message: string;
}

/**
 * Save-time checks shared by the components: every id a config names must exist in the
 * author's workspace and, where the picker enforces it, be visible to the author.
 * Callers pass only what `ctx.known` holds, so a `{{ref}}` is skipped, never reported.
 */
export interface Scope {
  readonly attributes: { readonly workspaceId?: string | undefined };
  /** The SDK types it `unknown` on a registered component; it is the session's `XyneCtx`. */
  readonly caller: unknown;
}

/** What `validateConfig` receives, narrowed to the fields a component checks. */
export type Checked<TKnown> = Scope & { readonly known: Readonly<TKnown> };

type Ids = string | readonly string[] | undefined;

const idsOf = (value: Ids): string[] =>
  [value ?? []].flat().map((id) => id.trim()).filter(Boolean);

const query = (scope: Scope, values: string[]) => {
  const caller = scope.caller as XyneCtx;
  return {
    workspaceId: scope.attributes.workspaceId ?? caller.workspaceId,
    callerUserId: caller.userId,
    values,
  };
};

async function unseen(
  path: string,
  what: string,
  ids: string[],
  seen: Promise<ReadonlySet<string>>,
): Promise<ConfigIssue[]> {
  if (ids.length === 0) return [];
  const found = await seen;
  return ids.filter((id) => !found.has(id)).map((id) => ({ path, message: `${what} ${id} was not found in this workspace` }));
}

export function boardIssues(scope: Scope, path: string, value: Ids): Promise<ConfigIssue[]> {
  const ids = idsOf(value);
  return unseen(path, 'Board', ids, boardOptions(query(scope, ids)).then((page) => new Set(page.items.map((o) => o.value))));
}

export function channelIssues(scope: Scope, path: string, value: Ids): Promise<ConfigIssue[]> {
  const ids = idsOf(value);
  return unseen(path, 'Channel', ids, channelOptions(query(scope, ids)).then((page) => new Set(page.items.map((o) => o.value))));
}

export function projectIssues(scope: Scope, path: string, value: Ids): Promise<ConfigIssue[]> {
  const ids = idsOf(value);
  const { workspaceId } = query(scope, ids);
  return unseen(
    path,
    'Project',
    ids,
    db.project.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } }).then((rows) => new Set(rows.map((r) => r.id))),
  );
}

/** A ticket by id or by ID like PLAT-12. */
export function ticketIssues(scope: Scope, path: string, value: Ids): Promise<ConfigIssue[]> {
  const ids = idsOf(value);
  const { workspaceId } = query(scope, ids);
  return unseen(
    path,
    'Ticket',
    ids,
    db.ticket
      .findMany({
        where: { workspaceId, OR: [{ id: { in: ids } }, { xyneId: { in: ids } }] },
        select: { id: true, xyneId: true },
      })
      .then((rows) => new Set(rows.flatMap((r) => [r.id, r.xyneId]))),
  );
}

export function canvasIssues(scope: Scope, path: string, value: Ids): Promise<ConfigIssue[]> {
  const ids = idsOf(value);
  const { workspaceId } = query(scope, ids);
  return unseen(
    path,
    'Canvas',
    ids,
    db.canvas.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } }).then((rows) => new Set(rows.map((r) => r.id))),
  );
}

export function conversationIssues(scope: Scope, path: string, value: Ids): Promise<ConfigIssue[]> {
  const ids = idsOf(value);
  const { workspaceId } = query(scope, ids);
  return unseen(
    path,
    'Conversation',
    ids,
    db.conversation
      .findMany({ where: { conversationId: { in: ids }, channel: { workspaceId } }, select: { conversationId: true } })
      .then((rows) => new Set(rows.map((r) => r.conversationId))),
  );
}
