import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { CollectionRole, CollectionSummary } from '../../../services/Knowledge/collectionService';

// Lists every collection the caller can read across all visible channels.
// We can't add a global `myCollections` Zero query without touching shared
// schema, so instead we fan `scopedCollections` out one channel at a time
// and merge results in the provider. Each visible channel pays one Zero
// subscription; for typical users that's a small handful.

export interface GlobalCollection extends CollectionSummary {
  scopeType: string;
  scopeId: string;
  /** projectId of the owning channel, when known. Needed to build the
   *  existing /knowledge-base/<projectId>/<channelId>/<collectionId> URL. */
  projectId: string | null;
}

interface GlobalCollectionsContextValue {
  collections: GlobalCollection[];
  isLoading: boolean;
  /** Look up a collection by id without scanning the list. */
  byId: (id: string) => GlobalCollection | undefined;
}

const GlobalCollectionsContext = createContext<GlobalCollectionsContextValue | null>(null);

interface ChannelCollectionsLoaderProps {
  channelId: string;
  projectId: string | null;
  onLoad: (channelId: string, rows: GlobalCollection[]) => void;
  onLoadingChange: (channelId: string, loading: boolean) => void;
}

const ChannelCollectionsLoader: React.FC<ChannelCollectionsLoaderProps> = React.memo(
  ({ channelId, projectId, onLoad, onLoadingChange }) => {
    const { user } = useAuth();
    const enabled = !!user && !!channelId;
    const [zeroCollections, { type: queryType }] = useCachedQuery(
      queries.scopedCollections({ scopeType: 'CHANNEL', scopeId: channelId }),
      enabled,
    );

    const loading = enabled && queryType !== 'complete';
    const lastLoadingRef = useRef<boolean | null>(null);
    if (lastLoadingRef.current !== loading) {
      lastLoadingRef.current = loading;
      // Schedule the change after render to avoid setState-in-render warnings.
      queueMicrotask(() => onLoadingChange(channelId, loading));
    }

    const mapped: GlobalCollection[] = useMemo(() => {
      if (!zeroCollections || !user) return [];
      return zeroCollections.map(col => {
        const perm = col.permissions?.find(p => p.userId === user.id);
        const isOwner = col.ownerId === user.id;
        const defaultRole = isOwner ? 'OWNER' : col.isPrivate ? 'VIEWER' : 'EDITOR';
        return {
          id: col.id,
          name: col.name,
          description: col.description ?? null,
          ownerId: col.ownerId,
          role: (perm?.role ?? defaultRole) as CollectionRole,
          canShare: perm?.canShare ?? isOwner,
          scopeType: 'CHANNEL',
          scopeId: channelId,
          projectId,
        };
      });
    }, [zeroCollections, user, channelId, projectId]);

    const lastMappedRef = useRef<GlobalCollection[] | null>(null);
    if (lastMappedRef.current !== mapped) {
      lastMappedRef.current = mapped;
      queueMicrotask(() => onLoad(channelId, mapped));
    }
    return null;
  },
);
ChannelCollectionsLoader.displayName = 'ChannelCollectionsLoader';

export const GlobalCollectionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const channels = useAllVisibleChannels();
  const [byChannel, setByChannel] = useState<Record<string, GlobalCollection[]>>({});
  const [loadingByChannel, setLoadingByChannel] = useState<Record<string, boolean>>({});

  const handleLoad = useCallback((channelId: string, rows: GlobalCollection[]): void => {
    setByChannel(prev => {
      if (prev[channelId] === rows) return prev;
      return { ...prev, [channelId]: rows };
    });
  }, []);

  const handleLoadingChange = useCallback((channelId: string, loading: boolean): void => {
    setLoadingByChannel(prev => {
      if (prev[channelId] === loading) return prev;
      return { ...prev, [channelId]: loading };
    });
  }, []);

  const value: GlobalCollectionsContextValue = useMemo(() => {
    const flat: GlobalCollection[] = [];
    const idIndex = new Map<string, GlobalCollection>();
    for (const channelId of Object.keys(byChannel)) {
      const rows = byChannel[channelId];
      if (!rows) continue;
      for (const row of rows) {
        if (!idIndex.has(row.id)) {
          idIndex.set(row.id, row);
          flat.push(row);
        }
      }
    }
    flat.sort((a, b) => a.name.localeCompare(b.name));
    const isLoading =
      channels.length === 0 ? false : channels.some(ch => loadingByChannel[ch.id] !== false);
    return {
      collections: flat,
      isLoading,
      byId: (id: string): GlobalCollection | undefined => idIndex.get(id),
    };
  }, [byChannel, loadingByChannel, channels]);

  return (
    <GlobalCollectionsContext.Provider value={value}>
      {channels.map(ch => (
        <ChannelCollectionsLoader
          key={ch.id}
          channelId={ch.id}
          projectId={ch.projectId ?? null}
          onLoad={handleLoad}
          onLoadingChange={handleLoadingChange}
        />
      ))}
      {children}
    </GlobalCollectionsContext.Provider>
  );
};

export function useGlobalCollections(): GlobalCollectionsContextValue {
  const ctx = useContext(GlobalCollectionsContext);
  if (!ctx) {
    throw new Error('useGlobalCollections must be used inside <GlobalCollectionsProvider>');
  }
  return ctx;
}
