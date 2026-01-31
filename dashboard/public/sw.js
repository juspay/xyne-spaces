self.addEventListener('install', (_event) => {
  console.log('Service Worker installing');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating');
  event.waitUntil(self.clients.claim());
});

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

// ============================================
// DOCS PREVIEW - Service Worker File Serving
// ============================================

const DOCS_PREVIEW_PATH = '/docs-preview/';

// Intercept fetch requests for docs preview
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only handle docs-preview requests
  if (url.pathname.startsWith(DOCS_PREVIEW_PATH)) {
    event.respondWith(serveDocsFile(event.request, url));
  }
});

// Serve a docs file from the appropriate session cache
async function serveDocsFile(request, url) {
  try {
    // Remove hash and query from pathname for matching
    let pathname = url.pathname;
    
    // Handle directory requests - append index.html
    if (pathname.endsWith('/')) {
      pathname = pathname + 'index.html';
    }
    
    // Extract session ID and file path from: /docs-preview/{sessionId}/{filepath}
    const pathParts = pathname.split('/');
    const sessionId = pathParts[2]; // ['', 'docs-preview', 'sessionId', ...]
    const filePath = pathParts.slice(3).join('/'); // Everything after sessionId
    
    if (!sessionId) {
      return new Response('Invalid docs preview path', { status: 400 });
    }
    
    // Open the session-specific cache
    const cacheName = `docs-preview-${sessionId}`;
    const cache = await caches.open(cacheName);
    
    // Try exact match first
    let cachedResponse = await cache.match(pathname);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Try matching with origin
    const fullUrl = `${url.origin}${pathname}`;
    cachedResponse = await cache.match(fullUrl);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Try finding by iterating through cache entries
    const keys = await cache.keys();
    for (const cacheRequest of keys) {
      const cacheUrl = new URL(cacheRequest.url);
      if (cacheUrl.pathname === pathname || cacheUrl.pathname.endsWith('/' + filePath)) {
        cachedResponse = await cache.match(cacheRequest);
        if (cachedResponse) {
          return cachedResponse;
        }
      }
    }
    
    // FALLBACK: If file not found and path has subdirectories, try finding the file at root level
    // This handles cases like docs/index.html -> index.html (when index.html is at root)
    if (filePath.includes('/')) {
      const fileName = filePath.split('/').pop(); // Get just the filename
      const rootPath = `/docs-preview/${sessionId}/${fileName}`;
      
      cachedResponse = await cache.match(rootPath);
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Also try with origin
      cachedResponse = await cache.match(`${url.origin}${rootPath}`);
      if (cachedResponse) {
        return cachedResponse;
      }
    }
    
    return new Response('File not found: ' + pathname, { 
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    });
  } catch {
    return new Response('Error serving file', { 
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}