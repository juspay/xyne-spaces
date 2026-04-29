import React, { useEffect, useRef, useState } from 'react';
import { TextInput, MultiSelect } from '@juspay/blend-design-system';
import { Search, Brain, Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MemoryFilters } from '../../types/memory';
import { useUploadDocuments, useCleanupAllVespaMemory } from '../../hooks/useMemory';
import { useIsMemoryAdmin } from '../../hooks/usePermissions';
import { usePlatform } from '../../hooks/usePlatform';
import Dialog from '../ui/Dialog';

interface MemoryHeaderProps {
  filters: MemoryFilters;
  onFiltersChange: (filters: MemoryFilters) => void;
}

const MemoryHeader: React.FC<MemoryHeaderProps> = ({ filters, onFiltersChange }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [repoUrl, setRepoUrl] = useState('');
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLElement | null>(null);
  const { isMobile } = usePlatform();

  const isMemoryAdmin = useIsMemoryAdmin();
  const uploadMutation = useUploadDocuments();
  const cleanupMutation = useCleanupAllVespaMemory();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // reset so same file can be re-selected
    if (files.length === 0) return;
    setPendingFiles(files);
    setRepoUrl('');
    setShowUploadDialog(true);
  };

  const handleUploadSubmit = (): void => {
    uploadMutation.mutate(
      { files: pendingFiles, repoUrl: repoUrl.trim() },
      {
        onSuccess: data => {
          setShowUploadDialog(false);
          setPendingFiles([]);
          setRepoUrl('');
          const count = data.files.length;
          toast.success(`${count} file${count !== 1 ? 's' : ''} queued for ingestion`);
          if (data.rejected && data.rejected.length > 0) {
            toast.warning(
              `${data.rejected.length} file(s) rejected: only .txt and .md are supported`,
            );
          }
        },
        onError: () => toast.error('Failed to upload documents'),
      },
    );
  };

  const handleCleanupConfirm = (): void => {
    cleanupMutation.mutate(undefined, {
      onSuccess: () => {
        setShowCleanupConfirm(false);
        toast.success('All Vespa memory documents deleted');
      },
      onError: () => {
        setShowCleanupConfirm(false);
        toast.error('Cleanup failed');
      },
    });
  };

  const hasActiveFilters = (): boolean => {
    return (
      filters.docTypeFilter.length > 0 ||
      filters.tagsFilter.trim().length > 0 ||
      filters.repoUrlFilter.trim().length > 0 ||
      filters.commitIdFilter.trim().length > 0 ||
      filters.sessionIdFilter.trim().length > 0 ||
      filters.filePointersFilter.trim().length > 0 ||
      filters.ticketIdFilter.trim().length > 0
    );
  };

  const clearAllFilters = (): void => {
    onFiltersChange({
      ...filters,
      searchQuery: '',
      includeQuery: true,
      includeSummary: true,
      docTypeFilter: [],
      tagsFilter: '',
      repoUrlFilter: '',
      commitIdFilter: '',
      sessionIdFilter: '',
      filePointersFilter: '',
      ticketIdFilter: '',
    });
  };

  const clearFilters = (): void => {
    onFiltersChange({
      ...filters,
      docTypeFilter: [],
      tagsFilter: '',
      repoUrlFilter: '',
      commitIdFilter: '',
      sessionIdFilter: '',
      filePointersFilter: '',
      ticketIdFilter: '',
    });
  };

  const handleDocTypeChange = (value: string): void => {
    if (value === '') {
      onFiltersChange({ ...filters, docTypeFilter: [] });
    } else {
      const newValues = filters.docTypeFilter.includes(value)
        ? filters.docTypeFilter.filter(v => v !== value)
        : [...filters.docTypeFilter, value];
      onFiltersChange({ ...filters, docTypeFilter: newValues });
    }
  };

  const docTypeOptions = ['fact', 'sop'];
  const scopeOptions = [
    { label: 'Mine', value: 'my' },
    { label: 'All', value: 'all' },
  ];

  const getSearchPlaceholder = (): string => {
    if (filters.includeQuery && filters.includeSummary) {
      return 'Search in query and summary...';
    } else if (filters.includeQuery) {
      return 'Search in query...';
    } else if (filters.includeSummary) {
      return 'Search in summary...';
    }
    return 'Search context...';
  };

  useEffect(() => {
    if (isMobile) return;
    const input = searchContainerRef.current?.querySelector('input');
    if (input instanceof HTMLElement) {
      searchInputRef.current = input;
    }
  }, [isMobile]);

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [filters.includeQuery, filters.includeSummary, isMobile]);

  return (
    <div className='space-y-6 mb-8'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <Brain size={24} className='text-purple-600' />
          <h1 className='font-semibold text-xl leading-[32px] tracking-normal text-foreground whitespace-nowrap'>
            Context
          </h1>
        </div>

        {/* Action buttons */}
        <div className='flex items-center gap-2'>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type='file'
            multiple
            accept='.txt,.md'
            className='hidden'
            onChange={handleFileChange}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            title='Upload .txt or .md files to ingest as SOPs/Facts'
            data-track-category='Memory'
            data-track-name='UploadDocuments'
          >
            <Upload size={14} />
            {uploadMutation.isPending ? 'Uploading…' : 'Upload Docs'}
          </button>

          {isMemoryAdmin && (
            <button
              onClick={() => setShowCleanupConfirm(true)}
              disabled={cleanupMutation.isPending}
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-red-300 bg-background text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              title='Delete ALL documents from Vespa memory — irreversible'
              data-track-category='Memory'
              data-track-name='CleanupAllVespaMemory'
            >
              <Trash2 size={14} />
              {cleanupMutation.isPending ? 'Deleting…' : 'Cleanup All'}
            </button>
          )}
        </div>
      </div>

      {/* Upload dialog — asks for optional repoUrl before submitting */}
      <Dialog
        open={showUploadDialog}
        onOpenChange={open => {
          if (!open) {
            setShowUploadDialog(false);
            setPendingFiles([]);
            setRepoUrl('');
          }
        }}
        className='max-w-sm'
      >
        <div className='p-6 space-y-4'>
          <h2 className='text-base font-semibold text-foreground'>Upload documents</h2>
          <p className='text-sm text-muted-foreground'>
            {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} selected:{' '}
            <span className='text-foreground'>{pendingFiles.map(f => f.name).join(', ')}</span>
          </p>

          <div className='space-y-1'>
            <p className='text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              Repository URL <span className='text-red-500'>*</span>
            </p>
            <TextInput
              placeholder='https://github.com/org/repo'
              value={repoUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepoUrl(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>
              Scope ingested knowledge to a specific repository for better retrieval.
            </p>
          </div>

          <div className='flex justify-end gap-2'>
            <button
              onClick={() => {
                setShowUploadDialog(false);
                setPendingFiles([]);
                setRepoUrl('');
              }}
              className='px-4 py-2 text-sm font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors'
              data-track-category='Memory'
              data-track-name='CancelUploadDocuments'
            >
              Cancel
            </button>
            <button
              onClick={handleUploadSubmit}
              disabled={uploadMutation.isPending || !repoUrl.trim()}
              className='px-4 py-2 text-sm font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              data-track-category='Memory'
              data-track-name='ConfirmUploadDocuments'
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      </Dialog>

      {/* Cleanup confirmation dialog — admin only */}
      <Dialog open={showCleanupConfirm} onOpenChange={setShowCleanupConfirm} className='max-w-sm'>
        <div className='p-6 space-y-4'>
          <h2 className='text-base font-semibold text-foreground'>Delete all Vespa memory?</h2>
          <p className='text-sm text-muted-foreground'>
            This will permanently delete{' '}
            <span className='font-medium text-foreground'>all SOP and Fact documents</span> from the
            Vespa memory schema for all users. This action cannot be undone.
          </p>
          <div className='flex justify-end gap-2'>
            <button
              onClick={() => setShowCleanupConfirm(false)}
              className='px-4 py-2 text-sm font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors'
              data-track-category='Memory'
              data-track-name='CancelCleanupVespaMemory'
            >
              Cancel
            </button>
            <button
              onClick={handleCleanupConfirm}
              disabled={cleanupMutation.isPending}
              className='px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              data-track-category='Memory'
              data-track-name='ConfirmCleanupVespaMemory'
            >
              {cleanupMutation.isPending ? 'Deleting…' : 'Delete All'}
            </button>
          </div>
        </div>
      </Dialog>

      <div className='flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4'>
        <div className='flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full lg:w-auto'>
          <div className='flex items-center gap-2'>
            <div ref={searchContainerRef} className='w-[300px]'>
              <TextInput
                placeholder={getSearchPlaceholder()}
                value={filters.searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onFiltersChange({ ...filters, searchQuery: e.target.value })
                }
                leftSlot={<Search className='w-4 h-4' />}
              />
            </div>
            <div className='flex items-center gap-1'>
              <button
                onClick={() => {
                  // Prevent deselecting both - at least one must be selected
                  if (filters.includeQuery && !filters.includeSummary) return;
                  onFiltersChange({ ...filters, includeQuery: !filters.includeQuery });
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  filters.includeQuery
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
                title='Include user query in search ranking'
                data-track-category='Memory'
                data-track-name='ToggleIncludeQuery'
              >
                Query
              </button>
              <button
                onClick={() => {
                  // Prevent deselecting both - at least one must be selected
                  if (filters.includeSummary && !filters.includeQuery) return;
                  onFiltersChange({ ...filters, includeSummary: !filters.includeSummary });
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  filters.includeSummary
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
                title='Include summary in search ranking'
                data-track-category='Memory'
                data-track-name='ToggleIncludeSummary'
              >
                Summary
              </button>
            </div>
          </div>
          {filters.searchQuery.trim() && (
            <button
              onClick={clearAllFilters}
              className='flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors whitespace-nowrap'
              data-track-category='Memory'
              data-track-name='ClearAllFilters'
            >
              <span>Clear All</span>
            </button>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-2 lg:gap-4 w-full lg:w-auto'>
          {hasActiveFilters() && (
            <button
              onClick={clearFilters}
              className='flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors whitespace-nowrap'
              data-track-category='Memory'
              data-track-name='ClearFilters'
            >
              <span>Clear Filters</span>
            </button>
          )}

          <MultiSelect
            label=''
            items={[
              {
                items: scopeOptions.map(option => ({
                  label: option.label,
                  value: option.value,
                })),
              },
            ]}
            selectedValues={[filters.scope]}
            onChange={(value: string) => {
              if (value === 'my' || value === 'all') {
                onFiltersChange({ ...filters, scope: value });
              }
            }}
            placeholder='Scope'
            enableSearch={false}
            enableSelectAll={false}
          />

          <MultiSelect
            label=''
            items={[
              {
                items: docTypeOptions.map(option => ({
                  label: option,
                  value: option,
                })),
              },
            ]}
            selectedValues={filters.docTypeFilter}
            onChange={handleDocTypeChange}
            placeholder='Doc Type'
            enableSearch={false}
            enableSelectAll={true}
          />

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by tag...'
              value={filters.tagsFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, tagsFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by repo URL...'
              value={filters.repoUrlFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, repoUrlFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by commit ID...'
              value={filters.commitIdFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, commitIdFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by session ID...'
              value={filters.sessionIdFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, sessionIdFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by file...'
              value={filters.filePointersFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, filePointersFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder='Filter by ticket ID...'
              value={filters.ticketIdFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, ticketIdFilter: e.target.value })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemoryHeader;
