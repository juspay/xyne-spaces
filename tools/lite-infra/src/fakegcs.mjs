import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BIN, DATA, httpOk, launch, log, run, waitFor } from './util.mjs';

export const GCS_PORT = Number(process.env.GCS_PORT ?? 4443);
const VERSION = '1.56.1';
// Same buckets scripts/start-services.sh creates.
const BUCKETS = [
  'xyne-frontend-bundles',
  'xyne-spaces-chat-documents',
  'transcription-dev-v2',
  'xyne-spaces-canvas-documents',
  'xyne-claw-chat-attachments',
];

async function ensureBinary() {
  const bin = path.join(BIN, 'fake-gcs-server');
  if (fs.existsSync(bin)) return bin;
  const osName = { darwin: 'Darwin', linux: 'Linux' }[os.platform()];
  const arch = { arm64: 'arm64', x64: 'amd64' }[os.arch()];
  if (!osName || !arch) throw new Error(`no fake-gcs-server build for ${os.platform()}/${os.arch()}`);
  const url = `https://github.com/fsouza/fake-gcs-server/releases/download/v${VERSION}/fake-gcs-server_${VERSION}_${osName}_${arch}.tar.gz`;
  fs.mkdirSync(BIN, { recursive: true });
  const tgz = path.join(BIN, 'fake-gcs-server.tar.gz');
  log('fake-gcs', `first run: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  await run('fake-gcs', 'tar', ['-xzf', tgz, '-C', BIN, 'fake-gcs-server']);
  fs.unlinkSync(tgz);
  fs.chmodSync(bin, 0o755);
  return bin;
}

export const gcsHealthy = () => httpOk(`http://127.0.0.1:${GCS_PORT}/storage/v1/b`);

export async function startFakeGcs() {
  const bin = await ensureBinary();
  const dir = path.join(DATA, 'gcs');
  fs.mkdirSync(dir, { recursive: true });
  const child = launch('fake-gcs', bin, [
    '-scheme', 'http', '-host', '127.0.0.1', '-port', String(GCS_PORT),
    '-external-url', `http://localhost:${GCS_PORT}`,
    '-backend', 'filesystem', '-filesystem-root', dir,
  ]);
  await waitFor('fake-gcs', gcsHealthy, { timeoutMs: 20_000 });
  for (const name of BUCKETS) {
    await fetch(`http://127.0.0.1:${GCS_PORT}/storage/v1/b?project=xyne-spaces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    }).catch(() => {});
  }
  log('fake-gcs', `ready on http://localhost:${GCS_PORT} (${BUCKETS.length} buckets)`);
  return child;
}
