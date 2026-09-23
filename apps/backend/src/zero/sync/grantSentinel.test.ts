/** P1(d) fallback decision — the three prescribed cases (node:test, env-free). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantSentinelFallbackDecision } from './grantSentinel';

const T = 15_000;

test('defer before the threshold: first entry starts the clock, later entries within it defer', () => {
  const clock = new Map<string, number>();
  assert.equal(grantSentinelFallbackDecision(clock, 'g', 1_000, T), 'defer');
  assert.equal(clock.get('g'), 1_000, 'first entry stamps the clock');
  assert.equal(grantSentinelFallbackDecision(clock, 'g', 1_000 + T - 1, T), 'defer');
  assert.equal(clock.get('g'), 1_000, 'clock is NOT re-stamped by subsequent entries');
});

test('adopt after the threshold; the clock is consumed (no repeat adoption)', () => {
  const clock = new Map<string, number>();
  grantSentinelFallbackDecision(clock, 'g', 1_000, T);
  assert.equal(grantSentinelFallbackDecision(clock, 'g', 1_000 + T, T), 'adopt');
  assert.equal(clock.has('g'), false, 'clock cleared on adoption');
  // a later unhydrated episode starts a FRESH wait, not an instant adoption
  assert.equal(grantSentinelFallbackDecision(clock, 'g', 1_000 + T + 5, T), 'defer');
});

test('cleared resets the clock: after the caller deletes the key, the wait restarts in full', () => {
  const clock = new Map<string, number>();
  grantSentinelFallbackDecision(clock, 'g', 1_000, T);
  clock.delete('g'); // what the `cleared` branch does
  assert.equal(grantSentinelFallbackDecision(clock, 'g', 20_000, T), 'defer', 'fresh clock, not adoption');
  assert.equal(clock.get('g'), 20_000);
  assert.equal(grantSentinelFallbackDecision(clock, 'g', 20_000 + T, T), 'adopt');
});

test('independent keys: one grant adopting does not affect another', () => {
  const clock = new Map<string, number>();
  grantSentinelFallbackDecision(clock, 'a', 0, T);
  grantSentinelFallbackDecision(clock, 'b', T - 1, T);
  assert.equal(grantSentinelFallbackDecision(clock, 'a', T, T), 'adopt');
  assert.equal(grantSentinelFallbackDecision(clock, 'b', T, T), 'defer', 'b is on its own clock');
});
