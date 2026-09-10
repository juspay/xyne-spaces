import { ReactElement } from 'react';
import { ChevronRight, Plus } from 'lucide-react';

interface DirectorySectionHeaderProps {
  title: string;
  isExpanded?: boolean;
  onToggle?: () => void;
  onAdd?: () => void;
  renderAddButton?: () => ReactElement;
}

const DirectorySectionHeader = ({
  title,
  isExpanded = true,
  onToggle,
  onAdd,
  renderAddButton,
}: DirectorySectionHeaderProps): ReactElement => {
  return (
    <div
      data-component='DirectorySectionHeader'
      className='flex items-center justify-between w-full h-7 px-3 rounded-md group'
    >
      <div
        className='flex items-center gap-2 cursor-pointer flex-1 min-w-0 text-sidebar-foreground text-xs font-medium'
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle?.();
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={`${title.toLowerCase().replace(' ', '-')}-section`}
        data-track-category='CHAT_DIRECTORY'
        data-track-name='Toggle_Section'
        data-track-metadata={JSON.stringify({ section: title, isExpanded })}
      >
        <span className='size-4 flex items-center justify-center shrink-0'>
          <ChevronRight
            size={12}
            strokeWidth={2.33}
            className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : 'rotate-0'}`}
          />
        </span>
        <h3 className='text-left truncate select-none'>{title}</h3>
      </div>

      {renderAddButton ? (
        renderAddButton()
      ) : onAdd ? (
        <button
          onClick={onAdd}
          className='text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent p-1 rounded transition-colors'
          data-track-category='CHAT_DIRECTORY'
          data-track-name='Add_Section'
          data-track-metadata={JSON.stringify({ section: title })}
        >
          <Plus size={14} />
        </button>
      ) : null}
    </div>
  );
};

export default DirectorySectionHeader;
