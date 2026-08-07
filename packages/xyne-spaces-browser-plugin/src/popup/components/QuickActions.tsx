interface QuickActionsProps {
  onChannels: () => void;
  onTickets: () => void;
}

interface ActionButton {
  label: string;
  icon: string;
  onClick: () => void;
  color: string;
}

export function QuickActions({ onChannels, onTickets }: QuickActionsProps) {
  const actions: ActionButton[] = [
    {
      label: 'New Thread',
      icon: 'M12 4v16m8-8H4',
      onClick: () => {
        chrome.tabs.create({ url: 'https://spaces.xyne.app' });
      },
      color: 'text-xyne-600 bg-xyne-50 hover:bg-xyne-100',
    },
    {
      label: 'My Tickets',
      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
      onClick: onTickets,
      color: 'text-green-600 bg-green-50 hover:bg-green-100',
    },
    {
      label: 'Channels',
      icon: 'M7 20l4-16m2 16l4-16M6 9h14M4 15h14',
      onClick: onChannels,
      color: 'text-orange-600 bg-orange-50 hover:bg-orange-100',
    },
    {
      label: 'Open App',
      icon: 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14',
      onClick: () => {
        chrome.tabs.create({ url: 'https://spaces.xyne.app' });
      },
      color: 'text-gray-600 bg-gray-50 hover:bg-gray-100',
    },
  ];

  return (
    <div className="px-4 py-3">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Quick Actions
      </h2>
      <div className="grid grid-cols-4 gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            className={`flex flex-col items-center justify-center p-2 rounded-lg transition-colors ${action.color}`}
          >
            <svg
              className="w-5 h-5 mb-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={action.icon}
              />
            </svg>
            <span className="text-xs font-medium truncate w-full text-center">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
