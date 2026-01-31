import { protocol, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { getActiveUIPath } from './ui-updater';
import log from 'electron-log/main';

/**
 * Custom protocol scheme for serving bundled UI
 * Uses xyne-spaces:// scheme to serve files from the bundled dashboard
 */
export const CUSTOM_PROTOCOL_SCHEME = 'xyne-spaces';

// MIME type mapping for common file extensions
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.map': 'application/json',
};

/**
 * Get the UI path - always from ui-active in Application Support
 * On first launch, bundled UI is copied there automatically
 */
export function getUIPath(): string {
  const activePath = getActiveUIPath();
  log.info('[CustomProtocol] Using UI from:', activePath);
  return activePath;
}

/**
 * Register the custom protocol scheme
 * MUST be called before app.whenReady()
 */
export function registerProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CUSTOM_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

/**
 * Setup the custom protocol handler
 * MUST be called after app.whenReady()
 */
export function setupCustomProtocol(): void {
  log.info('[CustomProtocol] Setting up custom protocol handler');

  protocol.handle(CUSTOM_PROTOCOL_SCHEME, async (request) => {
    // Get UI path on each request (allows hot-switching after update)
    const basePath = getUIPath();
    
    const url = new URL(request.url);
    let filePath = url.pathname;

    if (filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }
    if (!filePath || filePath === '') {
      filePath = 'index.html';
    }
    const ext = path.extname(filePath);
    if (!ext && !filePath.includes('.')) {
      filePath = 'index.html';
    }

    const fullPath = path.join(basePath, filePath);
    const fileUrl = pathToFileURL(fullPath).href;

    log.info(`[CustomProtocol] Serving: ${request.url} -> ${fullPath}`);

    try {
      const response = await net.fetch(fileUrl);
      
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      log.error(`[CustomProtocol] Error serving ${fullPath}:`, error);
      
      if (ext === '' || !ext) {
        const indexPath = path.join(basePath, 'index.html');
        const indexUrl = pathToFileURL(indexPath).href;
        
        try {
          const indexResponse = await net.fetch(indexUrl);
          return new Response(indexResponse.body, {
            status: indexResponse.status,
            statusText: indexResponse.statusText,
            headers: {
              'Content-Type': 'text/html',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (indexError) {
          log.error('[CustomProtocol] Failed to serve index.html:', indexError);
        }
      }
      
      return new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    }
  });

  log.info('[CustomProtocol] Custom protocol handler registered successfully');
}

export function getBundledUIUrl(): string {
  return `${CUSTOM_PROTOCOL_SCHEME}://./`;
}
