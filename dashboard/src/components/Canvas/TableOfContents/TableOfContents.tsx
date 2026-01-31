import React, { useCallback } from 'react';
import { List } from 'lucide-react';
import { Popover } from '../../ui/Popover/Popover';

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  headings: TocHeading[];
  onHeadingClick?: (id: string) => void;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ headings, onHeadingClick }) => {
  const handleClick = useCallback(
    (id: string) => {
      onHeadingClick?.(id);
    },
    [onHeadingClick],
  );

  if (headings.length === 0) {
    return null;
  }

  return (
    <div className='absolute right-0 top-1/2 -translate-y-1/2 z-40 hidden md:block'>
      <Popover
        trigger={
          <button
            className='flex flex-col gap-1 py-2 px-2 bg-white/90 hover:bg-white shadow-md rounded-l-lg border border-r-0 border-gray-200 transition-all duration-200 hover:shadow-lg max-h-[300px]'
            aria-label='Table of Contents'
          >
            <List className='w-4 h-4 text-gray-600 flex-shrink-0' />
            <div className='flex flex-col gap-0.5 overflow-hidden flex-1'>
              {headings.map(heading => (
                <div
                  key={heading.id}
                  className={`h-[2px] bg-gray-400 rounded-full transition-all flex-shrink-0 ${
                    heading.level === 1 ? 'w-3' : heading.level === 2 ? 'w-2' : 'w-1.5'
                  }`}
                  title={heading.text}
                />
              ))}
            </div>
          </button>
        }
        side='left'
        align='center'
        sideOffset={8}
        className='w-64'
      >
        <div className='max-h-[60vh] overflow-y-auto'>
          <div className='mb-2 pb-2 border-b border-gray-200'>
            <h3 className='text-sm font-semibold text-gray-900'>Table of Contents</h3>
          </div>
          <div className='space-y-1.5'>
            {headings.map(heading => (
              <button
                key={heading.id}
                onClick={() => handleClick(heading.id)}
                className={`block w-full text-left text-sm truncate hover:text-gray-900 hover:bg-gray-50 rounded px-2 py-1 transition-colors ${
                  heading.level === 1
                    ? 'font-medium text-gray-700 pl-2'
                    : heading.level === 2
                      ? 'text-gray-600 pl-6'
                      : 'text-gray-500 pl-10 text-xs'
                }`}
                title={heading.text}
              >
                {heading.text}
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </div>
  );
};

export default TableOfContents;
