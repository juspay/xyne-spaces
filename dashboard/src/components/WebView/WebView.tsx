import { ReactElement } from 'react';
import { useSelector } from '@xstate/react';
import { webviewActor } from '../../machines/webviewMachine';
import TabWebView from './TabWebView';

const WebView = (): ReactElement => {
  const tabs = useSelector(webviewActor, state => state.context.tabs);
  const activeTab = useSelector(webviewActor, state => state.context.activeTab);

  // Extract domain from URL for tab display
  const getDomainFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  };

  // Handle tab switching
  const handleTabSwitch = (url: string): void => {
    webviewActor.send({ type: 'SWITCH_TAB', url });
  };

  // Handle tab closing
  const handleTabClose = (url: string): void => {
    webviewActor.send({ type: 'REMOVE_TAB', url });
  };

  // Empty state when no tabs
  if (tabs.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center h-full w-full bg-white'>
        <div className='text-gray-500 text-center'>
          <span className='text-6xl mb-4 block'>🌐</span>
          <h3 className='text-lg font-semibold mb-2'>No tabs open</h3>
          <p className='text-sm'>Add a tab to start browsing</p>
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full w-full p-2 bg-[#F0F2F5]'>
      <div className='flex flex-1 flex-col bg-[#F0F2F5] rounded-lg overflow-hidden border-[#DDE2E7] border'>
        {/* Tab Header Bar */}
        <div className='flex items-center bg-gray-100 border-b border-gray-200 overflow-x-auto no-scrollbar debug'>
          {tabs.map((tab, index) => (
            <div
              key={index}
              className={`flex items-center border-r border-gray-200 text-sm whitespace-nowrap transition-colors ${
                activeTab === index
                  ? 'bg-white border-b-2 border-blue-500 text-gray-900'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              {/* Tab content area - clicks to switch tabs */}
              <button
                onClick={() => handleTabSwitch(tab.currentUrl)}
                className='flex items-center gap-2 px-3 py-2 flex-1 text-left'
              >
                <span className='text-xs'>🌐</span>
                <span className='max-w-28 truncate'>{getDomainFromUrl(tab.currentUrl)}</span>
              </button>

              {/* Close button */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  handleTabClose(tab.currentUrl);
                }}
                className='px-2 py-2 hover:bg-red-100 hover:text-red-600 transition-colors'
                title='Close tab'
              >
                <span className='text-xs'>✕</span>
              </button>
            </div>
          ))}
        </div>

        {/* Tab Content Area */}
        <div className='flex-1'>
          {tabs.map((tab, index) => (
            <TabWebView key={tab.currentUrl} tab={tab} isActive={activeTab === index} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default WebView;
