import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  fieldTransitionPath,
  mouseTravelDurationMs,
  mouseTravelPath,
  mouseTravelTimes,
  pointerCaretPoint,
  pointerEntryPoint,
  pointerParkPoint,
} from './writingPointerPath.ts';

void describe('mouseTravelPath', () => {
  void it('curves off the straight line and ends on the target', () => {
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
  });

  void it('uses eased timing along the travel samples', () => {
    const times = mouseTravelTimes(11);
    assert.equal(times[0], 0);
    assert.equal(times[times.length - 1], 1);
    assert.ok((times[1] ?? 0) > 0);
    assert.ok((times[times.length - 2] ?? 0) < 1);
  });

  void it('scales duration with distance and stays in a human range', () => {
    const short = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 10, y: 10 });
    const long = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 400, y: 400 });
    assert.ok(short >= 420);
    assert.ok(long <= 760);
    assert.ok(long > short);
  });

  void it('enters from above-left of the target', () => {
    const target = { x: 100, y: 80 };
    const from = pointerEntryPoint(target);
    assert.ok(from.x < target.x);
    assert.ok(from.y < target.y);
  });

  void it('arcs downward between fields instead of a straight drop', () => {
    const from = { x: 180, y: 40 };
    const to = { x: 200, y: 120 };
    const path = fieldTransitionPath(from, to);
    const mid = path[Math.floor(path.length / 2)];
    assert.ok(mid);
    const straightX = (from.x + to.x) / 2;
    const offLine = Math.abs(mid.x - straightX);
    assert.ok(offLine > 8, `expected a sideways arc, got deviation ${offLine}`);
    assert.equal(path[path.length - 1]?.x, to.x);
    assert.equal(path[path.length - 1]?.y, to.y);
  });

  void it('uses a short two-point path for reduced motion', () => {
    const path = mouseTravelPath({ x: 0, y: 0 }, { x: 80, y: 40 }, 'reduced');
    assert.equal(path.length, 2);
    const duration = mouseTravelDurationMs({ x: 0, y: 0 }, { x: 80, y: 40 }, 'reduced');
    assert.ok(duration <= 220);
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
