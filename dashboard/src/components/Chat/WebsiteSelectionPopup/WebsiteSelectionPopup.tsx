import React, { useEffect, useRef } from 'react';
import { WEBSITES } from '../../../utils/configs';
import { webviewActor } from '../../../machines/webviewMachine';
import { buildMimirUrl, buildGoogleUrl, buildChatGPTUrl } from '../../../utils/websiteUrlUtils';
import { useScope, useShortcutById } from '../../../shortcuts';

interface WebsiteSelectionPopupProps {
  isVisible: boolean;
  position: { x: number; y: number };
  selectedText: string;
  onClose: () => void;
}

export const WebsiteSelectionPopup: React.FC<WebsiteSelectionPopupProps> = ({
  isVisible,
  position,
  selectedText,
  onClose,
}) => {
  const popupRef = useRef<HTMLDivElement>(null);

  useScope('modal', isVisible);

  useShortcutById(
    'modal.close',
    () => {
      onClose();
    },
    {
      enabled: isVisible,
      priority: 90,
    },
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible, onClose]);

  const handleWebsiteClick = (websiteId: string): void => {
    let url: string;

    switch (websiteId) {
      case 'mimir':
        url = buildMimirUrl(selectedText, WEBSITES.find(w => w.id === 'mimir')?.url);
        break;
      case 'google':
        url = buildGoogleUrl(selectedText);
        break;
      case 'chatgpt':
        url = buildChatGPTUrl(selectedText);
        break;
      default:
        return;
    }

    // Add tab to webview and open webview
    webviewActor.send({ type: 'ADD_TAB', url });
    webviewActor.send({ type: 'OPEN' });

    onClose();
  };

  if (!isVisible || !selectedText.trim()) {
    return null;
  }

  return (
    <div
      ref={popupRef}
      className='fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2'
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        minWidth: '200px',
      }}
    >
      <div className='text-xs text-gray-500 mb-2 px-2 py-1 border-b'>
        Open &ldquo;{selectedText.substring(0, 30)}
        {selectedText.length > 30 ? '...' : ''}&rdquo; with:
      </div>

      <div className='space-y-1'>
        {WEBSITES.map(website => (
          <button
            key={website.id}
            onClick={() => handleWebsiteClick(website.id)}
            className='w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-100 rounded transition-colors'
          >
            <div className='flex-shrink-0 w-5 h-5'>
              {website.iconImage ? (
                <img
                  src={website.iconImage}
                  alt={website.name}
                  className='w-5 h-5 object-contain'
                />
              ) : (
                <span className='text-sm'>{website.icon || '🌐'}</span>
              )}
            </div>
            <span className='text-sm font-medium text-gray-700'>{website.name}</span>
          </button>
        ))}
      </div>

      <div className='mt-2 pt-2 border-t border-gray-100'>
        <button
          onClick={onClose}
          className='w-full text-xs text-gray-400 hover:text-gray-600 text-center py-1'
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
