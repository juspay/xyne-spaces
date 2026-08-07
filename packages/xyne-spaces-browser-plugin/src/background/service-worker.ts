/**
 * Background service worker for the Xyne Spaces browser extension.
 * Handles context menus and background tasks.
 */

// Create context menus when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
  // Search selected text in Xyne Spaces
  chrome.contextMenus.create({
    id: 'search-xyne',
    title: 'Search Xyne Spaces for "%s"',
    contexts: ['selection'],
  });

  console.log('Xyne Spaces extension installed');
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, _tab) => {
  if (info.menuItemId === 'search-xyne' && info.selectionText) {
    // Send message to popup to perform search
    chrome.runtime.sendMessage({
      type: 'SEARCH_QUERY',
      query: info.selectionText,
    }).catch(() => {
      // Popup might not be open, store the search query for when it opens
      chrome.storage.local.set({
        pending_search_query: info.selectionText,
      });
    });

    // Open the popup
    chrome.action.openPopup?.().catch(() => {
      // openPopup might not be available in all contexts
      // The user can manually click the extension icon
    });
  }
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PENDING_SEARCH') {
    chrome.storage.local.get('pending_search_query').then((result) => {
      sendResponse({ query: result.pending_search_query || null });
      // Clear the pending search after retrieval
      chrome.storage.local.remove('pending_search_query');
    });
    return true; // Keep the message channel open for async response
  }
});

// Optional: Badge management for unread counts
export async function updateBadge(count: number): Promise<void> {
  if (count > 0) {
    await chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// Export for module usage
export {};
