import { ReactElement, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  placeholder?: string;
}

const SearchInput = ({
  value,
  onChange,
  onClose,
  placeholder = 'Search...',
}: SearchInputProps): ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when component mounts
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className='flex-1 flex items-center gap-2 px-2 py-1 bg-gray-50 rounded-md'>
      <Search className='size-3 text-gray-400 flex-shrink-0' />
      <input
        ref={inputRef}
        type='text'
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className='flex-1 bg-transparent text-[13px] text-gray-700 placeholder-gray-400 outline-none min-w-0'
        data-track-event='blur'
        data-track-category='Projects'
        data-track-name='ProjectSearchInput'
      />
      <button
        onClick={onClose}
        className='p-0.5 hover:bg-gray-200 rounded transition-colors'
        aria-label='Close search'
        data-track-category='Projects'
        data-track-name='CloseSearchInput'
      >
        <X className='size-3 text-gray-500' />
      </button>
    </div>
  );
};

export default SearchInput;
