import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  fieldTransitionPath,
  hermiteSmoothstep,
  mouseTravelDurationMs,
  mouseTravelPath,
  mouseTravelTimes,
  pointerCaretPoint,
  pointerEntryPoint,
  pointerParkPoint,
  travelArcHeight,
} from './writingPointerPath.ts';

void describe('mouseTravelPath', () => {
  void it('curves with an upward arc and ends on the target', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 200 };
    const path = mouseTravelPath(from, to);
    assert.equal(path[0]?.x, from.x);
    assert.equal(path[0]?.y, from.y);
    assert.equal(path[path.length - 1]?.x, to.x);
    assert.equal(path[path.length - 1]?.y, to.y);

    const mid = path[Math.floor(path.length / 2)];
    assert.ok(mid);
    const straightY = (from.y + to.y) / 2;
    assert.ok(mid.y < straightY, `expected upward arc, mid.y=${mid.y} straightY=${straightY}`);
    // Quadratic mid sits ~halfway to the control point (plus small entry nudge).
    const expectedArc = travelArcHeight(Math.hypot(100, 200));
    assert.ok(straightY - mid.y > expectedArc * 0.4);
    assert.ok(straightY - mid.y < expectedArc * 0.7 + 6);
  });

  void it('uses linear sample times (Hermite ease applied by Motion)', () => {
    const times = mouseTravelTimes(11);
    assert.equal(times[0], 0);
    assert.equal(times[times.length - 1], 1);
    assert.equal(times[5], 0.5);
  });

  void it('applies Hermite smoothstep 3t²−2t³', () => {
    assert.equal(hermiteSmoothstep(0), 0);
    assert.equal(hermiteSmoothstep(1), 1);
    assert.ok(Math.abs(hermiteSmoothstep(0.5) - 0.5) < 1e-9);
    assert.ok(hermiteSmoothstep(0.25) > 0.1);
    assert.ok(hermiteSmoothstep(0.25) < 0.25);
  });

  void it('scales duration with Clicky clamp(distance/800, 0.6, 1.4)s', () => {
    const short = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 10, y: 10 });
    const mid = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 800, y: 0 });
    const long = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 2000, y: 0 });
    assert.equal(short, 600);
    assert.equal(mid, 1000);
    assert.equal(long, 1400);
    const reduced = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 800, y: 0 }, 'reduced');
    assert.ok(reduced < mid);
    assert.equal(reduced, Math.round(1000 * 0.35));
  });

  void it('caps arc height at 80px', () => {
    assert.equal(travelArcHeight(100), 20);
    assert.equal(travelArcHeight(1000), 80);
  });

  void it('enters from above-left of the target', () => {
    const target = { x: 100, y: 80 };
    const from = pointerEntryPoint(target);
    assert.ok(from.x < target.x);
    assert.ok(from.y < target.y);
  });

  void it('arcs between fields with the same upward quadratic', () => {
    const from = { x: 180, y: 40 };
    const to = { x: 200, y: 120 };
    const path = fieldTransitionPath(from, to);
    const mid = path[Math.floor(path.length / 2)];
    assert.ok(mid);
    const straightY = (from.y + to.y) / 2;
    assert.ok(mid.y < straightY, `expected upward arc, got mid.y=${mid.y}`);
    assert.equal(path[path.length - 1]?.x, to.x);
    assert.equal(path[path.length - 1]?.y, to.y);
  });

  void it('uses a short two-point path for reduced motion', () => {
    const path = mouseTravelPath({ x: 0, y: 0 }, { x: 80, y: 40 }, 'reduced');
    assert.equal(path.length, 2);
    const duration = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 80, y: 40 }, 'reduced');
    assert.ok(duration <= 600 * 0.35 + 1);
  });

  void it('tracks caret on the text line without parking on the left title edge', () => {
    const box = { left: 0, top: 0, width: 240, height: 32, inline: true };
    const empty = pointerCaretPoint(null, box, '');
    const filled = pointerCaretPoint(null, box, 'Eng Standup');
    assert.ok(empty.x > box.left + 8);
    assert.ok(filled.x > empty.x);
    const park = pointerParkPoint(box);
    assert.ok(park.x > box.left + 8);
  });

  void it('drives the canvas pointer with Motion, not CSS or GSAP', () => {
    const pointer = readFileSync(new URL('./WritingFieldPointer.tsx', import.meta.url), 'utf8');
    const highlight = readFileSync(new URL('./ChatFillHighlight.tsx', import.meta.url), 'utf8');
    const chat = readFileSync(new URL('./AgentCreateChatPanel.tsx', import.meta.url), 'utf8');
    assert.match(pointer, /from 'motion\/react'/);
    assert.match(pointer, /animate\(/);
    assert.match(pointer, /useMotionValue/);
    assert.match(pointer, /pointerCaretPoint/);
    assert.match(pointer, /field-down/);
    assert.match(pointer, /hermiteSmoothstep/);
    assert.match(pointer, /SCALE_PEAK/);
    assert.match(pointer, /data-pointer-settled/);
    assert.equal(/pointerWanderStops/.test(pointer), false);
    assert.equal(/pointerSettlePath/.test(pointer), false);
    assert.equal(/from 'framer-motion'/.test(pointer), false);
    assert.equal(/gsap/i.test(pointer), false);
    assert.match(highlight, /from 'motion\/react'/);
    assert.match(highlight, /animate\(/);
    assert.equal(/ring-2/.test(highlight), false);
    assert.equal(/from 'framer-motion'/.test(highlight), false);
    assert.match(chat, /from '@\/components\/AIScreen\/ReasoningLoader'/);
    assert.match(chat, /BrailleLoader/);
    assert.equal(/from '@\/components\/AIScreen\/AIChatThread'/.test(chat), false);
    assert.equal(
      /useXyneAIStream/.test(chat.split('function ScriptedAgentCreateChatPanel')[1] ?? ''),
      false,
    );
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
