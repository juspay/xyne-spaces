import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

interface SettingsProps {
  onBack?: () => void;
  isInitialSetup?: boolean;
}

export function Settings({ onBack, isInitialSetup }: SettingsProps) {
  const { user, baseUrl, login, logout, isLoading, error } = useAuth();
  const [token, setToken] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState(baseUrl);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!token.trim()) {
      setLocalError('Please enter your API token');
      return;
    }

    setLocalError(null);

    try {
      await login(token.trim(), customBaseUrl || undefined);
      setToken('');
    } catch (err) {
      // Error is handled by useAuth hook
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center">
        {onBack && !isInitialSetup && (
          <button
            onClick={onBack}
            className="p-1 -ml-1 mr-2 text-gray-500 hover:text-gray-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h1 className="text-lg font-semibold text-gray-900">
          {isInitialSetup ? 'Welcome to Xyne Spaces' : 'Settings'}
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {user ? (
          /* Logged in state */
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-xyne-100 flex items-center justify-center text-xyne-600 font-semibold">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{user.name}</p>
                  <p className="text-sm text-gray-500">{user.email}</p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Workspace</p>
              <p className="text-sm text-gray-900">{user.workspaceId}</p>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">API Endpoint</p>
              <p className="text-sm text-gray-900 truncate">{baseUrl}</p>
            </div>

            <button
              onClick={handleLogout}
              disabled={isLoading}
              className="w-full py-2 px-4 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Logging out...' : 'Logout'}
            </button>
          </div>
        ) : (
          /* Login form */
          <div className="space-y-4">
            {isInitialSetup && (
              <p className="text-sm text-gray-600">
                Enter your Xyne Spaces API token to get started.
              </p>
            )}

            <div>
              <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-1">
                API Token
              </label>
              <textarea
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your token here..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-xyne-500 focus:border-transparent resize-none font-mono"
              />
              <p className="mt-1 text-xs text-gray-500">
                Get your token from Xyne Spaces Settings → API Tokens
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center"
            >
              <svg
                className={`w-4 h-4 mr-1 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Advanced settings
            </button>

            {showAdvanced && (
              <div>
                <label htmlFor="baseUrl" className="block text-sm font-medium text-gray-700 mb-1">
                  API Base URL
                </label>
                <input
                  id="baseUrl"
                  type="url"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                  placeholder="https://spaces.xyne.app"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-xyne-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Only change this if using a self-hosted instance
                </p>
              </div>
            )}

            {(error || localError) && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error || localError}</p>
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={isLoading || !token.trim()}
              className="w-full py-2 px-4 bg-xyne-600 text-white rounded-lg hover:bg-xyne-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
