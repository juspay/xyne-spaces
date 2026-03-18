/**
 * Xyne AI Chrome Extension - Background Service Worker
 * 
 * Handles:
 * - VPN status checking via health endpoint
 * - Context menu integration
 * - Deep link generation for Xyne Spaces app
 */

const CONFIG = {
  HEALTH_CHECK_URL: 'https://app.spaces.xyne.juspay.net/api/health',
  DEEP_LINK_PROTOCOL: 'xyne-spaces',
  VPN_CHECK_INTERVAL_MS: 30000, // 30 seconds
  VPN_CHECK_TIMEOUT_MS: 5000, // 5 second timeout
};

// VPN status cache
let vpnStatus = {
  isConnected: false,
  lastChecked: 0,
  isChecking: false,
};

/**
 * Check VPN connection by pinging the internal health endpoint
 * @returns {Promise<boolean>} True if VPN is connected
 */
async function checkVPNStatus() {
  if (vpnStatus.isChecking) {
    return vpnStatus.isConnected;
  }

  vpnStatus.isChecking = true;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.VPN_CHECK_TIMEOUT_MS);

    const response = await fetch(CONFIG.HEALTH_CHECK_URL, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    vpnStatus.isConnected = response.ok;
    vpnStatus.lastChecked = Date.now();

    console.log('[Xyne Extension] VPN status:', vpnStatus.isConnected ? 'Connected' : 'Disconnected');

    // Notify all content scripts about VPN status
    broadcastVPNStatus();

    return vpnStatus.isConnected;
  } catch (error) {
    console.log('[Xyne Extension] VPN check failed:', error.message);
    vpnStatus.isConnected = false;
    vpnStatus.lastChecked = Date.now();

    broadcastVPNStatus();

    return false;
  } finally {
    vpnStatus.isChecking = false;
  }
}

/**
 * Broadcast VPN status to all content scripts
 */
async function broadcastVPNStatus() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'VPN_STATUS',
          isConnected: vpnStatus.isConnected,
        }).catch(() => {
          // Tab might not have content script loaded
        });
      }
    }
  } catch (error) {
    console.error('[Xyne Extension] Failed to broadcast VPN status:', error);
  }
}

/**
 * Generate deep link URL for Xyne Spaces app
 * @param {Object} context - The context data
 * @returns {string} Deep link URL
 */
function generateDeepLink(context) {
  const params = new URLSearchParams({
    text: context.text || '',
    url: context.url || '',
    domain: context.domain || '',
    title: context.title || '',
  });

  return `${CONFIG.DEEP_LINK_PROTOCOL}://ask-ai?${params.toString()}`;
}

/**
 * Open the Xyne Spaces app with context
 * @param {Object} context - The context data
 */
async function openXyneSpaces(context) {
  const deepLink = generateDeepLink(context);

  console.log('[Xyne Extension] Opening Xyne Spaces with deep link:', deepLink);

  // Create a new tab that will redirect to the deep link
  // This triggers the OS to open the registered protocol handler (Electron app)
  chrome.tabs.create({
    url: deepLink,
    active: false,
  }, (tab) => {
    // Close the tab after a short delay (the deep link will have triggered the app)
    setTimeout(() => {
      if (tab && tab.id) {
        chrome.tabs.remove(tab.id).catch(() => { });
      }
    }, 1000);
  });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_VPN') {
    checkVPNStatus().then((isConnected) => {
      sendResponse({ isConnected });
    });
    return true; // Indicates async response
  }

  if (message.type === 'GET_VPN_STATUS') {
    // Return cached status immediately, trigger refresh if stale
    const isStale = Date.now() - vpnStatus.lastChecked > CONFIG.VPN_CHECK_INTERVAL_MS;
    if (isStale) {
      checkVPNStatus(); // Refresh in background
    }
    sendResponse({ isConnected: vpnStatus.isConnected });
    return false;
  }

  if (message.type === 'ASK_AI') {
    // Verify VPN is still connected before opening
    checkVPNStatus().then((isConnected) => {
      if (isConnected) {
        openXyneSpaces(message.context);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'VPN not connected' });
      }
    });
    return true; // Indicates async response
  }

  return false;
});

// Set up context menu for "Ask AI"
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'xyne-ask-ai',
    title: 'Ask Xyne AI',
    contexts: ['selection'],
  });

  // Initial VPN check
  checkVPNStatus();
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'xyne-ask-ai' && info.selectionText) {
    const context = {
      text: info.selectionText,
      url: tab?.url || '',
      domain: tab?.url ? new URL(tab.url).hostname : '',
      title: tab?.title || '',
    };
    
    console.log('[Xyne Extension] Context menu clicked with:', context);
    
    // Verify VPN connection before opening Xyne Spaces
    checkVPNStatus().then((isConnected) => {
      if (isConnected) {
        openXyneSpaces(context);
      } else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'VPN Required',
          message: 'Please connect to VPN to use Xyne AI Assistant.',
        });
      }
    });
  }
});

// Periodic VPN status check
setInterval(() => {
  checkVPNStatus();
}, CONFIG.VPN_CHECK_INTERVAL_MS);

// Check VPN status when extension starts
checkVPNStatus();

console.log('[Xyne Extension] Background service worker initialized');
