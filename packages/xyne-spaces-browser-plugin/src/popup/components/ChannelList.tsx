import { useChannels } from '../../hooks/useChannels';
import type { Channel } from '@xyne/spaces-sdk';

interface ChannelListProps {
  preview?: boolean;
  onViewAll?: () => void;
  onBack?: () => void;
}

export function ChannelList({ preview, onViewAll, onBack }: ChannelListProps) {
  const { channels, isLoading, error, refresh, markAsViewed } = useChannels();

  const displayChannels = preview ? channels.slice(0, 5) : channels;

  const openChannel = async (channelId: string) => {
    await markAsViewed(channelId);
    chrome.tabs.create({ url: `https://spaces.xyne.app/channels/${channelId}` });
  };

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'DM':
      case 'GROUP_DM':
        return 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z';
      case 'EMAIL':
        return 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z';
      default:
        return 'M7 20l4-16m2 16l4-16M6 9h14M4 15h14';
    }
  };

  const getChannelPrefix = (channel: Channel) => {
    if (channel.type === 'DM' || channel.type === 'GROUP_DM') {
      return '@';
    }
    return '#';
  };

  if (!preview && onBack) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center">
          <button
            onClick={onBack}
            className="p-1 -ml-1 mr-2 text-gray-500 hover:text-gray-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Channels</h1>
          <button
            onClick={refresh}
            className="ml-auto p-1 text-gray-500 hover:text-gray-700"
            title="Refresh"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {renderContent()}
        </div>
      </div>
    );
  }

  function renderContent() {
    if (isLoading) {
      return (
        <div className="p-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex items-center space-x-3 p-2">
              <div className="w-8 h-8 bg-gray-200 rounded-lg" />
              <div className="flex-1 h-4 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-4 text-center text-red-500 text-sm">
          {error}
        </div>
      );
    }

    if (displayChannels.length === 0) {
      return (
        <div className="p-4 text-center text-gray-500 text-sm">
          No channels found
        </div>
      );
    }

    return (
      <div className="divide-y divide-gray-100">
        {displayChannels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => openChannel(channel.id)}
            className="w-full px-4 py-2.5 flex items-center space-x-3 hover:bg-gray-50 text-left transition-colors"
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-gray-100 text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={getChannelIcon(channel.type)}
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700 truncate">
                {getChannelPrefix(channel)}{channel.name}
              </p>
              {channel.description && (
                <p className="text-xs text-gray-500 truncate">
                  {channel.description}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Recent Channels
        </h2>
        {onViewAll && channels.length > 5 && (
          <button
            onClick={onViewAll}
            className="text-xs text-xyne-600 hover:text-xyne-700"
          >
            View all
          </button>
        )}
      </div>
      <div className="bg-white rounded-lg border border-gray-200">
        {renderContent()}
      </div>
    </div>
  );
}
