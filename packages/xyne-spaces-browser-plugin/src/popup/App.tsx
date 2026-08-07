import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { SearchBar } from './components/SearchBar';
import { SearchResults } from './components/SearchResults';
import { QuickActions } from './components/QuickActions';
import { ChannelList } from './components/ChannelList';
import { TicketList } from './components/TicketList';
import { Settings } from './components/Settings';
import type { SearchResult } from '@xyne/spaces-sdk';

type View = 'main' | 'settings' | 'channels' | 'tickets';

export default function App() {
  const { isAuthenticated, user, isLoading } = useAuth();
  const [view, setView] = useState<View>('main');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Check for pending search from context menu
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_PENDING_SEARCH' }, (response) => {
      if (response?.query) {
        setSearchQuery(response.query);
      }
    });
  }, []);

  // Handle auth loading state
  if (isLoading) {
    return (
      <div className="w-popup h-popup flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-xyne-600"></div>
      </div>
    );
  }

  // Show settings if not authenticated
  if (!isAuthenticated) {
    return <Settings onBack={() => {}} isInitialSetup />;
  }

  // Render current view
  const renderView = () => {
    switch (view) {
      case 'settings':
        return <Settings onBack={() => setView('main')} />;
      case 'channels':
        return <ChannelList onBack={() => setView('main')} />;
      case 'tickets':
        return <TicketList onBack={() => setView('main')} />;
      default:
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-lg font-semibold text-gray-900">Xyne Spaces</h1>
                <button
                  onClick={() => setView('settings')}
                  className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
                  title="Settings"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onResults={setSearchResults}
                onSearching={setIsSearching}
              />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto bg-gray-50">
              {searchQuery ? (
                <SearchResults results={searchResults} isLoading={isSearching} />
              ) : (
                <>
                  {/* Quick Actions */}
                  <QuickActions
                    onChannels={() => setView('channels')}
                    onTickets={() => setView('tickets')}
                  />

                  {/* Recent Channels Preview */}
                  <div className="mt-4">
                    <ChannelList preview onViewAll={() => setView('channels')} />
                  </div>

                  {/* My Tickets Preview */}
                  <div className="mt-4">
                    <TicketList preview onViewAll={() => setView('tickets')} />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-gray-200 bg-white">
              <div className="text-xs text-gray-500 text-center">
                Logged in as {user?.email}
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="w-popup h-popup bg-white overflow-hidden">
      {renderView()}
    </div>
  );
}
