self.addEventListener('install', (_event) => {
  console.log('Service Worker installing');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating');
  event.waitUntil(self.clients.claim());
});

/**
 * Validates and sanitizes a URL that originated from a push notification
 * payload before it is passed to clients.openWindow().
 *
 * Only URLs that belong to the service worker's own origin are accepted.
 * Everything else (cross-origin, javascript:, data:, blob:, file:, etc.,
 * or URLs with embedded credentials) falls back to the app root so that a
 * malicious notification cannot open an arbitrary attacker-controlled page
 * in the user's browser.
 */
function sanitizeNotificationUrl(rawUrl) {
  try {
    // Accept only absolute HTTP(S) URLs or root-relative paths. Anything
    // else (e.g. "javascript:...", "//evil.com", bare words, empty string)
    // is treated as untrusted.
    const isAbsoluteHttp = /^https?:/i.test(rawUrl);
    if (!isAbsoluteHttp && !rawUrl.startsWith('/')) {
      console.warn('[Service Worker] Rejecting notification URL with unexpected format:', rawUrl);
      return self.location.origin + '/';
    }

    const url = new URL(rawUrl, self.location.origin);

    // Reject non-HTTP(S) schemes (e.g. javascript:, data:, blob:, file:)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.warn('[Service Worker] Rejecting notification URL with unsupported protocol:', rawUrl);
      return self.location.origin + '/';
    }

    // Reject cross-origin URLs. Protocol-relative URLs such as //evil.com
    // are resolved against the current origin by the URL constructor, so
    // their resulting origin will differ and be caught here.
    if (url.origin !== self.location.origin) {
      console.warn('[Service Worker] Rejecting cross-origin notification URL:', rawUrl);
      return self.location.origin + '/';
    }

    // Reject URLs containing embedded credentials (e.g. https://user:pass@...).
    if (url.username || url.password) {
      console.warn('[Service Worker] Rejecting notification URL with credentials:', rawUrl);
      return self.location.origin + '/';
    }

    return url.href;
  } catch (error) {
    console.error('[Service Worker] Invalid notification URL:', rawUrl, error);
    return self.location.origin + '/';
  }
}

self.addEventListener('push', (event) => {
  console.log('Push event received:', event);
  
  if (!event.data) {
    console.log('Push event has no data');
    return;
  }

  try {
    const data = event.data.json();
    console.log('Push notification data:', data);

    const options = {
      body: data.body || data.message,
      icon: data.icon || '/images/xyne.png',
      badge: data.badge || '/images/xyne.png',
      tag: data.tag || 'xyne-notification',
      data: {
        notificationId: data.notificationId,
        actionUrl: data.actionUrl,
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        ...data.metadata
      },
      actions: data.actions || [
        {
          action: 'view',
          title: 'View',
          icon: '/icon-view.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
          icon: '/icon-dismiss.png'
        }
      ],
      requireInteraction: true,
      silent: false, // Use browser's default notification sound
      vibrate: [200, 100, 200], // Add vibration pattern for mobile
      timestamp: Date.now()
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  } catch (error) {
    console.error('Error processing push notification:', error);
    
    // Fallback notification
    event.waitUntil(
      self.registration.showNotification('Xyne Notification', {
        body: 'You have a new notification',
        icon: '/images/xyne.png',
        tag: 'xyne-fallback'
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;

  if (action === 'dismiss') {
    // Mark notification as dismissed
    if (data.notificationId) {
      fetch(`/api/notifications/${data.notificationId}/dismiss`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        }
      }).catch(err => console.error('Failed to dismiss notification:', err));
    }
    return;
  }

  // Default action or 'view' action
  let urlToOpen = '/';

  if (data.actionUrl) {
    urlToOpen = data.actionUrl;
  } else if (data.relatedEntityType === 'ticket') {
    urlToOpen = `/tickets?tickets=${data.relatedEntityId}`;
  } else if (data.relatedEntityType === 'workflow') {
    urlToOpen = `/workflows/${data.relatedEntityId}`;
  } else if (data.relatedEntityType === 'message') {
    // For messages, try to construct URL from metadata if actionUrl is not available
    if (data.metadata && data.metadata.channelId) {
      const params = new URLSearchParams();
      params.append('channel', data.metadata.channelId);
      if (data.metadata.conversationId) {
        params.append('thread', data.metadata.conversationId);
      }
      if (data.metadata.messageId) {
        params.append('message', data.metadata.messageId);
      }
      urlToOpen = `/chat?${params.toString()}`;
    } else {
      urlToOpen = '/chat';
    }
  }

  // Ensure absolute URL for openWindow (it requires absolute URLs to work properly)
  if (urlToOpen.startsWith('/')) {
    urlToOpen = self.location.origin + urlToOpen;
  }

  // Validate the URL before opening a window. The actionUrl comes from the
  // push notification payload and must not be trusted blindly.
  urlToOpen = sanitizeNotificationUrl(urlToOpen);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window/tab open with the chat page
      for (const client of clientList) {
        if (client.url.includes('/chat') && 'focus' in client) {
          // Mark notification as read
          if (data.notificationId) {
            fetch(`/api/notifications/${data.notificationId}/read`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json'
              }
            }).catch(err => console.error('Failed to mark notification as read:', err));
          }
          return client.focus();
        }
      }
      
      // If no existing window/tab, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen).then((client) => {
          // Mark notification as read
          if (data.notificationId) {
            fetch(`/api/notifications/${data.notificationId}/read`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json'
              }
            }).catch(err => console.error('Failed to mark notification as read:', err));
          }
          return client;
        });
      }
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  console.log('Notification closed:', event);
  
  const data = event.notification.data || {};
  
  // Optionally mark as dismissed when user closes notification
  if (data.notificationId) {
    fetch(`/api/notifications/${data.notificationId}/dismiss`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      }
    }).catch(err => console.error('Failed to dismiss notification:', err));
  }
});

// Handle background sync for offline notification actions
self.addEventListener('sync', (event) => {
  console.log('Background sync event:', event.tag);
  
  if (event.tag === 'notification-action') {
    event.waitUntil(
      // Handle any queued notification actions when back online
      handleQueuedNotificationActions()
    );
  }
});

async function handleQueuedNotificationActions() {
  // Implementation for handling queued actions when back online
  // This could involve reading from IndexedDB and syncing with server
  console.log('Handling queued notification actions');
}
