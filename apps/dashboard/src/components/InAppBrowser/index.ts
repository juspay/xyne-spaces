/**
 * The in-app browser, as both of the app's browsers draw it: a folder's tabs and
 * the browser panel. Each keeps its own tabs and pages; what they look like and
 * how a page behaves is here, once.
 */
export { AddressBar, type OpenTabSuggestion } from './AddressBar';
export { askAiAboutSelection } from './askAi';
export { BrowserToolbar } from './BrowserToolbar';
export {
  BrowserWebview,
  IDLE_PAGE,
  ask,
  type PageLive,
  type WebviewElement,
} from './BrowserWebview';
export { FindBar, type FindResult } from './FindBar';
export {
  canClearBrowsingHistory,
  clearBrowsingHistory,
  desktopHistory,
  preconnect,
  type BrowserHistoryPage,
  type HistorySource,
  type HistorySuggestions,
} from './history';
export { LoadError, type PageLoadError } from './LoadError';
export { LoadingBar } from './LoadingBar';
export { LinkPreview } from './LinkPreview';
export { DownloadsButton } from './DownloadsButton';
export {
  actOnDownload,
  clearFinishedDownloads,
  currentDownloads,
  keepDownloads,
  subscribeToDownloads,
  useBrowserDownloads,
  type BrowserDownload,
} from './downloads';
export { PageContextMenu, type PageMenuAction, type PageMenuParams } from './PageContextMenu';
export {
  KEY_RELAY,
  desktopPassesPageKeys,
  subscribeToAppKeys,
  subscribeToPageKeys,
  type AppKeyCommand,
  type PageKeyCommand,
} from './pageKeys';
export { MostVisited, SiteTile, SiteTiles, StartPage, StartSection, siteLetter } from './StartPage';
export { PageFavicon, TabName, TabStrip, type StripTab, type TabStripVariant } from './TabStrip';
export { TabSwitcher, type TabSwitcherEntry } from './TabSwitcher';
export { ToolbarButton } from './ToolbarButton';
export { runPageMenuAction } from './pageMenuActions';
export { useKeptAlive, type KeepAlivePolicy } from './keepAlive';
export { useFirstSeenOrder } from './firstSeenOrder';
export { useFindInPage, type FindControl } from './useFindInPage';
export { zoomFor, zoomPage, type ZoomStep } from './zoom';
export { isOnBattery } from './power';
