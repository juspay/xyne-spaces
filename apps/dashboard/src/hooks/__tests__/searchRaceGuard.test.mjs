/**
 * Reproduction test for the search stale-response race (from:<user> black screen).
 *
 * The dashboard has no unit-test runner, so this is a self-contained Node script
 * that models the EXACT resolution path of performSearch in useSearchMetrics.ts:
 *   - each search run captures `seq = ++searchSeqRef.current`
 *   - after `await vespaSearch(...)`, it commits results ONLY if `seq` is still latest
 *
 * It drives the real-world timeline from the bug report:
 *   Request A: q="from"   -> resolves LATE (3300ms) with an EMPTY payload (stale)
 *   Request B: q=""+from: -> resolves FAST (459ms)  with the correct results
 * B is dispatched after A, so B is the "latest" run.
 *
 * WITHOUT the guard, A resolves last and overwrites B -> blank screen (the bug).
 * WITH the guard, A is detected as stale and dropped -> correct results survive.
 */
import assert from 'node:assert/strict';

const FRESH = [{ id: 'msg-1', title: 'hello from Vimal' }, { id: 'msg-2', title: 'ping' }];
const STALE_EMPTY = [];

function makeVespa(latencyMs, payload) {
  return () => new Promise(res => setTimeout(() => res(payload), latencyMs));
}

// --- BUGGY model: no sequence guard (mirrors code BEFORE the fix) ---
function makeBuggyHook() {
  const state = { searchResults: null };
  async function performSearch(vespa) {
    const results = await vespa();
    state.searchResults = results; // unconditional commit
  }
  return { state, performSearch };
}

// --- FIXED model: monotonic sequence guard (mirrors code AFTER the fix) ---
function makeFixedHook() {
  const state = { searchResults: null };
  const searchSeqRef = { current: 0 };
  async function performSearch(vespa) {
    const seq = ++searchSeqRef.current;
    const isStale = () => seq !== searchSeqRef.current;
    const results = await vespa();
    if (isStale()) return; // drop out-of-order response
    state.searchResults = results;
  }
  return { state, performSearch };
}

async function drive(hook) {
  // A dispatched first (slow, stale, empty). B dispatched right after (fast, correct).
  const a = hook.performSearch(makeVespa(120, STALE_EMPTY)); // scaled 3300ms -> 120ms
  const b = hook.performSearch(makeVespa(20, FRESH)); //         scaled  459ms -> 20ms
  await Promise.all([a, b]);
  return hook.state.searchResults;
}

const results = [];
function check(name, cond) {
  results.push({ name, pass: cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

const buggy = await drive(makeBuggyHook());
const fixed = await drive(makeFixedHook());

console.log('\n--- observed final searchResults ---');
console.log('buggy (no guard):', JSON.stringify(buggy));
console.log('fixed (guard)  :', JSON.stringify(fixed));
console.log('------------------------------------\n');

// The bug: stale empty response wins -> blank screen.
check('reproduces bug: without guard, stale empty response clobbers fresh results',
  Array.isArray(buggy) && buggy.length === 0);
// The fix: fresh results survive the late stale response.
check('fix: with guard, fresh results survive the late stale response',
  Array.isArray(fixed) && fixed.length === 2 && fixed[0].id === 'msg-1');

const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
assert.equal(failed, 0, 'race-guard test failed');
console.log('ALL CHECKS PASSED');
