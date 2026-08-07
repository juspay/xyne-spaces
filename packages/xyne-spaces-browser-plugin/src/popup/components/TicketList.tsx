import { useTickets } from '../../hooks/useTickets';

interface TicketListProps {
  preview?: boolean;
  onViewAll?: () => void;
  onBack?: () => void;
}

const priorityColors: Record<string, string> = {
  CRITICAL: 'text-red-600 bg-red-100',
  HIGH: 'text-orange-600 bg-orange-100',
  MEDIUM: 'text-yellow-600 bg-yellow-100',
  LOW: 'text-gray-600 bg-gray-100',
};

const statusColors: Record<string, string> = {
  TODO: 'text-gray-600 bg-gray-100',
  STARTED: 'text-blue-600 bg-blue-100',
  PAUSED: 'text-yellow-600 bg-yellow-100',
  COMPLETED: 'text-green-600 bg-green-100',
  CANCELLED: 'text-red-600 bg-red-100',
};

export function TicketList({ preview, onViewAll, onBack }: TicketListProps) {
  const { tickets, isLoading, error, refresh } = useTickets();

  const displayTickets = preview ? tickets.slice(0, 3) : tickets;

  const openTicket = (ticketId: string) => {
    chrome.tabs.create({ url: `https://spaces.xyne.app/tickets/${ticketId}` });
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
          <h1 className="text-lg font-semibold text-gray-900">My Tickets</h1>
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
              <div className="flex-1 space-y-1">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
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

    if (displayTickets.length === 0) {
      return (
        <div className="p-4 text-center text-gray-500 text-sm">
          No tickets assigned to you
        </div>
      );
    }

    return (
      <div className="divide-y divide-gray-100">
        {displayTickets.map((ticket) => (
          <button
            key={ticket.id}
            onClick={() => openTicket(ticket.id)}
            className="w-full px-4 py-3 flex items-start space-x-3 hover:bg-gray-50 text-left transition-colors"
          >
            <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${priorityColors[ticket.priority] || priorityColors.LOW}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {ticket.xyneId}: {ticket.title}
              </p>
              <div className="flex items-center space-x-2 mt-1">
                {ticket.statusV2 && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${statusColors[ticket.statusV2] || statusColors.TODO}`}>
                    {ticket.statusV2}
                  </span>
                )}
                {ticket.priority && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${priorityColors[ticket.priority] || priorityColors.LOW}`}>
                    {ticket.priority}
                  </span>
                )}
              </div>
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
          My Tickets ({tickets.length})
        </h2>
        {onViewAll && tickets.length > 3 && (
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
