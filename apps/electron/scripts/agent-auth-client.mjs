#!/usr/bin/env node
/**
 * Reference client for the Xyne agent-auth loopback server (agent-auth.ts).
 *
 * Talks to http://127.0.0.1:49231. Demonstrates the full flow:
 *   request  -> pops the native consent dialog, stores the granted token
 *   whoami   -> prints the stored token/session
 *   health   -> unauthenticated liveness probe
 *   search   -> token-gated proxy call (needs a logged-in Electron session)
 *   release  -> revokes the token
 *
 * Requires Node >= 18 (global fetch). No external deps.
 *
 * Usage:
 *   node agent-auth-client.mjs request [--name NAME] [--type TYPE] [--desc TEXT]
 *   node agent-auth-client.mjs health
 *   node agent-auth-client.mjs search "my query"
 *   node agent-auth-client.mjs release
 *   node agent-auth-client.mjs whoami
 *
 * Token is cached at $TMPDIR/xyne-agent-auth-token.json so subsequent commands reuse it.
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.XYNE_AGENT_AUTH_PORT || 49231);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_FILE = join(tmpdir(), 'xyne-agent-auth-token.json');

function loadToken() {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveToken(data) {
  // 0o600: token is a bearer credential — keep it readable only by the owner so
  // other users on a shared host cannot lift it from the world-readable temp dir.
  writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function request(flags) {
  const body = {
    agentName: flags.name || 'Reference Client',
    agentType: flags.type || 'cli',
    description: flags.desc || 'Test agent-auth flow',
  };
  console.log('POST /auth/request — approve the native dialog that pops up...');
  const res = await fetch(`${BASE}/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`status ${res.status}:`, json);
  if (res.status === 200 && json.accessToken) {
    saveToken({ token: json.accessToken, expiresAt: json.expiresAt, agentName: body.agentName });
    console.log(`\nToken cached at ${TOKEN_FILE}`);
  }
}

async function health() {
  const res = await fetch(`${BASE}/health`);
  console.log(`status ${res.status}:`, await res.json().catch(() => ({})));
}

async function search(query) {
  const t = loadToken();
  if (!t?.token) return console.error('No cached token — run "request" first.');
  const url = `${BASE}/search?${new URLSearchParams({ q: query ?? '', scope: 'my', limit: '5', offset: '0' })}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${t.token}` } });
  console.log(`status ${res.status}:`, await res.text());
}

async function release() {
  const t = loadToken();
  if (!t?.token) return console.error('No cached token.');
  const res = await fetch(`${BASE}/auth/release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.token}` },
  });
  console.log(`status ${res.status}:`, await res.json().catch(() => ({})));
  rmSync(TOKEN_FILE, { force: true });
}

function whoami() {
  const t = loadToken();
  console.log(t ?? 'No cached token.');
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

switch (cmd) {
  case 'request': await request(flags); break;
  case 'health': await health(); break;
  case 'search': await search(rest.find((a) => !a.startsWith('--'))); break;
  case 'release': await release(); break;
  case 'whoami': whoami(); break;
  default:
    console.log('Commands: request | health | search "q" | release | whoami');
}
