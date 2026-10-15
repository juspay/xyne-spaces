import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useSelector } from '@xstate/react';
import { AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  ExternalLink,
  Globe,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Minus,
  PanelRightClose,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Volume2,
  VolumeX,
  ZoomIn,
} from 'lucide-react';
import { isElectronApp } from '../../utils/electronApp';
import { browserPanelActor, type BrowserTab } from '../../machines/browserPanelMachine';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import { logger, Event } from '../../utils/logger';
import { BrowserHintBar } from '../../components/BrowserPanel/BrowserHintBar';
import { useLinkOpenHintDismissed } from '../../hooks/useLinkOpenHintDismissed';
import { usePlatform } from '../../hooks/usePlatform';
import { useScope, useShortcutById } from '../../shortcuts';
import { hostOf } from '../../utils/browserAddress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  BrowserToolbar,
  DownloadsButton,
  FindBar,
  LoadError,
  MostVisited,
  PageFavicon,
  StartPage,
  TabStrip,
  TabSwitcher,
  ToolbarButton,
  ask,
  desktopHistory,
  preconnect,
  useFindInPage,
  zoomPage,
  type ZoomStep,
  type OpenTabSuggestion,
  type PageKeyCommand,
} from '../../components/InAppBrowser';
import { browserPages, usePageLives } from './browserPages';

/** A playing tab's speaker, as Chrome's: click to mute it, again to hear it. */
function TabSound(props: { tab: BrowserTab }): ReactElement {
  const { tab } = props;
  return (
    <button
      type='button'
      tabIndex={-1}
      // A press here is for the speaker, not the start of dragging the tab.
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        browserPanelActor.send({
          type: 'UPDATE_TAB',
          tabId: tab.id,
          patch: { muted: !tab.muted },
        });
      }}
      title={tab.muted ? 'Unmute this tab' : 'Mute this tab'}
      aria-label={tab.muted ? 'Unmute this tab' : 'Mute this tab'}
      className='flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground'
      data-track-category='BROWSER'
      data-track-name='TabMuteToggled'
    >
      {tab.muted ? <VolumeX className='size-3.5' /> : <Volume2 className='size-3.5' />}
    </button>
  );
}

interface BrowserTabsScreenProps {
  variant?: 'fullscreen' | 'panel';
  pendingUrls?: string[];
}

const TRACK = 'BROWSER';
const newTab = (url = ''): BrowserTab => ({
  id: crypto.randomUUID(),
  url,
  title: url ? hostOf(url) || url : 'New tab',
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
});

/** A tab's name: its page's title, else its site, else that it is new. */
const tabName = (tab: BrowserTab): string =>
  tab.url
    ? tab.title && tab.title !== tab.url
      ? tab.title
      : hostOf(tab.url) || tab.url
    : 'New tab';

/**
 * The app's browser, docked beside the app or full screen: tabs as Chrome draws
 * them — dragged to reorder, kept across a reload — a bar that goes, suggests from
 * history and finds in the page, and a new tab's start page.
 *
 * The pages themselves aren't here: they live in BrowserPageLayer, drawn over the
 * hole this leaves, so docking or undocking never reloads them.
 */
export function BrowserTabsScreen({
  variant = 'fullscreen',
  pendingUrls: externalPendingUrls,
}: BrowserTabsScreenProps = {}): ReactElement {
  const tabs = useSelector(browserPanelActor, state => state.context.tabs);
  const activeTabId = useSelector(browserPanelActor, state => state.context.activeTabId);
  const statePendingUrls = useSelector(browserPanelActor, state => state.context.pendingUrls);
  const canReopen = useSelector(browserPanelActor, state => state.context.closedTabs.length > 0);
  const popupsAllowed = useSelector(
    browserPanelActor,
    state => state.context.browserSettings.popups,
  );
  const { isMac } = usePlatform();
  const { hintDismissed, dismissHint } = useLinkOpenHintDismissed();
  const { track } = useActivityTracking();
  const navigate = useNavigate();

  const isPanel = variant === 'panel';
  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? null;
  const pendingUrls = externalPendingUrls ?? statePendingUrls;
  const mod = isMac ? '⌘' : 'Ctrl+';

  // Re-rendered as pages load, fail and find.
  usePageLives();
  const live = browserPages.live;
  const addressRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [tabListOpen, setTabListOpen] = useState(false);
  // Where the open page shows: given to the page layer while this screen is up.
  const [hole, setHole] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hole) return undefined;
    browserPages.setHole(hole);
    return () => browserPages.releaseHole(hole);
  }, [hole]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeTabId);
  activeRef.current = activeTabId;

  const view = browserPages.view;

  // ─── Tabs ───────────────────────────────────────────────────────────────────
  const openTab = useCallback(
    (url = '', options: { after?: string; background?: boolean } = {}): void => {
      browserPanelActor.send({
        type: 'ADD_TAB',
        tab: newTab(url),
        ...(options.after && { after: options.after }),
        ...(options.background && { background: true }),
      });
    },
    [],
  );

  const switchTab = useCallback((tabId: string): void => {
    browserPanelActor.send({ type: 'SWITCH_TAB', tabId });
  }, []);

  const closeTab = (tabId: string): void => {
    const wasLast = tabs.length === 1 && tabs[0]?.id === tabId;
    browserPanelActor.send({ type: 'CLOSE_TAB', tabId });
    if (!wasLast) return;
    if (isPanel) browserPanelActor.send({ type: 'CLOSE' });
    else void navigate(-1);
  };

  /** The tab beside the open one, wrapping round. */
  const stepTab = useCallback(
    (by: 1 | -1): void => {
      const list = tabsRef.current;
      const index = list.findIndex(tab => tab.id === activeRef.current);
      const next = list[(index + by + list.length) % list.length];
      if (next) switchTab(next.id);
    },
    [switchTab],
  );

  // Links from elsewhere in the app: to the tab already on that page, else a new one.
  useEffect(() => {
    if (!pendingUrls || pendingUrls.length === 0 || !isElectronApp()) return;
    for (const url of pendingUrls) {
      const existing = tabsRef.current.find(tab => tab.url === url);
      if (existing) switchTab(existing.id);
      else openTab(url);
    }
    browserPanelActor.send({ type: 'OPEN_URLS', urls: [] });
  }, [pendingUrls, openTab, switchTab]);

  // The browser's settings live in the desktop app, which has the last word on them.
  useEffect(() => {
    if (!isElectronApp() || !window.electronAPI?.getBrowserSettings) return;
    void window.electronAPI.getBrowserSettings().then(settings => {
      browserPanelActor.send({ type: 'UPDATE_SETTINGS', settings });
    });
  }, []);

  const setPopupsAllowed = (allowed: boolean): void => {
    browserPanelActor.send({ type: 'UPDATE_SETTINGS', settings: { popups: allowed } });
    void window.electronAPI?.setBrowserSettings?.({ popups: allowed });
  };

  // ─── The open page ──────────────────────────────────────────────────────────
  /** Where the open tab goes: its page if it has one, else it starts one there. */
  const go = (url: string): void => {
    const target = view(activeTabId);
    if (activeTab && activeTab.url && target) {
      void ask(() => target.loadURL(url), Promise.resolve()).catch(() => undefined);
      return;
    }
    if (activeTab) {
      browserPanelActor.send({
        type: 'UPDATE_TAB',
        tabId: activeTab.id,
        patch: { url, title: hostOf(url) || url },
      });
    } else {
      openTab(url);
    }
  };

  const find = useFindInPage(
    {
      // Electron's findNext begins a new search; ours is a step in this one.
      find: (key, text, forward, step) =>
        ask(() => view(key)?.findInPage(text, { forward, findNext: !step }), 0),
      stop: key => {
        ask(() => view(key)?.stopFindInPage('clearSelection'), undefined);
        browserPages.setLive(key, { find: null });
      },
    },
    activeTabId ?? '',
  );

  /** Takes the keyboard back from a page, so the bar or a list can have it. */
  const takeFocusBack = (): void => {
    void window.electronAPI?.focusHostWebContents?.();
  };
  const focusAddress = useCallback((): void => {
    requestAnimationFrame(() => addressRef.current?.focus());
  }, []);

  const runCommand = (command: PageKeyCommand): void => {
    const page = view(activeRef.current);
    if (command === 'back') ask(() => page?.canGoBack() && page.goBack(), undefined);
    else if (command === 'forward') ask(() => page?.canGoForward() && page.goForward(), undefined);
    else if (command === 'nextTab') stepTab(1);
    else if (command === 'previousTab') stepTab(-1);
    else {
      takeFocusBack();
      if (command === 'focusAddress') focusAddress();
      else setTabListOpen(true);
    }
  };
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  const findRef = useRef(find);
  findRef.current = find;

  // What a page asks of the screen around it — the address bar, the tab list, find —
  // pressed inside it, which the page layer passes on.
  useEffect(
    () =>
      browserPages.onCommand(command => {
        if (command === 'find') findRef.current.open();
        else runCommandRef.current(command);
      }),
    [],
  );

  // The browser's own keys, while it has the keyboard — full screen, it always has.
  const [hasKeyboard, setHasKeyboard] = useState(false);
  useEffect(() => {
    const update = (): void =>
      setHasKeyboard(Boolean(rootRef.current?.contains(document.activeElement)));
    const later = (): void => {
      requestAnimationFrame(update);
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    update();
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
    };
  }, []);
  useScope('in-app-browser', hasKeyboard || !isPanel);
  const inScope = { scope: 'in-app-browser' };
  useShortcutById('browser.newTab', () => openTab(), inScope);
  useShortcutById('browser.tabs', () => setTabListOpen(open => !open), inScope);
  useShortcutById('browser.find', () => find.open(), inScope);
  useShortcutById('browser.focusAddress', focusAddress, inScope);
  useShortcutById(
    'browser.reload',
    () => ask(() => view(activeRef.current)?.reload(), undefined),
    inScope,
  );
  useShortcutById('browser.back', () => runCommandRef.current('back'), inScope);
  useShortcutById('browser.forward', () => runCommandRef.current('forward'), inScope);
  useShortcutById('browser.nextTab', () => stepTab(1), inScope);
  useShortcutById('browser.previousTab', () => stepTab(-1), inScope);
  useShortcutById(
    'browser.reopenTab',
    () => browserPanelActor.send({ type: 'REOPEN_TAB' }),
    inScope,
  );
  const zoom = (step: ZoomStep): void => {
    const tabId = activeRef.current;
    const page = view(tabId);
    if (page && tabId) browserPages.setLive(tabId, { zoom: zoomPage(page, step) });
  };
  // The View menu's zoom (⌘+, ⌘-, ⌘0) is the open page's while the browser has the
  // keyboard — full screen, it always has.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const takesZoom = hasKeyboard || !isPanel;
  useEffect(() => {
    if (!takesZoom) return undefined;
    browserPages.setPageZoomer(step => {
      if (!view(activeRef.current)) return false;
      zoomRef.current(step);
      return true;
    });
    return () => browserPages.setPageZoomer(null);
  }, [takesZoom]);
  useShortcutById('browser.zoomIn', () => zoom('in'), inScope);
  useShortcutById('browser.zoomOut', () => zoom('out'), inScope);
  useShortcutById('browser.zoomReset', () => zoom('reset'), inScope);

  if (!isElectronApp()) {
    return (
      <div className='flex h-full items-center justify-center bg-background'>
        <div className='text-center text-muted-foreground'>
          <Globe size={48} className='mx-auto mb-4 opacity-50' />
          <p>Browser tabs are only available in the desktop app.</p>
        </div>
      </div>
    );
  }

  const activeLive = live(activeTabId);
  const activeUrl = activeTab?.url ?? '';
  const web = /^https?:/.test(activeUrl);
  const openTabs: OpenTabSuggestion[] = tabs
    .filter(tab => tab.id !== activeTabId && tab.url)
    .map(tab => ({ key: tab.id, url: tab.url, title: tabName(tab), favicon: tab.favicon ?? '' }));

  const closePanel = (): void => {
    logger.info(Event.BROWSER_PANEL_CLOSED, { url: activeTab?.url, tabCount: tabs.length });
    browserPanelActor.send({ type: 'CLOSE' });
  };
  const toggleFullScreen = (): void => {
    if (isPanel) {
      void navigate('/browser');
      browserPanelActor.send({ type: 'CLOSE' });
      return;
    }
    void navigate(-1);
    browserPanelActor.send({ type: 'OPEN' });
    track({
      eventCategory: TRACK,
      eventName: 'MinimizeToDocked',
      eventLabel: 'Minimize from fullscreen to panel',
      contextMetadata: { tabs: tabs.map(tab => ({ id: tab.id, url: tab.url })) },
    });
  };

  const menuItem = 'gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]';
  const menuIcon = 'size-4 text-muted-foreground';

  return (
    <div
      ref={rootRef}
      className='flex h-full flex-col overflow-hidden bg-background shadow-md md:rounded-2xl'
    >
      {/* The tabs, as Chrome draws them: + follows the last; the list of every tab
          and closing the panel sit at the far end. */}
      {/* Taking the keyboard back from a page as the pointer arrives: while a page
          has it, the first click on anything here would only hand it back. */}
      <div onPointerEnter={takeFocusBack} className='flex h-10 shrink-0 items-stretch bg-muted/70'>
        <TabStrip
          variant='chrome'
          tabs={tabs.map(tab => ({
            key: tab.id,
            name: tabName(tab),
            tooltip: tab.url ? `${tabName(tab)}\n${tab.url}` : 'New tab',
            icon: <PageFavicon favicon={tab.favicon} loading={live(tab.id).loading} />,
            ...((live(tab.id).playing || tab.muted) && { badge: <TabSound tab={tab} /> }),
          }))}
          activeKey={activeTabId}
          onSelect={switchTab}
          onClose={closeTab}
          onReorder={(from, to) => browserPanelActor.send({ type: 'MOVE_TAB', from, to })}
          label='Open tabs'
          trackCategory={TRACK}
          trackNames={{ select: 'SwitchTab', close: 'CloseTab' }}
        />
        <div className='flex shrink-0 items-center pl-1 pt-1.5'>
          <ToolbarButton
            label={`New tab (${mod}T)`}
            onClick={() => openTab()}
            trackCategory={TRACK}
            trackName='CreateNewTab'
          >
            <Plus className='size-4' />
          </ToolbarButton>
        </div>
        <div className='ml-auto flex shrink-0 items-center gap-0.5 pl-2 pr-1.5 pt-1.5'>
          <Tooltip content={`All open tabs (${mod}P)`} delayDuration={600}>
            <ToolbarButton
              label='All open tabs'
              onClick={() => setTabListOpen(true)}
              pressed={tabListOpen}
              trackCategory={TRACK}
              trackName='OpenTabList'
            >
              <ChevronDown className='size-4' />
            </ToolbarButton>
          </Tooltip>
        </div>
      </div>

      <BrowserToolbar
        url={activeUrl}
        loading={activeLive.loading}
        canGoBack={activeTab?.canGoBack ?? false}
        canGoForward={activeTab?.canGoForward ?? false}
        onBack={() => runCommand('back')}
        onForward={() => runCommand('forward')}
        onReload={() => ask(() => view(activeTabId)?.reload(), undefined)}
        onStop={() => ask(() => view(activeTabId)?.stop(), undefined)}
        onGo={go}
        addressRef={addressRef}
        history={desktopHistory}
        openTabs={openTabs}
        onSwitchTab={switchTab}
        preconnect={preconnect}
        addressTrailing={
          web && activeLive.zoom !== 1 ? (
            // Zoomed, as Chrome's bar says: a click puts it back to 100%.
            <button
              type='button'
              onClick={() => zoom('reset')}
              title='Reset zoom to 100%'
              className='shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10'
              data-track-category={TRACK}
              data-track-name='BrowserZoomReset'
            >
              {Math.round(activeLive.zoom * 100)}%
            </button>
          ) : null
        }
        find={
          find.text !== null && (
            <FindBar
              text={find.text}
              result={activeLive.find}
              onChange={find.setText}
              onStep={find.step}
              onClose={find.close}
              inputRef={find.inputRef}
              trackCategory={TRACK}
            />
          )
        }
        trailing={
          <>
            <DownloadsButton />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <ToolbarButton label='More' trackCategory={TRACK} trackName='BrowserMenuOpened'>
                  <MoreHorizontal className='size-4' />
                </ToolbarButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-60'>
                <DropdownMenuItem
                  className={menuItem}
                  onSelect={() => openTab()}
                  data-track-category={TRACK}
                  data-track-name='BrowserMenuNewTab'
                >
                  <Plus className={menuIcon} />
                  New tab
                  <span className='ml-auto text-xs text-muted-foreground'>{mod}T</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={menuItem}
                  disabled={!canReopen}
                  onSelect={() => browserPanelActor.send({ type: 'REOPEN_TAB' })}
                  data-track-category={TRACK}
                  data-track-name='BrowserMenuReopenTab'
                >
                  <RotateCcw className={menuIcon} />
                  Reopen closed tab
                  <span className='ml-auto text-xs text-muted-foreground'>{mod}⇧T</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={menuItem}
                  disabled={!web}
                  onSelect={() => find.open()}
                  data-track-category={TRACK}
                  data-track-name='BrowserMenuFind'
                >
                  <Search className={menuIcon} />
                  Find in page
                  <span className='ml-auto text-xs text-muted-foreground'>{mod}F</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={menuItem}
                  disabled={!web}
                  onSelect={() => window.electronAPI?.openExternal(activeUrl)}
                  data-track-category={TRACK}
                  data-track-name='OpenInSystemBrowser'
                >
                  <ExternalLink className={menuIcon} />
                  Open in your browser
                </DropdownMenuItem>
                {/* Zoom, as Chrome's menu has it: a step out, the page's size — back to
                  100% when pressed — and a step in. It stays open while used. */}
                <div className='flex items-center gap-2.5 px-2.5 py-1 text-[13px]'>
                  <ZoomIn className={menuIcon} />
                  <span className={web ? 'text-foreground' : 'text-muted-foreground'}>Zoom</span>
                  <div className='ml-auto flex items-center gap-0.5'>
                    <ToolbarButton
                      label={`Zoom out (${mod}-)`}
                      disabled={!web}
                      onClick={() => zoom('out')}
                      trackCategory={TRACK}
                      trackName='BrowserMenuZoomOut'
                    >
                      <Minus className='size-3.5' />
                    </ToolbarButton>
                    <button
                      type='button'
                      disabled={!web}
                      onClick={() => zoom('reset')}
                      title='Reset to 100%'
                      className='min-w-[3.25rem] rounded-md px-1 py-1 text-center text-[12px] tabular-nums text-foreground outline-none transition-colors hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] disabled:text-muted-foreground'
                      data-track-category={TRACK}
                      data-track-name='BrowserMenuZoomReset'
                    >
                      {Math.round(activeLive.zoom * 100)}%
                    </button>
                    <ToolbarButton
                      label={`Zoom in (${mod}+)`}
                      disabled={!web}
                      onClick={() => zoom('in')}
                      trackCategory={TRACK}
                      trackName='BrowserMenuZoomIn'
                    >
                      <Plus className='size-3.5' />
                    </ToolbarButton>
                  </div>
                </div>
                <DropdownMenuItem
                  className={menuItem}
                  onSelect={toggleFullScreen}
                  data-track-category={TRACK}
                  data-track-name={isPanel ? 'OpenFullscreenBrowser' : 'MinimizeToDocked'}
                >
                  {isPanel ? (
                    <Maximize2 className={menuIcon} />
                  ) : (
                    <Minimize2 className={menuIcon} />
                  )}
                  {isPanel ? 'Open full screen' : 'Dock on the right'}
                  <span className='ml-auto text-xs text-muted-foreground'>{mod}⇧F</span>
                </DropdownMenuItem>
                {isPanel && (
                  // Hidden, not closed: its tabs and pages stay, and ⌘⇧B brings it back.
                  <DropdownMenuItem
                    className={menuItem}
                    onSelect={closePanel}
                    data-track-category={TRACK}
                    data-track-name='CloseBrowserPanel'
                  >
                    <PanelRightClose className={menuIcon} />
                    Hide browser
                    <span className='ml-auto text-xs text-muted-foreground'>{mod}⇧B</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={menuItem}
                  // Stays open, as a switch does.
                  onSelect={event => {
                    event.preventDefault();
                    setPopupsAllowed(!popupsAllowed);
                  }}
                  data-track-category={TRACK}
                  data-track-name='BrowserPopupsToggled'
                >
                  <span className='flex size-4 items-center justify-center'>
                    {popupsAllowed && <Check className='size-4' />}
                  </span>
                  Allow pop-ups
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={menuItem}
                  onSelect={() =>
                    window.dispatchEvent(
                      new CustomEvent('xyne-open-preferences', { detail: { section: 'browser' } }),
                    )
                  }
                  data-track-category={TRACK}
                  data-track-name='OpenBrowserPreferences'
                >
                  <Settings className={menuIcon} />
                  Browser settings…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        pageKey={activeTabId ?? ''}
        onPointerEnter={takeFocusBack}
        trackCategory={TRACK}
      />

      <AnimatePresence>
        {!hintDismissed && (
          <BrowserHintBar
            key='browser-hint-bar'
            isMac={isMac}
            onOpenPreferences={() => {
              dismissHint();
              window.dispatchEvent(
                new CustomEvent('xyne-open-preferences', { detail: { section: 'messaging' } }),
              );
            }}
            onDismiss={dismissHint}
          />
        )}
      </AnimatePresence>

      {/* The hole the page layer draws the open page over. */}
      <div ref={setHole} className='relative min-h-0 flex-1 overflow-hidden bg-background'>
        {activeLive.error && activeTab && (
          <LoadError
            error={activeLive.error}
            onRetry={() => {
              const page = view(activeTab.id);
              const url = activeLive.error?.url || activeTab.url;
              if (page) void ask(() => page.loadURL(url), Promise.resolve()).catch(() => undefined);
            }}
            trackCategory={TRACK}
          />
        )}

        {(!activeTab || !activeTab.url) && (
          <div className='absolute inset-0'>
            <StartPage
              onGo={go}
              history={desktopHistory}
              openTabs={openTabs}
              onSwitchTab={switchTab}
              preconnect={preconnect}
              keys={[
                { keys: `${mod}T`, label: 'New tab' },
                { keys: `${mod}L`, label: 'Address' },
                { keys: `${mod}F`, label: 'Find in page' },
                { keys: `${mod}P`, label: 'All tabs' },
              ]}
              trackCategory={TRACK}
            >
              <MostVisited history={desktopHistory} onGo={go} trackCategory={TRACK} />
            </StartPage>
          </div>
        )}
      </div>

      <TabSwitcher
        open={tabListOpen}
        onOpenChange={setTabListOpen}
        entries={tabs.map(tab => ({
          key: tab.id,
          name: tabName(tab),
          detail: tab.url ? hostOf(tab.url) : 'New tab',
          icon: <PageFavicon favicon={tab.favicon} loading={live(tab.id).loading} />,
          current: tab.id === activeTabId,
        }))}
        onOpen={switchTab}
        onClose={closeTab}
        onCloseAll={() => {
          for (const tab of tabs) browserPanelActor.send({ type: 'CLOSE_TAB', tabId: tab.id });
          if (isPanel) browserPanelActor.send({ type: 'CLOSE' });
          else void navigate(-1);
        }}
        where='anywhere in the browser'
        trackCategory={TRACK}
      />
    </div>
  );
}
