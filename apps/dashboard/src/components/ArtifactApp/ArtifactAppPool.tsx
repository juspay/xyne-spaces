import {
  memo,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MutableRefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { ArtifactAppHostView } from './ArtifactAppHostView';
import {
  initialPoolState,
  isAppVisible,
  ownerSlotId,
  poolReducer,
  type PoolAction,
  type PooledApp,
  type PoolState,
  type SlotProps,
  type SlotRect,
} from './artifactAppPool.state';

type BackRef = MutableRefObject<(() => void) | undefined>;

// Module-level so slots reach the host without a provider around the shell.
let poolState: PoolState = initialPoolState;
const listeners = new Set<() => void>();
const backRefs = new Map<string, BackRef>();

function dispatch(action: PoolAction): void {
  const next = poolReducer(poolState, action);
  if (next === poolState) return;
  poolState = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getState = (): PoolState => poolState;

// A hot swap would split slots and host across two copies of this store; reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

export const artifactAppPool = {
  mount(
    slotId: string,
    key: string,
    appId: string,
    props: SlotProps,
    backRef: BackRef,
  ): () => void {
    backRefs.set(slotId, backRef);
    dispatch({ type: 'mount', slotId, key, appId, props });
    return () => {
      backRefs.delete(slotId);
      dispatch({ type: 'unmount', slotId, key });
    };
  },
  update(slotId: string, key: string, patch: { props?: SlotProps; rect?: SlotRect }): void {
    dispatch({ type: 'update', slotId, key, ...patch });
  },
};

// Memoized so per-frame moves don't re-render the app.
const PooledAppView = memo(ArtifactAppHostView);

const PooledAppFrame = memo(({ app }: { app: PooledApp }): ReactElement => {
  const visible = isAppVisible(app);
  const owner = ownerSlotId(app);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // A hidden app must not keep keyboard focus.
  useEffect(() => {
    const active = document.activeElement;
    if (!visible && active instanceof HTMLElement && frameRef.current?.contains(active)) {
      active.blur();
    }
  }, [visible]);

  const onBack = useCallback((): void => {
    if (owner) backRefs.get(owner)?.current?.();
  }, [owner]);

  return (
    <div
      ref={frameRef}
      inert={!visible}
      aria-hidden={!visible}
      style={{
        position: 'fixed',
        top: app.rect?.top ?? 0,
        left: app.rect?.left ?? 0,
        width: app.rect?.width ?? 0,
        height: app.rect?.height ?? 0,
        visibility: visible ? 'visible' : 'hidden',
        // Sandpack's iframe overrides `visibility`; opacity and clip-path can't be undone from inside.
        opacity: visible ? 1 : 0,
        clipPath: visible ? (app.rect?.clip ?? 'none') : 'inset(100%)',
        pointerEvents: visible ? 'auto' : 'none',
        // Same layer as the SDLC frame: above content, below popovers.
        zIndex: 1,
      }}
    >
      <PooledAppView
        appId={app.appId}
        placement={app.props.placement}
        showPayloadTitle={app.props.showPayloadTitle}
        visible={visible}
        {...(app.props.hasBack ? { onBack } : {})}
      />
    </div>
  );
});
PooledAppFrame.displayName = 'PooledAppFrame';

/** Keeps recent apps running, drawn over their slots like SdlcFrameHost; moving an iframe would reload it. */
const ArtifactAppPoolHost = (): ReactElement | null => {
  const state = useSyncExternalStore(subscribe, getState);
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  const container = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const element = document.createElement('div');
    element.dataset['artifactAppPool'] = 'true';
    return element;
  }, []);

  useEffect(() => {
    if (!container) return undefined;
    document.body.appendChild(container);
    return (): void => container.remove();
  }, [container]);

  // Drop another workspace's hidden apps.
  useEffect(() => {
    dispatch({ type: 'dropHidden' });
  }, [workspaceId]);

  if (!container) return null;
  return createPortal(
    state.apps.map(app => <PooledAppFrame key={app.key} app={app} />),
    container,
  );
};

export default ArtifactAppPoolHost;
