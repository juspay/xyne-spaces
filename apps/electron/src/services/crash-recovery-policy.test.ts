/**
 * Dependency-free assertions for crash-recovery-policy.
 * Run with: npx tsx src/services/crash-recovery-policy.test.ts
 * (no test framework is configured in this package).
 */
import assert from 'assert';
import {
  shouldRecoverFromReason,
  CrashRetryBudget,
} from './crash-recovery-policy';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

// --- shouldRecoverFromReason ------------------------------------------------
check('recovers on a hard crash', () => {
  assert.strictEqual(shouldRecoverFromReason('crashed'), true);
});
check('recovers on oom / killed / launch-failed', () => {
  assert.strictEqual(shouldRecoverFromReason('oom'), true);
  assert.strictEqual(shouldRecoverFromReason('killed'), true);
  assert.strictEqual(shouldRecoverFromReason('launch-failed'), true);
});
check('does NOT recover on a clean exit (normal teardown)', () => {
  assert.strictEqual(shouldRecoverFromReason('clean-exit'), false);
});

// --- CrashRetryBudget -------------------------------------------------------
check('allows up to maxRetries inside the window, then stops', () => {
  const b = new CrashRetryBudget({ maxRetries: 3, windowMs: 60_000 });
  const t = 1_000_000;
  assert.strictEqual(b.tryConsume(t), true);       // 1
  assert.strictEqual(b.tryConsume(t + 1), true);   // 2
  assert.strictEqual(b.tryConsume(t + 2), true);   // 3
  assert.strictEqual(b.tryConsume(t + 3), false);  // budget exhausted
});
check('recovers budget once attempts age out of the window', () => {
  const b = new CrashRetryBudget({ maxRetries: 2, windowMs: 10_000 });
  const t = 5_000_000;
  assert.strictEqual(b.tryConsume(t), true);
  assert.strictEqual(b.tryConsume(t + 1), true);
  assert.strictEqual(b.tryConsume(t + 2), false);          // within window
  assert.strictEqual(b.tryConsume(t + 10_001), true);      // old attempts expired
});
check('attemptsInWindow reflects only in-window attempts', () => {
  const b = new CrashRetryBudget({ maxRetries: 5, windowMs: 10_000 });
  const t = 2_000_000;
  b.tryConsume(t);
  b.tryConsume(t + 5_000);
  assert.strictEqual(b.attemptsInWindow(t + 6_000), 2);
  assert.strictEqual(b.attemptsInWindow(t + 14_000), 1); // only the t+5000 attempt is still in-window
});
check('reset clears the budget', () => {
  const b = new CrashRetryBudget({ maxRetries: 1, windowMs: 60_000 });
  assert.strictEqual(b.tryConsume(1), true);
  assert.strictEqual(b.tryConsume(2), false);
  b.reset();
  assert.strictEqual(b.tryConsume(3), true);
});

console.log(`\nAll ${passed} assertions passed.`);
