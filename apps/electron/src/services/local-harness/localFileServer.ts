import { createServer, type Server } from 'http';
import { createReadStream, promises as fsp } from 'fs';
import { extname, join, relative, resolve, sep } from 'path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function resolveServedPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const trimmed = decoded.replace(/^\/+/, '');
  if (!trimmed) return null;

  const segments = trimmed.split('/').filter((part) => part.length > 0);
  if (segments.length < 3) return null;
  if (segments[0] !== 'runs') return null;
  if (segments.some((part) => part === '.' || part === '..')) return null;

  const rootReal = resolve(root);
  const target = resolve(join(rootReal, ...segments));
  const rel = relative(rootReal, target);
  if (rel.startsWith('..') || rel.startsWith(`..${sep}`) || resolve(rootReal, rel) !== target) return null;
  return target;
}

export class LocalFileServer {
  private server: Server | null = null;
  private port: number | null = null;
  private root: string | null = null;
  private starting: Promise<number> | null = null;

  async start(root: string): Promise<number> {
    if (this.server && this.port && this.root === root) return this.port;
    if (this.starting) return this.starting;
    this.root = root;

    this.starting = new Promise<number>((resolvePort, rejectPort) => {
      const server = createServer((req, res) => {
        void this.handle(req.url ?? '/', res);
      });
      server.on('error', (err) => {
        this.server = null;
        this.port = null;
        this.starting = null;
        rejectPort(err);
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          rejectPort(new Error('Local file server did not bind a port'));
          return;
        }
        this.server = server;
        this.port = address.port;
        this.starting = null;
        resolvePort(address.port);
      });
    });

    return this.starting;
  }

  private async handle(url: string, res: import('http').ServerResponse): Promise<void> {
    const root = this.root;
    if (!root) {
      res.writeHead(503).end();
      return;
    }

    const pathname = url.split('?')[0] ?? '/';
    const target = resolveServedPath(root, pathname);
    if (!target) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Forbidden');
      return;
    }

    try {
      const real = await fsp.realpath(target);
      const rootReal = await fsp.realpath(root);
      const rel = relative(rootReal, real);
      if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) throw new Error('escape');
      if (!rel.split(sep)[0] || rel.split(sep)[0] !== 'runs') throw new Error('escape');
      const stat = await fsp.stat(real);
      if (!stat.isFile()) throw new Error('not a file');

      res.writeHead(200, {
        'Content-Type': contentTypeFor(real),
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      createReadStream(real).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
    }
  }

  baseUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}` : null;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = null;
    this.starting = null;
  }
}

export const localFileServer = new LocalFileServer();
