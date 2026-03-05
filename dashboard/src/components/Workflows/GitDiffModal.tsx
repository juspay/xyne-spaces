import React, { useState } from 'react';
import { Diff, Hunk, HunkData } from 'react-diff-view';
import { X, GitBranch, GitCommit, FilePlus, FileMinus, Edit } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../../services/clients/apiClient';

import 'react-diff-view/style/index.css';

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

const GitDiffModal: React.FC<GitDiffModalProps> = ({ executionId, isOpen, onClose }) => {
  const [viewType, setViewType] = useState<'split' | 'unified'>('split');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

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

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
      <div className='bg-white rounded-lg shadow-xl w-full h-full max-w-7xl max-h-[90vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200'>
          <div className='flex items-center gap-4'>
            <h2 className='text-lg font-semibold text-gray-900'>Git Diff</h2>
            {diffData && (
              <div className='flex items-center gap-2 text-sm text-gray-600'>
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
              <div className='flex items-center gap-4 mr-4 text-sm text-gray-600'>
                <span className='text-green-600'>+{diffData.stats.additions}</span>
                <span className='text-red-600'>-{diffData.stats.deletions}</span>
                <span>{diffData.stats.files} files</span>
              </div>
            )}

            <select
              value={viewType}
              onChange={e => setViewType(e.target.value as 'split' | 'unified')}
              className='px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
              data-track-category='Workflows'
              data-track-name='ChangeGitDiffViewType'
              data-track-metadata={JSON.stringify({ viewType })}
            >
              <option value='split'>Split View</option>
              <option value='unified'>Unified View</option>
            </select>

            <button
              onClick={onClose}
              className='p-2 hover:bg-gray-100 rounded-md transition-colors'
              data-track-category='Workflows'
              data-track-name='CloseGitDiffModal'
            >
              <X className='w-5 h-5 text-gray-500' />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className='flex-1 flex overflow-hidden'>
          {/* File List Sidebar */}
          {diffData && diffData.gitDiff.length > 0 && (
            <div className='w-80 border-r border-gray-200 overflow-y-auto'>
              <div className='p-2'>
                <h3 className='text-sm font-medium text-gray-700 mb-2'>Changed Files</h3>
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
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'hover:bg-gray-50 text-gray-700'
                        }`}
                        data-track-category='Workflows'
                        data-track-name='SelectDiffFile'
                        data-track-metadata={JSON.stringify({ fileName })}
                      >
                        {getFileIcon(file.type)}
                        <span className='truncate flex-1'>{fileName}</span>
                        {file.hunks.length > 0 && (
                          <span className='text-xs text-gray-500'>
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
                  <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4'></div>
                  <p className='text-gray-600'>Loading git diff...</p>
                </div>
              </div>
            )}

            {error && (
              <div className='flex items-center justify-center h-full'>
                <div className='text-center'>
                  <div className='text-red-500 mb-4'>
                    <X className='w-12 h-12 mx-auto' />
                  </div>
                  <p className='text-sm text-gray-500 mt-2'>
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </p>
                </div>
              </div>
            )}

            {diffData && (
              <div className='p-4'>
                {diffData.gitDiff.length === 0 ? (
                  <div className='text-center py-8'>
                    <GitBranch className='w-12 h-12 mx-auto text-gray-400 mb-4' />
                    <p className='text-gray-600'>
                      No changes detected on branch{' '}
                      <span className='font-semibold'>{diffData.branch}</span>
                    </p>
                    <p className='text-sm text-gray-500 mt-2'>
                      The bot did not make any commits during this workflow execution.
                    </p>
                  </div>
                ) : (
                  <div>
                    {diffData.gitDiff
                      .filter(file => !selectedFile || getFileName(file) === selectedFile)
                      .map((file, index) => (
                        <div key={index} className='mb-6'>
                          <div className='flex items-center gap-2 font-medium text-sm text-gray-700 mb-2 p-2 bg-gray-100 rounded'>
                            {getFileIcon(file.type)}
                            <span>{getFileName(file)}</span>
                          </div>

                          {file.hunks.length > 0 ? (
                            <Diff
                              viewType={viewType}
                              diffType={file.type}
                              hunks={file.hunks as unknown as HunkData[]}
                            >
                              {(hunks): React.ReactElement[] =>
                                hunks.map((hunk, i) => <Hunk key={i} hunk={hunk} />)
                              }
                            </Diff>
                          ) : (
                            <div className='text-sm text-gray-500 italic p-2'>
                              No changes in this file
                            </div>
                          )}
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
