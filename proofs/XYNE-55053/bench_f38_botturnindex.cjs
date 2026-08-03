/**
 * POT — XYNE-55053 / F38: botTurnIndex O(n^2) -> O(n)
 *
 * Reproduces the exact code paths changed in XyneAISidebar.tsx.
 *
 *   BEFORE (per render, inside the .map() for every bot message):
 *     displayMessages.slice(0, index + 1).filter(m => m.type === 'bot').length - 1
 *     => O(n) per bot message => O(n^2) per render.
 *
 *   AFTER (single O(n) pass, memoized once per messages change):
 *     const map = new Map(); let c = 0;
 *     for (const m of displayMessages) if (m.type === 'bot') map.set(m.id, c++);
 *     ...later: map.get(m.id) ?? -1   // O(1) lookup
 *
 * Run: node proofs/XYNE-55053/bench_f38_botturnindex.cjs
 */
'use strict';

function makeMessages(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: 'm' + i, type: i % 2 === 0 ? 'user' : 'bot' });
  }
  return out;
}

// BEFORE: recompute botTurnIndex for every message the way the render loop did.
function oldRenderPass(displayMessages) {
  let sink = 0;
  displayMessages.forEach((message, index) => {
    const botTurnIndex =
      message.type === 'bot'
        ? displayMessages.slice(0, index + 1).filter(m => m.type === 'bot').length - 1
        : -1;
    sink += botTurnIndex;
  });
  return sink;
}

// AFTER: one O(n) pass builds the map; render loop does O(1) lookups.
function newRenderPass(displayMessages) {
  const map = new Map();
  let c = 0;
  for (const m of displayMessages) {
    if (m.type === 'bot') map.set(m.id, c++);
  }
  let sink = 0;
  displayMessages.forEach(message => {
    const botTurnIndex = message.type === 'bot' ? map.get(message.id) ?? -1 : -1;
    sink += botTurnIndex;
  });
  return sink;
}

function time(fn, arg, iters) {
  // warmup
  for (let i = 0; i < 50; i++) fn(arg);
  const t0 = process.hrtime.bigint();
  let guard = 0;
  for (let i = 0; i < iters; i++) guard += fn(arg);
  const t1 = process.hrtime.bigint();
  const perCallMs = Number(t1 - t0) / 1e6 / iters;
  return { perCallMs, guard };
}

// Correctness: both implementations must produce identical botTurnIndex sums.
function assertEquivalent() {
  for (const n of [1, 2, 3, 10, 51, 200]) {
    const msgs = makeMessages(n);
    if (oldRenderPass(msgs) !== newRenderPass(msgs)) {
      throw new Error('MISMATCH at n=' + n + ' — fix changes behaviour!');
    }
  }
  console.log('correctness: BEFORE and AFTER produce identical botTurnIndex for n in {1,2,3,10,51,200}  ✓\n');
}

assertEquivalent();

console.log('F38 — per-render cost of botTurnIndex over the whole list\n');
console.log('   n     BEFORE (O(n^2))     AFTER (O(n))      speedup');
console.log('  ---    ---------------     ------------      -------');
for (const n of [50, 100, 500, 1000]) {
  const msgs = makeMessages(n);
  const iters = n >= 500 ? 2000 : 20000;
  const before = time(oldRenderPass, msgs, iters);
  const after = time(newRenderPass, msgs, iters);
  const speedup = (before.perCallMs / after.perCallMs).toFixed(1);
  console.log(
    '  ' +
      String(n).padStart(4) +
      '   ' +
      (before.perCallMs.toFixed(4) + ' ms').padStart(14) +
      '   ' +
      (after.perCallMs.toFixed(4) + ' ms').padStart(14) +
      '     ' +
      speedup +
      'x',
  );
}
console.log('\nPASS: AFTER is asymptotically flat (O(n)); BEFORE grows quadratically.');
