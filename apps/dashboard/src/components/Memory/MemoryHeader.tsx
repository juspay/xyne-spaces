import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('placeholders');
  const { t: tc } = useTranslation('common');
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
          toast.success(tc('memory.header.filesQueued', { count }));
          if (data.rejected && data.rejected.length > 0) {
            toast.warning(tc('memory.header.filesRejected', { count: data.rejected.length }));
          }
        },
        onError: () => toast.error(tc('memory.header.uploadFailed')),
      },
    );
  };

  const handleCleanupConfirm = (): void => {
    cleanupMutation.mutate(undefined, {
      onSuccess: () => {
        setShowCleanupConfirm(false);
        toast.success(tc('memory.header.allDeleted'));
      },
      onError: () => {
        setShowCleanupConfirm(false);
        toast.error(tc('memory.header.cleanupFailed'));
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
    { labelKey: 'memory.header.scopeMine', value: 'my' },
    { labelKey: 'memory.header.scopeAll', value: 'all' },
  ];

  const getSearchPlaceholder = (): string => {
    if (filters.includeQuery && filters.includeSummary) {
      return t('memory.header.searchInQueryAndSummary');
    } else if (filters.includeQuery) {
      return t('memory.header.searchInQuery');
    } else if (filters.includeSummary) {
      return t('memory.header.searchInSummary');
    }
    return t('memory.header.searchContext');
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
            {tc('memory.header.heading')}
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
            title={tc('memory.header.uploadTooltip')}
            data-track-category='Memory'
            data-track-name='UploadDocuments'
          >
            <Upload size={14} />
            {uploadMutation.isPending
              ? tc('memory.header.uploading')
              : tc('memory.header.uploadDocs')}
          </button>

          {isMemoryAdmin && (
            <button
              onClick={() => setShowCleanupConfirm(true)}
              disabled={cleanupMutation.isPending}
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-red-300 bg-background text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              title={tc('memory.header.cleanupTooltip')}
              data-track-category='Memory'
              data-track-name='CleanupAllVespaMemory'
            >
              <Trash2 size={14} />
              {cleanupMutation.isPending
                ? tc('memory.header.deleting')
                : tc('memory.header.cleanupAll')}
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
          <h2 className='text-base font-semibold text-foreground'>
            {tc('memory.header.uploadDocumentsHeading')}
          </h2>
          <p className='text-sm text-muted-foreground'>
            {tc('memory.header.filesSelected', { count: pendingFiles.length })}{' '}
            <span className='text-foreground'>{pendingFiles.map(f => f.name).join(', ')}</span>
          </p>

          <div className='space-y-1'>
            <p className='text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              {tc('memory.header.repositoryUrl')} <span className='text-red-500'>*</span>
            </p>
            <TextInput
              placeholder={t('memory.header.repoUrlPlaceholder')}
              value={repoUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepoUrl(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>{tc('memory.header.repoUrlHint')}</p>
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
              {tc('memory.header.cancel')}
            </button>
            <button
              onClick={handleUploadSubmit}
              disabled={uploadMutation.isPending || !repoUrl.trim()}
              className='h-auto px-4 py-2 text-sm font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              data-ph-capture-attribute-track-id='memory_upload_documents'
              data-track-category='Memory'
              data-track-name='ConfirmUploadDocuments'
            >
              {uploadMutation.isPending
                ? tc('memory.header.uploading')
                : tc('memory.header.upload')}
            </button>
          </div>
        </div>
      </Dialog>

      {/* Cleanup confirmation dialog — admin only */}
      <Dialog open={showCleanupConfirm} onOpenChange={setShowCleanupConfirm} className='max-w-sm'>
        <div className='p-6 space-y-4'>
          <h2 className='text-base font-semibold text-foreground'>
            {tc('memory.header.deleteAllHeading')}
          </h2>
          <p className='text-sm text-muted-foreground'>
            {tc('memory.header.deleteAllPrefix')}{' '}
            <span className='font-medium text-foreground'>
              {tc('memory.header.deleteAllTarget')}
            </span>{' '}
            {tc('memory.header.deleteAllSuffix')}
          </p>
          <div className='flex justify-end gap-2'>
            <button
              onClick={() => setShowCleanupConfirm(false)}
              className='px-4 py-2 text-sm font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors'
              data-track-category='Memory'
              data-track-name='CancelCleanupVespaMemory'
            >
              {tc('memory.header.cancel')}
            </button>
            <button
              onClick={handleCleanupConfirm}
              disabled={cleanupMutation.isPending}
              className='h-auto px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              data-ph-capture-attribute-track-id='memory_cleanup_all_vespa'
              data-track-category='Memory'
              data-track-name='ConfirmCleanupVespaMemory'
            >
              {cleanupMutation.isPending
                ? tc('memory.header.deleting')
                : tc('memory.header.deleteAll')}
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
                title={tc('memory.header.includeQueryTooltip')}
                data-track-category='Memory'
                data-track-name='ToggleIncludeQuery'
              >
                {tc('memory.header.query')}
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
                title={tc('memory.header.includeSummaryTooltip')}
                data-track-category='Memory'
                data-track-name='ToggleIncludeSummary'
              >
                {tc('memory.header.summary')}
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
              <span>{tc('memory.header.clearAll')}</span>
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
              <span>{tc('memory.header.clearFiltersLabel')}</span>
            </button>
          )}

          <MultiSelect
            label=''
            items={[
              {
                items: scopeOptions.map(option => ({
                  label: tc(option.labelKey),
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
            placeholder={t('memory.header.scope')}
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
            placeholder={t('memory.header.docType')}
            enableSearch={false}
            enableSelectAll={true}
          />

          <div className='w-[200px]'>
            <TextInput
              placeholder={t('memory.header.filterByTag')}
              value={filters.tagsFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, tagsFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder={t('memory.header.filterByRepoUrl')}
              value={filters.repoUrlFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, repoUrlFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder={t('memory.header.filterByCommitId')}
              value={filters.commitIdFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, commitIdFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder={t('memory.header.filterBySessionId')}
              value={filters.sessionIdFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, sessionIdFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder={t('memory.header.filterByFile')}
              value={filters.filePointersFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, filePointersFilter: e.target.value })
              }
            />
          </div>

          <div className='w-[200px]'>
            <TextInput
              placeholder={t('memory.header.filterByTicketId')}
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
