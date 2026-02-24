import React, { useState, useMemo } from 'react';
import { Diff, Hunk, HunkData } from 'react-diff-view';
import 'react-diff-view/style/index.css';
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

// Parse hunk content into changes array for react-diff-view
type Change = {
  type: 'insert' | 'delete' | 'normal';
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
  isNormal?: boolean;
  isInsert?: boolean;
  isDelete?: boolean;
};

type ParsedHunk = GitDiffFile['hunks'][0] & { changes: Change[] };

const parseHunkContent = (hunk: GitDiffFile['hunks'][0]): ParsedHunk => {
  const changes: Change[] = [];

  const lines = hunk.content.split('\n');
  let oldLineNumber = hunk.oldStart;
  let newLineNumber = hunk.newStart;

  for (const line of lines) {
    if (line.startsWith('+')) {
      changes.push({
        type: 'insert',
        content: line.substring(1),
        lineNumber: newLineNumber,
        newLineNumber: newLineNumber,
        isInsert: true,
      });
      newLineNumber++;
    } else if (line.startsWith('-')) {
      changes.push({
        type: 'delete',
        content: line.substring(1),
        lineNumber: oldLineNumber,
        oldLineNumber: oldLineNumber,
        isDelete: true,
      });
      oldLineNumber++;
    } else if (line.startsWith(' ') || line === '') {
      changes.push({
        type: 'normal',
        content: line.startsWith(' ') ? line.substring(1) : line,
        oldLineNumber: oldLineNumber,
        newLineNumber: newLineNumber,
        isNormal: true,
      });
      oldLineNumber++;
      newLineNumber++;
    }
  }

  return {
    ...hunk,
    changes,
  };
};

const GitDiffPanel: React.FC<GitDiffPanelProps> = ({ executionId, onRefresh }) => {
  const [viewType, setViewType] = useState<'split' | 'unified'>('unified');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  // Parse hunks to add changes array
  const parsedDiffData = useMemo(() => {
    if (!diffData) return null;

    return {
      ...diffData,
      gitDiff: diffData.gitDiff.map(file => ({
        ...file,
        hunks: file.hunks.map(parseHunkContent),
      })),
    };
  }, [diffData]);

  const getFileIcon = (type: string): React.ReactElement => {
    switch (type) {
      case 'add':
        return <FilePlus className='w-4 h-4 text-green-600' />;
      case 'delete':
        return <FileMinus className='w-4 h-4 text-red-600' />;
      case 'modify':
        return <Edit className='w-4 h-4 text-blue-600' />;
      case 'rename':
        return <GitBranch className='w-4 h-4 text-purple-600' />;
      default:
        return <Edit className='w-4 h-4 text-gray-600' />;
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
      <div className='h-full flex items-center justify-center bg-gray-50'>
        <div className='text-center'>
          <AlertCircle className='w-12 h-12 text-gray-400 mx-auto mb-4' />
          <p className='text-gray-600'>No execution selected</p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col bg-white'>
      {/* Header */}
      <div className='flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50'>
        <div className='flex items-center gap-4'>
          {diffData && (
            <div className='flex items-center gap-4 text-sm text-gray-600'>
              <div className='flex items-center gap-2'>
                <GitBranch className='w-4 h-4 text-blue-500' />
                <span className='font-semibold text-gray-900'>{diffData.branch}</span>
              </div>
              {diffData.commitHash && (
                <div className='flex items-center gap-2'>
                  <GitCommit className='w-4 h-4' />
                  <span className='font-mono text-xs'>{diffData.commitHash.substring(0, 8)}</span>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            className='flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50'
            data-track-category='Workflows'
            data-track-name='RefreshGitDiff'
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Check for Updates'}
          </button>
        </div>

        <div className='flex items-center gap-3'>
          {diffData && (
            <div className='flex items-center gap-3 text-sm text-gray-600'>
              <span className='text-green-600'>+{diffData.stats.additions}</span>
              <span className='text-red-600'>-{diffData.stats.deletions}</span>
              <span>{diffData.stats.files} files</span>
            </div>
          )}

          <select
            value={viewType}
            onChange={e => setViewType(e.target.value as 'split' | 'unified')}
            className='px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
            data-track-category='Workflows'
            data-track-name='ChangeGitDiffViewType'
            data-track-metadata={JSON.stringify({ viewType })}
          >
            <option value='split'>Split View</option>
            <option value='unified'>Unified View</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 flex overflow-hidden'>
        {/* File List Sidebar */}
        {diffData && diffData.gitDiff.length > 0 && (
          <div className='w-72 border-r border-gray-200 overflow-y-auto bg-gray-50'>
            <div className='p-2'>
              <h3 className='text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 px-2'>
                Changed Files
              </h3>
              <div className='space-y-0.5'>
                {diffData.gitDiff.map((file, index) => {
                  const fileName = getFileName(file);
                  const isSelected = selectedFile === fileName;

                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedFile(isSelected ? null : fileName)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors text-left ${
                        isSelected ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-700'
                      }`}
                      data-track-category='Workflows'
                      data-track-name='SelectGitDiffFile'
                      data-track-metadata={JSON.stringify({ fileName })}
                    >
                      {getFileIcon(file.type)}
                      <span className='truncate flex-1 font-mono'>{fileName}</span>
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
                <Loader2 className='w-8 h-8 text-blue-500 animate-spin mx-auto mb-4' />
                <p className='text-gray-600 text-sm'>Loading git diff...</p>
              </div>
            </div>
          )}

          {error && (
            <div className='flex items-center justify-center h-full'>
              <div className='text-center'>
                <AlertCircle className='w-12 h-12 text-red-500 mx-auto mb-4' />
                <p className='text-gray-600'>Failed to load git diff</p>
                <p className='text-sm text-gray-500 mt-2'>
                  {error instanceof Error ? error.message : 'Unknown error'}
                </p>
              </div>
            </div>
          )}

          {parsedDiffData && (
            <div className='p-4'>
              {parsedDiffData.gitDiff.length === 0 ? (
                <div className='text-center py-12'>
                  <GitBranch className='w-12 h-12 mx-auto text-gray-400 mb-4' />
                  <p className='text-gray-600'>
                    No changes detected on branch{' '}
                    <span className='font-semibold'>{parsedDiffData.branch}</span>
                  </p>
                  <p className='text-sm text-gray-500 mt-2'>
                    The bot did not make any commits during this workflow execution.
                  </p>
                </div>
              ) : (
                parsedDiffData.gitDiff
                  .filter(file => !selectedFile || getFileName(file) === selectedFile)
                  .map((file, index) => (
                    <div key={index} className='mb-6'>
                      <div className='flex items-center gap-2 font-medium text-sm text-gray-700 mb-2 px-2 py-1 bg-gray-100 rounded'>
                        {getFileIcon(file.type)}
                        <span className='font-mono'>{getFileName(file)}</span>
                      </div>

                      {file.hunks.length > 0 ? (
                        <>
                          {file.hunks.map((hunk, i) => (
                            <React.Fragment key={i}>
                              {i > 0 &&
                                (() => {
                                  const prevHunk = file.hunks[i - 1];
                                  if (prevHunk) {
                                    const prevEndLine = prevHunk.oldStart + prevHunk.oldLines;
                                    const currentStartLine = hunk.oldStart;
                                    const lineGap = currentStartLine - prevEndLine;

                                    if (lineGap > 3) {
                                      return (
                                        <div className='my-4 border-t border-dashed border-gray-300' />
                                      );
                                    }
                                  }
                                  return null;
                                })()}
                              <Diff
                                viewType={viewType}
                                diffType={file.type}
                                hunks={[hunk] as unknown as HunkData[]}
                              >
                                {(hunks): React.ReactElement[] =>
                                  hunks.map((h, j) => <Hunk key={j} hunk={h} />)
                                }
                              </Diff>
                            </React.Fragment>
                          ))}
                        </>
                      ) : (
                        <div className='text-sm text-gray-500 italic px-2'>No hunks available</div>
                      )}
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
