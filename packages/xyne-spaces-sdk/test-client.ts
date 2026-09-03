/**
 * Test client for SDK SSO authentication.
 *
 * This script:
 * 1. Authenticates via SSO (opens browser for approval)
 * 2. Initializes the SDK client with the token
 * 3. Makes test API calls to verify authentication
 *
 * Usage:
 *   npx tsx test-client.ts          # Uses cached token if available
 *   npx tsx test-client.ts --fresh  # Forces new SSO authentication
 *
 * Environment variables:
 *   SPACES_URL - Backend URL (default: http://localhost:3001)
 */

import { xyneSsoLoginAndWait, createClient, type SpacesClient } from './src/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const BASE_URL = process.env.SPACES_URL || 'http://localhost:3001';
const TOKEN_FILE = path.join(os.homedir(), '.xyne-sdk-test-token.json');
const FORCE_FRESH = process.argv.includes('--fresh');

interface StoredToken {
  jwt: string;
  expiresAt: number;
  baseUrl: string;
}

/**
 * Load a previously saved token if it exists and is still valid.
 */
function loadStoredToken(): StoredToken | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;

    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')) as StoredToken;

    // Check if token is expired (with 1 hour buffer)
    if (data.expiresAt < Date.now() + 3600000) {
      console.log('Stored token is expired or expiring soon, will re-authenticate.');
      return null;
    }

    // Check if base URL matches
    if (data.baseUrl !== BASE_URL) {
      console.log('Stored token is for a different server, will re-authenticate.');
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Save token for future use.
 */
function saveToken(jwt: string, expiresAt: number): void {
  const data: StoredToken = { jwt, expiresAt, baseUrl: BASE_URL };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  console.log(`Token saved to ${TOKEN_FILE}`);
}

/**
 * Authenticate via SSO and get a token.
 */
async function authenticate(): Promise<string> {
  // Check for stored token first (unless --fresh flag is used)
  if (!FORCE_FRESH) {
    const stored = loadStoredToken();
    if (stored) {
      console.log('Using stored token (expires: ' + new Date(stored.expiresAt).toISOString() + ')');
      console.log('(Use --fresh flag to force new SSO authentication)\n');
      return stored.jwt;
    }
  } else {
    console.log('--fresh flag: Forcing new SSO authentication\n');
  }

  console.log('\n' + '='.repeat(50));
  console.log('SSO Authentication Required');
  console.log('='.repeat(50));

  const { jwt, expiresAt } = await xyneSsoLoginAndWait({
    baseUrl: BASE_URL,
    openBrowser: true,
    onUserCode: (code, _url, completeUrl) => {
      console.log('\nPlease authorize in your browser:');
      console.log(`  URL:  ${completeUrl}`);
      console.log(`  Code: ${code}`);
      console.log('\nWaiting for approval...');
    },
  });

  console.log('\nAuthentication successful!');
  saveToken(jwt, expiresAt);

  return jwt;
}

/**
 * Run test API calls.
 */
async function runTests(client: SpacesClient): Promise<void> {
  console.log('\n' + '='.repeat(50));
  console.log('Running API Tests');
  console.log('='.repeat(50));

  // Test 1: Get current user
  console.log('\n1. Testing users.me()...');
  try {
    const me = await client.users.me();
    console.log(`   ✓ Authenticated as: ${me.name} <${me.email}>`);
    console.log(`   ✓ Workspace ID: ${me.workspaceId}`);
  } catch (err) {
    console.log(`   ✗ Failed: ${err}`);
    throw err;
  }

  // Test 2: List channels
  console.log('\n2. Testing channels.list()...');
  try {
    const channels = await client.channels.list({ limit: 5 });
    console.log(`   ✓ Found ${channels.length} channels`);
    if (channels.length > 0) {
      console.log(`   ✓ First channel: ${channels[0].name}`);
    }
  } catch (err) {
    console.log(`   ✗ Failed: ${err}`);
  }

  // Test 3: List projects
  console.log('\n3. Testing projects.list()...');
  try {
    const projects = await client.projects.list({ limit: 5 });
    console.log(`   ✓ Found ${projects.length} projects`);
    if (projects.length > 0) {
      console.log(`   ✓ First project: ${projects[0].name}`);
    }
  } catch (err) {
    console.log(`   ✗ Failed: ${err}`);
  }

  // Test 4: List users
  console.log('\n4. Testing users.list()...');
  try {
    const users = await client.users.list({ limit: 5 });
    console.log(`   ✓ Found ${users.length} users`);
  } catch (err) {
    console.log(`   ✗ Failed: ${err}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('All tests completed!');
  console.log('='.repeat(50));
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log('Xyne Spaces SDK Test Client');
  console.log(`Backend: ${BASE_URL}\n`);

  // Authenticate
  const jwt = await authenticate();

  // Create client
  const client = createClient({
    baseUrl: BASE_URL,
    apiKey: jwt,
  });

  // Run tests
  await runTests(client);

  // Interactive mode hint
  console.log('\nTo use the client interactively, you can import it in a REPL:');
  console.log('  node --experimental-strip-types -i -e "const {createClient} = require(\'./src/index.js\')"');
}

main().catch((err) => {
  console.error('\nError:', err.message || err);
  process.exit(1);
});
