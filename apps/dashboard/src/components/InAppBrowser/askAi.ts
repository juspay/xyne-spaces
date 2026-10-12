import { xyneAIActor } from '../../machines/xyneAIMachine';
import { logger, Event } from '../../utils/logger';

/** The longest selection passed on; a page can select a great deal. */
const MAX_TEXT_LENGTH = 10_000;

/**
 * Opens Xyne AI about text selected in a page of the in-app browser, with the page
 * as context.
 *
 * Only the selected text is taken from the page's message. Where it came from —
 * address, site, title — is read off the webview itself: a page's own message
 * could claim to be any site.
 */
export function askAiAboutSelection(
  payload: unknown,
  page: { url: string; title: string },
  trackSource: 'browser_panel',
): void {
  const text =
    typeof payload === 'object' && payload !== null && 'text' in payload ? payload.text : undefined;
  if (typeof text !== 'string' || !text.trim()) return;
  let domain = '';
  try {
    domain = new URL(page.url).hostname;
  } catch {
    return;
  }

  xyneAIActor.send({ type: 'OPEN', trackSource, contextType: 'general' });
  try {
    const contextPill = {
      type: 'browser',
      text: text.slice(0, MAX_TEXT_LENGTH),
      url: page.url,
      domain,
      title: page.title,
      timestamp: Date.now(),
    };
    // Picked up by Xyne AI, whether it opens now or was open already.
    sessionStorage.setItem('xyne-ai-browser-context', JSON.stringify(contextPill));
    window.dispatchEvent(new CustomEvent('xyne-ai-browser-context-ready', { detail: contextPill }));
  } catch (error) {
    logger.error(Event.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[InAppBrowser] Failed to store browser context:'),
      error,
    });
  }
}
