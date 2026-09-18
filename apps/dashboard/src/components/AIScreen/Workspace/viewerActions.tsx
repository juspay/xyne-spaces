import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

type ViewerActionRender = () => ReactNode;

interface ViewerActionsValue {
  render: ViewerActionRender | null;
  publish: (render: ViewerActionRender | null) => void;
}

const ViewerActionsContext = createContext<ViewerActionsValue | null>(null);

/**
 * Lets whatever is open publish a control into the surface's toolbar, so an
 * item's own action sits with the workspace's actions instead of floating over
 * the content.
 */
export function ViewerActionsProvider({ children }: { children: ReactNode }): ReactElement {
  const [render, setRender] = useState<ViewerActionRender | null>(null);
  const publish = useMemo(() => (next: ViewerActionRender | null) => setRender(() => next), []);
  const value = useMemo(() => ({ render, publish }), [render, publish]);
  return <ViewerActionsContext.Provider value={value}>{children}</ViewerActionsContext.Provider>;
}

export function useViewerActions(): ReactNode {
  const render = useContext(ViewerActionsContext)?.render;
  return render ? render() : null;
}

export function usePublishViewerAction(render: ViewerActionRender, deps: unknown[]): void {
  const context = useContext(ViewerActionsContext);
  const publish = context?.publish;
  const latest = useRef(render);
  latest.current = render;

  useEffect(() => {
    if (!publish) return;
    publish(() => latest.current());
    return () => publish(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, ...deps]);
}
