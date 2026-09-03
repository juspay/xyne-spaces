import React, { createContext, useContext, useMemo } from 'react';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUserGroupMappings } from '../../../hooks/useUserGroup';
import { IngestionStatus } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { CollectionRole, CollectionSummary } from '../../../services/Knowledge/collectionService';

const ROLE_RANK: Record<CollectionRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

// Lists every collection the caller can read across the whole workspace, in
// a single Zero subscription. `scopedCollectionsWithItems` already treats
// scopeType/scopeId as optional — omitting both returns every root
// collection the Zero ACL allows (owner, explicit permission, or public),
// regardless of channel scope or membership. Channel/project labels are then
// resolved client-side per row (best-effort — a public collection scoped to
// a channel the current user isn't a member of has no name/project to show).

export interface GlobalCollection extends CollectionSummary {
  scopeType: string;
  scopeId: string;
  /** projectId of the owning channel, when known (CHANNEL-scoped rows whose
   *  channel is in the current user's visible-channel list only). */
  projectId: string | null;
  isPrivate: boolean;
  /** Total number of (latest, non-deleted) files across the whole collection. */
  fileTotal: number;
  /** How many of those files have finished ingesting (COMPLETED/NONE). */
  fileIngested: number;
  /** How many files failed ingestion. */
  fileFailed: number;
  /** Collection-level rollup used for the root ingestion spinner: FAILED when
   *  any file failed, PROCESSING while any file is still ingesting, else null. */
  ingestionStatus: IngestionStatus | null;
}

interface GlobalCollectionsContextValue {
  collections: GlobalCollection[];
  isLoading: boolean;
  /** Look up a collection by id without scanning the list. */
  byId: (id: string) => GlobalCollection | undefined;
}

const GlobalCollectionsContext = createContext<GlobalCollectionsContextValue | null>(null);

export const GlobalCollectionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const channels = useAllVisibleChannels();
  const userGroupMappings = useUserGroupMappings();
  const userGroupIds = useMemo(
    () => new Set(userGroupMappings.map(m => m.userGroupId)),
    [userGroupMappings],
  );
  const channelById = useMemo(() => {
    const m = new Map<string, { name: string; projectId: string | null }>();
    for (const ch of channels) {
      m.set(ch.id, { name: ch.name, projectId: ch.projectId ?? null });
    }
    return m;
  }, [channels]);

  const enabled = !!user;
  const [zeroCollections, { type: queryType }] = useCachedQuery(
    queries.scopedCollectionsWithItems({}),
    { enabled },
  );
  const isLoading = enabled && queryType !== 'complete';

  const collections: GlobalCollection[] = useMemo(() => {
    if (!zeroCollections || !user) return [];
    return zeroCollections.map(col => {
      // Pick the highest role among any matching row — a direct grant, or a
      // grant on a group this user belongs to. Without the group branch, a
      // group-granted EDITOR shows as VIEWER here (write buttons hidden)
      // even though the server mutators (resolveCollectionPermissionRole)
      // would allow the write — client/server role mismatch.
      let perm: NonNullable<typeof col.permissions>[number] | undefined;
      for (const p of col.permissions ?? []) {
        const matches =
          p.userId === user.id || (p.userGroupId !== null && userGroupIds.has(p.userGroupId));
        if (!matches) continue;
        if (!perm || ROLE_RANK[p.role as CollectionRole] > ROLE_RANK[perm.role as CollectionRole]) {
          perm = p;
        }
      }
      const isOwner = col.ownerId === user.id;
      // Public collections are read-only by default — EDITOR only comes
      // from an explicit CollectionPermission row (`perm` below).
      const defaultRole = isOwner ? 'OWNER' : 'VIEWER';

      const channelMeta = col.scopeType === 'CHANNEL' ? channelById.get(col.scopeId) : undefined;

      // Roll the collection's files up into an ingestion summary. Normalize
      // casing the same way IngestStatusV2 does so status never slips through.
      const items = col.allItems ?? [];
      const fileTotal = items.length;
      let fileFailed = 0;
      let filePending = 0;
      let fileProcessing = 0;
      for (const it of items) {
        const s = (it.ingestionStatus ?? '').toUpperCase() as IngestionStatus;
        if (s === IngestionStatus.FAILED) fileFailed += 1;
        else if (s === IngestionStatus.PROCESSING) fileProcessing += 1;
        else if (s === IngestionStatus.PENDING) filePending += 1;
      }
      const fileIngested = fileTotal - fileFailed - fileProcessing - filePending;
      // Loader colour: blue as soon as any file is actively PROCESSING; grey
      // while everything in-flight is still only queued (PENDING); red alert
      // when nothing is in-flight but something failed; nothing when settled.
      const ingestionStatus =
        fileProcessing > 0
          ? IngestionStatus.PROCESSING
          : filePending > 0
            ? IngestionStatus.PENDING
            : fileFailed > 0
              ? IngestionStatus.FAILED
              : null;

      return {
        id: col.id,
        name: col.name,
        description: col.description ?? null,
        ownerId: col.ownerId,
        role: (perm?.role ?? defaultRole) as CollectionRole,
        canShare: perm?.canShare ?? isOwner,
        scopeType: col.scopeType,
        scopeId: col.scopeId,
        projectId: channelMeta?.projectId ?? null,
        isPrivate: col.isPrivate ?? false,
        fileTotal,
        fileIngested,
        fileFailed,
        ingestionStatus,
      };
    });
  }, [zeroCollections, user, channelById, userGroupIds]);

  const value: GlobalCollectionsContextValue = useMemo(() => {
    const sorted = [...collections].sort((a, b) => a.name.localeCompare(b.name));
    const idIndex = new Map(sorted.map(c => [c.id, c]));
    return {
      collections: sorted,
      isLoading,
      byId: (id: string): GlobalCollection | undefined => idIndex.get(id),
    };
  }, [collections, isLoading]);

  return (
    <GlobalCollectionsContext.Provider value={value}>{children}</GlobalCollectionsContext.Provider>
  );
};

export function useGlobalCollections(): GlobalCollectionsContextValue {
  const ctx = useContext(GlobalCollectionsContext);
  if (!ctx) {
    throw new Error('useGlobalCollections must be used inside <GlobalCollectionsProvider>');
  }
  return ctx;
}
