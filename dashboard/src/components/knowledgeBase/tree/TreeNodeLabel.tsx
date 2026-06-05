import React from 'react';

interface TreeNodeLabelProps {
  name: string;
  highlight?: string;
}

/**
 * Label component for tree nodes
 * Supports text highlighting for search
 */
export const TreeNodeLabel: React.FC<TreeNodeLabelProps> = ({ name, highlight }) => {
  if (!highlight) {
    return <span className='text-sm truncate flex-1'>{name}</span>;
  }

  // Simple highlight implementation
  const parts = name.split(new RegExp(`(${highlight})`, 'gi'));

  return (
    <span className='text-sm truncate flex-1'>
      {parts.map((part, index) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={index} className='bg-yellow-200'>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </span>
  );
};
