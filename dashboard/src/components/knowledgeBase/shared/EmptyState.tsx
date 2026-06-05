import React from 'react';
import { FolderOpen, Search } from 'lucide-react';

/**
 * Empty state component for file list
 */
export const FileEmptyState: React.FC = () => {
  return (
    <div className='h-full flex items-center justify-center'>
      <div className='text-center max-w-sm'>
        <FolderOpen size={48} className='mx-auto text-gray-300 mb-4' />
        <h3 className='text-lg font-medium text-gray-900 mb-2'>No files yet</h3>
        <p className='text-sm text-gray-500 mb-4'>
          Upload files to get started with your Collection
        </p>
      </div>
    </div>
  );
};

/**
 * Empty state when search returns no results
 */
export const SearchEmptyState: React.FC<{ query?: string }> = ({ query }) => {
  return (
    <div className='h-full flex items-center justify-center'>
      <div className='text-center max-w-sm'>
        <Search size={48} className='mx-auto text-gray-300 mb-4' />
        <h3 className='text-lg font-medium text-gray-900 mb-2'>No results found</h3>
        <p className='text-sm text-gray-500'>
          {query
            ? `No files or folders match "${query}". Try a different search.`
            : 'Try a different search term or check your spelling.'}
        </p>
      </div>
    </div>
  );
};
