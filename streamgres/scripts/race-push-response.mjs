// An end-to-end regression check for the retry race that used to be caused by
// forwarding ordinary MutateResponses as pushResponse. It expects a running
// streamgres and Postgres, starts its own mutate endpoint, then:
//
//   1. writes an application error for A/1 and returns it normally;
//   2. immediately retries A/1, returning alreadyProcessed;
//   3. requires a mutationsPatch app error and forbids pushResponse.
//
// RACE_PG is the psql connection string. RACE_GATEWAY defaults to the local
// sync server; RACE_MUTATE_PORT defaults to 4781.

import {randomUUID} from 'node:crypto';

const pg = process.env.RACE_PG;
if (!pg) throw new Error('RACE_PG is required');
const gateway = process.env.RACE_GATEWAY ?? 'ws://127.0.0.1:4848/sync';
const shardSchema = `${process.env.STREAMGRES_APP_ID ?? 'xyne'}_${process.env.STREAMGRES_SHARD ?? '0'}`;
const port = Number(process.env.RACE_MUTATE_PORT ?? 4781);
const group = `race-group-${randomUUID()}`;
const client = `race-client-${randomUUID()}`;
const mutation = {clientID: client, id: 1};
let calls = 0;

function sql(statement) {
  const child = Bun.spawnSync(['psql', pg, '-v', 'ON_ERROR_STOP=1', '-qAtc', statement]);
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
}

const mutate = Bun.serve({
  port,
  async fetch(request) {
    const body = await request.json();
    const received = body.mutations?.[0];
    if (received?.id !== 1 || received?.clientID !== client) {
      return Response.json({kind: 'PushFailed', origin: 'server', reason: 'parse', mutationIDs: []}, {status: 400});
    }
    calls += 1;
    if (calls === 1) {
      const q = (value) => `'${value.replaceAll("'", "''")}'`;
      sql(`BEGIN;
           INSERT INTO ${shardSchema}.clients ("clientGroupID", "clientID", "lastMutationID") VALUES (${q(group)}, ${q(client)}, 1);
           INSERT INTO ${shardSchema}.mutations ("clientGroupID", "clientID", "mutationID", result) VALUES (${q(group)}, ${q(client)}, 1, '{"error":"app","message":"denied by race test"}'::json);
           COMMIT;`);
      return Response.json({kind: 'MutateResponse', mutations: [{id: mutation, result: {error: 'app', message: 'denied by race test'}}]});
    }
    if (calls === 2) {
      return Response.json({kind: 'MutateResponse', mutations: [{id: mutation, result: {error: 'alreadyProcessed', details: 'expected: 2'}}]});
    }
    return Response.json({kind: 'PushFailed', origin: 'server', reason: 'internal', mutationIDs: [mutation]});
  },
});

const init = ['initConnection', {desiredQueriesPatch: []}];
const protocol = encodeURIComponent(btoa(JSON.stringify({initConnectionMessage: init})));
const ws = new WebSocket(`${gateway}/sync/v51/connect?clientID=${client}&clientGroupID=${group}&baseCookie=&wsid=race`, [protocol]);
const frames = [];
let sentRetry = false;
let sawResult = false;

const deadline = setTimeout(() => finish(new Error(`timed out; calls=${calls}, frames=${JSON.stringify(frames)}`)), 15_000);

ws.addEventListener('open', () => {
  const now = Date.now();
  ws.send(JSON.stringify(['push', {
    clientGroupID: group,
    mutations: [{type: 'custom', id: 1, clientID: client, name: 'race', args: [], timestamp: now}],
    pushVersion: 1,
    timestamp: now,
    requestID: 'first',
  }]));
  const retry = setInterval(() => {
    if (calls !== 1 || sentRetry) return;
    sentRetry = true;
    const now = Date.now();
    ws.send(JSON.stringify(['push', {
      clientGroupID: group,
      mutations: [{type: 'custom', id: 1, clientID: client, name: 'race', args: [], timestamp: now}],
      pushVersion: 1,
      timestamp: now,
      requestID: 'retry',
    }]));
    clearInterval(retry);
    const awaitRetry = setInterval(() => {
      if (calls !== 2) return;
      clearInterval(awaitRetry);
      check();
    }, 1);
  }, 1);
});

ws.addEventListener('message', event => {
  const frame = JSON.parse(event.data);
  frames.push(frame);
  const [tag, body] = frame;
  if (tag !== 'pokePart') return;
  const result = body.mutationsPatch?.find(op =>
    op.op === 'put' && op.mutation.id.clientID === client && op.mutation.id.id === 1,
  );
  if (!result) return;
  if (result.mutation.result.error !== 'app') {
    finish(new Error(`expected app error, got ${JSON.stringify(result)}`));
    return;
  }
  if (body.lastMutationIDChanges?.[client] !== 1) {
    finish(new Error(`result and LMID were not in the same poke part: ${JSON.stringify(body)}`));
    return;
  }
  sawResult = true;
  check();
});

function check() {
  if (!sawResult || calls !== 2) return;
  if (frames.some(([kind]) => kind === 'pushResponse')) {
    finish(new Error(`received forbidden pushResponse: ${JSON.stringify(frames)}`));
    return;
  }
  if (frames.some(([kind]) => kind === 'error')) {
    finish(new Error(`received unexpected fatal error: ${JSON.stringify(frames)}`));
    return;
  }
  console.log('PASS: retry returned alreadyProcessed; client received only mutationsPatch app error with LMID');
  finish();
}

ws.addEventListener('error', () => finish(new Error(`websocket error; frames=${JSON.stringify(frames)}`)));

function finish(error) {
  clearTimeout(deadline);
  ws.close();
  mutate.stop(true);
  if (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
