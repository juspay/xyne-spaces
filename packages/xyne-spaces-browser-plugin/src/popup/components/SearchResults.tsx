import type { SearchResult } from '@xyne/spaces-sdk';

interface SearchResultsProps {
  results: SearchResult[];
  isLoading: boolean;
}

const typeIcons: Record<string, string> = {
  message: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  ticket: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  file: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  channel: 'M7 20l4-16m2 16l4-16M6 9h14M4 15h14',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
};

const typeColors: Record<string, string> = {
  message: 'text-blue-600 bg-blue-100',
  ticket: 'text-green-600 bg-green-100',
  file: 'text-purple-600 bg-purple-100',
  channel: 'text-orange-600 bg-orange-100',
  user: 'text-pink-600 bg-pink-100',
};

function getResultTitle(result: SearchResult): string {
  const data = result.data as Record<string, unknown>;
  return (
    (data.title as string) ||
    (data.name as string) ||
    (data.content as string)?.slice(0, 50) ||
    result.id
  );
}

function getResultSubtitle(result: SearchResult): string {
  const data = result.data as Record<string, unknown>;

  switch (result.type) {
    case 'message':
      return (data.content as string)?.slice(0, 100) || '';
    case 'ticket':
      return `${data.status || ''} • ${data.priority || ''}`.trim();
    case 'file':
      return (data.fileName as string) || '';
    case 'channel':
      return (data.description as string) || '';
    default:
      return '';
  }
}

function openInXyne(result: SearchResult): void {
  const baseUrl = 'https://spaces.xyne.app';
  let path = '';

  switch (result.type) {
    case 'message':
      const messageData = result.data as Record<string, unknown>;
      path = `/channels/${messageData.channelId}?message=${result.id}`;
      break;
    case 'ticket':
      path = `/tickets/${result.id}`;
      break;
    case 'channel':
      path = `/channels/${result.id}`;
      break;
    case 'file':
      path = `/files/${result.id}`;
      break;
    default:
      path = '/';
  }

  chrome.tabs.create({ url: `${baseUrl}${path}` });
}

export function SearchResults({ results, isLoading }: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="p-4">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex items-start space-x-3">
              <div className="w-8 h-8 bg-gray-200 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <p className="mt-2 text-sm">No results found</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {results.map((result) => (
        <button
          key={result.id}
          onClick={() => openInXyne(result)}
          className="w-full px-4 py-3 flex items-start space-x-3 hover:bg-gray-50 text-left transition-colors"
        >
          <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${typeColors[result.type] || 'text-gray-600 bg-gray-100'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={typeIcons[result.type] || typeIcons.file}
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {getResultTitle(result)}
            </p>
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {getResultSubtitle(result)}
            </p>
            {result.highlight && Object.keys(result.highlight).length > 0 && (
              <p
                className="text-xs text-gray-600 mt-1 line-clamp-2"
                dangerouslySetInnerHTML={{
                  __html: Object.values(result.highlight).flat().join(' ... '),
                }}
              />
            )}
          </div>
          <span className="flex-shrink-0 text-xs text-gray-400 capitalize">
            {result.type}
          </span>
        </button>
      ))}
    </div>
  );
}
