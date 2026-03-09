import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Globe,
  Lock,
  ChevronDown,
  Plus,
  Search,
  Loader2,
  Trash2,
  Pencil,
  GitBranch,
  X,
  Check,
  ArrowLeft,
} from 'lucide-react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button';
import Input from '../../ui/Input';
import { useZero } from '../../../hooks/useZero';
import { Repo } from '@xyne/shared';
import { toast } from 'sonner';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuth } from '../../../hooks/useAuth';
import { cn } from '../../../utils/classNames';
import { logger, Event } from '../../../utils/logger';
import { apiInstance } from '../../../services/clients/apiClient';
import { QuartoInstructionsModal } from '../QuartoInstructionsModal/QuartoInstructionsModal';

type QuartoDocType = 'public' | 'private';

interface QuartoDocModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PUBLIC_REPO_URL = 'ssh://git@github.com/example-org/xyne-spaces-docs.git';

export const QuartoDocModal: React.FC<QuartoDocModalProps> = ({ isOpen, onClose }) => {
  const z = useZero();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const [allRepos] = useCachedQuery(queries.getAllRepos());

  const userRepos = useMemo(() => {
    if (!allRepos || !user?.id) return [];
    return allRepos.filter(repo => repo.createdBy === user.id);
  }, [allRepos, user?.id]);

  // Main state
  const [docType, setDocType] = useState<QuartoDocType | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('main');
  const [workingBranch, setWorkingBranch] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  // Dropdown states
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);

  // Add repo form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [newRepoBranches, setNewRepoBranches] = useState('main');
  const [isSavingRepo, setIsSavingRepo] = useState(false);

  // Edit repo state
  const [editingRepo, setEditingRepo] = useState<Repo | null>(null);
  const [editRepoName, setEditRepoName] = useState('');
  const [editRepoUrl, setEditRepoUrl] = useState('');
  const [editRepoBranches, setEditRepoBranches] = useState('');

  // Instructions modal state
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [instructionsModalData, setInstructionsModalData] = useState<{
    repoUrl: string;
    branchName: string;
    repoName: string;
  } | null>(null);

  // Filter repos based on search
  const filteredRepos = useMemo(() => {
    if (!userRepos) return [];
    if (!repoSearchQuery.trim()) return userRepos;
    const query = repoSearchQuery.toLowerCase();
    return userRepos.filter(r => r.name.toLowerCase().includes(query));
  }, [userRepos, repoSearchQuery]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDocType(null);
      setSelectedRepo(null);
      setShowAddForm(false);
      setEditingRepo(null);
      setRepoSearchQuery('');
      setWorkingBranch('');
    }
  }, [isOpen]);

  // Set default repo when user repos load
  useEffect(() => {
    if (docType === 'private' && userRepos.length > 0 && !selectedRepo) {
      const firstRepo = userRepos[0];
      if (firstRepo) {
        setSelectedRepo(firstRepo);
        const baseBranch = firstRepo.baseBranch;
        const firstBranch = baseBranch?.[0];
        if (firstBranch) setSelectedBranch(firstBranch);
      }
    }
  }, [docType, userRepos, selectedRepo]);

  useEffect(() => {
    if (selectedRepo && userRepos.length > 0) {
      const stillExists = userRepos.some(r => r.id === selectedRepo.id);
      if (!stillExists) {
        const firstRepo = userRepos[0];
        if (firstRepo) {
          setSelectedRepo(firstRepo);
          const baseBranch = firstRepo.baseBranch;
          setSelectedBranch(baseBranch?.[0] || 'main');
        } else {
          setSelectedRepo(null);
          setSelectedBranch('main');
        }
      }
    } else if (selectedRepo && userRepos.length === 0) {
      setSelectedRepo(null);
      setSelectedBranch('main');
    }
  }, [userRepos, selectedRepo]);

  const handleSaveNewRepo = useCallback(() => {
    if (!newRepoName.trim() || !newRepoUrl.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSavingRepo(true);
    try {
      const branches = newRepoBranches
        .split(',')
        .map(b => b.trim())
        .filter(Boolean);
      if (branches.length === 0) branches.push('main');

      void z.mutate(
        mutators.repo.create({
          id: crypto.randomUUID(),
          name: newRepoName.trim(),
          url: newRepoUrl.trim(),
          baseBranch: branches,
          prefix: 'feature',
        }),
      );

      logger.info(Event.QUARTO_REPO_CREATED, {
        repoName: newRepoName.trim(),
        repoUrl: newRepoUrl.trim(),
      });
      toast.success('Repository added successfully');
      setShowAddForm(false);
      setNewRepoName('');
      setNewRepoUrl('');
      setNewRepoBranches('main');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add repository';
      toast.error(message);
    } finally {
      setIsSavingRepo(false);
    }
  }, [z, newRepoName, newRepoUrl, newRepoBranches]);

  const handleDeleteRepo = useCallback(
    (repoId: string) => {
      try {
        void z.mutate(mutators.repo.delete({ id: repoId }));
        logger.info(Event.QUARTO_REPO_DELETED, { repoId });
        toast.success('Repository deleted');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete repository';
        logger.error(Event.QUARTO_SETUP_FAILED, { error: message, action: 'delete_repo' });
        toast.error(message);
      }
    },
    [z],
  );

  const handleStartEditRepo = useCallback((repo: Repo) => {
    setEditingRepo(repo);
    setEditRepoName(repo.name);
    setEditRepoUrl(repo.url);
    const branches = repo.baseBranch as string[] | undefined;
    setEditRepoBranches(branches?.join(', ') || 'main');
  }, []);

  const handleSaveEditRepo = useCallback(() => {
    if (!editingRepo || !editRepoName.trim() || !editRepoUrl.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const branches = editRepoBranches
        .split(',')
        .map(b => b.trim())
        .filter(Boolean);
      if (branches.length === 0) branches.push('main');

      void z.mutate(
        mutators.repo.update({
          id: editingRepo.id,
          name: editRepoName.trim(),
          url: editRepoUrl.trim(),
          baseBranch: branches,
        }),
      );

      logger.info(Event.QUARTO_REPO_UPDATED, {
        repoId: editingRepo.id,
        repoName: editRepoName.trim(),
      });
      toast.success('Repository updated successfully');
      setEditingRepo(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update repository';
      toast.error(message);
    }
  }, [z, editingRepo, editRepoName, editRepoUrl, editRepoBranches]);

  const handleOpenQuarto = useCallback(
    async (repoUrl: string, branch: string) => {
      // Extract repo name from URL for display
      const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'quarto-docs';

      if (docType === 'public') {
        setIsLoading(true);
        const loadingToastId = toast.loading('Setting up Quarto access...');
        try {
          const setupResponse = await apiInstance.post<{
            success: boolean;
            repoUrl: string;
            branch: string;
            error?: string;
          }>('/docs/setup-quarto-access');

          if (!setupResponse.data.success) {
            logger.error(Event.QUARTO_ACCESS_SETUP_FAILED, {
              error: setupResponse.data.error,
              docType: 'public',
            });
            toast.dismiss(loadingToastId);
            toast.error('Setup failed', {
              description: setupResponse.data.error ?? 'Failed to setup repository access',
            });
            setIsLoading(false);
            return;
          }
          logger.info(Event.QUARTO_ACCESS_SETUP_SUCCESS, { docType: 'public' });
          toast.dismiss(loadingToastId);
        } catch (err) {
          toast.dismiss(loadingToastId);
          const message = err instanceof Error ? err.message : 'Failed to setup quarto access';
          logger.error(Event.QUARTO_SETUP_FAILED, { error: message, repoUrl, branch });
          toast.error('Error', { description: message });
          setIsLoading(false);
          return;
        }
        setIsLoading(false);
      }

      setInstructionsModalData({
        repoUrl,
        branchName: branch,
        repoName,
      });
      setShowInstructionsModal(true);
    },
    [docType],
  );

  const handleContinue = useCallback(() => {
    if (docType === 'public') {
      void handleOpenQuarto(PUBLIC_REPO_URL, 'main');
    } else if (docType === 'private' && selectedRepo) {
      const branch = workingBranch.trim() || selectedBranch;
      void handleOpenQuarto(selectedRepo.url, branch);
    }
  }, [docType, handleOpenQuarto, selectedRepo, selectedBranch, workingBranch]);

  const selectedRepoBranches = selectedRepo?.baseBranch;

  // Type selection view
  const renderTypeSelection = (): React.ReactElement => (
    <div className='space-y-4'>
      <p className='text-sm text-muted-foreground'>Choose where to create your Quarto document:</p>

      <div className='grid grid-cols-2 gap-3'>
        <button
          onClick={() => setDocType('public')}
          className={cn(
            'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
            docType === 'public'
              ? 'border-blue-500 bg-blue-50'
              : 'border-border hover:border-border',
          )}
          data-track-category='CANVAS'
          data-track-name='Select_Public_Quarto_Doc'
          data-track-metadata={JSON.stringify({})}
        >
          <Globe className='h-8 w-8 text-blue-500' />
          <span className='font-medium'>Public</span>
          <span className='text-xs text-muted-foreground text-center'>Shared docs repo</span>
        </button>

        <button
          onClick={() => setDocType('private')}
          className={cn(
            'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
            docType === 'private'
              ? 'border-purple-500 bg-purple-50'
              : 'border-border hover:border-border',
          )}
          data-track-category='CANVAS'
          data-track-name='Select_Private_Quarto_Doc'
          data-track-metadata={JSON.stringify({})}
        >
          <Lock className='h-8 w-8 text-purple-500' />
          <span className='font-medium'>Private</span>
          <span className='text-xs text-muted-foreground text-center'>Your own repo</span>
        </button>
      </div>

      {docType === 'public' && (
        <div className='p-3 bg-blue-50 rounded-lg border border-blue-200'>
          <p className='text-sm text-primary'>
            Your document will be created in the shared{' '}
            <code className='bg-blue-100 px-1 rounded'>xyne-spaces-docs</code> repository. Everyone
            with repo access can view and edit it.
          </p>
        </div>
      )}
    </div>
  );

  // Private repo selection view
  const renderPrivateConfig = (): React.ReactElement => (
    <div className='space-y-4'>
      <div className='flex items-center gap-2'>
        <button
          onClick={() => setDocType(null)}
          className='p-1 text-muted-foreground hover:text-foreground rounded hover:bg-accent'
          data-track-category='CANVAS'
          data-track-name='BackTo_Quarto_Doc_Type_Selection'
          data-track-metadata={JSON.stringify({})}
        >
          <ArrowLeft className='h-4 w-4' />
        </button>
        <div className='flex items-center gap-2'>
          <Lock className='h-5 w-5 text-purple-500' />
          <span className='font-medium text-foreground'>Private Repository</span>
        </div>
      </div>

      {/* Repo selector */}
      <div className='space-y-2'>
        <span className='block text-sm font-medium text-foreground mb-1.5'>Repository</span>

        {showAddForm ? (
          // Add new repo form
          <div className='space-y-3 p-3 border rounded-lg bg-muted'>
            <div className='flex justify-between items-center'>
              <span className='text-sm font-medium'>Add New Repository</span>
              <button
                onClick={() => setShowAddForm(false)}
                className='text-muted-foreground hover:text-foreground'
                data-track-category='CANVAS'
                data-track-name='Cancel_Add_Repository'
                data-track-metadata={JSON.stringify({})}
              >
                <X className='h-4 w-4' />
              </button>
            </div>
            <Input
              placeholder='Repository name'
              value={newRepoName}
              onChange={e => setNewRepoName(e.target.value)}
            />
            <Input
              placeholder='Repository URL (SSH or HTTPS)'
              value={newRepoUrl}
              onChange={e => setNewRepoUrl(e.target.value)}
            />
            <Input
              placeholder='Base branches (comma-separated)'
              value={newRepoBranches}
              onChange={e => setNewRepoBranches(e.target.value)}
            />
            <Button
              onClick={() => void handleSaveNewRepo()}
              disabled={isSavingRepo || !newRepoName.trim() || !newRepoUrl.trim()}
              className='w-full'
              data-track-category='CANVAS'
              data-track-name='Save_New_Repository'
              data-track-metadata={JSON.stringify({ repoName: newRepoName })}
            >
              {isSavingRepo ? <Loader2 className='h-4 w-4 animate-spin' /> : 'Add Repository'}
            </Button>
          </div>
        ) : editingRepo ? (
          // Edit repo form
          <div className='space-y-3 p-3 border rounded-lg bg-muted'>
            <div className='flex justify-between items-center'>
              <span className='text-sm font-medium'>Edit Repository</span>
              <button
                onClick={() => setEditingRepo(null)}
                className='text-muted-foreground hover:text-foreground'
                data-track-category='CANVAS'
                data-track-name='Cancel_Edit_Repository'
                data-track-metadata={JSON.stringify({ repoId: editingRepo?.id })}
              >
                <X className='h-4 w-4' />
              </button>
            </div>
            <Input
              placeholder='Repository name'
              value={editRepoName}
              onChange={e => setEditRepoName(e.target.value)}
            />
            <Input
              placeholder='Repository URL (SSH or HTTPS)'
              value={editRepoUrl}
              onChange={e => setEditRepoUrl(e.target.value)}
            />
            <Input
              placeholder='Base branches (comma-separated)'
              value={editRepoBranches}
              onChange={e => setEditRepoBranches(e.target.value)}
            />
            <Button
              onClick={() => void handleSaveEditRepo()}
              disabled={!editRepoName.trim() || !editRepoUrl.trim()}
              className='w-full'
              data-track-category='CANVAS'
              data-track-name='Save_Edit_Repository'
              data-track-metadata={JSON.stringify({
                repoId: editingRepo?.id,
                repoName: editRepoName,
              })}
            >
              Save Changes
            </Button>
          </div>
        ) : (
          // Repo dropdown
          <div className='relative'>
            <button
              onClick={() => setShowRepoDropdown(!showRepoDropdown)}
              className='w-full flex items-center justify-between px-3 py-2 border rounded-lg bg-background hover:bg-accent'
              data-track-category='CANVAS'
              data-track-name='Toggle_Repo_Dropdown'
            >
              <span className={selectedRepo ? 'text-foreground' : 'text-muted-foreground'}>
                {selectedRepo?.name || 'Select a repository...'}
              </span>
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', showRepoDropdown && 'rotate-180')}
              />
            </button>

            {showRepoDropdown && (
              <div className='absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-60 overflow-auto'>
                <div className='p-2 border-b'>
                  <div className='relative'>
                    <Search className='absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                    <input
                      ref={searchInputRef}
                      type='text'
                      placeholder='Search repositories...'
                      value={repoSearchQuery}
                      onChange={e => setRepoSearchQuery(e.target.value)}
                      className='w-full pl-8 pr-3 py-1.5 text-sm border rounded bg-muted'
                      data-track-event='blur'
                      data-track-category='CANVAS'
                      data-track-name='Repo_Search_Input'
                    />
                  </div>
                </div>

                {filteredRepos.length === 0 ? (
                  <div className='p-4 text-center text-sm text-muted-foreground'>
                    No repositories found
                  </div>
                ) : (
                  filteredRepos.map(repo => (
                    <div
                      key={repo.id}
                      className={cn(
                        'flex items-center justify-between px-3 py-2 hover:bg-accent cursor-pointer',
                        selectedRepo?.id === repo.id && 'bg-primary/10',
                      )}
                    >
                      <button
                        className='flex-1 text-left'
                        onClick={() => {
                          setSelectedRepo(repo);
                          const branches = repo.baseBranch as string[] | undefined;
                          if (branches?.[0]) setSelectedBranch(branches[0]);
                          setShowRepoDropdown(false);
                        }}
                        data-track-category='CANVAS'
                        data-track-name='Select_Repository'
                        data-track-metadata={JSON.stringify({
                          repoId: repo.id,
                          repoName: repo.name,
                        })}
                      >
                        <span className='font-medium'>{repo.name}</span>
                        <span className='text-xs text-muted-foreground block truncate'>
                          {repo.url}
                        </span>
                      </button>
                      <div className='flex items-center gap-1 ml-2'>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleStartEditRepo(repo);
                            setShowRepoDropdown(false);
                          }}
                          className='p-1 text-muted-foreground hover:text-primary'
                          title='Edit repository'
                          data-track-category='CANVAS'
                          data-track-name='Edit_Repository'
                          data-track-metadata={JSON.stringify({
                            repoId: repo.id,
                            repoName: repo.name,
                          })}
                        >
                          <Pencil className='h-3.5 w-3.5' />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (confirm('Delete this repository?')) {
                              void handleDeleteRepo(repo.id);
                            }
                          }}
                          className='p-1 text-muted-foreground hover:text-red-500'
                          title='Delete repository'
                          data-track-category='CANVAS'
                          data-track-name='Delete_Repository'
                          data-track-metadata={JSON.stringify({
                            repoId: repo.id,
                            repoName: repo.name,
                          })}
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </button>
                      </div>
                    </div>
                  ))
                )}

                <button
                  onClick={() => {
                    setShowAddForm(true);
                    setShowRepoDropdown(false);
                  }}
                  className='w-full flex items-center gap-2 px-3 py-2 text-primary hover:bg-primary/10 border-t'
                  data-track-category='CANVAS'
                  data-track-name='Open_Add_Repository_Form'
                  data-track-metadata={JSON.stringify({})}
                >
                  <Plus className='h-4 w-4' />
                  Add new repository
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Branch selector */}
      {selectedRepo && !showAddForm && !editingRepo && (
        <>
          <div className='space-y-2'>
            <span className='block text-sm font-medium text-foreground mb-1.5'>Base Branch</span>
            <div className='relative'>
              <button
                onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                className='w-full flex items-center justify-between px-3 py-2 border rounded-lg bg-background'
                data-track-category='CANVAS'
                data-track-name='Toggle_Branch_Dropdown'
                data-track-metadata={JSON.stringify({ repoId: selectedRepo?.id })}
              >
                <div className='flex items-center gap-2'>
                  <GitBranch className='h-4 w-4 text-muted-foreground' />
                  <span>{selectedBranch}</span>
                </div>
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', showBranchDropdown && 'rotate-180')}
                />
              </button>

              {showBranchDropdown && selectedRepoBranches && (
                <div className='absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg'>
                  {selectedRepoBranches.map(branch => (
                    <button
                      key={branch}
                      onClick={() => {
                        setSelectedBranch(branch);
                        setShowBranchDropdown(false);
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 hover:bg-accent',
                        selectedBranch === branch && 'bg-primary/10',
                      )}
                      data-track-category='CANVAS'
                      data-track-name='Select_Branch'
                      data-track-metadata={JSON.stringify({ branch, repoId: selectedRepo?.id })}
                    >
                      {branch}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className='space-y-2'>
            <span className='block text-sm font-medium text-foreground mb-1.5'>
              Working Branch (optional)
            </span>
            <Input
              placeholder={`Leave empty to use ${selectedBranch}`}
              value={workingBranch}
              onChange={e => setWorkingBranch(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>
              Create or switch to a specific branch for your work
            </p>
          </div>
        </>
      )}
    </div>
  );

  const canContinue = docType === 'public' || (docType === 'private' && selectedRepo);

  // Render based on current step
  const renderContent = (): React.ReactElement => {
    // Private config view
    if (docType === 'private') {
      return renderPrivateConfig();
    }

    // Initial type selection (or public selected)
    return renderTypeSelection();
  };

  return (
    <>
      <Dialog
        open={isOpen && !showInstructionsModal}
        onOpenChange={open => !open && onClose()}
        title='Create Quarto Document'
      >
        <div className='p-4 space-y-6'>
          {renderContent()}

          {canContinue && (
            <div className='flex justify-end gap-2 pt-4 border-t border-border'>
              <Button
                variant='outline'
                onClick={onClose}
                data-track-category='CANVAS'
                data-track-name='Cancel_Quarto_Doc_Creation'
                data-track-metadata={JSON.stringify({ docType })}
              >
                Cancel
              </Button>
              <Button
                onClick={handleContinue}
                disabled={isLoading}
                data-track-category='CANVAS'
                data-track-name='Continue_Quarto_Doc_Creation'
                data-track-metadata={JSON.stringify({
                  docType,
                  repoId: selectedRepo?.id,
                  branch: selectedBranch,
                })}
              >
                {isLoading ? (
                  <>
                    <Loader2 className='h-4 w-4 animate-spin mr-2' />
                    Opening...
                  </>
                ) : (
                  <>
                    <Check className='h-4 w-4 mr-2' />
                    Continue
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </Dialog>

      <QuartoInstructionsModal
        isOpen={showInstructionsModal}
        onClose={() => {
          setShowInstructionsModal(false);
          setInstructionsModalData(null);
          onClose(); // Also close the initial modal to fully dismiss
        }}
        repoUrl={instructionsModalData?.repoUrl || ''}
        branchName={instructionsModalData?.branchName || 'main'}
        repoName={instructionsModalData?.repoName || 'quarto-docs'}
        mode='create'
      />
    </>
  );
};

export default QuartoDocModal;
