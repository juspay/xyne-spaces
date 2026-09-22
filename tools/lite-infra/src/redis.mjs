import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DATA, fail, launch, log, waitFor, which } from './util.mjs';

export const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

export function redisPing() {
  return new Promise(resolve => {
    const s = net.createConnection({ port: REDIS_PORT, host: '127.0.0.1' });
    s.setTimeout(1000);
    s.on('connect', () => s.write('PING\r\n'));
    s.on('data', d => { resolve(String(d).startsWith('+PONG')); s.destroy(); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { resolve(false); s.destroy(); });
  });
}

export async function startRedis() {
  const bin = which('redis-server') ?? which('valkey-server');
  if (!bin) {
    fail(
      'redis-server not found on PATH. Install it once (no container needed):\n' +
      '  macOS:          brew install redis\n' +
      '  Debian/Ubuntu:  sudo apt install redis-server\n' +
      '  Fedora:         sudo dnf install redis\n' +
      'Then re-run.',
    );
  }
  const dir = path.join(DATA, 'redis');
  fs.mkdirSync(dir, { recursive: true });
  const child = launch('redis', bin, [
    '--port', String(REDIS_PORT), '--bind', '127.0.0.1',
    '--dir', dir, '--save', '60 1', '--appendonly', 'no', '--loglevel', 'warning',
  ]);
  await waitFor('redis', redisPing, { timeoutMs: 20_000 });
  log('redis', `ready on 127.0.0.1:${REDIS_PORT} (${path.basename(bin)})`);
  return child;
}
