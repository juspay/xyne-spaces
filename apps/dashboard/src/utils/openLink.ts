import { isElectronApp } from './electronApp';
import { detectReactNativeWebView, reactNativeBridge } from './reactNativeBridge';
import { browserPanelActor } from '../machines/browserPanelMachine';
import { logger, Event } from './logger';

const LINK_OPEN_EXTERNAL_KEY = 'xyne:link-open-external-default';

const listeners = new Set<() => void>();
const notify = (): void => {
  listeners.forEach(l => l());
};

export const subscribeLinkOpenPref = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

export const getLinkOpenExternalDefault = (): boolean =>
  localStorage.getItem(LINK_OPEN_EXTERNAL_KEY) !== 'false';

const syncLinkOpenPrefToMain = (value: boolean): void => {
  if (!isElectronApp()) return;
  void window.electronAPI?.setBrowserSettings?.({ openLinksExternally: value });
};

syncLinkOpenPrefToMain(getLinkOpenExternalDefault());

export const setLinkOpenExternalDefault = (value: boolean): void => {
  localStorage.setItem(LINK_OPEN_EXTERNAL_KEY, String(value));
  syncLinkOpenPrefToMain(value);
  notify();
};

type MouseLike = Pick<MouseEvent, 'metaKey' | 'ctrlKey'>;

export interface OpenLinkOpts {
  force?: 'in-app' | 'external';
}

export const linkOpenPrefIsRelevant = (): boolean => isElectronApp() || detectReactNativeWebView();

const wantsExternal = (event?: MouseLike | null, opts?: OpenLinkOpts): boolean => {
  const externalDefault = getLinkOpenExternalDefault();
  const modifier = !!(event?.metaKey || event?.ctrlKey);

  return opts?.force ? opts.force === 'external' : externalDefault !== modifier;
};

// Where the link actually lands: the in-app panel only exists in Electron, so off
// it both branches of openLink end up in the system browser.
export const resolveLinkTarget = (
  event?: MouseLike | null,
  opts?: OpenLinkOpts,
): 'external' | 'in-app' =>
  !wantsExternal(event, opts) && isElectronApp() ? 'in-app' : 'external';

export const openLink = (url: string, event?: MouseLike | null, opts?: OpenLinkOpts): void => {
  const wantExternal = wantsExternal(event, opts);
  const modifier = !!(event?.metaKey || event?.ctrlKey);

  logger.info(modifier ? Event.BROWSER_LINK_CMD_CLICK : Event.BROWSER_LINK_CLICK, {
    url,
    openedIn: resolveLinkTarget(event, opts),
  });

  if (wantExternal) {
    openExternal(url);
  } else {
    openInApp(url);
  }
};

const openExternal = (url: string): void => {
  if (isElectronApp() && window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
    return;
  }
  if (detectReactNativeWebView() && reactNativeBridge.isAvailable()) {
    if (reactNativeBridge.openExternalUrl(url)) return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

const openInApp = (url: string): void => {
  if (isElectronApp()) {
    const { browserPanelState } = browserPanelActor.getSnapshot().context;
    if (browserPanelState === 'open') {
      browserPanelActor.send({ type: 'OPEN_URLS', urls: [url] });
    } else {
      browserPanelActor.send({ type: 'OPEN', urls: [url] });
    }
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};
