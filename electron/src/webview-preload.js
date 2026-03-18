/**
 * Webview Preload Script for Ask AI Text Selection
 * 
 * This script runs inside the <webview> with context isolation enabled.
 * It detects text selection and shows a floating "Ask AI" button.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe API to the webview's window object
contextBridge.exposeInMainWorld('electronAPI', {
  sendToHost: (channel, data) => {
    ipcRenderer.sendToHost(channel, data);
  }
});

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  initializeAskAI();
});

// Also initialize immediately in case DOM is already loaded
if (document.readyState !== 'loading') {
  initializeAskAI();
}

function initializeAskAI() {
  let askAIButton = null;
  let currentSelection = null;
  let hideTimeout = null;

  // Create the Ask AI button
  function createAskAIButton() {
    const button = document.createElement('button');
    button.id = 'xyne-ask-ai-button';
    button.setAttribute('aria-label', 'Ask AI');
    button.title = 'Ask AI about this text';
    
    // Clean, simple styling - white background with subtle shadow
    button.setAttribute('style', `
      all: initial;
      position: fixed !important;
      display: none !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      padding: 6px 10px !important;
      background: white !important;
      color: #333 !important;
      border: 1px solid #e0e0e0 !important;
      border-radius: 6px !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
      cursor: pointer !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      line-height: 1 !important;
      transition: all 0.15s ease !important;
      pointer-events: auto !important;
      opacity: 0 !important;
      transform: scale(0.95) !important;
      white-space: nowrap !important;
    `);

    // Simple Xyne star icon (red) + "Ask AI" text
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
        <path d="M7.27143 15.2409C7.26996 12.6631 6.89499 11.1104 6.00967 10.1694C5.13445 9.23917 3.58587 8.72653 0.726533 8.72653C0.325075 8.72653 0.000340076 8.40138 0 8C0 7.59833 0.324865 7.27143 0.726533 7.27143C3.5859 7.27143 5.13445 6.75882 6.00967 5.82854C6.89478 4.88743 7.27 3.33479 7.27143 0.757059C7.27144 0.747035 7.27144 0.736583 7.27143 0.726533C7.27166 0.325027 7.59849 0 8 0C8.40122 0.000339949 8.7263 0.325237 8.72653 0.726533C8.72654 0.737114 8.72654 0.748536 8.72653 0.759094C8.72813 3.33547 9.10364 4.8876 9.9883 5.82854C10.8634 6.75873 12.4126 7.27134 15.2714 7.27143C15.6731 7.27143 16 7.59833 16 8C15.9997 8.40138 15.6729 8.72653 15.2714 8.72653C12.4126 8.72663 10.8634 9.23923 9.9883 10.1694C9.10322 11.1105 8.72801 12.6634 8.72653 15.2409C8.72653 15.251 8.72653 15.2633 8.72653 15.2735C8.72585 15.6744 8.40094 15.9997 8 16C7.59877 16 7.27212 15.6746 7.27143 15.2735C7.27144 15.2633 7.27144 15.251 7.27143 15.2409Z" fill="#FF4E4F"/>
      </svg>
      <span style="font-family: inherit; font-size: inherit; font-weight: inherit; color: inherit;">Ask AI</span>
    `;

    // Hover effect - subtle
    button.addEventListener('mouseenter', () => {
      button.style.setProperty('background', '#f8f8f8', 'important');
      button.style.setProperty('border-color', '#d0d0d0', 'important');
      button.style.setProperty('box-shadow', '0 3px 10px rgba(0, 0, 0, 0.18)', 'important');
    });

    button.addEventListener('mouseleave', () => {
      button.style.setProperty('background', 'white', 'important');
      button.style.setProperty('border-color', '#e0e0e0', 'important');
      button.style.setProperty('box-shadow', '0 2px 8px rgba(0, 0, 0, 0.15)', 'important');
    });

    // Click handler
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (currentSelection) {
        const selectedText = currentSelection.text;
        const url = window.location.href;
        
        // Send to host (parent renderer)
        ipcRenderer.sendToHost('ask-ai-request', {
          text: selectedText,
          url: url,
          domain: window.location.hostname,
          title: document.title
        });

        // Hide the button
        hideButton();
        
        // Clear the selection
        window.getSelection()?.removeAllRanges();
      }
    });

    return button;
  }

  // Position the button near the selection
  function positionButton(selection) {
    if (!askAIButton || !selection) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Position button above the selection, centered
    const buttonWidth = 100;
    const buttonHeight = 32;
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

    // Use setProperty for positioning
    askAIButton.style.setProperty('top', `${top}px`, 'important');
    askAIButton.style.setProperty('left', `${left}px`, 'important');
  }

  // Show the button with animation
  function showButton() {
    if (!askAIButton) return;
    
    askAIButton.style.setProperty('display', 'flex', 'important');
    // Trigger reflow to enable transition
    askAIButton.offsetHeight;
    askAIButton.style.setProperty('opacity', '1', 'important');
    askAIButton.style.setProperty('transform', 'scale(1)', 'important');
  }

  // Hide the button with animation
  function hideButton() {
    if (!askAIButton) return;
    
    askAIButton.style.setProperty('opacity', '0', 'important');
    askAIButton.style.setProperty('transform', 'scale(0.9)', 'important');
    
    setTimeout(() => {
      if (askAIButton) {
        askAIButton.style.setProperty('display', 'none', 'important');
      }
    }, 200);
  }

  // Handle text selection
  function handleSelection() {
    // Clear any existing hide timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    // Only show button if text is selected and it's meaningful (more than 3 characters)
    if (selectedText && selectedText.length > 3) {
      currentSelection = {
        text: selectedText,
        selection: selection
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
        currentSelection = null;
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
        currentSelection = null;
      }
    }
  });

  // Reposition button during scroll
  document.addEventListener('scroll', () => {
    if (askAIButton && askAIButton.style.display !== 'none') {
      if (currentSelection?.selection) {
        positionButton(currentSelection.selection);
      }
    }
  }, true);

  // Hide button when window loses focus
  window.addEventListener('blur', () => {
    hideButton();
    currentSelection = null;
  });
}
