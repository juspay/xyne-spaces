import React, { useState, useMemo } from 'react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { X, GitBranch, GitCommit, FilePlus, FileMinus, Edit } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../../services/clients/apiClient';
import { useTheme } from '../../hooks/useTheme';

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

interface GitDiffModalProps {
  executionId: string;
  isOpen: boolean;
  onClose: () => void;
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

const GitDiffModal: React.FC<GitDiffModalProps> = ({ executionId, isOpen, onClose }) => {
  const [viewType, setViewType] = useState<'split' | 'unified'>('split');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const pierreTheme = useTheme().theme === 'midnight' ? 'pierre-dark' : 'pierre-light';

  const {
    data: diffData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['git-diff', executionId],
    queryFn: async (): Promise<GitDiffResponse> => {
      const response = await apiInstance.get<GitDiffResponse>(`/workflows/${executionId}/git-diff`);
      return response.data;
    },
    enabled: isOpen && !!executionId,
  });

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

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
      <div className='bg-background rounded-lg shadow-xl w-full h-full max-w-7xl max-h-[90vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-border'>
          <div className='flex items-center gap-4'>
            <h2 className='text-lg font-semibold text-foreground'>Git Diff</h2>
            {diffData && (
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <GitBranch className='w-4 h-4' />
                <span>{diffData.branch}</span>
                {diffData.commitHash && (
                  <>
                    <GitCommit className='w-4 h-4 ml-2' />
                    <span className='font-mono text-xs'>{diffData.commitHash.substring(0, 8)}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className='flex items-center gap-2'>
            {diffData && (
              <div className='flex items-center gap-4 mr-4 text-sm text-muted-foreground'>
                <span className='text-emerald-500'>+{diffData.stats.additions}</span>
                <span className='text-red-500'>-{diffData.stats.deletions}</span>
                <span>{diffData.stats.files} files</span>
              </div>
            )}

            <select
              value={viewType}
              onChange={e => setViewType(e.target.value as 'split' | 'unified')}
              className='px-3 py-1 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='Workflows'
              data-track-name='ChangeGitDiffViewType'
              data-track-metadata={JSON.stringify({ viewType })}
            >
              <option value='split'>Split View</option>
              <option value='unified'>Unified View</option>
            </select>

            <button
              onClick={onClose}
              className='p-2 hover:bg-muted rounded-md transition-colors'
              data-track-category='Workflows'
              data-track-name='CloseGitDiffModal'
            >
              <X className='w-5 h-5 text-muted-foreground' />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className='flex-1 flex overflow-hidden'>
          {/* File List Sidebar */}
          {diffData && diffData.gitDiff.length > 0 && (
            <div className='w-80 border-r border-border overflow-y-auto'>
              <div className='p-2'>
                <h3 className='text-sm font-medium text-foreground mb-2'>Changed Files</h3>
                <div className='space-y-1'>
                  {diffData.gitDiff.map((file, index) => {
                    const fileName = getFileName(file);
                    const isSelected = selectedFile === fileName;

                    return (
                      <button
                        key={index}
                        onClick={() => setSelectedFile(isSelected ? null : fileName)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors text-left ${
                          isSelected
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'hover:bg-muted text-foreground'
                        }`}
                        data-track-category='Workflows'
                        data-track-name='SelectDiffFile'
                        data-track-metadata={JSON.stringify({ fileName })}
                      >
                        {getFileIcon(file.type)}
                        <span className='truncate flex-1'>{fileName}</span>
                        {file.hunks.length > 0 && (
                          <span className='text-xs text-muted-foreground'>
                            {file.hunks.reduce((acc, hunk) => acc + hunk.newLines, 0)} lines
                          </span>
                        )}
                      </button>
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
                  <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4'></div>
                  <p className='text-muted-foreground'>Loading git diff...</p>
                </div>
              </div>
            )}

            {error && (
              <div className='flex items-center justify-center h-full'>
                <div className='text-center'>
                  <div className='text-destructive mb-4'>
                    <X className='w-12 h-12 mx-auto' />
                  </div>
                  <p className='text-sm text-muted-foreground mt-2'>
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </p>
                </div>
              </div>
            )}

            {diffData && (
              <div className='p-4'>
                {diffData.gitDiff.length === 0 ? (
                  <div className='text-center py-8'>
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
                  <div>
                    {fileDiffs
                      .filter(
                        ({ gitFile }) => !selectedFile || getFileName(gitFile) === selectedFile,
                      )
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
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitDiffModal;
