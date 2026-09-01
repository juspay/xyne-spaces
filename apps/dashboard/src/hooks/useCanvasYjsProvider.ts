import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { createYjsProvider, EVENT_CONNECTION_STATUS, EVENT_LOCAL_CHANGES } from '@y-sweet/client';
import { DYNAMIC_HEADERS_CHANGED_EVENT } from '../services/clients/dynamicHeaders';
import type { YSweetProvider } from '@y-sweet/client';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { canvasService } from '../services/Canvas/canvasService';
import type { YSweetAuthToken } from '../services/Canvas/canvasService';
import { canvasPrefetchService } from '../services/Canvas/canvasPrefetchService';
import { logger, Event } from '../utils/logger';

const COLLABORATION_COLORS = [
  '#E57373',
  '#F06292',
  '#BA68C8',
  '#9575CD',
  '#7986CB',
  '#64B5F6',
  '#4FC3F7',
  '#4DD0E1',
  '#4DB6AC',
  '#81C784',
  '#AED581',
  '#DCE775',
  '#FFD54F',
  '#FFB74D',
  '#FF8A65',
  '#A1887F',
] as const;

export function generateUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLLABORATION_COLORS.length;
  return COLLABORATION_COLORS[index] ?? '#64B5F6';
}

export interface AwarenessUser {
  id: string;
  name: string;
  color: string;
}

export type CollaboratorInfo = AwarenessUser;

export interface CanvasYjsProviderOptions {
  canvasId: string;
  userId: string;
  userName: string;
  userColor?: string;
  channelId?: string | undefined;
  title?: string | undefined;
}

export interface CanvasYjsProviderState {
  doc: Y.Doc;
  awareness: Awareness | null;
  provider: YSweetProvider | null;
  fragment: Y.XmlFragment;
  collaborators: CollaboratorInfo[];
  connectionStatus: 'offline' | 'connecting' | 'error' | 'handshaking' | 'connected';
  hasLocalChanges: boolean;
  isReadOnly: boolean;
  connectionFailed: boolean;
  reconnect: () => void;
}

export function useCanvasYjsProvider(options: CanvasYjsProviderOptions): CanvasYjsProviderState {
  const { canvasId, userId, userName, channelId, title } = options;
  const userColor = options.userColor ?? generateUserColor(userId);

  const prefetchedCanvas = useMemo(() => {
    const canvas = canvasPrefetchService.consumePrefetchedCanvas(canvasId);
    if (canvas) {
      logger.info(Event.CANVAS_OPENED_FROM_PREFETCH, { canvasId });
    } else {
      logger.info(Event.CANVAS_OPENED, { canvasId });
    }
    return canvas;
  }, [canvasId]);

  const doc = useMemo(() => prefetchedCanvas?.doc ?? new Y.Doc(), [prefetchedCanvas]);
  const fragment = useMemo(
    () => prefetchedCanvas?.fragment ?? doc.getXmlFragment('document-store'),
    [prefetchedCanvas, doc],
  );

  const providerRef = useRef<YSweetProvider | null>(prefetchedCanvas?.provider ?? null);
  const [awareness, setAwareness] = useState<Awareness | null>(
    prefetchedCanvas?.provider.awareness ?? null,
  );

  const hasConnectedOnceRef = useRef(false);
  const lastNotificationStatusRef = useRef<string>('');
  const localChangesTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasLocalChangesRef = useRef(false);
  const errorCountRef = useRef(0);
  const latestAuthTokenRef = useRef<YSweetAuthToken | undefined>(undefined);
  const permissionReadOnlyRef = useRef(false);

  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    'offline' | 'connecting' | 'error' | 'handshaking' | 'connected'
  >('offline');
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  useEffect(() => {
    hasLocalChangesRef.current = hasLocalChanges;
  }, [hasLocalChanges]);

  useEffect(() => {
    if (!awareness) return;

    awareness.setLocalStateField('user', {
      id: userId,
      name: userName,
      color: userColor,
    });
  }, [awareness, userId, userName, userColor]);

  useEffect(() => {
    if (!awareness) return;

    const updateCollaborators = (): void => {
      const states = awareness.getStates();
      const userMap = new Map<string, CollaboratorInfo>();

      states.forEach((state: Record<string, unknown>, clientId: number) => {
        // Skip the local client (this user)
        const localClientId = awareness.clientID;
        if (typeof localClientId === 'number' && clientId === localClientId) {
          return;
        }

        const u = state['user'] as Partial<CollaboratorInfo> | undefined;
        const cursor = state['cursor'] as { name?: string; color?: string } | undefined;

        const id = u?.id as string;
        if (!id || typeof id !== 'string' || id.trim().length === 0) {
          return;
        }

        const name = (u?.name as string) || (cursor?.name as string) || 'Anonymous';
        const color = (u?.color as string) || (cursor?.color as string) || '#64B5F6';

        if (!userMap.has(id)) {
          userMap.set(id, { id, name, color });
        }
      });

      setCollaborators(Array.from(userMap.values()));
    };

    awareness.on('change', updateCollaborators);
    updateCollaborators();

    return (): void => {
      awareness.off('change', updateCollaborators);
    };
  }, [awareness, userId, doc.clientID]);

  const {
    data: authTokenData,
    error: authError,
    refetch,
  } = useQuery<YSweetAuthToken>({
    queryKey: ['ysweet-auth', canvasId, channelId],
    queryFn: () =>
      canvasService.getYSweetAuthToken({
        docId: canvasId,
        ...(channelId ? { channelId } : {}),
        ...(title ? { title } : {}),
      }),
    staleTime: 1000 * 60 * 50,
    retry: 3,
  });

  // Handle auth errors
  useEffect(() => {
    if (authError) {
      toast.error('Connection Failed', {
        description: 'Could not authorize collaboration access.',
      });
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
        setAwareness(null);
      }
      setIsReadOnly(true);
    }
  }, [authError]);

  // Update read-only state when auth token changes
  useEffect(() => {
    if (authTokenData) {
      const readOnly = authTokenData.authorization === 'read-only';
      permissionReadOnlyRef.current = readOnly;
      setIsReadOnly(readOnly);
    }
  }, [authTokenData]);

  latestAuthTokenRef.current = authTokenData;
  // Derived, not effect-driven state: two useEffects here (set true when the
  // token arrives, reset false on canvasId change) both fire on mount, and
  // when the token is already cached the reset can run after the set and
  // win, permanently gating out provider creation for that mount. Deriving
  // it during render has no such ordering to race.
  const hasAuthToken = authTokenData?.docId === canvasId;

  const getAuthToken = useCallback(async (): Promise<YSweetAuthToken> => {
    if (errorCountRef.current >= 5) {
      throw new Error('Authentication retry limit reached');
    }
    const { data, isError, error } = await refetch();
    if (isError || !data) {
      throw error || new Error('Failed to refetch auth token');
    }
    return data;
  }, [refetch]);

  useEffect(() => {
    if (prefetchedCanvas?.provider) {
      const provider = prefetchedCanvas.provider;
      providerRef.current = provider;
      setAwareness(provider.awareness);

      if (prefetchedCanvas.isConnected) {
        setConnectionStatus('connected');
        hasConnectedOnceRef.current = true;
      }

      const handleConnectionStatus = (
        status: 'offline' | 'connecting' | 'error' | 'handshaking' | 'connected',
      ): void => {
        setConnectionStatus(status);

        if (status === 'connected') {
          errorCountRef.current = 0;
          setIsReadOnly(permissionReadOnlyRef.current);
          if (!hasConnectedOnceRef.current) {
            hasConnectedOnceRef.current = true;
            lastNotificationStatusRef.current = status;
            logger.info(Event.CANVAS_CONNECTION_ESTABLISHED, { canvasId, fromPrefetch: true });
          }
        } else if (status === 'error') {
          errorCountRef.current += 1;
          setIsReadOnly(true);
          logger.error(Event.CANVAS_CONNECTION_ERROR, {
            canvasId,
            errorCount: errorCountRef.current,
            fromPrefetch: true,
          });
          if (errorCountRef.current >= 5) {
            provider.destroy();
            providerRef.current = null;
            setAwareness(null);
            setConnectionFailed(true);
          }
          if (lastNotificationStatusRef.current !== 'error') {
            lastNotificationStatusRef.current = 'error';
            toast.warning('Connection Issue', {
              description: 'Try refreshing the page.',
            });
          }
        } else if (status === 'offline' && lastNotificationStatusRef.current === 'connected') {
          setIsReadOnly(true);
          lastNotificationStatusRef.current = 'offline';
          toast.info('Working Offline', {
            description: 'Try refreshing the page.',
          });
        }
      };

      provider.on(EVENT_CONNECTION_STATUS, handleConnectionStatus);

      const handleLocalChanges = (hasChanges: boolean): void => {
        if (localChangesTimerRef.current) {
          clearTimeout(localChangesTimerRef.current);
        }

        if (hasChanges) {
          setHasLocalChanges(true);
        } else {
          localChangesTimerRef.current = setTimeout(() => {
            setHasLocalChanges(false);
          }, 2000);
        }
      };

      provider.on(EVENT_LOCAL_CHANGES, handleLocalChanges);

      return (): void => {
        provider.off(EVENT_CONNECTION_STATUS, handleConnectionStatus);
        provider.off(EVENT_LOCAL_CHANGES, handleLocalChanges);

        if (localChangesTimerRef.current) {
          clearTimeout(localChangesTimerRef.current);
        }

        const hasUnsavedChanges = hasLocalChangesRef.current;
        if (hasUnsavedChanges) {
          toast.warning('Unsaved Changes', {
            description: 'Some changes may not have been saved',
          });
        }

        provider.destroy();
        providerRef.current = null;
        setAwareness(null);
      };
    }

    if (!hasAuthToken || !latestAuthTokenRef.current) return;
    const authTokenData = latestAuthTokenRef.current;

    const actualDocId = authTokenData.docId || canvasId;

    errorCountRef.current = 0;
    setConnectionFailed(false);

    const provider = createYjsProvider(doc, actualDocId, getAuthToken, {
      offlineSupport: true,
      warnOnClose: true,
      showDebuggerLink: false,
      connect: true,
    });

    providerRef.current = provider;
    setAwareness(provider.awareness);

    const handleConnectionStatus = (
      status: 'offline' | 'connecting' | 'error' | 'handshaking' | 'connected',
    ): void => {
      setConnectionStatus(status);

      if (status === 'connected') {
        errorCountRef.current = 0;
        setIsReadOnly(permissionReadOnlyRef.current);
        if (!hasConnectedOnceRef.current) {
          hasConnectedOnceRef.current = true;
          lastNotificationStatusRef.current = status;
          logger.info(Event.CANVAS_CONNECTION_ESTABLISHED, { canvasId, fromPrefetch: false });
        }
      } else if (status === 'error') {
        errorCountRef.current += 1;
        setIsReadOnly(true);
        logger.error(Event.CANVAS_CONNECTION_ERROR, {
          canvasId,
          errorCount: errorCountRef.current,
          fromPrefetch: false,
        });
        if (errorCountRef.current >= 5) {
          provider.destroy();
          providerRef.current = null;
          setAwareness(null);
          setConnectionFailed(true);
        }
        if (lastNotificationStatusRef.current !== 'error') {
          lastNotificationStatusRef.current = 'error';
          toast.warning('Connection Issue', {
            description: 'Try refreshing the page.',
          });
        }
      } else if (status === 'offline' && lastNotificationStatusRef.current === 'connected') {
        setIsReadOnly(true);
        lastNotificationStatusRef.current = 'offline';
        toast.info('Working Offline', {
          description: 'Try refreshing the page.',
        });
      }
    };

    provider.on(EVENT_CONNECTION_STATUS, handleConnectionStatus);

    const handleLocalChanges = (hasChanges: boolean): void => {
      if (localChangesTimerRef.current) {
        clearTimeout(localChangesTimerRef.current);
      }

      if (hasChanges) {
        setHasLocalChanges(true);
      } else {
        localChangesTimerRef.current = setTimeout(() => {
          setHasLocalChanges(false);
        }, 1000);
      }
    };

    provider.on(EVENT_LOCAL_CHANGES, handleLocalChanges);

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (hasLocalChangesRef.current) {
        event.preventDefault();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return (): void => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (localChangesTimerRef.current) {
        clearTimeout(localChangesTimerRef.current);
      }

      if (providerRef.current) {
        providerRef.current.off(EVENT_CONNECTION_STATUS, handleConnectionStatus);
        providerRef.current.off(EVENT_LOCAL_CHANGES, handleLocalChanges);

        providerRef.current.destroy();
        providerRef.current = null;
      }

      setAwareness(null);
      doc.destroy();
    };
  }, [doc, canvasId, hasAuthToken, getAuthToken, reconnectNonce]);

  const reconnect = useCallback((): void => {
    errorCountRef.current = 0;
    lastNotificationStatusRef.current = '';
    setConnectionFailed(false);
    void refetch().then(() => {
      setReconnectNonce(n => n + 1);
    });
  }, [refetch]);

  useEffect(() => {
    const handleDynamicHeadersChanged = (): void => {
      const provider = providerRef.current;
      if (!provider) return;
      provider.disconnect();
      void provider.connect();
    };
    window.addEventListener(DYNAMIC_HEADERS_CHANGED_EVENT, handleDynamicHeadersChanged);
    return (): void => {
      window.removeEventListener(DYNAMIC_HEADERS_CHANGED_EVENT, handleDynamicHeadersChanged);
    };
  }, []);

  return {
    doc,
    awareness,
    provider: providerRef.current,
    fragment,
    collaborators,
    connectionStatus,
    hasLocalChanges,
    isReadOnly,
    connectionFailed,
    reconnect,
  };
}
