/**
 * TicketIDEScreen - Full-screen VS Code IDE view for a ticket
 * Similar to WorkflowScreen but focused on code editing
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, GitBranch, RefreshCw, Loader2, AlertCircle, Code2 } from 'lucide-react';
import { isElectronApp } from '../../utils/electronApp';
import { useTickets } from '../../hooks/useTickets';
import { queries } from '../../zero/queries';
import { Repo } from '@xyne/shared';
import { toast } from 'sonner';
import { useVSCode } from '../../contexts/VSCodeContext';
import { useCachedQuery } from '../../hooks/useCachedQuery';

const TicketIDEScreen: React.FC = () => {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { registerSession, unregisterSession } = useVSCode();

  // Get ticket data
  const { tickets, isLoading: ticketsLoading } = useTickets();
  const ticket = useMemo(() => tickets.find(t => t.id === ticketId), [tickets, ticketId]);

  // Query repos
  const [repos] = useCachedQuery(queries.getAllRepos());

  // State
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('main');
  const [vsCodeUrl, setVsCodeUrl] = useState<string | null>(null);
  const [activeBranchName, setActiveBranchName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRepoSelector, setShowRepoSelector] = useState(true);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);

  // Check for passed state from modal
  useEffect(() => {
    const state = location.state as
      | { vsCodeUrl?: string; repoName?: string; branchName?: string; workspacePath?: string }
      | undefined;
    if (state?.vsCodeUrl) {
      setVsCodeUrl(state.vsCodeUrl);
      if (state.branchName) setActiveBranchName(state.branchName);
      if (state.repoName && repos) {
        const repo = repos.find(r => r.name === state.repoName);
        if (repo) setSelectedRepo(repo);
      }
      if (state.workspacePath) {
        setWorkspacePath(state.workspacePath);
        registerSession(state.workspacePath, state.vsCodeUrl, state.branchName, state.repoName);
      }
      setShowRepoSelector(false);
    }
  }, [location.state, repos, registerSession]);

  // Derived
  const ticketBranchName = ticket && selectedRepo ? `${selectedRepo.prefix}/${ticket.xyneId}` : '';

  // Set default repo when repos load
  useEffect(() => {
    if (repos && repos.length > 0 && !selectedRepo) {
      const firstRepo = repos[0];
      if (firstRepo) {
        setSelectedRepo(firstRepo);
        const baseBranch = firstRepo.baseBranch;
        if (baseBranch?.[0]) setSelectedBranch(baseBranch[0]);
      }
    }
  }, [repos, selectedRepo]);

  // Cleanup: Unregister session on unmount
  useEffect(() => {
    return () => {
      if (workspacePath) {
        unregisterSession(workspacePath);
      }
    };
  }, [workspacePath, unregisterSession]);

  const handleOpenIDE = useCallback(async () => {
    if (!isElectronApp() || !selectedRepo || !ticket) {
      setError('VS Code is only available in the desktop app');
      return;
    }

    const api = window.electronAPI?.codeServer;
    if (!api?.prepareForTicket) {
      setError('Please restart the Electron app to enable this feature');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const branchName = `${selectedRepo.prefix}/${ticket.xyneId}`;
      const result = await api.prepareForTicket(selectedRepo.url, selectedBranch, branchName);

      if (!result.success) {
        setError(result.error ?? 'Failed to prepare workspace');
        setIsLoading(false);
        return;
      }

      if (result.stashedChanges) {
        toast.warning('Uncommitted changes were stashed', {
          description: 'Use "git stash pop" to restore them',
          duration: 5000,
        });
      }

      const codeServerUrl = await api.getUrlWithFolder(result.workspacePath);
      if (!codeServerUrl) {
        setError('Failed to get VS Code URL');
        setIsLoading(false);
        return;
      }

      setVsCodeUrl(codeServerUrl);
      setActiveBranchName(branchName);
      setShowRepoSelector(false);
      setWorkspacePath(result.workspacePath);
      registerSession(
        result.workspacePath,
        codeServerUrl,
        branchName,
        selectedRepo.name,
        ticket.id,
      );
      toast.success(`Workspace ready on branch ${branchName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [selectedRepo, selectedBranch, ticket, registerSession]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current && vsCodeUrl) {
      iframeRef.current.src = vsCodeUrl;
    }
  }, [vsCodeUrl]);

  const handleBack = useCallback(() => {
    if (vsCodeUrl && location.state) {
      // If we came from modal with pre-loaded state, go back in history
      void navigate(-1);
    } else if (vsCodeUrl) {
      // If we used the selector on this page, goes back to selector
      setVsCodeUrl(null);
      setShowRepoSelector(true);
    } else {
      void navigate(-1);
    }
  }, [vsCodeUrl, navigate, location.state]);

  // Loading state
  if (ticketsLoading || !ticket) {
    return (
      <div className='h-full flex items-center justify-center bg-gray-50'>
        <div className='text-center'>
          <Loader2 className='w-8 h-8 text-blue-500 animate-spin mx-auto mb-4' />
          <p className='text-gray-600 text-sm'>Loading ticket...</p>
        </div>
      </div>
    );
  }

  // VS Code embedded view
  if (vsCodeUrl && !showRepoSelector) {
    return (
      <div className='h-full flex flex-col bg-[#1e1e1e] rounded-lg overflow-hidden shadow-lg'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-gray-700'>
          <div className='flex items-center gap-3'>
            <button
              onClick={handleBack}
              className='p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors'
              data-track-category='TicketIDE'
              data-track-name='GoBack'
            >
              <ArrowLeft className='w-4 h-4' />
            </button>
            <div className='flex items-center gap-2'>
              <Code2 className='w-4 h-4 text-blue-400' />
              <span className='text-sm font-medium text-gray-200'>{ticket.xyneId}</span>
            </div>
            <div className='h-4 w-px bg-gray-600' />
            <div className='flex items-center gap-1.5'>
              <GitBranch className='w-4 h-4 text-green-400' />
              <span className='text-sm text-gray-300 font-mono'>{activeBranchName}</span>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className='flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors'
            data-track-category='TicketIDE'
            data-track-name='Refresh'
          >
            <RefreshCw className='w-3 h-3' />
            Refresh
          </button>
        </div>

        {/* VS Code Iframe */}
        <div className='flex-1'>
          <iframe
            ref={iframeRef}
            src={vsCodeUrl}
            className='w-full h-full border-0'
            title='VS Code Editor'
            allow='clipboard-read; clipboard-write'
          />
        </div>
      </div>
    );
  }

  // Repo selector view
  return (
    <div className='h-full flex flex-col bg-white rounded-lg overflow-hidden shadow-lg'>
      {/* Header */}
      <div className='flex items-center gap-3 px-4 py-3 bg-gray-50 border-b'>
        <button
          onClick={handleBack}
          className='p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors'
          data-track-category='TicketIDE'
          data-track-name='GoBackToSelector'
        >
          <ArrowLeft className='w-4 h-4' />
        </button>
        <div>
          <h1 className='text-sm font-medium text-gray-900'>Open in VS Code</h1>
          <p className='text-xs text-gray-500'>{ticket.title}</p>
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 flex items-center justify-center p-6'>
        <div className='w-full max-w-md space-y-4'>
          {/* Ticket Info */}
          <div className='flex items-center gap-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100'>
            <div className='w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0'>
              <Code2 className='w-5 h-5 text-white' />
            </div>
            <div className='min-w-0 flex-1'>
              <p className='font-medium text-gray-900 truncate'>{ticket.title}</p>
              <p className='text-sm text-blue-600 font-mono'>{ticket.xyneId}</p>
            </div>
          </div>

          {/* Repository Selector */}
          <div>
            <span className='block text-sm font-medium text-gray-700 mb-1.5'>Repository</span>
            <select
              value={selectedRepo?.id || ''}
              onChange={e => {
                const repo = repos?.find(r => r.id === e.target.value);
                if (repo) {
                  setSelectedRepo(repo);
                  const baseBranch = repo.baseBranch;
                  if (baseBranch?.[0]) setSelectedBranch(baseBranch[0]);
                }
              }}
              data-track-event='change'
              data-track-category='TicketIDE'
              data-track-name='SelectRepository'
              className='w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              {!repos || repos.length === 0 ? (
                <option value=''>No repositories configured</option>
              ) : (
                repos.map(repo => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Branch Selector */}
          {selectedRepo && (
            <div>
              <span className='block text-sm font-medium text-gray-700 mb-1.5'>Base Branch</span>
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                data-track-event='change'
                data-track-category='TicketIDE'
                data-track-name='SelectBranch'
                className='w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
              >
                {(selectedRepo.baseBranch || ['main']).map(branch => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* New Branch Preview */}
          {selectedRepo && ticket && (
            <div className='p-3 bg-green-50 rounded-lg border border-green-100'>
              <p className='text-xs text-green-700 font-medium mb-1'>New branch:</p>
              <code className='text-sm font-mono text-green-800 bg-green-100 px-2 py-0.5 rounded'>
                {ticketBranchName}
              </code>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className='flex items-center gap-2 p-3 text-red-600 bg-red-50 rounded-lg text-sm'>
              <AlertCircle className='w-4 h-4 flex-shrink-0' /> {error}
            </div>
          )}

          {/* Open Button */}
          <button
            onClick={() => {
              void handleOpenIDE();
            }}
            disabled={isLoading || !selectedRepo}
            className='w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            data-track-category='TicketIDE'
            data-track-name='OpenVSCode'
            data-track-metadata={JSON.stringify({
              repoId: selectedRepo?.id,
              branch: selectedBranch,
              ticketId: ticket?.id,
            })}
          >
            {isLoading ? (
              <>
                <Loader2 className='w-4 h-4 animate-spin' /> Cloning...
              </>
            ) : (
              <>
                <Code2 className='w-4 h-4' /> Open VS Code
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TicketIDEScreen;
