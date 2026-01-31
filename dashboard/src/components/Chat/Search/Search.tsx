import { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import BrowseChannels from '../BrowseChannels/BrowseChannels';

const Search = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');

  // For now, we only support 'channels' mode
  // Future modes could be added here (e.g., 'messages', 'users', etc.)
  if (mode === 'channels') {
    return <BrowseChannels />;
  }

  // Default fallback - could be a search mode selector or default search view
  return (
    <div className='h-full flex flex-col items-center justify-center bg-white'>
      <div className='text-center'>
        <h2 className='text-lg font-semibold text-gray-900 mb-2'>Search</h2>
        <p className='text-gray-500'>Select a search mode to continue</p>
      </div>
    </div>
  );
};

export default Search;
