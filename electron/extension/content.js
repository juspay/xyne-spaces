/**
 * Xyne AI Chrome Extension - Content Script
 * 
 * Handles:
 * - Text selection detection
 * - Floating "Ask AI" button
 * - VPN status awareness
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__xyneAIExtensionLoaded) {
    return;
  }
  window.__xyneAIExtensionLoaded = true;

  // State
  let askAIButton = null;
  let currentSelection = null;
  let hideTimeout = null;
  let vpnConnected = false;

  // Check VPN status on load
  chrome.runtime.sendMessage({ type: 'GET_VPN_STATUS' }, (response) => {
    if (response) {
      vpnConnected = response.isConnected;
      console.log('[Xyne Extension] Initial VPN status:', vpnConnected ? 'Connected' : 'Disconnected');
    }
  });

  // Listen for VPN status updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'VPN_STATUS') {
      vpnConnected = message.isConnected;
      console.log('[Xyne Extension] VPN status updated:', vpnConnected ? 'Connected' : 'Disconnected');
      
      // Hide button if VPN disconnected
      if (!vpnConnected && askAIButton) {
        hideButton();
      }
    }
  });

  /**
   * Create the Ask AI button element
   */
  function createAskAIButton() {
    const button = document.createElement('button');
    button.id = 'xyne-ask-ai-button';
    button.setAttribute('aria-label', 'Ask AI');
    button.title = 'Ask Xyne AI about this text';
    
    // Simple Xyne star icon (red) + "Ask AI" text
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="xyne-ask-ai-icon">
        <path d="M7.27143 15.2409C7.26996 12.6631 6.89499 11.1104 6.00967 10.1694C5.13445 9.23917 3.58587 8.72653 0.726533 8.72653C0.325075 8.72653 0.000340076 8.40138 0 8C0 7.59833 0.324865 7.27143 0.726533 7.27143C3.5859 7.27143 5.13445 6.75882 6.00967 5.82854C6.89478 4.88743 7.27 3.33479 7.27143 0.757059C7.27144 0.747035 7.27144 0.736583 7.27143 0.726533C7.27166 0.325027 7.59849 0 8 0C8.40122 0.000339949 8.7263 0.325237 8.72653 0.726533C8.72654 0.737114 8.72654 0.748536 8.72653 0.759094C8.72813 3.33547 9.10364 4.8876 9.9883 5.82854C10.8634 6.75873 12.4126 7.27134 15.2714 7.27143C15.6731 7.27143 16 7.59833 16 8C15.9997 8.40138 15.6729 8.72653 15.2714 8.72653C12.4126 8.72663 10.8634 9.23923 9.9883 10.1694C9.10322 11.1105 8.72801 12.6634 8.72653 15.2409C8.72653 15.251 8.72653 15.2633 8.72653 15.2735C8.72585 15.6744 8.40094 15.9997 8 16C7.59877 16 7.27212 15.6746 7.27143 15.2735C7.27144 15.2633 7.27144 15.251 7.27143 15.2409Z" fill="#FF4E4F"/>
      </svg>
      <span class="xyne-ask-ai-text">Ask AI</span>
    `;

    // Click handler
    button.addEventListener('click', handleAskAIClick);

    // Prevent selection from being cleared
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    return button;
  }

  /**
   * Handle Ask AI button click
   */
  function handleAskAIClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!currentSelection || !vpnConnected) {
      console.log('[Xyne Extension] Cannot proceed:', !currentSelection ? 'No selection' : 'VPN not connected');
      return;
    }

    const context = {
      text: currentSelection.text,
      url: window.location.href,
      domain: window.location.hostname,
      title: document.title,
    };

    console.log('[Xyne Extension] Sending Ask AI request:', context);

    // Send to background script
    chrome.runtime.sendMessage({
      type: 'ASK_AI',
      context: context,
    }, (response) => {
      if (response && response.success) {
        console.log('[Xyne Extension] Ask AI request sent successfully');
        hideButton();
        window.getSelection()?.removeAllRanges();
      } else if (response && response.error) {
        console.error('[Xyne Extension] Ask AI request failed:', response.error);
        // Could show a toast/notification here
      }
    });
  }

  /**
   * Position the button near the selection
   */
  function positionButton(selection) {
    if (!askAIButton || !selection) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Position button above the selection, centered
      const buttonWidth = 100;
      const buttonHeight = 36;
      const spacing = 8;

      let top = rect.top - buttonHeight - spacing;
      let left = rect.left + (rect.width / 2) - (buttonWidth / 2);

      // If button would go off-screen at the top, position it below the selection
      if (top < 10) {
        top = rect.bottom + spacing;
      }

      // Keep button within viewport horizontally
      const viewportWidth = window.innerWidth;
      if (left < 10) {
        left = 10;
      } else if (left + buttonWidth > viewportWidth - 10) {
        left = viewportWidth - buttonWidth - 10;
      }

      // Use fixed positioning relative to viewport
      askAIButton.style.top = `${top}px`;
      askAIButton.style.left = `${left}px`;
    } catch (error) {
      console.warn('[Xyne Extension] Failed to position button:', error);
    }
  }

  /**
   * Show the button with animation
   */
  function showButton() {
    if (!askAIButton) return;
    
    askAIButton.classList.add('xyne-visible');
  }

  /**
   * Hide the button with animation
   */
  function hideButton() {
    if (!askAIButton) return;
    
    askAIButton.classList.remove('xyne-visible');
    currentSelection = null;
  }

  /**
   * Handle text selection
   */
  function handleSelection() {
    // Clear any existing hide timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    // Don't show if VPN is not connected
    if (!vpnConnected) {
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    // Only show button if text is selected and it's meaningful (more than 3 characters)
    if (selectedText && selectedText.length > 3) {
      currentSelection = {
        text: selectedText,
        selection: selection,
      };

      // Create button if it doesn't exist
      if (!askAIButton) {
        askAIButton = createAskAIButton();
        document.body.appendChild(askAIButton);
      }

      // Position and show the button
      positionButton(selection);
      showButton();
    } else {
      // No valid selection - hide button after a short delay
      hideTimeout = setTimeout(() => {
        hideButton();
      }, 100);
    }
  }

  // Listen for text selection events
  document.addEventListener('mouseup', (e) => {
    // Don't show if clicking on the Ask AI button itself
    if (e.target?.closest('#xyne-ask-ai-button')) {
      return;
    }
    
    // Small delay to ensure selection is complete
    setTimeout(handleSelection, 10);
  });

  // Handle keyboard-based selection (e.g., Shift+Arrow keys)
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift') {
      setTimeout(handleSelection, 10);
    }
  });

  // Hide button when clicking elsewhere
  document.addEventListener('mousedown', (e) => {
    if (!e.target?.closest('#xyne-ask-ai-button')) {
      const selection = window.getSelection();
      if (!selection?.toString().trim()) {
        hideButton();
      }
    }
  });

  // Reposition button during scroll
  document.addEventListener('scroll', () => {
    if (askAIButton && askAIButton.classList.contains('xyne-visible') && currentSelection?.selection) {
      positionButton(currentSelection.selection);
    }
  }, true);

  // Hide button when window loses focus
  window.addEventListener('blur', () => {
    hideButton();
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (askAIButton && askAIButton.parentNode) {
      askAIButton.parentNode.removeChild(askAIButton);
    }
  });

  console.log('[Xyne Extension] Content script initialized');
})();
