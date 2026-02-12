import { ReactElement, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ComposeDmPanel from '../AddDmForm/ComposeDmPanel';
import BrowseChannels from '../BrowseChannels/BrowseChannels';

const Search = (): ReactElement => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');

  // route the user to create dm panenl if no mode
  useEffect(() => {
    if (!mode || (mode !== 'channels' && mode !== 'dm')) {
      void navigate('/chat/search?mode=dm', { replace: true });
    }
  }, [mode, navigate]);

  // For now, we only support 'channels' mode
  // Future modes could be added here (e.g., 'messages', 'users', etc.)
  if (mode === 'channels') {
    return <BrowseChannels />;
  }

  if (mode === 'dm') {
    return <ComposeDmPanel />;
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
