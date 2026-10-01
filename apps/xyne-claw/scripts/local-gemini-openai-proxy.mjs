import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function envValue(file, key) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim();
  }
  return '';
}

const clawEnv = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const GEMINI_KEY = process.env.GEMINI_API_KEY || envValue(clawEnv, 'GEMINI_API_KEY');
const MODEL = process.env.LITELLM_MODEL || envValue(clawEnv, 'LITELLM_MODEL') || 'gemini-2.5-flash';
const PORT = Number(process.env.PORT || 4000);
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

if (!GEMINI_KEY) {
  console.error('GEMINI_API_KEY missing in apps/xyne-claw/.env');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  if (req.method === 'GET' && (url === '/health' || url === '/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', data: [{ id: MODEL, object: 'model' }] }));
    return;
  }
  if (req.method !== 'POST' || !url.includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString('utf8') || '{}';
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    payload = {};
  }
  if (!payload.model) payload.model = MODEL;
  if (payload.model === 'gemini-2.5-pro' || payload.model === 'gemini-2.0-flash') {
    payload.model = 'gemini-2.5-flash';
  }
  delete payload.response_format;
  try {
    const upstream = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GEMINI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: String(err) } }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`local gemini openai proxy on http://0.0.0.0:${PORT} model=${MODEL}`);
});
