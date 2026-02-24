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
      xyneAIActor.send({ type: 'CLOSE' });

      if (browserPanelState === 'open' || isOnBrowserRoute) {
        browserPanelActor.send({ type: 'OPEN_URLS', urls: [url] });
      } else {
        browserPanelActor.send({ type: 'OPEN', urls: [url] });
      }
    });

    return cleanup;
  }, [isOnBrowserRoute, browserPanelState]);

  return null;
}
