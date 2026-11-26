import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, GripHorizontal, MoreHorizontal } from 'lucide-react';
import { ReactArtifactView } from '../AIScreen/ReactArtifact';
import type { XyneAppContext } from '../AIScreen/ReactArtifact';
import { AppIcon } from '../AppIcon/AppIcon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { cn } from '../../utils/classNames';
import {
  removeWidget,
  reportSurfaceFailure,
  reportSurfaceReady,
  setWidgetLayout,
  type WidgetLayout,
} from './surfacesStore';
import {
  WIDGET_COLLAPSED_HEIGHT,
  WIDGET_COLLAPSED_WIDTH,
  WIDGET_EDGE_GAP,
  clampWidgetSize,
  clampWidgetTop,
  snapSide,
} from './widgetSizing';
import { navigateFromApp } from './surfaceRegistry';
import { useSurfaceApp } from './useSurfaceApp';
import { useDeclaredSurface } from './useDeclaredSurface';

const TRACK = 'ARTIFACT_SURFACES';

/** One arrow-key press on the grip moves the widget this far. */
const KEYBOARD_STEP = 16;

/** Height of the hover toolbar above the card. */
const TOOLBAR_HEIGHT = 28;

const openSettings = (): void => {
  window.dispatchEvent(
    new CustomEvent('xyne-open-preferences', { detail: { section: 'overlays' } }),
  );
};

/**
 * One app as a floating widget.
 *
 * The shell owns the frame and the app owns everything inside it. The frame is
 * a toolbar that appears above the card on hover or focus — a grip to drag, the
 * app's name, and a menu — so no click inside the card is ever taken from the
 * app. Dropped, a widget snaps to the nearer side of the window and keeps its
 * height; the layout is remembered on this device.
 *
 * Collapsed, the app is unmounted and the widget is a pill with the app's name:
 * a collapsed widget costs nothing. A failure shows a card with Retry, Open app
 * and Hide; after a few in a row the store switches the widget off.
 */
export const FloatingWidget = ({
  appId,
  layout,
}: {
  appId: string;
  layout: WidgetLayout;
}): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { app, artifact, isLoading, isError } = useSurfaceApp(appId);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [, setViewportTick] = useState(0);
  const title = app?.title ?? 'Widget';
  const allowed = useDeclaredSurface(appId, 'widget', artifact, title);

  // Re-clamp on window resize: a widget must never end up off-screen.
  useEffect(() => {
    const onResize = (): void => setViewportTick(n => n + 1);
    window.addEventListener('resize', onResize);
    return (): void => window.removeEventListener('resize', onResize);
  }, []);

  const size = layout.collapsed
    ? { width: WIDGET_COLLAPSED_WIDTH, height: WIDGET_COLLAPSED_HEIGHT }
    : clampWidgetSize(layout.width, layout.height);
  const top = clampWidgetTop(layout.top, size.height);

  const fail = useCallback((): void => {
    setFailed(true);
    if (reportSurfaceFailure('widget', appId)) {
      toast.error(`${title} was removed from your widgets`, {
        description: 'It kept failing to load. You can add it again in Preferences.',
      });
    }
  }, [appId, title]);

  useEffect(() => {
    if (isError) fail();
    // Only on the transition into an error; `fail` changes with the title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError]);

  const onHealth = useCallback(
    (state: 'ready' | 'failed'): void => {
      if (state === 'ready') reportSurfaceReady('widget', appId);
      else fail();
    },
    [appId, fail],
  );

  const hostContext = useMemo(
    (): XyneAppContext => ({
      v: 1,
      appId,
      surface: 'widget',
      layout: 'widget',
      ...(workspaceId ? { workspaceId } : {}),
    }),
    [appId, workspaceId],
  );

  const retry = (): void => {
    setFailed(false);
    setAttempt(n => n + 1);
  };

  const setCollapsed = (collapsed: boolean): void =>
    setWidgetLayout(appId, { ...layout, collapsed });

  // ─── Dragging ─────────────────────────────────────────────────────────────
  const onGripPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setDrag({ left: rect.left, top: rect.top });
  };

  const onGripPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const offset = dragOffset.current;
    if (!offset) return;
    const maxLeft = window.innerWidth - size.width - WIDGET_EDGE_GAP;
    setDrag({
      left: Math.max(WIDGET_EDGE_GAP, Math.min(maxLeft, event.clientX - offset.x)),
      top: clampWidgetTop(event.clientY - offset.y, size.height),
    });
  };

  const onGripPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag) {
      setWidgetLayout(appId, {
        ...layout,
        side: snapSide(drag.left, size.width),
        top: clampWidgetTop(drag.top, size.height),
      });
    }
    setDrag(null);
  };

  const onGripKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const moves: Record<string, () => WidgetLayout> = {
      ArrowUp: () => ({ ...layout, top: clampWidgetTop(top - KEYBOARD_STEP, size.height) }),
      ArrowDown: () => ({ ...layout, top: clampWidgetTop(top + KEYBOARD_STEP, size.height) }),
      ArrowLeft: () => ({ ...layout, side: 'left' }),
      ArrowRight: () => ({ ...layout, side: 'right' }),
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    setWidgetLayout(appId, next());
  };

  const position = drag
    ? { left: drag.left, top: drag.top }
    : layout.side === 'left'
      ? { left: WIDGET_EDGE_GAP, top }
      : { right: WIDGET_EDGE_GAP, top };

  const toolbar = (
    <div
      className={cn(
        'absolute inset-x-0 flex items-center gap-1 rounded-md border border-border bg-popover px-1 text-popover-foreground shadow-sm',
        'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
        drag && 'opacity-100',
      )}
      style={{ top: -TOOLBAR_HEIGHT - 4, height: TOOLBAR_HEIGHT }}
    >
      <button
        type='button'
        className='flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing'
        aria-label={`Move ${title}. Arrow keys move it up, down or to the other side.`}
        title='Drag to move'
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerUp}
        onKeyDown={onGripKeyDown}
        data-track-category={TRACK}
        data-track-name='MoveWidget'
      >
        <GripHorizontal className='size-3.5' aria-hidden='true' />
      </button>
      <span className='min-w-0 flex-1 truncate text-xs font-medium'>{title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className='flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground'
            aria-label={`${title} widget actions`}
            data-track-category={TRACK}
            data-track-name='OpenWidgetMenu'
          >
            <MoreHorizontal className='size-3.5' aria-hidden='true' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='min-w-40'>
          <DropdownMenuItem
            onClick={() => setCollapsed(!layout.collapsed)}
            data-track-category={TRACK}
            data-track-name={layout.collapsed ? 'ExpandWidget' : 'CollapseWidget'}
          >
            {layout.collapsed ? 'Expand' : 'Collapse'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => navigateFromApp({ kind: 'libraryApp', appId })}
            data-track-category={TRACK}
            data-track-name='OpenWidgetApp'
          >
            Open app
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => removeWidget(appId)}
            data-track-category={TRACK}
            data-track-name='HideWidget'
          >
            Hide
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={openSettings}
            data-track-category={TRACK}
            data-track-name='OpenWidgetSettings'
          >
            Widget settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  let body: ReactElement;
  if (layout.collapsed) {
    body = (
      <button
        type='button'
        onClick={() => setCollapsed(false)}
        className='flex h-full w-full items-center gap-2 rounded-full px-3 text-left text-sm font-medium text-foreground hover:bg-accent'
        aria-label={`Expand ${title}`}
        data-track-category={TRACK}
        data-track-name='ExpandWidgetPill'
      >
        <AppIcon name={app?.icon ?? null} size={14} aria-hidden='true' />
        <span className='truncate'>{title}</span>
      </button>
    );
  } else if (failed) {
    body = (
      <div className='flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center'>
        <AlertTriangle className='size-4 text-destructive' aria-hidden='true' />
        <p className='text-xs text-muted-foreground'>Couldn&apos;t load {title}.</p>
        <div className='flex flex-wrap justify-center gap-1'>
          <button
            type='button'
            onClick={retry}
            className='rounded-md border border-border px-2 py-1 text-xs hover:bg-accent'
            data-track-category={TRACK}
            data-track-name='RetryWidget'
          >
            Retry
          </button>
          <button
            type='button'
            onClick={() => navigateFromApp({ kind: 'libraryApp', appId })}
            className='rounded-md border border-border px-2 py-1 text-xs hover:bg-accent'
            data-track-category={TRACK}
            data-track-name='OpenFailedWidgetApp'
          >
            Open app
          </button>
          <button
            type='button'
            onClick={() => removeWidget(appId)}
            className='rounded-md border border-border px-2 py-1 text-xs hover:bg-accent'
            data-track-category={TRACK}
            data-track-name='HideFailedWidget'
          >
            Hide
          </button>
        </div>
      </div>
    );
  } else if (!artifact || isLoading || !allowed) {
    body = <div className='h-full w-full' role='status' aria-label={`Loading ${title}`} />;
  } else {
    body = (
      <ReactArtifactView
        key={attempt}
        artifact={artifact}
        hostContext={hostContext}
        surfaceMode='widget'
        onSurfaceHealth={onHealth}
      />
    );
  }

  return (
    <div
      ref={frameRef}
      className='group fixed z-[44]'
      style={{ ...position, width: size.width, height: size.height }}
      data-testid='artifact-widget'
    >
      {toolbar}
      <div
        className={cn(
          'h-full w-full overflow-hidden border border-border bg-background shadow-lg',
          layout.collapsed ? 'rounded-full' : 'rounded-xl',
          // The iframe would swallow the pointer mid-drag.
          drag && 'pointer-events-none',
        )}
      >
        {body}
      </div>
    </div>
  );
};
