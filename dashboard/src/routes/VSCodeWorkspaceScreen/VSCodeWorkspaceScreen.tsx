/**
 * VSCodeWorkspaceScreen - Standalone VS Code view for xyne-spaces folder
 * Opens the last workspace or xyne-spaces directory in code-server
 * This component stays mounted at AppRoot level for persistence
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Code2,
  MessageSquare,
  Fullscreen,
  Minimize,
  X,
  Folder,
  ChevronDown,
  Plus,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { isElectronApp } from '../../utils/electronApp';
import { useCodeServer } from '../../contexts/CodeServerContext';
import { useVSCode } from '../../contexts/VSCodeContext';
import { queries } from '../../zero/queries';
import { ThreadMessages } from '../../components/Chat/ThreadPannel';
import { ThreadSummary } from '../../components/Chat/Summary';

import { useMachine } from '@xstate/react';
import { vscodeWorkspaceMachine, type EditorTab } from '../../machines/vscodeWorkspaceMachine';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const VSCodeWorkspaceScreen: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { status: codeServerStatus, isAvailable: isCodeServerAvailable } = useCodeServer();
  const { lastWorkspace, registerSession } = useVSCode();

  const [vsCodeUrl, setVsCodeUrl] = useState<string | null>(null);
  const [_workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [activeBranchName, setActiveBranchName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [state, send] = useMachine(vscodeWorkspaceMachine);

  const isManualWorkspaceSwitchRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const startAttemptRef = useRef(false);

  // Use safer destructuring to prevent crash if context is missing
  const context = state?.context || {
    tabs: [],
    activeTabId: null,
    tabSummaryStates: {},
    isThreadOpen: false,
  };
  const { tabs, activeTabId, tabSummaryStates, isThreadOpen } = context;

  // Get ticket ID from lastWorkspace (passed when opening from ticket)
  const ticketId = lastWorkspace?.ticketId;

  // Query ticket by ID if we have a ticket ID
  const [ticket] = useCachedQuery(queries.ticketById({ ticketId: ticketId || '' }), {
    enabled: !!ticketId,
  });

  // Check if we should show the Thread button/tab for the main workspace ticket
  const showMainThread = !!ticket?.conversationId && !!ticket?.conversation?.channelId;

  // Helper to add or switch to a tab
  const addTab = useCallback(
    (tab: EditorTab) => {
      send({ type: 'ADD_TAB', tab });
    },
    [send],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      send({ type: 'CLOSE_TAB', tabId });
    },
    [send],
  );

  const handleWorkspaceTabClick = useCallback(
    (tab: EditorTab) => {
      if (tab.type === 'workspace' && tab.workspaceInfo) {
        const newUrl = tab.workspaceInfo.folderUrl;

        isManualWorkspaceSwitchRef.current = true;

        setWorkspacePath(tab.workspaceInfo.folderPath);
        setActiveBranchName(tab.workspaceInfo.folderName);
        setVsCodeUrl(newUrl);

        send({ type: 'SET_ACTIVE_TAB', tabId: tab.id });
        send({ type: 'SET_THREAD_OPEN', isOpen: false });

        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.src = newUrl;
          }
          isManualWorkspaceSwitchRef.current = false;
        }, 100);
      } else {
        send({ type: 'SET_ACTIVE_TAB', tabId: tab.id });
      }
    },
    [send],
  );

  const handleOpenFolder = useCallback(async () => {
    if (!isElectronApp()) return;

    const api = window.electronAPI?.codeServer;
    if (!api) return;

    try {
      const folderPath = await api.openFolderDialog();
      if (!folderPath) return;

      const folderUrl = await api.getUrlWithFolder(folderPath);
      if (!folderUrl) return;

      const folderName = folderPath.split('/').pop() || 'Unknown';

      isManualWorkspaceSwitchRef.current = true;

      setWorkspacePath(folderPath);
      setActiveBranchName(folderName);
      setVsCodeUrl(folderUrl);

      send({
        type: 'SWITCH_TO_WORKSPACE',
        folderUrl,
        folderPath,
        folderName,
      });

      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = folderUrl;
        }
        isManualWorkspaceSwitchRef.current = false;
      }, 100);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to open folder:', err);
    }
  }, [send]);

  // Add initial main tab if ticket is available
  useEffect(() => {
    if (showMainThread && ticket) {
      const ticketTitle = ticket.xyneId || ticket.title || ticket.id;
      const mainTab: EditorTab = {
        id: 'main-thread',
        type: 'main',
        title: ticketTitle,
        conversationId: ticket.conversationId ?? undefined,
        channelId: ticket.conversation?.channelId || '',
        ticketId: ticket.id,
      };

      const existingTab = tabs.find(t => t.type === 'main');
      if (!existingTab) {
        send({ type: 'ADD_TAB', tab: mainTab });
      } else if (existingTab.title !== ticketTitle) {
        // Update title if it has changed (e.g. from "Thread" to ticket ID)
        send({ type: 'UPDATE_TAB_TITLE', tabId: existingTab.id, title: ticketTitle });
      }
    }
  }, [showMainThread, ticket, tabs, send]);

  // Listen for custom event from notifications to open thread
  useEffect(() => {
    const handleOpenThread = (event: Event): void => {
      const customEvent = event as CustomEvent<{
        conversationId?: string;
        channelId?: string;
        messageId?: string;
      }>;

      const { conversationId, channelId } = customEvent.detail || {};

      if (conversationId && channelId) {
        addTab({
          id: conversationId,
          type: 'notification',
          title: 'New Message',
          conversationId,
          channelId,
        });
      }
    };

    window.addEventListener('vscode-open-thread', handleOpenThread);

    return (): void => {
      window.removeEventListener('vscode-open-thread', handleOpenThread);
    };
  }, [addTab]);

  useEffect(() => {
    const startCodeServer = async (): Promise<void> => {
      if (!isElectronApp() || startAttemptRef.current) return;

      const api = window.electronAPI?.codeServer;
      if (!api) return;

      if (
        codeServerStatus?.binaryInstalled &&
        !codeServerStatus.isRunning &&
        !codeServerStatus.isDownloading
      ) {
        try {
          startAttemptRef.current = true;
          console.log('[VSCode] Code server not running, attempting to start...');
          await api.start();
        } catch (err) {
          console.error('[VSCode] Failed to auto-start code server:', err);
        } finally {
          setTimeout(() => {
            startAttemptRef.current = false;
          }, 5000);
        }
      }

      if (!codeServerStatus) {
        try {
          await api.getStatus();
        } catch (err) {
          console.error('[VSCode] Failed to get code server status:', err);
        }
      }
    };

    void startCodeServer();
  }, [codeServerStatus]);

  // Initialize workspace - use last workspace or default to xyne-spaces dir
  const setupWorkspace = useCallback(async () => {
    if (!isElectronApp()) return;

    const api = window.electronAPI?.codeServer;
    if (!api) {
      console.error('[VSCode] No codeServer API available');
      return;
    }

    if (hasInitializedRef.current) {
      console.log('[VSCode] Already initialized, skipping setup');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // If we have a last workspace path, get fresh URL from code server
      if (lastWorkspace?.path) {
        console.log('[VSCode] Using last workspace path:', lastWorkspace.path);

        const freshUrl = await api.getUrlWithFolder(lastWorkspace.path);
        if (!freshUrl) {
          console.log('[VSCode] Failed to get URL for last workspace, will use default');
        } else {
          console.log('[VSCode] Fresh URL for workspace:', freshUrl);
          setVsCodeUrl(freshUrl);
          setWorkspacePath(lastWorkspace.path);
          setActiveBranchName(lastWorkspace.branchName || 'xyne-spaces');

          const folderName = lastWorkspace.path.split('/').pop() || 'Unknown';
          send({
            type: 'SWITCH_TO_WORKSPACE',
            folderUrl: freshUrl,
            folderPath: lastWorkspace.path,
            folderName,
          });

          hasInitializedRef.current = true;
          setIsLoading(false);
          return;
        }
      }

      // Otherwise, open xyne-spaces directory
      console.log('[VSCode] No last workspace, getting xyne-spaces dir...');
      const xyneSpacesDir = await api.getXyneSpacesDir();
      console.log('[VSCode] xyne-spaces dir:', xyneSpacesDir);

      const url = await api.getUrlWithFolder(xyneSpacesDir);
      console.log('[VSCode] URL with folder:', url);

      if (!url) {
        console.log('[VSCode] getUrlWithFolder failed, trying base URL...');
        const baseUrl = await api.getUrl();
        console.log('[VSCode] Base URL:', baseUrl);

        if (!baseUrl) {
          setError('Failed to get VS Code URL');
          setIsLoading(false);
          return;
        }

        setVsCodeUrl(baseUrl);
        setWorkspacePath(null);
        setActiveBranchName('');
        hasInitializedRef.current = true;
        setIsLoading(false);
        return;
      }

      setVsCodeUrl(url);
      setWorkspacePath(xyneSpacesDir);
      setActiveBranchName('xyne-spaces');
      registerSession(xyneSpacesDir, url, 'xyne-spaces');

      // Create workspace tab for xyne-spaces
      const folderName = xyneSpacesDir.split('/').pop() || 'xyne-spaces';
      send({
        type: 'SWITCH_TO_WORKSPACE',
        folderUrl: url,
        folderPath: xyneSpacesDir,
        folderName,
      });
      hasInitializedRef.current = true;
    } catch (err) {
      console.error('[VSCode] Setup workspace error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [registerSession, send, lastWorkspace]);

  useEffect(() => {
    if (isCodeServerAvailable && !vsCodeUrl && !hasInitializedRef.current) {
      void setupWorkspace();
    }
  }, [setupWorkspace, vsCodeUrl, isCodeServerAvailable]);

  // Sync with lastWorkspace changes (e.g., when opened from ticket modal or docs edit)
  // Force iframe reload when branch changes even if URL is the same
  useEffect(() => {
    // Skip if we're doing a manual workspace switch
    if (isManualWorkspaceSwitchRef.current) return;
    if (!isElectronApp()) return;

    const syncWorkspace = async (): Promise<void> => {
      try {
        if (!lastWorkspace?.path) return;

        const api = window.electronAPI?.codeServer;
        if (!api) return;

        console.log('[VSCode] Syncing workspace from lastWorkspace:', lastWorkspace);

        const freshUrl = await api.getUrlWithFolder(lastWorkspace.path);
        if (!freshUrl) {
          console.log('[VSCode] Failed to get fresh URL for workspace');
          return;
        }

        const urlChanged = freshUrl !== vsCodeUrl;
        const pathChanged = lastWorkspace.path !== _workspacePath;
        const branchChanged = lastWorkspace.branchName !== activeBranchName;

        console.log(
          '[VSCode] Sync check - urlChanged:',
          urlChanged,
          'pathChanged:',
          pathChanged,
          'branchChanged:',
          branchChanged,
        );

        if (urlChanged || pathChanged || branchChanged) {
          setVsCodeUrl(freshUrl);
          setWorkspacePath(lastWorkspace.path);
          setActiveBranchName(lastWorkspace.branchName || 'xyne-spaces');

          // Force iframe reload if same URL but different branch/path
          if (!urlChanged && (branchChanged || pathChanged) && iframeRef.current) {
            // Add cache-busting param to force reload
            const refreshUrl = freshUrl + (freshUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`;
            console.log('[VSCode] Force reloading iframe with:', refreshUrl);
            iframeRef.current.src = refreshUrl;
          }

          const folderName = lastWorkspace.path.split('/').pop() || 'Unknown';
          send({
            type: 'SWITCH_TO_WORKSPACE',
            folderUrl: freshUrl,
            folderPath: lastWorkspace.path,
            folderName,
          });
        }
      } catch (err) {
        console.error('[VSCode] Failed to sync workspace:', err);
      }
    };

    void syncWorkspace();
  }, [lastWorkspace, vsCodeUrl, _workspacePath, activeBranchName, send]);

  // No cleanup on unmount since this panel stays mounted for persistence

  const handleRefresh = useCallback(() => {
    if (iframeRef.current && vsCodeUrl) {
      iframeRef.current.src = vsCodeUrl;
    }
  }, [vsCodeUrl]);

  // Handle fullscreen toggle
  const handleFullscreenToggle = useCallback((): void => {
    if (!panelRef.current) return;

    if (!document.fullscreenElement) {
      panelRef.current
        .requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
        })
        .catch(err => {
          // eslint-disable-next-line no-console
          console.error('Error attempting to enable fullscreen:', err);
        });
    } else {
      document
        .exitFullscreen()
        .then(() => {
          setIsFullscreen(false);
        })
        .catch(err => {
          // eslint-disable-next-line no-console
          console.error('Error attempting to exit fullscreen:', err);
        });
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return (): void => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Listen for messages from code-server iframe (ticket ID clicks in commit messages)
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data as { type?: string; ticketId?: string } | null;

      if (data?.type === 'xyne:openTicketThread' && typeof data?.ticketId === 'string') {
        const xyneId = data.ticketId;
        addTab({
          id: xyneId,
          type: 'ticket',
          title: xyneId,
          xyneId,
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return (): void => {
      window.removeEventListener('message', handleMessage);
    };
  }, [addTab]);

  // Listen for Electron IPC messages (ticket deep links from VS Code extension)
  useEffect(() => {
    if (!isElectronApp()) return;

    const api = window.electronAPI;
    if (!api || typeof api.onNavigateToTicketThread !== 'function') return;

    const handleTicketThreadNavigation = (data: { ticketId: string }): void => {
      const xyneId = data.ticketId;
      addTab({
        id: xyneId,
        type: 'ticket',
        title: xyneId,
        xyneId,
      });
    };

    const cleanup = api.onNavigateToTicketThread(handleTicketThreadNavigation);
    return cleanup;
  }, [addTab]);

  // Not in Electron
  if (!isElectronApp()) {
    return (
      <div className='h-full flex flex-col items-center justify-center bg-muted rounded-lg'>
        <AlertCircle className='w-12 h-12 text-muted-foreground mb-4' />
        <h3 className='text-base font-semibold text-foreground mb-1.5'>VS Code Not Available</h3>
        <p className='text-sm text-muted-foreground max-w-xs text-center leading-relaxed'>
          VS Code integration is only available in the desktop app.
        </p>
      </div>
    );
  }

  if (!isCodeServerAvailable) {
    if (!codeServerStatus) {
      return (
        <div className='h-full flex flex-col items-center justify-center bg-background rounded-lg'>
          <Loader2 className='w-12 h-12 animate-spin text-primary mb-4' />
          <h3 className='text-base font-semibold text-foreground mb-1.5'>Initializing VS Code:</h3>
          <p className='text-sm text-muted-foreground'>Please wait...</p>
        </div>
      );
    }

    if (codeServerStatus.isDownloading) {
      return (
        <div className='h-full flex flex-col items-center justify-center bg-muted rounded-lg'>
          <Loader2 className='w-12 h-12 animate-spin text-action-primary mb-4' />
          <h3 className='text-base font-semibold text-foreground mb-1.5'>
            Downloading VS Code Server
          </h3>
          <p className='text-sm text-muted-foreground'>Please wait...</p>
        </div>
      );
    }

    if (codeServerStatus.error || !codeServerStatus.binaryInstalled) {
      return (
        <div className='h-full flex flex-col items-center justify-center bg-muted rounded-lg'>
          <AlertCircle className='w-12 h-12 text-destructive mb-4' />
          <h3 className='text-base font-semibold text-foreground mb-1.5'>VS Code Server Error</h3>
          <p className='text-sm text-muted-foreground max-w-md text-center mb-4'>
            {codeServerStatus.error || 'Code server binary not installed'}
          </p>
        </div>
      );
    }

    return (
      <div className='h-full flex flex-col items-center justify-center bg-muted rounded-lg'>
        <Loader2 className='w-12 h-12 animate-spin text-action-primary mb-4' />
        <h3 className='text-base font-semibold text-foreground mb-1.5'>Starting VS Code Server</h3>
        <p className='text-sm text-muted-foreground'>Please wait...</p>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className='h-full flex flex-col items-center justify-center bg-background rounded-lg'>
        <Loader2 className='w-8 h-8 animate-spin text-action-primary mb-4' />
        <p className='text-muted-foreground'>Setting up VS Code...</p>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className='h-full flex flex-col items-center justify-center bg-background rounded-lg'>
        <AlertCircle className='w-12 h-12 text-destructive mb-4' />
        <h3 className='text-base font-semibold text-foreground mb-2'>Failed to Load</h3>
        <p className='text-sm text-muted-foreground max-w-md text-center mb-4'>{error}</p>
        <button
          onClick={() => {
            hasInitializedRef.current = false;
            setError(null);
            setIsLoading(true);
            void setupWorkspace();
          }}
          className='flex items-center gap-2 px-4 py-2 bg-action-primary text-action-primary-foreground rounded-lg hover:opacity-90 transition-opacity'
          data-track-category='VSCodeWorkspace'
          data-track-name='RetrySetup'
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    );
  }

  // VS Code iframe - render even when vsCodeUrl is empty to ensure iframe exists for navigation
  const activeTab = tabs.find(t => t.id === activeTabId);

  return (
    <div
      ref={panelRef}
      className='h-full flex flex-col bg-background rounded-lg overflow-hidden shadow-lg'
    >
      {/* Header */}
      <div
        className='flex items-center justify-between px-3 pt-[8px] pb-[2px] bg-card border-b border-border'
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        onDoubleClick={() => {
          if (typeof window.electronAPI?.toggleCompactMode === 'function') {
            window.electronAPI.toggleCompactMode();
          }
        }}
      >
        {/* Left Section - Logo & Workspace Info */}
        <div
          className='flex items-center gap-3'
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className='flex items-center gap-2 px-2 mb-1'>
            <Code2 className='w-4 h-4 text-blue-400' />
          </div>
        </div>

        {/* Center Section - Thread Tabs */}
        <div
          className='flex-1 flex items-center gap-2 min-w-0 mx-4 mb-1'
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className='flex items-center gap-1 overflow-x-auto no-scrollbar'>
            {tabs
              .filter(tab => tab.type !== 'workspace')
              .map(tab => (
                <button
                  key={tab.id}
                  onClick={() => send({ type: 'SET_ACTIVE_TAB', tabId: tab.id })}
                  data-track-category='VSCodeWorkspace'
                  data-track-name='SetActiveTab'
                  data-track-metadata={JSON.stringify({ tabId: tab.id, tabType: tab.type })}
                  className={`
                    group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                    transition-all duration-200 whitespace-nowrap min-w-fit
                    ${
                      activeTabId === tab.id
                        ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/25'
                        : 'bg-card text-muted-foreground hover:bg-blue-500/10 hover:text-blue-300'
                    }
                  `}
                >
                  <MessageSquare className='w-3.5 h-3.5' />
                  <span className='font-medium'>{tab.title}</span>
                  {tab.type !== 'main' && (
                    <X
                      className='w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 hover:bg-muted transition-all'
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      data-track-category='VSCodeWorkspace'
                      data-track-name='CloseTab'
                      data-track-metadata={JSON.stringify({ tabId: tab.id, tabType: tab.type })}
                    />
                  )}
                </button>
              ))}
          </div>
        </div>

        {/* Right Section - Projects & Actions */}
        <div
          className='flex items-center gap-1.5'
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className='flex items-center gap-2 px-3 py-1.5 mb-1 text-xs font-semibold text-muted-foreground bg-card hover:bg-muted rounded-lg transition-all border border-border shadow-sm'>
                <Folder className='w-3.5 h-3.5 text-blue-400' />
                <span className='hidden sm:inline'>Projects</span>
                <ChevronDown className='w-3 h-3 text-muted-foreground' />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal container={panelRef.current}>
              <DropdownMenu.Content
                className='min-w-[200px] bg-popover border border-border rounded-lg p-1.5 shadow-2xl z-[100] animate-in fade-in zoom-in-95 duration-100'
                sideOffset={5}
              >
                {/* Add Project Action */}
                <DropdownMenu.Item
                  onSelect={() => {
                    void handleOpenFolder();
                  }}
                  className='flex items-center gap-2.5 px-2.5 py-2 text-xs text-blue-400 font-medium hover:bg-blue-500/10 rounded-md cursor-pointer outline-none transition-colors'
                >
                  <Plus className='w-4 h-4' />
                  <span>Add Project</span>
                </DropdownMenu.Item>

                <div className='h-px bg-border my-1.5 mx-1' />

                {/* Open Projects */}
                <div className='px-2.5 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider'>
                  Open Projects
                </div>

                {tabs
                  .filter(t => t.type === 'workspace')
                  .map(tab => (
                    <DropdownMenu.Item
                      key={tab.id}
                      onSelect={() => handleWorkspaceTabClick(tab)}
                      className={`
                        flex items-center justify-between group px-2.5 py-2 mt-0.5 text-xs rounded-md cursor-pointer outline-none transition-all
                        ${
                          activeTabId === tab.id
                            ? 'bg-blue-500/15 text-blue-300 font-medium'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }
                      `}
                    >
                      <div className='flex items-center gap-2.5'>
                        <Folder
                          className={`w-3.5 h-3.5 ${activeTabId === tab.id ? 'text-blue-400' : 'text-muted-foreground group-hover:text-muted-foreground'}`}
                        />
                        <span className='truncate max-w-[140px]'>{tab.title}</span>
                      </div>
                      <X
                        className='w-3 h-3 opacity-0 group-hover:opacity-60 hover:opacity-100 hover:text-red-400 transition-all'
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          closeTab(tab.id);
                        }}
                        data-track-category='VSCodeWorkspace'
                        data-track-name='CloseTab'
                        data-track-metadata={JSON.stringify({ tabId: tab.id, tabType: tab.type })}
                      />
                    </DropdownMenu.Item>
                  ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <div className='w-px h-4 bg-border mx-1 mb-1' />

          <button
            onClick={handleRefresh}
            data-track-category='VSCodeWorkspace'
            data-track-name='Refresh'
            className='p-1.5 mb-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all'
            title='Refresh'
          >
            <RefreshCw className='w-3.5 h-3.5' />
          </button>

          <button
            onClick={handleFullscreenToggle}
            className='p-1.5 mb-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all'
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            data-track-category='VSCode'
            data-track-name='ToggleFullscreen'
            data-track-metadata={JSON.stringify({ isFullscreen })}
          >
            {isFullscreen ? (
              <Minimize className='w-3.5 h-3.5' />
            ) : (
              <Fullscreen className='w-3.5 h-3.5' />
            )}
          </button>
        </div>
      </div>

      {/* Content: Thread side panel + VS Code Iframe */}
      <div className='flex-1 flex overflow-hidden relative'>
        {/* Only show thread panel on the left as before */}
        {isThreadOpen && activeTab && activeTab.type !== 'workspace' && (
          <div className='w-[500px] flex-shrink-0 border-r border-border overflow-hidden flex flex-col bg-background'>
            <TabContent
              key={activeTab.id}
              tab={activeTab}
              showSummary={!!tabSummaryStates[activeTab.id]}
              setShowSummary={show => send({ type: 'TOGGLE_SUMMARY', tabId: activeTab.id, show })}
              onClose={() => send({ type: 'SET_THREAD_OPEN', isOpen: false })}
            />
          </div>
        )}

        {/* VS Code Iframe - always render, show welcome when no URL */}
        <div className='flex-1 h-full relative'>
          {vsCodeUrl ? (
            <iframe
              ref={iframeRef}
              src={vsCodeUrl}
              className='w-full h-full border-0'
              title='VS Code Editor'
              allow='clipboard-read; clipboard-write'
            />
          ) : (
            <div className='absolute inset-0 flex flex-col items-center justify-center bg-background'>
              <Code2 className='w-12 h-12 text-primary mb-4' />
              <h3 className='text-base font-semibold text-foreground mb-1.5'>No Workspace Open</h3>
              <p className='text-sm text-muted-foreground max-w-xs text-center leading-relaxed mb-4'>
                Open a folder to start working in VS Code.
              </p>
              <button
                onClick={() => void handleOpenFolder()}
                className='flex items-center gap-2 px-4 py-2 bg-action-primary text-action-primary-foreground text-sm rounded-lg hover:opacity-90 transition-opacity'
                data-track-category='VSCodeWorkspace'
                data-track-name='OpenFolder'
              >
                <Folder size={16} />
                Open Folder
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TabContent: React.FC<{
  tab: EditorTab;
  showSummary: boolean;
  setShowSummary: (show: boolean) => void;
  onClose: () => void;
}> = ({ tab, showSummary, setShowSummary, onClose }) => {
  // Query ticket by xyneId if this is a ticket tab that doesn't have conversation/channel details yet
  const [ticket] = useCachedQuery(queries.ticketByXyneId({ xyneId: tab.xyneId || '' }), {
    enabled: !!tab.xyneId && !tab.conversationId,
  });

  const conversationId = tab.conversationId || ticket?.conversationId;
  const channelId = tab.channelId || ticket?.conversation?.channelId;

  if (!conversationId || !channelId) {
    return (
      <div className='h-full flex flex-col items-center justify-center bg-background'>
        <Loader2 className='w-6 h-6 animate-spin text-primary mb-2' />
        <p className='text-sm text-muted-foreground'>Loading thread...</p>
      </div>
    );
  }

  return (
    <div className='flex-1 overflow-hidden'>
      {showSummary ? (
        <div className='h-full bg-muted'>
          <ThreadSummary
            conversationId={conversationId}
            channelName={tab.title}
            onClose={() => setShowSummary(false)}
          />
        </div>
      ) : (
        <ThreadMessages
          conversationId={conversationId}
          channelId={channelId}
          simpleView={true}
          onSummaryClick={() => setShowSummary(true)}
          onClose={onClose}
        />
      )}
    </div>
  );
};

export default VSCodeWorkspaceScreen;
