import { ReactElement, useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Lock, Users, Search, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import Input from '../../ui/Input';
import { ChannelVisibility, User } from '@xyne/shared';
import { useBrowsableChannels } from '../../../hooks/useChannels';
import { useUsers } from '../../../hooks/useUsers';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';

const PAGE_SIZE = 10;

const BrowseChannels = (): ReactElement => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const channels = useBrowsableChannels();
  const users = useUsers();
  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    users.forEach(user => map.set(user.id, user));
    return map;
  }, [users]);

  // Filter and sort channels - prioritize channels starting with search query
  const filteredChannels = useMemo(() => {
    if (!channels) return [];

    const query = searchQuery.toLowerCase();

    if (!query) return channels;

    const filtered = channels.filter(channel => {
      const matchesName = channel.name.toLowerCase().includes(query);
      const matchesDesc = channel.description?.toLowerCase().includes(query);
      return matchesName || matchesDesc;
    });

    // Sort: channels starting with query first, then channels containing query
    return filtered.sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(query);
      const bStartsWith = b.name.toLowerCase().startsWith(query);

      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      // If both start with or both don't start with, sort alphabetically
      return a.name.localeCompare(b.name);
    });
  }, [channels, searchQuery]);

  // Track search execution (no sensitive data - only metadata)
  useEffect(() => {
    // Reset to page 1 when search query changes
    setCurrentPage(1);

    if (!searchQuery.trim()) return;

    const timer = setTimeout((): void => {
      mixpanelService.track(EVENTS.SEARCH_PERFORMED, {
        searchType: EVENT_PROPERTIES.SEARCH_TYPES.CHANNELS,
        resultsCount: filteredChannels.length,
      });
    }, 500); // Debounce to avoid tracking every keystroke

    return (): void => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredChannels.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedChannels = filteredChannels.slice(startIndex, startIndex + PAGE_SIZE);

  const handleChannelClick = (channelId: string): void => {
    void navigate(`/chat/dir/${channelId}`);
  };

  const handleBack = (): void => {
    void navigate('/chat');
  };

  return (
    <div className='h-full flex flex-col bg-white'>
      {/* Header */}
      <div className='flex items-center gap-3 p-4 border-b border-gray-200'>
        <button
          onClick={handleBack}
          className='p-2 rounded-md text-gray-600 hover:bg-gray-100 transition-colors'
          aria-label='Back to chat'
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className='text-lg font-semibold text-gray-900'>Browse Channels</h2>
      </div>

      <div className='flex-1 overflow-y-auto p-4'>
        <div className='space-y-4 max-w-4xl mx-auto'>
          {/* Search Input */}
          <div className='relative'>
            <Search size={16} className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-400' />
            <Input
              placeholder='Search channels...'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='pl-9'
            />
          </div>

          {/* Channel List */}
          <div className='space-y-2'>
            {filteredChannels.length === 0 ? (
              <div className='text-center py-8 text-gray-500'>
                {searchQuery ? 'No channels match your search' : 'No channels available'}
              </div>
            ) : (
              paginatedChannels.map(channel => {
                const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;
                const createdByUser = userMap.get(channel.createdBy);
                return (
                  <button
                    key={channel.id}
                    type='button'
                    onClick={() => handleChannelClick(channel.id)}
                    className='w-full flex items-center p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-blue-500'
                    aria-label={`${isPrivate ? 'Private channel' : 'Channel'}: ${channel.name}`}
                  >
                    <div className='flex items-center gap-3 flex-1 min-w-0'>
                      <div className='flex items-center justify-center w-8 h-8 rounded-md bg-gray-100'>
                        {isPrivate ? (
                          <Lock size={16} className='text-gray-600' />
                        ) : (
                          <Hash size={16} className='text-gray-600' />
                        )}
                      </div>
                      <div className='flex-1 min-w-0'>
                        <div className='font-medium text-sm text-gray-900 truncate'>
                          {channel.name}
                        </div>
                        {channel.description && (
                          <div className='text-xs text-gray-500 truncate'>
                            {channel.description}
                          </div>
                        )}
                        <div className='flex items-center gap-1 text-xs text-gray-400 mt-1'>
                          <Users size={12} />
                          <span>Created by {createdByUser?.name ?? 'Unknown'}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className='flex items-center justify-between pt-2 border-t border-gray-200'>
              <span className='text-xs text-gray-500'>
                Showing {startIndex + 1}-{Math.min(startIndex + PAGE_SIZE, filteredChannels.length)}{' '}
                of {filteredChannels.length} channels
              </span>
              <div className='flex items-center gap-2'>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className='p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  <ChevronLeft size={16} className='text-gray-600' />
                </button>
                <span className='text-sm text-gray-700'>
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className='p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  <ChevronRight size={16} className='text-gray-600' />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BrowseChannels;
