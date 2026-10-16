import { ask } from './ask';
import type { WebviewElement } from './BrowserWebview';
import type { PageMenuAction } from './PageContextMenu';

/**
 * Does what a page's right-click menu was asked, on that page — the same in every
 * in-app browser. Where a link opens, and whether a page can be saved, are the
 * browser's own: a tab beside it, the same view, a folder's tab.
 */
export function runPageMenuAction(
  page: WebviewElement,
  action: PageMenuAction,
  browser: { openInTab: (url: string) => void; savePage?: () => void },
): void {
  ask(() => {
    switch (action.type) {
      case 'back':
        page.goBack();
        break;
      case 'forward':
        page.goForward();
        break;
      case 'reload':
        page.reload();
        break;
      case 'undo':
      case 'redo':
      case 'cut':
      case 'copy':
      case 'paste':
      case 'selectAll':
        // An edit acts on the page's own focused field, so the page takes focus back.
        page.focus();
        page[action.type]();
        break;
      case 'replaceMisspelling':
        page.focus();
        page.replaceMisspelling(action.value);
        break;
      case 'copyImage':
        page.copyImageAt(action.x, action.y);
        break;
      case 'inspect':
        page.inspectElement(action.x, action.y);
        break;
      case 'copyText':
        void navigator.clipboard.writeText(action.value).catch(() => undefined);
        break;
      case 'openExternally':
        window.electronAPI?.openExternal(action.value);
        break;
      case 'openInTab':
        browser.openInTab(action.value);
        break;
      case 'savePage':
        browser.savePage?.();
        break;
    }
    return null;
  }, null);
}
