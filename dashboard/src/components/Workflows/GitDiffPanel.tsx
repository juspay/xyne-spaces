import React, { useState, useMemo } from 'react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useTheme } from '../../hooks/useTheme';
import {
  GitBranch,
  GitCommit,
  FilePlus,
  FileMinus,
  Edit,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../../services/clients/apiClient';

import { Tooltip } from '../ui/Tooltip/Tooltip';
interface GitDiffFile {
  oldPath: string;
  newPath: string;
  type: 'add' | 'delete' | 'modify' | 'rename';
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
  }>;
}

interface GitDiffResponse {
  executionId: string;
  branch: string;
  baseCommitHash: string;
  commitHash?: string;
  gitDiff: GitDiffFile[];
  stats: {
    additions: number;
    deletions: number;
    files: number;
  };
}

interface GitDiffPanelProps {
  executionId: string | undefined;
  onRefresh?: () => void;
}

// Build a unified diff patch string from the backend hunk data
const buildPatchString = (file: GitDiffFile): string => {
  const oldPath = file.type === 'add' ? '/dev/null' : `a/${file.oldPath}`;
  const newPath = file.type === 'delete' ? '/dev/null' : `b/${file.newPath}`;

  const parts: string[] = [
    `diff --git a/${file.oldPath} b/${file.newPath}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
  ];

  for (const hunk of file.hunks) {
    parts.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    parts.push(hunk.content);
  }

  return parts.join('\n');
};

const GitDiffPanel: React.FC<GitDiffPanelProps> = ({ executionId, onRefresh }) => {
  const [viewType, setViewType] = useState<'split' | 'unified'>('unified');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pierreTheme = useTheme().theme === 'midnight' ? 'pierre-dark' : 'pierre-light';

  const {
    data: diffData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['git-diff', executionId],
    queryFn: async (): Promise<GitDiffResponse> => {
      const response = await apiInstance.get<GitDiffResponse>(`/workflows/${executionId}/git-diff`);
      return response.data;
    },
    enabled: !!executionId,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      onRefresh?.();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Parse each file's hunks into FileDiffMetadata for @pierre/diffs
  const fileDiffs = useMemo((): Array<{ gitFile: GitDiffFile; fileDiff: FileDiffMetadata }> => {
    if (!diffData) return [];
    return diffData.gitDiff
      .map(file => {
        const patch = buildPatchString(file);
        const parsed = parsePatchFiles(patch);
        const fileDiff = parsed[0]?.files[0];
        return fileDiff ? { gitFile: file, fileDiff } : null;
      })
      .filter(
        (pair): pair is { gitFile: GitDiffFile; fileDiff: FileDiffMetadata } => pair !== null,
      );
  }, [diffData]);

  const getFileIcon = (type: string): React.ReactElement => {
    switch (type) {
      case 'add':
        return <FilePlus className='w-4 h-4 text-emerald-500' />;
      case 'delete':
        return <FileMinus className='w-4 h-4 text-red-500' />;
      case 'modify':
        return <Edit className='w-4 h-4 text-blue-500' />;
      case 'rename':
        return <GitBranch className='w-4 h-4 text-violet-500' />;
      default:
        return <Edit className='w-4 h-4 text-muted-foreground' />;
    }
  };

  const getFileName = (file: GitDiffFile): string => {
    if (file.type === 'delete') {
      return file.oldPath;
    }
    return file.newPath;
  };

  if (!executionId) {
    return (
      <div className='h-full flex items-center justify-center bg-muted'>
        <div className='text-center'>
          <AlertCircle className='w-12 h-12 text-muted-foreground mx-auto mb-4' />
          <p className='text-muted-foreground'>No execution selected</p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col bg-background'>
      {/* Header */}
      <div className='flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted'>
        {/* Left section: Branch info + Refresh button */}
        <div className='flex items-center gap-2 sm:gap-4 flex-wrap'>
          {diffData && (
            <div className='flex items-center gap-2 sm:gap-4 text-sm text-muted-foreground'>
              {/* Branch name with truncation and tooltip */}
              <Tooltip content={diffData.branch} side='bottom' delayDuration={300}>
                <div className='flex items-center gap-1.5 min-w-0'>
                  <GitBranch className='w-4 h-4 text-primary flex-shrink-0' />
                  <span className='font-semibold text-foreground truncate max-w-[120px] sm:max-w-[180px] md:max-w-[240px]'>
                    {diffData.branch}
                  </span>
                </div>
              </Tooltip>
              {/* Commit hash - hidden on very small screens */}
              {diffData.commitHash && (
                <div className='hidden sm:flex items-center gap-1.5'>
                  <GitCommit className='w-4 h-4 flex-shrink-0' />
                  <span className='font-mono text-xs'>{diffData.commitHash.substring(0, 8)}</span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            className='flex items-center gap-1.5 px-2.5 sm:px-3 py-1 bg-background border border-input text-foreground text-xs font-medium rounded-md hover:bg-accent transition-colors disabled:opacity-50 whitespace-nowrap'
            data-track-category='Workflows'
            data-track-name='RefreshGitDiff'
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className='hidden sm:inline'>
              {isRefreshing ? 'Refreshing...' : 'Check for Updates'}
            </span>
            <span className='sm:hidden'>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>

        {/* Right section: Stats + View toggle */}
        <div className='flex items-center gap-2 sm:gap-3'>
          {diffData && (
            <div className='flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-muted-foreground'>
              <span className='text-emerald-500 font-medium'>+{diffData.stats.additions}</span>
              <span className='text-red-500 font-medium'>-{diffData.stats.deletions}</span>
              <span className='hidden sm:inline'>{diffData.stats.files} files</span>
              <span className='sm:hidden'>{diffData.stats.files}f</span>
            </div>
          )}

          <select
            value={viewType}
            onChange={e => setViewType(e.target.value as 'split' | 'unified')}
            className='px-2 py-1 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer'
            data-track-category='Workflows'
            data-track-name='ChangeGitDiffViewType'
            data-track-metadata={JSON.stringify({ viewType })}
          >
            <option value='split'>Split</option>
            <option value='unified'>Unified</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 flex overflow-hidden'>
        {/* File List Sidebar */}
        {diffData && diffData.gitDiff.length > 0 && (
          <div className='w-48 sm:w-56 md:w-72 border-r border-border overflow-y-auto bg-muted'>
            <div className='p-2'>
              <h3 className='text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-2'>
                Changed Files
              </h3>
              <div className='space-y-0.5'>
                {diffData.gitDiff.map((file, index) => {
                  const fileName = getFileName(file);
                  const isSelected = selectedFile === fileName;

                  return (
                    <Tooltip key={index} content={fileName} side='right' delayDuration={400}>
                      <button
                        onClick={() => setSelectedFile(isSelected ? null : fileName)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors text-left cursor-pointer ${
                          isSelected
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-accent text-foreground'
                        }`}
                        data-track-category='Workflows'
                        data-track-name='SelectGitDiffFile'
                        data-track-metadata={JSON.stringify({ fileName })}
                      >
                        {getFileIcon(file.type)}
                        <span className='truncate flex-1 font-mono'>{fileName}</span>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Diff Content */}
        <div className='flex-1 overflow-auto'>
          {isLoading && (
            <div className='flex items-center justify-center h-full'>
              <div className='text-center'>
                <Loader2 className='w-8 h-8 text-primary animate-spin mx-auto mb-4' />
                <p className='text-muted-foreground text-sm'>Loading git diff...</p>
              </div>
            </div>
          )}

          {error && (
            <div className='flex items-center justify-center h-full'>
              <div className='text-center'>
                <AlertCircle className='w-12 h-12 text-destructive mx-auto mb-4' />
                <p className='text-sm text-muted-foreground mt-2'>
                  {error instanceof Error ? error.message : 'Unknown error'}
                </p>
              </div>
            </div>
          )}

          {diffData && (
            <div className='p-4'>
              {diffData.gitDiff.length === 0 ? (
                <div className='text-center py-12'>
                  <GitBranch className='w-12 h-12 mx-auto text-muted-foreground mb-4' />
                  <p className='text-muted-foreground'>
                    No changes detected on branch{' '}
                    <span className='font-semibold'>{diffData.branch}</span>
                  </p>
                  <p className='text-sm text-muted-foreground mt-2'>
                    The bot did not make any commits during this workflow execution.
                  </p>
                </div>
              ) : (
                fileDiffs
                  .filter(({ gitFile }) => !selectedFile || getFileName(gitFile) === selectedFile)
                  .map(({ fileDiff }, index) => (
                    <div key={index} className='mb-4 [&_*]:text-[11px] [&_*]:leading-relaxed'>
                      <FileDiff
                        fileDiff={fileDiff}
                        options={{
                          theme: pierreTheme,
                          diffStyle: viewType,
                          lineDiffType: 'word-alt',
                          hunkSeparators: 'line-info',
                        }}
                      />
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GitDiffPanel;
