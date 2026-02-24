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
      className='flex items-center justify-between w-full h-[29px] px-1 rounded-md group'
    >
      <div
        className='flex items-center gap-1 cursor-pointer flex-1'
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
        <h3 className='text-[10px] font-medium text-[#788187] select-none uppercase font-mono tracking-[0.8px]'>
          {title}
        </h3>
        <div
          className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : 'rotate-0'}`}
        >
          <ChevronRight size={12} className='text-muted-foreground' />
        </div>
      </div>

      {renderAddButton ? (
        renderAddButton()
      ) : onAdd ? (
        <button
          onClick={onAdd}
          className='text-[#788187] hover:text-[#1D1E1F] p-1 rounded transition-colors'
          data-track-category='CHAT_DIRECTORY'
          data-track-name='Add_Section'
          data-track-metadata={JSON.stringify({ section: title })}
        >
          <Plus size={12} />
        </button>
      ) : null}
    </div>
  );
};

export default DirectorySectionHeader;
