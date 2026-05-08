import React from 'react';
import { Search } from 'lucide-react';

interface TreeSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Search input for filtering tree nodes
 */
export const TreeSearchInput: React.FC<TreeSearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search collections...',
  disabled = false,
}) => {
  return (
    <div className='relative'>
      <Search size={16} className='absolute left-2 top-1/2 -translate-y-1/2 text-gray-400' />
      <input
        type='text'
        value={value}
        data-track-category='knowledge-base'
        data-track-name='search-collections'
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full pl-8 pr-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          disabled ? 'bg-gray-100 cursor-not-allowed opacity-50' : ''
        }`}
      />
    </div>
  );
};
