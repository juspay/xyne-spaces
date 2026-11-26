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

// ── Encrypted attachment streaming ──────────────────────────────────────────
//
// With file encryption on, attachments are stored encrypted and the backend never holds their
// plaintext, so a <video> or pdf.js range request to /api/attachments/:id/stream cannot be
// answered with plain bytes. This worker answers it instead: it asks the backend for the
// encrypted chunks covering the range (`x-file-encryption`), decrypts them with the page's
// transit key, and replies to the player with exactly the requested plaintext bytes. The key
// is asked of the page (a non-extractable CryptoKey over postMessage) and never leaves the
// browser. Files that are not encrypted come back as an ordinary range response and pass
// through untouched. The container layout is packages/shared/src/crypto/file-container.ts;
// keep the two in step.

const ENCRYPTED_STREAM_PATH = /\/api\/attachments\/[^/]+\/stream$/;
const FILE_ENCRYPTION_HEADER = 'x-file-encryption';
const FILE_ENCRYPTION_HEADER_VALUE = 'XEF1';
const FILE_CHUNK_IV_LENGTH = 12;
const FILE_CHUNK_OVERHEAD = 12 + 16;
const PAGE_REPLY_TIMEOUT_MS = 2000;
/** Transit keys by key id, as the page handed them over. */
const fileTransitKeys = new Map();

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!ENCRYPTED_STREAM_PATH.test(url.pathname)) return;
  event.respondWith(serveAttachmentStream(event));
});

/** Asks an open page of this app (the requesting one first) and returns its reply, or null. */
async function askPage(clientId, message) {
  const pages = [];
  if (clientId) {
    const own = await self.clients.get(clientId);
    if (own && own.type === 'window') pages.push(own);
  }
  for (const page of await self.clients.matchAll({ type: 'window' })) {
    if (!pages.some((p) => p.id === page.id)) pages.push(page);
  }
  for (const page of pages) {
    const reply = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), PAGE_REPLY_TIMEOUT_MS);
      channel.port1.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data);
      };
      page.postMessage(message, [channel.port2]);
    });
    if (reply) return reply;
  }
  return null;
}

async function transitKeyFor(keyId, clientId) {
  const cached = fileTransitKeys.get(keyId);
  if (cached) return cached;
  const reply = await askPage(clientId, { type: 'file-encryption-key', keyId });
  if (!reply || !reply.key) throw new Error(`No transit key for ${keyId}`);
  fileTransitKeys.set(keyId, reply.key);
  return reply.key;
}

/** Plaintext of a transit container holding chunks `firstIndex`.. of a `totalChunks`-chunk file. */
async function decryptContainerChunks(container, firstIndex, totalChunks, clientId) {
  const magic = String.fromCharCode(container[0], container[1], container[2], container[3]);
  if (container.length < 5 || magic !== FILE_ENCRYPTION_HEADER_VALUE) {
    throw new Error('Not an encrypted file container');
  }
  const keyIdLength = container[4];
  const headerLength = 4 + 1 + keyIdLength + 4 + 16;
  const header = container.subarray(0, headerLength);
  const keyId = new TextDecoder().decode(container.subarray(5, 5 + keyIdLength));
  const chunkSize = new DataView(container.buffer, container.byteOffset + 5 + keyIdLength, 4).getUint32(0);
  const key = await transitKeyFor(keyId, clientId);
  const record = chunkSize + FILE_CHUNK_OVERHEAD;
  const pieces = [];
  let at = headerLength;
  let index = firstIndex;
  let total = 0;
  while (at < container.length) {
    const end = Math.min(at + record, container.length);
    const aad = new Uint8Array(header.length + 5);
    aad.set(header, 0);
    new DataView(aad.buffer).setUint32(header.length, index);
    aad[header.length + 4] = index === totalChunks - 1 ? 1 : 0;
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: container.slice(at, at + FILE_CHUNK_IV_LENGTH), additionalData: aad },
        key,
        container.slice(at + FILE_CHUNK_IV_LENGTH, end),
      ),
    );
    pieces.push(plain);
    total += plain.length;
    at = end;
    index += 1;
  }
  const out = new Uint8Array(total);
  let written = 0;
  for (const piece of pieces) {
    out.set(piece, written);
    written += piece.length;
  }
  return out;
}

async function serveAttachmentStream(event) {
  const request = event.request;
  const state = await askPage(event.clientId, { type: 'file-encryption-state' });
  if (!state || !state.active) return fetch(request);

  const range = request.headers.get('range');
  const headers = new Headers({ [FILE_ENCRYPTION_HEADER]: FILE_ENCRYPTION_HEADER_VALUE });
  if (range) headers.set('range', range);
  const response = await fetch(request.url, { headers, credentials: 'include', mode: 'cors', signal: request.signal });
  const chunkStart = response.headers.get('x-file-chunk-start');
  // Not an encrypted file (or an error): as the server sent it.
  if (!response.ok || chunkStart === null) return response;

  const first = Number(chunkStart);
  const totalChunks = Number(response.headers.get('x-file-chunk-count'));
  const size = Number(response.headers.get('x-file-size'));
  const rangeStart = Number(response.headers.get('x-file-range-start'));
  const rangeEnd = Number(response.headers.get('x-file-range-end'));
  const contentType = response.headers.get('x-file-content-type') || 'application/octet-stream';
  const container = new Uint8Array(await response.arrayBuffer());

  let plaintext;
  try {
    plaintext = await decryptContainerChunks(container, first, totalChunks, event.clientId);
  } catch {
    // A key from an earlier session of the page: ask again once.
    fileTransitKeys.clear();
    try {
      plaintext = await decryptContainerChunks(container, first, totalChunks, event.clientId);
    } catch (error) {
      console.error('[Service Worker] Encrypted attachment could not be decrypted', error);
      return new Response(null, { status: 502 });
    }
  }

  // The chunks start at a chunk boundary; the player asked for an exact range within them.
  const offset = rangeStart - first * chunkSizeOf(container);
  const body = plaintext.slice(offset, offset + Math.max(0, rangeEnd - rangeStart + 1));
  const out = new Headers({
    'Content-Type': contentType,
    'Content-Length': String(body.byteLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  if (range) {
    out.set('Content-Range', `bytes ${rangeStart}-${rangeEnd}/${size}`);
    return new Response(body, { status: 206, headers: out });
  }
  return new Response(body, { status: 200, headers: out });
}

/** The plaintext chunk size a container's header records. */
function chunkSizeOf(container) {
  const keyIdLength = container[4];
  return new DataView(container.buffer, container.byteOffset + 5 + keyIdLength, 4).getUint32(0);
}
