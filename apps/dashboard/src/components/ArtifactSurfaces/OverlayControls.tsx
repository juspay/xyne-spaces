import { useEffect, useState, type ReactElement } from 'react';
import { Layers } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { ShortcutHint } from '../ui/ShortcutHint';
import {
  OVERLAY_CONFIRM_SECONDS,
  OVERLAY_PAUSE_MS,
  keepOverlay,
  pauseOverlay,
  resumeOverlay,
  revertOverlay,
  toggleOverlaySuppressed,
  turnOffOverlay,
} from './surfacesStore';
import { useSurfaceApp } from './useSurfaceApp';

const TRACK = 'ARTIFACT_SURFACES';

/**
 * Above everything, dialogs and Cmd+K included: the controls must stay reachable
 * whatever an overlay paints.
 */
const CONTROL_Z = 'z-[10002]';

/**
 * A newly chosen overlay runs as a preview. Unless the viewer keeps it, it
 * reverts when the countdown ends — so an overlay that hides the screen undoes
 * itself even if nobody can find the button.
 */
export const OverlayConfirm = ({ appId }: { appId: string }): ReactElement => {
  const { app } = useSurfaceApp(appId);
  const [left, setLeft] = useState(OVERLAY_CONFIRM_SECONDS);

  useEffect(() => {
    setLeft(OVERLAY_CONFIRM_SECONDS);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const remaining = OVERLAY_CONFIRM_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) {
        window.clearInterval(timer);
        revertOverlay();
        return;
      }
      setLeft(remaining);
    }, 250);
    return (): void => window.clearInterval(timer);
  }, [appId]);

  return (
    <div
      role='alertdialog'
      aria-labelledby='overlay-confirm-title'
      aria-describedby='overlay-confirm-description'
      className={`fixed left-1/2 top-4 ${CONTROL_Z} flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl`}
    >
      <div className='min-w-0 flex-1'>
        <p id='overlay-confirm-title' className='truncate text-sm font-medium'>
          Keep {app?.title ?? 'this overlay'}?
        </p>
        <p id='overlay-confirm-description' className='text-xs text-muted-foreground'>
          Reverting in {left}s
        </p>
      </div>
      <button
        type='button'
        onClick={revertOverlay}
        className='rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent'
        data-track-category={TRACK}
        data-track-name='RevertOverlay'
      >
        Revert
      </button>
      <button
        type='button'
        onClick={keepOverlay}
        className='rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90'
        // The safe choice is the default only by timeout; Keep is the action.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        data-track-category={TRACK}
        data-track-name='KeepOverlay'
      >
        Keep
      </button>
    </div>
  );
};

/**
 * The overlay's own control, drawn by Spaces over everything while an overlay is
 * chosen: pause it, hide it for the session, switch it off, or go to settings.
 * Present even while the overlay is paused, so it can be brought back.
 */
export const OverlayControl = ({
  appId,
  running,
}: {
  appId: string;
  /** False while paused or hidden for the session. */
  running: boolean;
}): ReactElement => {
  const { app } = useSurfaceApp(appId);
  const title = app?.title ?? 'Overlay';

  return (
    <div className={`fixed bottom-4 left-4 ${CONTROL_Z}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className={`flex size-8 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground shadow-md hover:bg-accent ${
              running ? '' : 'opacity-60'
            }`}
            aria-label={`Overlay controls: ${title}${running ? '' : ' (paused)'}`}
            title={`Overlay: ${title}`}
            data-track-category={TRACK}
            data-track-name='OpenOverlayControls'
          >
            <Layers className='size-4' aria-hidden='true' />
          </button>
        </DropdownMenuTrigger>
        {/* Above the trigger's own layer, so the menu is never under the overlay. */}
        <DropdownMenuContent side='top' align='start' className={`min-w-52 ${CONTROL_Z}`}>
          <DropdownMenuLabel className='truncate'>{title}</DropdownMenuLabel>
          {running ? (
            <>
              <DropdownMenuItem
                onClick={() => pauseOverlay(OVERLAY_PAUSE_MS)}
                data-track-category={TRACK}
                data-track-name='PauseOverlay'
              >
                Pause for an hour
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={toggleOverlaySuppressed}
                data-track-category={TRACK}
                data-track-name='HideOverlayForSession'
              >
                <span className='flex-1'>Hide until reload</span>
                <ShortcutHint shortcut='global.toggleOverlays' className='text-xs' />
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              onClick={resumeOverlay}
              data-track-category={TRACK}
              data-track-name='ResumeOverlay'
            >
              Resume
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={turnOffOverlay}
            data-track-category={TRACK}
            data-track-name='TurnOffOverlay'
          >
            Turn off
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('xyne-open-preferences', { detail: { section: 'overlays' } }),
              )
            }
            data-track-category={TRACK}
            data-track-name='OpenOverlaySettings'
          >
            Overlay settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
