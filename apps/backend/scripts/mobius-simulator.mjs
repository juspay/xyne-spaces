#!/usr/bin/env node
/*
 * Mobius Simulator — fakes the Mobius side of the Xyne release-webhook integration.
 *
 * It does TWO things at once, so a local Xyne backend behaves as if a real Mobius
 * release were rolling out:
 *
 *   1. WEBHOOK EMITTER  — POSTs release lifecycle events to
 *        {xyneBaseUrl}/api/webhooks/mobius/{workspaceId}
 *      on an interval (default 60s), walking a realistic ramp:
 *        START -> STAGGERED_UP_1 -> _25 -> _50 -> _100 -> STABILIZED   (or an ABORT/REVERT path)
 *
 *   2. RELEASE-STATE / HISTORY API  — a tiny HTTP server that answers the calls
 *      Xyne makes back for enrichment:
 *        GET /api/v2/release/{releaseId}            -> { status, staggerPercent, ... }
 *        GET /api/v1/eventLog/{releaseId}?offset=N  -> { count, results: [ ...events ] }
 *      The state advances as events fire, so each activity reflects the live stage.
 *
 * To get the enriched "Status / Stagger" lines in the ticket activity, point Xyne at
 * this server in backend/.env.local and restart the backend:
 *        MOBIUS_API_BASE_URL=http://localhost:<mockPort>
 *        MOBIUS_API_KEY=<anything-nonempty>
 * Without that, the webhook still records an activity — just without those two lines.
 *
 * Usage:  node scripts/mobius-simulator.mjs
 * Interactive: press [Enter] to fire the next event immediately, [q] then Enter to quit.
 * Requires Node 18+ (uses global fetch). No npm install needed.
 */

import http from 'node:http';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const now = () => new Date().toISOString();

// --- Release lifecycle scenarios ---------------------------------------------
// Each step becomes both a webhook event AND the current release state.
const SCENARIOS = {
  ramp: [
    { event_name: 'EULER_START_RELEASE_SUCCESS', status: 'INPROGRESS', staggerPercent: 0,   result: { status: 'Success' } },
    { event_name: 'STAGGERED_UP_1',              status: 'STAGGERING', staggerPercent: 1,   result: { abHistory: [] } },
    { event_name: 'STAGGERED_UP_25',             status: 'STAGGERING', staggerPercent: 25,  result: { decision: 'AB_CONTINUE' } },
    { event_name: 'STAGGERED_UP_50',             status: 'STAGGERING', staggerPercent: 50,  result: { decision: 'AB_CONTINUE' } },
    { event_name: 'STAGGERED_UP_100',            status: 'STAGGERING', staggerPercent: 100, result: { decision: 'AB_CONTINUE' } },
    { event_name: 'STABILIZED',                  status: 'STABILIZED', staggerPercent: 100, result: { message: 'Stabilized successfully' } },
  ],
  abort: [
    { event_name: 'EULER_START_RELEASE_SUCCESS', status: 'INPROGRESS', staggerPercent: 0,  result: { status: 'Success' } },
    { event_name: 'STAGGERED_UP_1',              status: 'STAGGERING', staggerPercent: 1,  result: { abHistory: [] } },
    { event_name: 'STAGGERED_UP_25',             status: 'STAGGERING', staggerPercent: 25, result: { decision: 'AB_CONTINUE' } },
    { event_name: 'ABORT',                       status: 'ABORTING',   staggerPercent: 25, result: { reason: ['sr'], decision: 'ABORT' } },
    { event_name: 'RELEASE_REVERTED',            status: 'REVERTED',   staggerPercent: 0,  result: { tag: 'RELEASE_ACTION_SUCCESS' } },
  ],
};

async function main() {
  // Interactive when attached to a TTY; otherwise fall back to env vars / defaults
  // so it can be scripted (e.g. WORKSPACE_ID=... node scripts/mobius-simulator.mjs).
  const interactive = Boolean(input.isTTY);
  const rl = interactive ? readline.createInterface({ input, output }) : null;
  const ask = async (envName, q, def) => {
    const fromEnv = process.env[envName];
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
    if (!interactive) {
      if (def !== undefined && def !== '') return def;
      console.error(c.red(`Missing required config: set env ${envName} (non-interactive mode).`));
      process.exit(1);
    }
    const a = (await rl.question(`${c.cyan('?')} ${q}${def !== undefined ? c.dim(` [${def}]`) : ''}: `)).trim();
    return a || def;
  };

  console.log(c.bold('\n=== Mobius Simulator ===\n'));
  const xyneBaseUrl = await ask('XYNE_URL', 'Xyne backend base URL', 'http://localhost:3001');
  let workspaceId = await ask('WORKSPACE_ID', 'Xyne workspaceId (first path segment of the dashboard URL)', '');
  while (!workspaceId) workspaceId = await ask('WORKSPACE_ID', 'workspaceId is required', '');
  const webhookApiKey = await ask('WEBHOOK_KEY', 'Webhook API key (x-api-key, matches MOBIUS_WEBHOOK_API_KEY)', 'test-key-123');
  const releaseId = await ask('RELEASE_ID', 'mobiusReleaseId (must match the ticket’s Mobius Release ID)', 'test-release-123');
  const scenarioName = (await ask('SCENARIO', 'Scenario: ramp (success) or abort', 'ramp')).toLowerCase() === 'abort' ? 'abort' : 'ramp';
  const mockPort = parseInt(await ask('MOCK_PORT', 'Port for the mock release-state/history API', '9900'), 10);
  const intervalSec = parseInt(await ask('INTERVAL_SEC', 'Seconds between events', '60'), 10);

  const scenario = SCENARIOS[scenarioName];
  const product = await ask('PRODUCT', 'Release product label (cosmetic)', 'SDK');
  const newVersion = `${Date.now()}`;

  if (rl) rl.close();

  // --- shared mutable state that the mock API serves ---
  const history = []; // accumulated events (event-log shape)
  let current = { status: 'PENDING', staggerPercent: 0 };

  // --- 1. Mock Mobius release-state / history API ---
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${mockPort}`);
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    console.log(c.dim(`  ← ${req.method} ${url.pathname}  (Xyne calling back for enrichment)`));
    // Event log — GET /api/v1/eventLog/{id}?offset=N → { count, results } (page size 20).
    const logMatch = url.pathname.match(/^\/api\/v1\/eventLog\/([^/]+)$/);
    if (logMatch) {
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      return json(200, { count: history.length, results: history.slice(offset, offset + 20) });
    }
    // Current release state — GET /api/v2/release/{id}.
    const stateMatch = url.pathname.match(/^\/api\/v2\/release\/([^/]+)$/);
    if (stateMatch) {
      const id = decodeURIComponent(stateMatch[1]);
      return json(200, {
        releaseId: id,
        status: current.status,
        staggerPercent: current.staggerPercent,
        releaseAction: 'NORMAL',
        product,
        newVersion,
        lastUpdated: now(),
      });
    }
    return json(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(mockPort, r));

  // --- print summary + reminders ---
  console.log(`\n${c.green('✓')} Mock Mobius API listening on ${c.bold(`http://localhost:${mockPort}`)}`);
  console.log(`${c.green('✓')} Will POST ${c.bold(scenario.length + '')} events to ${c.bold(`${xyneBaseUrl}/api/webhooks/mobius/${workspaceId}`)}`);
  console.log(`${c.green('✓')} release_id = ${c.bold(releaseId)}   scenario = ${c.bold(scenarioName)}   every ${c.bold(intervalSec + 's')}`);
  console.log(c.yellow(`\n! For enriched Status/Stagger lines, put these in backend/.env.local and restart the backend:`));
  console.log(c.yellow(`    MOBIUS_API_BASE_URL=http://localhost:${mockPort}`));
  console.log(c.yellow(`    MOBIUS_API_KEY=dev`));
  console.log(c.dim(`\n(reminder) The ticket’s "Mobius Release ID" field must equal ${releaseId} for routing to work.`));
  console.log(c.dim(`Press [Enter] to fire the next event now, or [q]+[Enter] to quit.\n`));

  // --- 2. Webhook emitter ---
  let idx = 0;
  let timer = null;

  const fireNext = async () => {
    if (idx >= scenario.length) {
      console.log(c.green('\n✓ Scenario complete. All events delivered.'));
      shutdown(0);
      return;
    }
    const step = scenario[idx++];
    current = { status: step.status, staggerPercent: step.staggerPercent };
    const event = {
      event_name: step.event_name,
      id: randomUUID(),
      release_id: releaseId,
      occurredAt: now(),
      staggerPercent: step.staggerPercent,
      status: step.status,
      result: step.result,
      date_created: now(),
      last_updated: now(),
    };
    history.unshift(event);

    process.stdout.write(`${c.cyan(`[${idx}/${scenario.length}]`)} ${c.bold(step.event_name)} `
      + c.dim(`(stagger ${step.staggerPercent}%, status ${step.status}) → webhook ... `));
    try {
      const resp = await fetch(`${xyneBaseUrl}/api/webhooks/mobius/${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': webhookApiKey },
        body: JSON.stringify(event),
      });
      const text = await resp.text();
      const ok = resp.status >= 200 && resp.status < 300;
      console.log((ok ? c.green(resp.status) : c.red(resp.status)) + ' ' + c.dim(text));
    } catch (e) {
      console.log(c.red('FAILED ') + c.dim(e.message));
      console.log(c.red(`  Is the Xyne backend running at ${xyneBaseUrl}?`));
    }

    if (idx < scenario.length) {
      timer = setTimeout(fireNext, intervalSec * 1000);
    } else {
      // give Xyne a moment, then finish
      timer = setTimeout(() => fireNext(), 2000);
    }
  };

  // interactive: Enter = fire now, q = quit
  input.setEncoding('utf8');
  input.on('data', (d) => {
    const s = String(d).trim().toLowerCase();
    if (s === 'q') return shutdown(0);
    if (timer) clearTimeout(timer);
    fireNext();
  });

  const shutdown = (code) => {
    if (timer) clearTimeout(timer);
    server.close();
    console.log(c.dim('\nSimulator stopped.'));
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));

  // kick off first event shortly after startup
  timer = setTimeout(fireNext, 2000);
}

main().catch((e) => { console.error(e); process.exit(1); });
