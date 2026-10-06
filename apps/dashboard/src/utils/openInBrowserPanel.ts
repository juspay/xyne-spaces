import { browserPanelActor } from '../machines/browserPanelMachine';
import { isXyneOrigin } from './browserPanelPartition';
import { logger, Event as LogEvent } from './logger';

export async function syncBrowserPanelCookies(urls: readonly string[]): Promise<void> {
  const sync = window.electronAPI?.syncXyneCookiesToBrowserPanel;
  if (!sync) return;
  const origins = new Set<string>();
  for (const url of urls) {
    if (!isXyneOrigin(url)) continue;
    origins.add(new URL(url).origin);
  }
  await Promise.all(
    [...origins].map(origin =>
      sync(origin).catch((error: unknown) => {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[openInBrowserPanel] cookie sync failed:'),
          context: [error],
        });
      }),
    ),
  );
}

export function sendUrlsToBrowserPanel(type: 'OPEN' | 'OPEN_URLS', urls: string[]): void {
  void syncBrowserPanelCookies(urls).finally(() => {
    browserPanelActor.send(type === 'OPEN' ? { type: 'OPEN', urls } : { type: 'OPEN_URLS', urls });
  });
}
