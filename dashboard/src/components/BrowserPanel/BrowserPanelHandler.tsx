import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { isElectronApp } from '../../utils/electronApp';
import { browserPanelActor } from '../../machines/browserPanelMachine';
import { xyneAIActor } from '../../machines/xyneAIMachine';

export function BrowserPanelHandler(): null {
  const location = useLocation();
  const isOnBrowserRoute = location.pathname === '/browser';
  const browserPanelState = useSelector(
    browserPanelActor,
    state => state.context.browserPanelState,
  );

  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI;
    if (!api?.onOpenInBrowserPanel) return;

    const cleanup = api.onOpenInBrowserPanel((url: string) => {
      console.log(
        '[BrowserPanelHandler] Opening external URL:',
        url,
        'isOnBrowserRoute:',
        isOnBrowserRoute,
        'panelState:',
        browserPanelState,
      );

      if (isOnBrowserRoute) {
        const browserApi = api.browserTabs;
        if (browserApi) {
          void browserApi.create(url);
        }
      } else {
        xyneAIActor.send({ type: 'CLOSE' });

        if (browserPanelState === 'open') {
          browserPanelActor.send({ type: 'OPEN_URLS', urls: [url] });
        } else {
          // Panel closed - open it with the URL
          browserPanelActor.send({ type: 'OPEN', urls: [url] });
        }
      }
    });

    return cleanup;
  }, [isOnBrowserRoute, browserPanelState]);

  return null;
}
