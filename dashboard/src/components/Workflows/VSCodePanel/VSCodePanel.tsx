/**
 * VSCodePanel - Embeds code-server iframe to show workflow code
 * Clones/pulls the workflow branch and opens it in VS Code
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, AlertCircle, RefreshCw, GitBranch, Maximize2, Minimize2, X } from 'lucide-react';
import { isElectronApp } from '../../../utils/electronApp';
import { CodeGenerationLoader } from '../CodeGenerationLoader';
import { useWorkspaceSubscription } from '../../../hooks/useWorkspaceSubscription';
import { useCodeServer } from '../../../contexts/CodeServerContext';
import { useVSCode } from '../../../contexts/VSCodeContext';

interface GitInfo {
  repoUrl?: string;
  branch?: string;
  commitHash?: string;
  baseCommitHash?: string;
  hasGitInfo?: boolean;
  prLink?: string;
  preview?: {
    type: string;
    userAgent: string;
    url: string;
  };
}

interface VSCodePanelProps {
  className?: string;
  executionId: string;
  gitInfo?: GitInfo;
  executionStatus?: string;
  isActive?: boolean;
  refetchTrigger?: number;
  workflowOutput?: { name?: string; message?: string; stack?: string } | null;
  onEnlargeChange?: (isEnlarged: boolean) => void;
}

export const VSCodePanel: React.FC<VSCodePanelProps> = ({
  className = '',
  executionId,
  gitInfo,
  executionStatus,
  isActive = true,
  refetchTrigger,
  workflowOutput,
  onEnlargeChange,
}) => {
  const [isCloning, setIsCloning] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [vsCodeUrl, setVsCodeUrl] = useState<string | null>(null);
  const [isEnlarged, setIsEnlarged] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);

  const { status: codeServerStatus, isAvailable: isCodeServerAvailable } = useCodeServer();
  const { attachIframe, detachIframe, registerSession, unregisterSession } = useVSCode();
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if workflow is completed or cancelled
  const isCompleted = executionStatus === 'SUCCESS' || executionStatus === 'COMPLETED';
  const isCancelled = executionStatus === 'CANCELLED';
  const isFailed = executionStatus === 'FAILURE' || executionStatus === 'FAILED';

  // Clone or pull the workflow branch
  const setupWorkspace = useCallback(async () => {
    if (!isElectronApp() || !gitInfo || !executionId) return;
    if (!gitInfo.repoUrl || !gitInfo.branch) return; // Need both to clone/pull

    const api = window.electronAPI?.codeServer;
    if (!api) return;

    setCloneError(null);

    try {
      // Check if workspace already exists
      const exists = await api.workspaceExists(executionId);

      if (exists) {
        // Get code-server URL immediately to unblock UI
        const path = await api.getWorkspacePath(executionId);
        const url = await api.getUrlWithFolder(path);
        setVsCodeUrl(url);
        setWorkspacePath(path);
        registerSession(path);

        // Pull updates in background
        setIsPulling(true);
        try {
          const result = await api.pullUpdates(executionId, gitInfo.branch, gitInfo.repoUrl);
          if (!result.success) {
            console.error('Failed to pull updates:', result.error);
            // Show non-blocking warning so user knows they might be out of sync
            setCloneError(
              'Warning: Could not sync latest changes from Git. You may be viewing an older version.',
            );
          }
        } catch (err) {
          console.error('Error pulling updates:', err);
          setCloneError(
            'Warning: Could not sync latest changes from Git. You may be viewing an older version.',
          );
        }
      } else {
        // Clone the repository
        setIsCloning(true);
        const result = await api.cloneBranch(
          gitInfo.repoUrl,
          gitInfo.branch,
          gitInfo.commitHash,
          executionId,
        );
        if (!result.success) {
          setCloneError(result.error || 'Failed to clone repository');
          setIsCloning(false);
          return;
        }

        // Get code-server URL after cloning
        const path = await api.getWorkspacePath(executionId);
        const url = await api.getUrlWithFolder(path);
        setVsCodeUrl(url);
        setWorkspacePath(path);
        registerSession(path);
      }
    } catch (error) {
      setCloneError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsCloning(false);
      setIsPulling(false);
    }
  }, [executionId, gitInfo, registerSession]);

  // Initial setup when component mounts or gitInfo changes
  useEffect(() => {
    if (isActive && gitInfo && executionId) {
      void setupWorkspace();
    }
  }, [isActive, gitInfo, executionId, setupWorkspace]);

  // Handle refetch trigger (from Global Refresh)
  const prevRefetchTrigger = useRef(refetchTrigger ?? 0);
  useEffect(() => {
    const currentTrigger = refetchTrigger ?? 0;
    if (currentTrigger !== prevRefetchTrigger.current && currentTrigger > 0) {
      prevRefetchTrigger.current = currentTrigger;
      void setupWorkspace();
    }
  }, [refetchTrigger, setupWorkspace]);

  // Cleanup: Detach on unmount
  useEffect(() => {
    return () => {
      detachIframe();
      if (workspacePath) {
        unregisterSession(workspacePath);
      }
    };
  }, [workspacePath, unregisterSession, detachIframe]);

  const reattachIframe = useCallback(() => {
    if (containerRef.current && vsCodeUrl) {
      detachIframe();
      attachIframe(containerRef.current, { url: vsCodeUrl });
    }
  }, [vsCodeUrl, attachIframe, detachIframe]);

  // Subscribe to workspace events for real-time updates
  useWorkspaceSubscription(executionId, {
    onFileTreeUpdate: () => {
      // When files change, pull updates
      if (gitInfo && !isCloning && !isPulling) {
        void setupWorkspace();
      }
    },
    onWorkspaceReady: () => {
      // Workspace is ready, refresh the iframe
      reattachIframe();
    },
  });

  // Attach iframe when URL and container are ready, and ONLY if active
  useEffect(() => {
    if (isActive && vsCodeUrl && containerRef.current) {
      attachIframe(containerRef.current, { url: vsCodeUrl });
    } else if (!isActive) {
      detachIframe();
    }
  }, [vsCodeUrl, attachIframe, detachIframe, isActive]);

  // Handle retry
  const handleRetry = (): void => {
    void setupWorkspace();
  };

  // If not in Electron, show fallback message
  if (!isElectronApp()) {
    return (
      <div className={`h-full flex flex-col items-center justify-center bg-muted ${className}`}>
        <AlertCircle className='w-12 h-12 text-muted-foreground mb-4' />
        <h3 className='text-base font-semibold text-foreground mb-1.5'>VS Code Not Available</h3>
        <p className='text-sm text-muted-foreground max-w-xs text-center leading-relaxed'>
          VS Code integration is only available in the desktop app.
        </p>
      </div>
    );
  }

  // Handle download action
  const handleDownload = async (): Promise<void> => {
    if (!window.electronAPI?.codeServer) return;
    try {
      const result = await window.electronAPI.codeServer.downloadBinary();
      if (result.success) {
        // Trigger a status refresh
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to download code-server:', error);
    }
  };

  // Handle start action
  const handleStart = async (): Promise<void> => {
    if (!window.electronAPI?.codeServer) return;
    try {
      await window.electronAPI.codeServer.start();
    } catch (error) {
      console.error('Failed to start code-server:', error);
    }
  };

  // If code-server is not available, show loading or error state
  if (!isCodeServerAvailable && codeServerStatus) {
    if (codeServerStatus.isDownloading) {
      return (
        <div className={`h-full flex flex-col items-center justify-center bg-muted ${className}`}>
          <Loader2 className='w-12 h-12 animate-spin text-action-primary mb-4' />
          <h3 className='text-base font-semibold text-foreground mb-1.5'>
            Downloading VS Code Server
          </h3>
          <p className='text-sm text-muted-foreground max-w-xs text-center leading-relaxed'>
            Please wait while we set up the development environment...
          </p>
        </div>
      );
    }

    if (codeServerStatus.error) {
      return (
        <div className={`h-full flex flex-col items-center justify-center bg-muted ${className}`}>
          <AlertCircle className='w-12 h-12 text-red-400 mb-4' />
          <h3 className='text-base font-semibold text-foreground mb-1.5'>VS Code Server Error</h3>
          <p className='text-sm text-muted-foreground max-w-md text-center leading-relaxed mb-4'>
            {codeServerStatus.error}
          </p>
          <div className='flex flex-col gap-3 items-center'>
            {!codeServerStatus.binaryInstalled && (
              <button
                onClick={(): void => {
                  void handleDownload();
                }}
                className='flex items-center gap-2 px-4 py-2 bg-action-primary text-action-primary-foreground rounded-lg hover:opacity-90 transition-opacity'
                data-track-category='Workflows'
                data-track-name='DownloadCodeServer'
                data-track-metadata={JSON.stringify({ executionId })}
              >
                Download Code Server
              </button>
            )}
            <button
              onClick={(): void => {
                void handleStart();
              }}
              className='flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors'
              data-track-category='Workflows'
              data-track-name='TryStartingAgain'
              data-track-metadata={JSON.stringify({ executionId })}
            >
              Try Starting Again
            </button>
            <a
              href='https://github.com/coder/code-server/releases'
              target='_blank'
              rel='noopener noreferrer'
              className='text-sm text-action-primary hover:underline'
            >
              Or install code-server manually
            </a>
          </div>
        </div>
      );
    }

    if (!codeServerStatus.binaryInstalled) {
      return (
        <div className={`h-full flex flex-col items-center justify-center bg-muted ${className}`}>
          <AlertCircle className='w-12 h-12 text-orange-400 mb-4' />
          <h3 className='text-base font-semibold text-foreground mb-1.5'>
            VS Code Server Not Installed
          </h3>
          <p className='text-sm text-muted-foreground max-w-md text-center leading-relaxed mb-4'>
            The VS Code server binary needs to be downloaded first, or you can install it
            system-wide.
          </p>
          <div className='flex flex-col gap-3 items-center'>
            <button
              onClick={(): void => {
                void handleDownload();
              }}
              className='flex items-center gap-2 px-4 py-2 bg-action-primary text-action-primary-foreground rounded-lg hover:opacity-90 transition-opacity'
              data-track-category='Workflows'
              data-track-name='DownloadCodeServer'
              data-track-metadata={JSON.stringify({ executionId })}
            >
              Download Code Server
            </button>
            <a
              href='https://github.com/coder/code-server/releases'
              target='_blank'
              rel='noopener noreferrer'
              className='text-sm text-action-primary hover:underline'
            >
              Or install code-server system-wide
            </a>
          </div>
        </div>
      );
    }

    return (
      <div className={`h-full flex flex-col items-center justify-center bg-muted ${className}`}>
        <Loader2 className='w-12 h-12 animate-spin text-action-primary mb-4' />
        <h3 className='text-base font-semibold text-foreground mb-1.5'>Starting VS Code Server</h3>
        <p className='text-sm text-muted-foreground max-w-xs text-center leading-relaxed mb-4'>
          Please wait while the server starts...
        </p>
        <button
          onClick={(): void => {
            void handleStart();
          }}
          className='text-sm text-action-primary hover:underline'
          data-track-category='Workflows'
          data-track-name='StartCodeServer'
          data-track-metadata={JSON.stringify({ executionId })}
        >
          Click here if it takes too long
        </button>
      </div>
    );
  }

  // If workflow is still in progress, show loader
  if (!isCompleted && !isCancelled && !isFailed && !gitInfo) {
    return <CodeGenerationLoader isCancelled={false} />;
  }

  // If cancelled, show cancelled state
  if (isCancelled) {
    return <CodeGenerationLoader isCancelled={true} />;
  }

  // If failed, show error state
  if (isFailed) {
    const errorMessage = workflowOutput?.message || workflowOutput?.name;
    return (
      <CodeGenerationLoader
        isCancelled={false}
        isFailed={true}
        {...(errorMessage ? { errorMessage } : {})}
      />
    );
  }

  // If no git info, show empty state
  if (!gitInfo) {
    return (
      <div className={`h-full flex flex-col items-center justify-center bg-muted ${className}`}>
        <GitBranch className='w-12 h-12 text-muted-foreground mb-4' />
        <h3 className='text-base font-semibold text-foreground mb-1.5'>No Git Information</h3>
        <p className='text-sm text-muted-foreground max-w-xs text-center leading-relaxed'>
          This workflow doesn&apos;t have Git repository information.
        </p>
      </div>
    );
  }

  // If cloning in progress
  if (isCloning) {
    return (
      <div
        className={`h-full flex flex-col items-center justify-center bg-background ${className}`}
      >
        <Loader2 className='w-8 h-8 animate-spin text-action-primary mb-4' />
        <p className='text-muted-foreground'>Cloning repository...</p>
        <p className='text-sm text-muted-foreground mt-1'>Branch: {gitInfo.branch}</p>
      </div>
    );
  }

  // If pulling in progress (only if we don't have the URL yet)
  if (isPulling && !vsCodeUrl) {
    return (
      <div
        className={`h-full flex flex-col items-center justify-center bg-background ${className}`}
      >
        <Loader2 className='w-8 h-8 animate-spin text-action-primary mb-4' />
        <p className='text-muted-foreground'>Pulling latest changes...</p>
      </div>
    );
  }

  // If error occurred
  if (cloneError) {
    return (
      <div
        className={`h-full flex flex-col items-center justify-center bg-background ${className}`}
      >
        <AlertCircle className='w-12 h-12 text-red-400 mb-4' />
        <h3 className='text-base font-semibold text-foreground mb-2'>Failed to Load Repository</h3>
        <p className='text-sm text-muted-foreground max-w-md text-center mb-4'>{cloneError}</p>
        <button
          onClick={handleRetry}
          className='flex items-center gap-2 px-4 py-2 bg-action-primary text-action-primary-foreground rounded-lg hover:opacity-90 transition-opacity'
          data-track-category='Workflows'
          data-track-name='RetryVSCodeClone'
          data-track-metadata={JSON.stringify({ executionId })}
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    );
  }

  // Handle enlarge toggle
  const handleEnlargeToggle = (): void => {
    const newEnlarged = !isEnlarged;
    setIsEnlarged(newEnlarged);
    onEnlargeChange?.(newEnlarged);
    requestAnimationFrame(reattachIframe);
  };

  // If VS Code URL is ready, show iframe
  if (vsCodeUrl) {
    return (
      <div
        data-vscode-panel='true'
        className={`${isEnlarged ? 'absolute inset-0 rounded-lg shadow-xl z-50' : 'relative w-full h-full'} flex flex-col bg-background ${className}`}
      >
        {/* Header with branch info */}
        <div className='flex items-center justify-between px-4 py-2 border-b border-border bg-card'>
          <div className='flex items-center gap-2'>
            <GitBranch size={16} className='text-muted-foreground' />
            <span className='text-sm font-medium text-muted'>{gitInfo.branch}</span>
            {gitInfo.commitHash && (
              <span className='text-xs text-muted-foreground font-mono'>
                @ {gitInfo.commitHash.slice(0, 7)}
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <button
              onClick={handleRetry}
              className='flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors'
              title='Refresh workspace'
              data-track-category='Workflows'
              data-track-name='RefreshVSCodeWorkspace'
              data-track-metadata={JSON.stringify({ executionId })}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              onClick={handleEnlargeToggle}
              className='flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors'
              title={isEnlarged ? 'Minimize' : 'Maximize'}
              data-track-category='Workflows'
              data-track-name='ToggleVSCodeEnlarge'
              data-track-metadata={JSON.stringify({ executionId, isEnlarged })}
            >
              {isEnlarged ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              {isEnlarged ? 'Minimize' : 'Maximize'}
            </button>
          </div>
        </div>
        {/* Warning Banner if Pull Failed */}
        {cloneError && (
          <div className='bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-1.5 flex items-center justify-between'>
            <div className='flex items-center gap-2 text-xs text-yellow-200'>
              <AlertCircle size={12} className='text-yellow-500' />
              <span>{cloneError}</span>
            </div>
            <button
              onClick={() => setCloneError(null)}
              className='text-yellow-500 hover:text-yellow-200'
              data-track-category='Workflows'
              data-track-name='DismissVSCodeWarning'
              data-track-metadata={JSON.stringify({ executionId })}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* VSCode Container (Portal Target) */}
        <div className='flex-1 relative bg-background'>
          <div ref={containerRef} className='absolute inset-0 w-full h-full bg-background' />
        </div>
      </div>
    );
  }

  // Loading state while setting up
  return <div className={`h-full bg-background ${className}`} />;
};

export default VSCodePanel;
