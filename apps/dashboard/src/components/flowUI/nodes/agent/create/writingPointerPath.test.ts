import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  mouseTravelDurationMs,
  mouseTravelPath,
  mouseTravelTimes,
  pointerEntryPoint,
} from './writingPointerPath.ts';

void describe('mouseTravelPath', () => {
  void it('curves off the straight line and settles on the target', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 200 };
    const path = mouseTravelPath(from, to);
    assert.equal(path[0]?.x, from.x);
    assert.equal(path[0]?.y, from.y);
    assert.equal(path[path.length - 1]?.x, to.x);
    assert.equal(path[path.length - 1]?.y, to.y);

    const mid = path[Math.floor(path.length / 2)];
    assert.ok(mid);
    const straightX = 50;
    const straightY = 100;
    const offLine = Math.hypot(mid.x - straightX, mid.y - straightY);
    assert.ok(offLine > 8, `expected a curve, got deviation ${offLine}`);

    const overshoot = path[path.length - 2];
    assert.ok(overshoot);
    assert.ok(overshoot.y > to.y || overshoot.x > to.x);
  });

  void it('uses slower start/end timing buckets', () => {
    const times = mouseTravelTimes(11);
    assert.equal(times[0], 0);
    assert.equal(times[times.length - 1], 1);
    assert.ok((times[1] ?? 0) > 0);
    assert.ok((times[times.length - 2] ?? 0) >= 0.9);
  });

  void it('scales duration with distance and stays in a human range', () => {
    const short = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 10, y: 10 });
    const long = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 400, y: 400 });
    assert.ok(short >= 420);
    assert.ok(long <= 780);
    assert.ok(long > short);
  });

  void it('enters from above-left of the target', () => {
    const target = { x: 100, y: 80 };
    const from = pointerEntryPoint(target);
    assert.ok(from.x < target.x);
    assert.ok(from.y < target.y);
  });

  void it('drives the canvas pointer with Motion, not CSS or GSAP', () => {
    const pointer = readFileSync(new URL('./WritingFieldPointer.tsx', import.meta.url), 'utf8');
    const highlight = readFileSync(new URL('./ChatFillHighlight.tsx', import.meta.url), 'utf8');
    assert.match(pointer, /from 'motion\/react'/);
    assert.match(pointer, /animate\(/);
    assert.match(pointer, /useMotionValue/);
    assert.equal(/from 'framer-motion'/.test(pointer), false);
    assert.equal(/gsap/i.test(pointer), false);
    assert.equal(/requestAnimationFrame\(run\)/.test(pointer), true);
    assert.equal(/function tick|while \(true\)/.test(pointer), false);
    assert.match(highlight, /from 'motion\/react'/);
    assert.equal(/from 'framer-motion'/.test(highlight), false);
  });

  void it('does not embed Figma MCP asset URLs', () => {
    const light = readFileSync(
      new URL('../../../../../../public/svgs/icons/pointer-cursor-light.svg', import.meta.url),
      'utf8',
    );
    const dark = readFileSync(
      new URL('../../../../../../public/svgs/icons/pointer-cursor-dark.svg', import.meta.url),
      'utf8',
    );
    assert.equal(/figma\.com\/api\/mcp\/asset/.test(light), false);
    assert.equal(/figma\.com\/api\/mcp\/asset/.test(dark), false);
    assert.match(light, /width="20"/);
    assert.match(dark, /width="20"/);
  });
});
