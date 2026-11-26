import { useMemo, useState, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { AppPickerDialog } from '../BarCustomize/AppPickerDialog';
import { AppIcon } from '../AppIcon/AppIcon';
import { ShortcutHint } from '../ui/ShortcutHint';
import { usePrefersPlainOverlays } from './environment';
import {
  MAX_WIDGETS,
  OVERLAY_CONFIRM_SECONDS,
  addWidget,
  previewOverlay,
  removeWidget,
  resetWidgetLayouts,
  resumeOverlay,
  shownOverlayAppId,
  turnOffOverlay,
  useSurfaces,
} from './surfacesStore';
import { useSurfaceApp } from './useSurfaceApp';

const TRACK = 'PREFERENCES';

const AppRow = ({
  appId,
  status,
  action,
}: {
  appId: string;
  status?: string;
  action: ReactElement;
}): ReactElement => {
  const { app, isError } = useSurfaceApp(appId);
  return (
    <div className='flex items-center gap-3 px-3 py-2'>
      <span className='flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground'>
        <AppIcon name={app?.icon ?? null} size={16} aria-hidden='true' />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium text-foreground'>
          {app?.title ?? (isError ? 'Unavailable app' : 'Loading…')}
        </span>
        {status && <span className='block truncate text-xs text-muted-foreground'>{status}</span>}
      </span>
      {action}
    </div>
  );
};

const smallButton =
  'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent';

/**
 * Preferences → Overlays & widgets.
 *
 * Overlays and widgets are apps run over Spaces. They sit on top of whichever
 * Spaces theme is chosen and never change it. Choosing an overlay starts a
 * preview the viewer must keep; widgets are added straight away.
 */
export const OverlaysAndWidgetsSection = (_props: { state?: unknown }): ReactElement => {
  const surfaces = useSurfaces();
  const plain = usePrefersPlainOverlays();
  const [picking, setPicking] = useState<'overlay' | 'widgets' | null>(null);

  const overlayId = surfaces.pending?.appId ?? surfaces.overlay.appId;
  const overlayRunning = shownOverlayAppId(surfaces, Date.now()) === overlayId;
  const widgetIds = useMemo(() => new Set(surfaces.widgets), [surfaces.widgets]);
  const overlayIds = useMemo(() => new Set(overlayId ? [overlayId] : []), [overlayId]);

  const overlayStatus = surfaces.pending
    ? 'Previewing — keep it or it reverts'
    : plain
      ? 'Not shown: your system asks for reduced motion or transparency'
      : overlayRunning
        ? 'On'
        : 'Paused';

  return (
    <div className='space-y-6'>
      <div>
        <p className='text-base font-semibold text-foreground'>Overlays &amp; widgets</p>
        <p className='mt-0.5 text-sm text-muted-foreground'>
          Run apps over Spaces. They sit on top of your theme and never change it.
        </p>
      </div>

      <section className='space-y-2'>
        <div>
          <p className='text-sm font-medium text-foreground'>Overlay</p>
          <p className='text-xs text-muted-foreground'>
            One app drawn over the whole window, like seasonal decorations. Clicks pass straight
            through it. A new overlay runs as a {OVERLAY_CONFIRM_SECONDS}-second preview and reverts
            unless you keep it. Press{' '}
            <ShortcutHint shortcut='global.toggleOverlays' className='opacity-100' /> to hide or
            show it.
          </p>
        </div>
        <div className='rounded-lg border border-border'>
          {overlayId ? (
            <AppRow
              appId={overlayId}
              status={overlayStatus}
              action={
                <div className='flex gap-1'>
                  {!overlayRunning && !surfaces.pending && !plain && (
                    <button
                      type='button'
                      onClick={resumeOverlay}
                      className={smallButton}
                      data-track-category={TRACK}
                      data-track-name='ResumeOverlay'
                    >
                      Resume
                    </button>
                  )}
                  <button
                    type='button'
                    onClick={() => setPicking('overlay')}
                    className={smallButton}
                    data-track-category={TRACK}
                    data-track-name='ChangeOverlay'
                  >
                    Change
                  </button>
                  <button
                    type='button'
                    onClick={turnOffOverlay}
                    className={smallButton}
                    data-track-category={TRACK}
                    data-track-name='TurnOffOverlay'
                  >
                    Turn off
                  </button>
                </div>
              }
            />
          ) : (
            <button
              type='button'
              onClick={() => setPicking('overlay')}
              className='flex w-full items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground'
              data-track-category={TRACK}
              data-track-name='ChooseOverlay'
            >
              <Plus className='size-4' aria-hidden='true' />
              Choose an overlay
            </button>
          )}
        </div>
      </section>

      <section className='space-y-2'>
        <div>
          <p className='text-sm font-medium text-foreground'>Widgets</p>
          <p className='text-xs text-muted-foreground'>
            Small floating apps you can use while you work. Hover one to move it, collapse it or
            hide it. Up to {MAX_WIDGETS}.
          </p>
        </div>
        <div className='divide-y divide-border rounded-lg border border-border'>
          {surfaces.widgets.map(appId => (
            <AppRow
              key={appId}
              appId={appId}
              action={
                <button
                  type='button'
                  onClick={() => removeWidget(appId)}
                  className={smallButton}
                  data-track-category={TRACK}
                  data-track-name='RemoveWidget'
                >
                  Remove
                </button>
              }
            />
          ))}
          {surfaces.widgets.length < MAX_WIDGETS && (
            <button
              type='button'
              onClick={() => setPicking('widgets')}
              className='flex w-full items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground'
              data-track-category={TRACK}
              data-track-name='AddWidgets'
            >
              <Plus className='size-4' aria-hidden='true' />
              Add widgets
            </button>
          )}
        </div>
        {surfaces.widgets.length > 0 && (
          <button
            type='button'
            onClick={resetWidgetLayouts}
            className='text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'
            data-track-category={TRACK}
            data-track-name='ResetWidgetPositions'
          >
            Reset widget positions
          </button>
        )}
      </section>

      <AppPickerDialog
        open={picking === 'overlay'}
        onOpenChange={open => setPicking(open ? 'overlay' : null)}
        addedAppIds={overlayIds}
        isFull={false}
        onToggle={(app, next) => {
          if (next) {
            previewOverlay(app.id);
            // Close so the preview and its Keep / Revert prompt are in view.
            setPicking(null);
          } else {
            turnOffOverlay();
          }
        }}
        trackCategory={TRACK}
        surface='overlay'
        description='Overlay apps draw over Spaces. Clicks pass through them.'
        limitNote={{
          normal: `One overlay at a time. It runs as a ${OVERLAY_CONFIRM_SECONDS}-second preview first.`,
          full: '',
        }}
      />
      <AppPickerDialog
        open={picking === 'widgets'}
        onOpenChange={open => setPicking(open ? 'widgets' : null)}
        addedAppIds={widgetIds}
        isFull={surfaces.widgets.length >= MAX_WIDGETS}
        onToggle={(app, next) => {
          if (next) addWidget(app.id);
          else removeWidget(app.id);
        }}
        trackCategory={TRACK}
        surface='widget'
        description='Widget apps you saved or that were published to this workspace.'
        limitNote={{
          normal: `Up to ${MAX_WIDGETS} widgets.`,
          full: `You have ${MAX_WIDGETS} widgets. Remove one to add another.`,
        }}
      />
    </div>
  );
};
