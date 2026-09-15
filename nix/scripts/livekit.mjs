// Adapt the shared config using local credentials without writing them to the store.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [configPath, executable] = process.argv.slice(2);
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
if (!key || !secret || key === 'devkey' || secret === 'devsecret') {
  throw new Error('Run just prepare to generate local LiveKit credentials');
}
const config = readFileSync(configPath, 'utf8')
  .replace(/\bdevkey\b/g, JSON.stringify(key))
  .replace(/\bdevsecret\b/g, JSON.stringify(secret));
const env = { ...process.env, LIVEKIT_CONFIG: config };
// Backend REDIS_HOST is a bare hostname, while LiveKit expects host:port.
// Use the Redis address in the native service config instead.
delete env.REDIS_HOST;
const child = spawn(executable, ['--dev'], {
  stdio: 'inherit',
  env,
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
