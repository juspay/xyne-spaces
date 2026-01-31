/**
 * OpenIDEModal - Modal for opening a ticket's code repository in VS Code
 * Shows searchable repo dropdown, with option to add new repos inline
 * Upon selection, navigates to the TicketIDEScreen for full view
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GitBranch,
  Code2,
  Loader2,
  AlertCircle,
  ChevronDown,
  Plus,
  FolderGit2,
  Search,
  ArrowLeft,
  Tag,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button';
import Input from '../../ui/Input';
import { isElectronApp } from '../../../utils/electronApp';
import { useZero } from '@rocicorp/zero/react';
import { Ticket, Repo } from '@xyne/shared';
import { toast } from 'sonner';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useVSCode } from '../../../contexts/VSCodeContext';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

type OpenIDEModalMode = 'ticket' | 'quarto';

interface OpenIDEModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket?: Ticket;
  mode?: OpenIDEModalMode;
  title?: string;
}

export const OpenIDEModal: React.FC<OpenIDEModalProps> = ({
  isOpen,
  onClose,
  ticket,
  mode = 'ticket',
  title,
}) => {
  const z = useZero();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { registerSession } = useVSCode();

  // Query all repos
  const [repos] = useCachedQuery(queries.getAllRepos());

  // Main state
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('main');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dropdown states
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState('');
  const [isAddingBranch, setIsAddingBranch] = useState(false);
  const [showPrefixDropdown, setShowPrefixDropdown] = useState(false);
  const [prefixSearchQuery, setPrefixSearchQuery] = useState('');
  const [isAddingPrefix, setIsAddingPrefix] = useState(false);
  const [selectedPrefix, setSelectedPrefix] = useState<string>('feature');

  const [quartoWorkingBranch, setQuartoWorkingBranch] = useState<string>('');

  // Add repo form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [newRepoBranches, setNewRepoBranches] = useState('main');
  const [newRepoPrefix, setNewRepoPrefix] = useState('feature');
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [pendingRepoName, setPendingRepoName] = useState<string | null>(null);

  // Mode-specific values
  const isTicketMode = mode === 'ticket' && ticket;
  const ticketBranchName = isTicketMode && selectedRepo ? `${selectedPrefix}/${ticket.xyneId}` : '';
  const branchToUse = isTicketMode
    ? ticketBranchName
    : quartoWorkingBranch.trim() || selectedBranch;
  const selectedRepoBranches = selectedRepo?.baseBranch;

  // Common prefix options
  const commonPrefixes = useMemo(
    () => ['feature', 'bugfix', 'hotfix', 'fix', 'chore', 'refactor', 'docs', 'test'],
    [],
  );

  // Filter repos based on search
  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    if (!repoSearchQuery.trim()) return repos;
    const query = repoSearchQuery.toLowerCase();
    return repos.filter(r => r.name.toLowerCase().includes(query));
  }, [repos, repoSearchQuery]);

  // Check if search query matches any existing repo
  const searchMatchesExisting = useMemo(() => {
    if (!repoSearchQuery.trim() || !repos) return false;
    return repos.some(r => r.name.toLowerCase() === repoSearchQuery.toLowerCase());
  }, [repos, repoSearchQuery]);

  // Set default repo when repos load or find pending repo
  useEffect(() => {
    if (!repos || repos.length === 0) return;

    if (pendingRepoName) {
      const newRepo = repos.find(r => r.name === pendingRepoName);
      if (newRepo) {
        setSelectedRepo(newRepo);
        const baseBranch = newRepo.baseBranch as string[] | undefined;
        const firstBranch = baseBranch?.[0];
        if (firstBranch) setSelectedBranch(firstBranch);
        if (newRepo.prefix) setSelectedPrefix(newRepo.prefix);
        setPendingRepoName(null);
        return;
      }
    }

    if (!selectedRepo) {
      const firstRepo = repos[0];
      if (firstRepo) {
        setSelectedRepo(firstRepo);
        const baseBranch = firstRepo.baseBranch as string[] | undefined;
        const firstBranch = baseBranch?.[0];
        if (firstBranch) setSelectedBranch(firstBranch);
        if (firstRepo.prefix) setSelectedPrefix(firstRepo.prefix);
      }
    }
  }, [repos, selectedRepo, pendingRepoName]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (showRepoDropdown && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showRepoDropdown]);

  // Handle starting to add a new repo
  const handleStartAddRepo = useCallback((prefillName?: string) => {
    setNewRepoName(prefillName ?? '');
    setNewRepoUrl('');
    setNewRepoBranches('main');
    setNewRepoPrefix('feature');
    setShowRepoDropdown(false);
    setShowAddForm(true);
    setError(null);
  }, []);

  // Handle adding a new repo
  const handleAddRepo = useCallback(() => {
    if (!z || !newRepoName.trim() || !newRepoUrl.trim()) {
      setError('Please fill in repository name and URL');
      return;
    }

    const repoName = newRepoName.trim();

    // Check if repo already exists
    const existingRepo = repos?.find(r => r.name.toLowerCase() === repoName.toLowerCase());
    if (existingRepo) {
      // If repo exists, just select it
      setSelectedRepo(existingRepo);
      const baseBranch = existingRepo.baseBranch as string[] | undefined;
      const firstBranch = baseBranch?.[0];
      if (firstBranch) setSelectedBranch(firstBranch);

      setShowAddForm(false);
      setNewRepoName('');
      setNewRepoUrl('');
      return;
    }

    setIsSavingRepo(true);
    setError(null);

    const baseBranch = newRepoBranches
      .split(',')
      .map(b => b.trim())
      .filter(Boolean);
    if (baseBranch.length === 0) baseBranch.push('main');

    const newId = crypto.randomUUID();

    void z.mutate(
      mutators.repo.create({
        id: newId,
        name: repoName,
        url: newRepoUrl.trim(),
        baseBranch,
        prefix: newRepoPrefix.trim() || 'feature',
      }),
    );

    setPendingRepoName(repoName);
    setRepoSearchQuery('');
    setShowAddForm(false);
    setNewRepoName('');
    setNewRepoUrl('');
    setIsSavingRepo(false);
  }, [z, repos, newRepoName, newRepoUrl, newRepoBranches, newRepoPrefix]);

  // Handle opening the IDE
  const handleOpenIDE = useCallback(async () => {
    if (!isElectronApp() || !selectedRepo) {
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
      const result = await api.prepareForTicket(selectedRepo.url, selectedBranch, branchToUse);

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

      // Register the session with workspace info so the persistent panel picks it up
      registerSession(
        result.workspacePath,
        codeServerUrl,
        branchToUse,
        selectedRepo.name,
        isTicketMode ? ticket.id : undefined,
      );

      // Navigate to the persistent VSCode screen
      onClose();
      void navigate('/vscode');
      toast.success(`Workspace ready on branch ${branchToUse}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [
    selectedRepo,
    selectedBranch,
    branchToUse,
    isTicketMode,
    ticket,
    navigate,
    onClose,
    registerSession,
  ]);

  // Select a repo from dropdown
  const selectRepo = useCallback((repo: Repo) => {
    setSelectedRepo(repo);
    const baseBranch = repo.baseBranch as string[] | undefined;
    const firstBranch = baseBranch?.[0];
    if (firstBranch) setSelectedBranch(firstBranch);
    if (repo.prefix) setSelectedPrefix(repo.prefix);
    setShowRepoDropdown(false);
    setRepoSearchQuery('');
  }, []);

  const handleSelectBranch = useCallback((branch: string) => {
    setSelectedBranch(branch);
    setShowBranchDropdown(false);
    setBranchSearchQuery('');
  }, []);

  const handleSelectPrefix = useCallback(
    (prefix: string) => {
      setSelectedPrefix(prefix);
      if (selectedRepo) {
        void z.mutate(
          mutators.repo.update({
            id: selectedRepo.id,
            prefix: prefix,
          }),
        );
      }
      setShowPrefixDropdown(false);
      setPrefixSearchQuery('');
    },
    [z, selectedRepo],
  );

  const handleAddNewPrefix = useCallback(() => {
    const newPrefix = prefixSearchQuery.trim();
    if (!newPrefix) return;

    setIsAddingPrefix(true);
    setSelectedPrefix(newPrefix);

    // Update the repo's prefix
    if (selectedRepo) {
      void z.mutate(
        mutators.repo.update({
          id: selectedRepo.id,
          prefix: newPrefix,
        }),
      );
    }

    setIsAddingPrefix(false);
    setShowPrefixDropdown(false);
    setPrefixSearchQuery('');
  }, [z, selectedRepo, prefixSearchQuery]);

  const handleAddNewBranch = useCallback(() => {
    const newBranchName = branchSearchQuery.trim();
    setIsAddingBranch(true);

    void z.mutate(
      mutators.repo.addBranch({
        id: selectedRepo!.id,
        branchName: newBranchName,
      }),
    );

    setSelectedBranch(newBranchName);
    setIsAddingBranch(false);
    setShowBranchDropdown(false);
    setBranchSearchQuery('');
  }, [z, selectedRepo, branchSearchQuery]);

  if (!isElectronApp()) return null;

  // Add form view
  if (showAddForm) {
    return (
      <Dialog
        open={isOpen}
        onOpenChange={open => !open && onClose()}
        title='Add Repository'
        className='max-w-md'
      >
        <div className='p-5 space-y-4'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setShowAddForm(false)}
            className='-mt-1 -ml-1'
          >
            <ArrowLeft className='w-4 h-4' />
            Back
          </Button>

          <div>
            <span className='block text-sm font-medium text-gray-700 mb-1.5'>
              Name <span className='text-red-500'>*</span>
            </span>
            <Input
              value={newRepoName}
              onChange={e => setNewRepoName(e.target.value)}
              placeholder='xyne-spaces'
            />
          </div>

          <div>
            <span className='block text-sm font-medium text-gray-700 mb-1.5'>
              Git URL <span className='text-red-500'>*</span>
            </span>
            <Input
              value={newRepoUrl}
              onChange={e => setNewRepoUrl(e.target.value)}
              placeholder='git@github.com:org/repo.git'
            />
          </div>

          <div>
            <span className='block text-sm font-medium text-gray-700 mb-1.5'>Base Branches</span>
            <Input
              value={newRepoBranches}
              onChange={e => setNewRepoBranches(e.target.value)}
              placeholder='main, develop'
            />
            <p className='text-xs text-gray-500 mt-1'>Comma-separated branches to checkout from</p>
          </div>

          <div>
            <span className='block text-sm font-medium text-gray-700 mb-1.5'>Branch Prefix</span>
            <Input
              value={newRepoPrefix}
              onChange={e => setNewRepoPrefix(e.target.value)}
              placeholder='feature'
            />
            {ticket && (
              <p className='text-xs text-gray-500 mt-1'>
                Format: {newRepoPrefix || 'feature'}/{ticket.xyneId}
              </p>
            )}
          </div>

          {error && (
            <div className='flex items-center gap-2 p-2 text-red-600 bg-red-50 rounded text-sm'>
              <AlertCircle className='w-4 h-4' /> {error}
            </div>
          )}

          <div className='flex gap-2 pt-2'>
            <Button
              variant='secondary'
              className='flex-1'
              onClick={() => setShowAddForm(false)}
              disabled={isSavingRepo}
            >
              Cancel
            </Button>
            <Button
              variant='default'
              className='flex-1'
              onClick={() => {
                void handleAddRepo();
              }}
              disabled={isSavingRepo || !newRepoName.trim() || !newRepoUrl.trim()}
            >
              {isSavingRepo ? <Loader2 className='w-4 h-4 animate-spin' /> : 'Add Repository'}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // Main modal view
  const modalTitle = title ?? (isTicketMode ? 'Open in VS Code' : 'New Quarto Document');

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && onClose()}
      title={modalTitle}
      className='max-w-md'
    >
      <div className='p-5 space-y-4'>
        {/* Ticket Info - only show in ticket mode */}
        {isTicketMode && (
          <div className='flex items-center gap-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100'>
            <div className='w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0'>
              <Code2 className='w-5 h-5 text-white' />
            </div>
            <div className='min-w-0 flex-1'>
              <p className='font-medium text-gray-900 truncate'>{ticket.title}</p>
              <p className='text-sm text-blue-600 font-mono'>{ticket.xyneId}</p>
            </div>
          </div>
        )}

        {/* Quarto Info - only show in quarto mode */}
        {!isTicketMode && (
          <div className='flex items-center gap-3 p-3 bg-gradient-to-r from-green-50 to-teal-50 rounded-lg border border-green-100'>
            <div className='w-10 h-10 rounded-lg bg-green-600 flex items-center justify-center flex-shrink-0'>
              <Code2 className='w-5 h-5 text-white' />
            </div>
            <div className='min-w-0 flex-1'>
              <p className='font-medium text-gray-900'>Create Quarto Document</p>
              <p className='text-sm text-green-600'>Select a repository to create your document</p>
            </div>
          </div>
        )}

        {/* Repository Selector */}
        <div>
          <span className='block text-sm font-medium text-gray-700 mb-1.5'>Repository</span>
          <div className='relative'>
            <Button
              variant='outline'
              onClick={() => {
                setShowRepoDropdown(!showRepoDropdown);
                setShowBranchDropdown(false);
                setShowPrefixDropdown(false);
              }}
              className='w-full flex items-center justify-between px-3 py-2.5'
            >
              <div className='flex items-center gap-2'>
                <FolderGit2 className='w-4 h-4 text-gray-400' />
                <span className='text-sm text-gray-900'>
                  {selectedRepo?.name ?? 'Select repository...'}
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform ${showRepoDropdown ? 'rotate-180' : ''}`}
              />
            </Button>

            {showRepoDropdown && (
              <div className='absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden'>
                {/* Search Input */}
                <div className='p-2 border-b border-gray-100'>
                  <div className='relative'>
                    <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10' />
                    <Input
                      ref={searchInputRef}
                      type='text'
                      value={repoSearchQuery}
                      onChange={e => setRepoSearchQuery(e.target.value)}
                      placeholder='Search repositories...'
                      className='w-full pl-8 text-sm'
                    />
                  </div>
                </div>

                {/* Repo List */}
                <div className='max-h-48 overflow-y-auto'>
                  {filteredRepos.length > 0 ? (
                    filteredRepos.map(repo => (
                      <Button
                        key={repo.id}
                        variant='ghost'
                        onClick={() => selectRepo(repo)}
                        className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors justify-start ${
                          selectedRepo?.id === repo.id
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-gray-900 hover:bg-gray-50'
                        }`}
                      >
                        <FolderGit2 className='w-4 h-4 text-gray-400' />
                        <span className='flex-1 truncate'>{repo.name}</span>
                      </Button>
                    ))
                  ) : repoSearchQuery.trim() ? (
                    <div className='px-3 py-4 text-center text-sm text-gray-500'>
                      No matching repositories
                    </div>
                  ) : (
                    <div className='px-3 py-4 text-center text-sm text-gray-500'>
                      No repositories yet
                    </div>
                  )}
                </div>

                {/* Add New Option - shown when search doesn't match */}
                {repoSearchQuery.trim() && !searchMatchesExisting && (
                  <Button
                    variant='ghost'
                    onClick={() => handleStartAddRepo(repoSearchQuery.trim())}
                    className='w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 text-blue-600 hover:bg-blue-50 border-t border-gray-100 justify-start'
                  >
                    <Plus className='w-4 h-4' />
                    Add &quot;{repoSearchQuery.trim()}&quot;
                  </Button>
                )}

                {/* Always show generic add option */}
                {!repoSearchQuery.trim() && (
                  <Button
                    variant='ghost'
                    onClick={() => handleStartAddRepo()}
                    className='w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 text-gray-600 hover:bg-gray-50 border-t border-gray-100 justify-start'
                  >
                    <Plus className='w-4 h-4' />
                    Add new repository
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Branch Selector */}
        {selectedRepo && (
          <div>
            <span className='block text-sm font-medium text-gray-700 mb-1.5'>Base Branch</span>
            <div className='relative'>
              <Button
                variant='outline'
                onClick={() => {
                  setShowBranchDropdown(!showBranchDropdown);
                  setShowRepoDropdown(false);
                  setShowPrefixDropdown(false);
                  setBranchSearchQuery('');
                }}
                className='w-full flex items-center justify-between px-3 py-2.5'
              >
                <div className='flex items-center gap-2'>
                  <GitBranch className='w-4 h-4 text-gray-400' />
                  <span className='text-sm text-gray-900'>{selectedBranch}</span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`}
                />
              </Button>

              {showBranchDropdown && (
                <div className='absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden'>
                  {/* Search/Add Input */}
                  <div className='p-2 border-b border-gray-100'>
                    <div className='relative'>
                      <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10' />
                      <Input
                        type='text'
                        value={branchSearchQuery}
                        onChange={e => setBranchSearchQuery(e.target.value)}
                        placeholder='Search or add branch...'
                        className='w-full pl-8 text-sm'
                      />
                    </div>
                  </div>

                  {/* Branch List */}
                  <div className='max-h-48 overflow-y-auto'>
                    {(selectedRepoBranches || [])
                      .filter(
                        branch =>
                          !branchSearchQuery.trim() ||
                          branch.toLowerCase().includes(branchSearchQuery.toLowerCase()),
                      )
                      .map(branch => (
                        <Button
                          key={branch}
                          variant='ghost'
                          onClick={() => handleSelectBranch(branch)}
                          className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors justify-start ${
                            selectedBranch === branch
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-gray-900 hover:bg-gray-50'
                          }`}
                        >
                          <GitBranch className='w-4 h-4 text-gray-400' />
                          {branch}
                        </Button>
                      ))}
                    {branchSearchQuery.trim() &&
                      !(selectedRepoBranches || []).some(
                        b => b.toLowerCase() === branchSearchQuery.toLowerCase(),
                      ) && (
                        <Button
                          variant='ghost'
                          onClick={handleAddNewBranch}
                          disabled={isAddingBranch}
                          className='w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 text-blue-600 hover:bg-blue-50 border-t border-gray-100 justify-start'
                        >
                          {isAddingBranch ? (
                            <Loader2 className='w-4 h-4 animate-spin' />
                          ) : (
                            <Plus className='w-4 h-4' />
                          )}
                          Add &quot;{branchSearchQuery.trim()}&quot;
                        </Button>
                      )}
                    {!branchSearchQuery.trim() &&
                      (!selectedRepoBranches || selectedRepoBranches.length === 0) && (
                        <div className='px-3 py-4 text-center text-sm text-gray-500'>
                          No branches configured. Type to add one.
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Prefix Selector - only for ticket mode */}
        {isTicketMode && selectedRepo && (
          <div>
            <span className='block text-sm font-medium text-gray-700 mb-1.5'>Branch Prefix</span>
            <div className='relative'>
              <Button
                variant='outline'
                onClick={() => {
                  setShowPrefixDropdown(!showPrefixDropdown);
                  setShowRepoDropdown(false);
                  setShowBranchDropdown(false);
                  setPrefixSearchQuery('');
                }}
                className='w-full flex items-center justify-between px-3 py-2.5'
              >
                <div className='flex items-center gap-2'>
                  <Tag className='w-4 h-4 text-gray-400' />
                  <span className='text-sm text-gray-900'>{selectedPrefix}</span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${showPrefixDropdown ? 'rotate-180' : ''}`}
                />
              </Button>

              {showPrefixDropdown && (
                <div className='absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden'>
                  {/* Search/Add Input */}
                  <div className='p-2 border-b border-gray-100'>
                    <div className='relative'>
                      <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10' />
                      <Input
                        type='text'
                        value={prefixSearchQuery}
                        onChange={e => setPrefixSearchQuery(e.target.value)}
                        placeholder='Search or add prefix...'
                        className='w-full pl-8 text-sm'
                      />
                    </div>
                  </div>

                  {/* Prefix List */}
                  <div className='max-h-48 overflow-y-auto'>
                    {commonPrefixes
                      .filter(
                        prefix =>
                          !prefixSearchQuery.trim() ||
                          prefix.toLowerCase().includes(prefixSearchQuery.toLowerCase()),
                      )
                      .map(prefix => (
                        <Button
                          key={prefix}
                          variant='ghost'
                          onClick={() => handleSelectPrefix(prefix)}
                          className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors justify-start ${
                            selectedPrefix === prefix
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-gray-900 hover:bg-gray-50'
                          }`}
                        >
                          <Tag className='w-4 h-4 text-gray-400' />
                          {prefix}
                        </Button>
                      ))}
                    {prefixSearchQuery.trim() &&
                      !commonPrefixes.some(
                        p => p.toLowerCase() === prefixSearchQuery.toLowerCase(),
                      ) && (
                        <Button
                          variant='ghost'
                          onClick={handleAddNewPrefix}
                          disabled={isAddingPrefix}
                          className='w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 text-blue-600 hover:bg-blue-50 border-t border-gray-100 justify-start'
                        >
                          {isAddingPrefix ? (
                            <Loader2 className='w-4 h-4 animate-spin' />
                          ) : (
                            <Plus className='w-4 h-4' />
                          )}
                          Add &quot;{prefixSearchQuery.trim()}&quot;
                        </Button>
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* New Branch Preview - only for ticket mode */}
        {isTicketMode && selectedRepo && (
          <div className='p-3 bg-green-50 rounded-lg border border-green-100'>
            <p className='text-xs text-green-700 font-medium mb-1'>New branch:</p>
            <code className='text-sm font-mono text-green-800 bg-green-100 px-2 py-0.5 rounded'>
              {ticketBranchName}
            </code>
          </div>
        )}

        {/* Checkout to Branch Input - only for quarto mode */}
        {!isTicketMode && selectedRepo && (
          <div>
            <span className='block text-sm font-medium text-gray-700 mb-1.5'>
              Checkout to Branch <span className='text-xs text-gray-400'>(optional)</span>
            </span>
            <Input
              value={quartoWorkingBranch}
              onChange={e => setQuartoWorkingBranch(e.target.value)}
              placeholder={`Leave empty to stay on ${selectedBranch}`}
            />
            <p className='text-xs text-gray-500 mt-1'>
              {quartoWorkingBranch.trim()
                ? `Will checkout from ${selectedBranch} → ${quartoWorkingBranch.trim()} (create if not exists)`
                : `Will checkout to ${selectedBranch}`}
            </p>
          </div>
        )}

        {/* Branch Info Preview - only for quarto mode */}
        {!isTicketMode && selectedRepo && (
          <div className='p-3 bg-green-50 rounded-lg border border-green-100'>
            <p className='text-xs text-green-700 font-medium mb-1'>
              {quartoWorkingBranch.trim() ? 'Will checkout to:' : 'Will open on:'}
            </p>
            <code className='text-sm font-mono text-green-800 bg-green-100 px-2 py-0.5 rounded'>
              {quartoWorkingBranch.trim() || selectedBranch}
            </code>
            {quartoWorkingBranch.trim() && (
              <p className='text-xs text-green-600 mt-1'>Based on: {selectedBranch}</p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className='flex items-center gap-2 p-3 text-red-600 bg-red-50 rounded-lg text-sm'>
            <AlertCircle className='w-4 h-4 flex-shrink-0' /> {error}
          </div>
        )}

        {/* Actions */}
        <div className='flex gap-3 pt-2'>
          <Button variant='secondary' className='flex-1' onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant='default'
            className='flex-1'
            onClick={() => {
              void handleOpenIDE();
            }}
            disabled={isLoading || !selectedRepo}
          >
            {isLoading ? (
              <>
                <Loader2 className='w-4 h-4 animate-spin mr-2' /> Cloning...
              </>
            ) : (
              <>
                <Code2 className='w-4 h-4 mr-2' /> Open VS Code
              </>
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default OpenIDEModal;
