import { toast } from 'sonner';
import { isElectronApp } from './electronApp';
import { detectReactNativeWebView, reactNativeBridge } from './reactNativeBridge';
import { browserPanelActor } from '../machines/browserPanelMachine';

const LINK_OPEN_EXTERNAL_KEY = 'xyne:link-open-external-default';
const LINK_OPEN_HINT_DISMISSED_KEY = 'xyne:link-open-hint-dismissed';

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
  localStorage.getItem(LINK_OPEN_EXTERNAL_KEY) === 'true';

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

const getHintDismissed = (): boolean =>
  localStorage.getItem(LINK_OPEN_HINT_DISMISSED_KEY) === 'true';

const markHintDismissed = (): void => {
  localStorage.setItem(LINK_OPEN_HINT_DISMISSED_KEY, 'true');
  notify();
};

type MouseLike = Pick<MouseEvent, 'metaKey' | 'ctrlKey'>;

export interface OpenLinkOpts {
  force?: 'in-app' | 'external';
  silent?: boolean;
}

export const linkOpenPrefIsRelevant = (): boolean => isElectronApp() || detectReactNativeWebView();

export const openLink = (url: string, event?: MouseLike | null, opts?: OpenLinkOpts): void => {
  const externalDefault = getLinkOpenExternalDefault();
  const modifier = !!(event?.metaKey || event?.ctrlKey);

  const wantExternal = opts?.force ? opts.force === 'external' : externalDefault !== modifier;

  if (wantExternal) {
    openExternal(url);
  } else {
    openInApp(url);
    if (!opts?.silent) maybeShowHint();
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

const maybeShowHint = (): void => {
  if (!isElectronApp()) return;
  if (getHintDismissed()) return;

  toast.info('⌘/Ctrl-click for external browser', {
    duration: Infinity,
    style: { width: '360px', maxWidth: 'calc(100vw - 32px)' },
    cancel: {
      label: 'Open Preferences',
      onClick: () => {
        markHintDismissed();
        window.dispatchEvent(
          new CustomEvent('xyne-open-preferences', { detail: { section: 'messaging' } }),
        );
      },
    },
    onDismiss: markHintDismissed,
  });
};
