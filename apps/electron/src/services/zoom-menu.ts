import { BrowserWindow, MenuItem, webContents, type Menu, type WebContents } from 'electron';
import { acceptsBrowserCommands } from './webview-shortcuts';

/**
 * The View menu's Zoom In, Zoom Out and Actual Size — ⌘+, ⌘- and ⌘0 — as the in-app
 * browsers need them.
 *
 * Electron's own items zoom whatever has focus, by half a step, behind the app's
 * back: a page zoomed that way never tells its browser, whose bar goes on showing
 * the old size. These ask the window instead, where its app takes them:
 *
 * - a page of its browsers has focus: that page, as its keys and its bar do;
 * - the browser itself has the keyboard: the page it shows;
 * - anything else in the app: the app, as before.
 *
 * A window whose app is from before it could take them gets Electron's own zoom.
 */

type ZoomStep = 'in' | 'out' | 'reset';

const COMMAND: Record<ZoomStep, string> = { in: 'zoomIn', out: 'zoomOut', reset: 'zoomReset' };

/** Electron's own zoom: half a step, or back to 100%. */
function zoomDirectly(contents: WebContents, step: ZoomStep): void {
  if (step === 'reset') contents.setZoomLevel(0);
  else contents.setZoomLevel(contents.getZoomLevel() + (step === 'in' ? 0.5 : -0.5));
}

function zoom(step: ZoomStep): void {
  const focused = webContents.getFocusedWebContents();
  if (focused && !focused.isDestroyed() && focused.getType() === 'webview') {
    const host = focused.hostWebContents;
    if (host && !host.isDestroyed() && acceptsBrowserCommands(host)) {
      host.send('browser-command', COMMAND[step]);
    } else {
      zoomDirectly(focused, step);
    }
    return;
  }
  const window = BrowserWindow.getFocusedWindow();
  const contents = window?.webContents;
  if (!contents || contents.isDestroyed()) return;
  if (acceptsBrowserCommands(contents)) contents.send('app-zoom-request', step);
  else zoomDirectly(contents, step);
}

/** Changes the app window's own zoom, for its app when nothing of the browser had the keyboard. */
export function zoomAppWindow(contents: WebContents, step: unknown): void {
  if (step === 'in' || step === 'out' || step === 'reset') zoomDirectly(contents, step);
}

/**
 * Puts this zoom in place of Electron's in the View menu: its items hidden and off,
 * these beside them with the same keys — and ⌘= besides ⌘+, as browsers take both.
 */
export function routeMenuZoom(menu: Menu): void {
  const view = menu.items.find(
    item => item.role?.toLowerCase() === 'viewmenu' || item.label === 'View',
  )?.submenu;
  if (!view) return;
  const steps: Record<string, ZoomStep> = { resetzoom: 'reset', zoomin: 'in', zoomout: 'out' };
  const replaced = view.items.flatMap((item, index) => {
    const step = steps[item.role?.toLowerCase() ?? ''];
    return step ? [{ item, index, step }] : [];
  });
  // From the last, so inserting doesn't move the ones still to come.
  for (const { item, index, step } of replaced.reverse()) {
    item.visible = false;
    item.enabled = false;
    const own = (accelerator: string, visible: boolean): MenuItem =>
      new MenuItem({
        label: item.label,
        accelerator,
        visible,
        acceleratorWorksWhenHidden: true,
        click: () => zoom(step),
      });
    view.insert(index + 1, own(step === 'reset' ? 'CommandOrControl+0' : step === 'in' ? 'CommandOrControl+Plus' : 'CommandOrControl+-', true));
    if (step === 'in') view.insert(index + 2, own('CommandOrControl+=', false));
  }
}
