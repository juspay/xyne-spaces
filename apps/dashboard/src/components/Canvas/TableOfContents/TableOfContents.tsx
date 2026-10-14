import React, { useCallback } from 'react';
import { HoverCard } from '../../ui/HoverCard/HoverCard';

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  headings: TocHeading[];
  onHeadingClick?: (id: string) => void;
  /** Shown as an "On this page" list on the right, in place of the hover rail on the left. */
  pinned?: boolean;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({
  headings,
  onHeadingClick,
  pinned = false,
}) => {
  const handleClick = useCallback(
    (id: string) => {
      onHeadingClick?.(id);
    },
    [onHeadingClick],
  );

  if (headings.length === 0) {
    return null;
  }

  const items = headings.map(heading => (
    <button
      key={heading.id}
      onClick={() => handleClick(heading.id)}
      className={`block w-full text-left text-sm truncate hover:text-foreground hover:bg-accent rounded pr-2 py-1 transition-colors ${
        heading.level === 1
          ? 'font-medium text-foreground pl-0'
          : heading.level === 2
            ? 'text-muted-foreground pl-4'
            : 'text-muted-foreground pl-8 text-xs'
      }`}
      aria-label={heading.text}
      data-track-category='CANVAS'
      data-track-name='Navigate_To_Heading'
      data-track-metadata={JSON.stringify({
        headingId: heading.id,
        headingText: heading.text,
        headingLevel: heading.level,
      })}
    >
      {heading.text}
    </button>
  ));

  // The page's own title heads the document already: the pinned list starts under it.
  const pinnedItems = headings[0]?.level === 1 ? items.slice(1) : items;

  return (
    <>
      {pinned && pinnedItems.length > 0 && (
        // Only where the page has room beside the text: narrower, the rail below takes over.
        <nav
          aria-label='On this page'
          className='absolute right-6 top-24 z-30 hidden max-h-[70vh] w-48 overflow-y-auto border-l pl-3 xl:block'
        >
          <p className='mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
            On this page
          </p>
          <div className='space-y-1'>{pinnedItems}</div>
        </nav>
      )}
      <div
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-40 hidden md:block ${
          pinned && pinnedItems.length > 0 ? 'xl:hidden' : ''
        }`}
      >
        <HoverCard
          openDelay={100}
          closeDelay={150}
          trigger={
            <button
              className='flex flex-col gap-1.5 py-2 px-2 transition-all duration-200 max-h-[300px]'
              aria-label='Table of Contents'
            >
              <div className='flex flex-col items-start gap-1.5 overflow-hidden flex-1'>
                {headings.map(heading => (
                  <div
                    key={heading.id}
                    className={`h-[2px] bg-muted-foreground/60 rounded-full transition-all flex-shrink-0 ${
                      heading.level === 1 ? 'w-4' : heading.level === 2 ? 'w-3' : 'w-2'
                    }`}
                  />
                ))}
              </div>
            </button>
          }
          side='right'
          align='center'
          sideOffset={8}
          className='w-64 p-2'
        >
          <div className='max-h-[60vh] overflow-y-auto'>
            <div className='space-y-1.5'>{items}</div>
          </div>
        </HoverCard>
      </div>
    </>
  );
};
