import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripLeadingMentionPrefix,
  formatMentionDisplay,
  normalizeMentionName,
  resolveUserMentionName,
  resolveChannelMentionName,
  resolveGroupMentionName,
  resolveUserMentionNameFromNativeAttrs,
  normalizeInterMentionWhitespaceForEdit,
} from '@/src/utils/mentionLabelUtils';

// ─── stripLeadingMentionPrefix ──────────────────────────────────────────────

test('stripLeadingMentionPrefix: strips single @ prefix', () => {
  assert.equal(stripLeadingMentionPrefix('@Aryan'), 'Aryan');
});

test('stripLeadingMentionPrefix: strips multiple @@@ prefix', () => {
  assert.equal(stripLeadingMentionPrefix('@@@Aryan'), 'Aryan');
});

test('stripLeadingMentionPrefix: strips # prefix when indicator is #', () => {
  assert.equal(stripLeadingMentionPrefix('#general', '#'), 'general');
});

test('stripLeadingMentionPrefix: strips multiple ### prefix', () => {
  assert.equal(stripLeadingMentionPrefix('###general', '#'), 'general');
});

test('stripLeadingMentionPrefix: trims surrounding whitespace', () => {
  assert.equal(stripLeadingMentionPrefix('  @Aryan  '), 'Aryan');
});

test('stripLeadingMentionPrefix: returns empty for empty/whitespace string', () => {
  assert.equal(stripLeadingMentionPrefix(''), '');
  assert.equal(stripLeadingMentionPrefix('   '), '');
});

test('stripLeadingMentionPrefix: returns name as-is when no prefix', () => {
  assert.equal(stripLeadingMentionPrefix('Aryan'), 'Aryan');
});

test('stripLeadingMentionPrefix: does not strip @ when indicator is #', () => {
  assert.equal(stripLeadingMentionPrefix('@user', '#'), '@user');
});

// ─── formatMentionDisplay ───────────────────────────────────────────────────

test('formatMentionDisplay: adds @ prefix to clean name', () => {
  assert.equal(formatMentionDisplay('Aryan'), '@Aryan');
});

test('formatMentionDisplay: normalizes multiple @ to single @', () => {
  assert.equal(formatMentionDisplay('@@@Aryan'), '@Aryan');
});

test('formatMentionDisplay: adds # prefix for channel indicator', () => {
  assert.equal(formatMentionDisplay('general', '#'), '#general');
});

test('formatMentionDisplay: returns just indicator for empty name', () => {
  assert.equal(formatMentionDisplay(''), '@');
  assert.equal(formatMentionDisplay('   ', '#'), '#');
});

// ─── normalizeMentionName ───────────────────────────────────────────────────

test('normalizeMentionName: strips @ prefix', () => {
  assert.equal(normalizeMentionName('@Aryan'), 'Aryan');
});

test('normalizeMentionName: strips # prefix', () => {
  assert.equal(normalizeMentionName('#general', '#'), 'general');
});

test('normalizeMentionName: returns empty for empty input', () => {
  assert.equal(normalizeMentionName(''), '');
});

// ─── resolveUserMentionName ─────────────────────────────────────────────────

test('resolveUserMentionName: picks longer name from inner vs attr', () => {
  assert.equal(resolveUserMentionName('Al', 'Alexander'), 'Alexander');
  assert.equal(resolveUserMentionName('Alexander', 'Al'), 'Alexander');
});

test('resolveUserMentionName: returns attr when inner is empty', () => {
  assert.equal(resolveUserMentionName('Aryan', ''), 'Aryan');
});

test('resolveUserMentionName: returns inner when attr is empty', () => {
  assert.equal(resolveUserMentionName('', 'Aryan'), 'Aryan');
});

test('resolveUserMentionName: strips @ from both sources', () => {
  assert.equal(resolveUserMentionName('@Al', '@Alexander'), 'Alexander');
});

// ─── resolveChannelMentionName ──────────────────────────────────────────────

test('resolveChannelMentionName: picks longer name', () => {
  assert.equal(resolveChannelMentionName('#gen', '#general'), 'general');
});

test('resolveChannelMentionName: returns attr when inner is empty', () => {
  assert.equal(resolveChannelMentionName('#general', ''), 'general');
});

// ─── resolveGroupMentionName ────────────────────────────────────────────────

test('resolveGroupMentionName: uses alias when longer than inner', () => {
  // groupAlias='Engineering Team', groupName='Eng', innerText='Eng'
  assert.equal(resolveGroupMentionName('Engineering Team', 'Eng', 'Eng'), 'Engineering Team');
});

test('resolveGroupMentionName: falls back to groupName when alias is empty', () => {
  // groupAlias='', groupName='Engineering', innerText='Engineering'
  assert.equal(resolveGroupMentionName('', 'Engineering', 'Engineering'), 'Engineering');
});

test('resolveGroupMentionName: picks longer from inner vs attr', () => {
  // groupAlias='Eng', groupName='unused', innerText='Engineering Team'
  assert.equal(resolveGroupMentionName('Eng', 'unused', 'Engineering Team'), 'Engineering Team');
});

// ─── resolveUserMentionNameFromNativeAttrs ──────────────────────────────────

test('resolveUserMentionNameFromNativeAttrs: prefers data-username', () => {
  assert.equal(
    resolveUserMentionNameFromNativeAttrs(
      { 'data-username': '@aryan', username: '@other', text: '@fallback' },
      'inner',
    ),
    'aryan',
  );
});

test('resolveUserMentionNameFromNativeAttrs: falls back to username attr', () => {
  assert.equal(resolveUserMentionNameFromNativeAttrs({ username: '@aryan' }, 'inner'), 'aryan');
});

test('resolveUserMentionNameFromNativeAttrs: falls back to text attr', () => {
  assert.equal(resolveUserMentionNameFromNativeAttrs({ text: '@aryan' }, 'inner'), 'aryan');
});

test('resolveUserMentionNameFromNativeAttrs: falls back to inner content', () => {
  assert.equal(resolveUserMentionNameFromNativeAttrs({}, '@aryan'), 'aryan');
});

// ─── normalizeInterMentionWhitespaceForEdit ─────────────────────────────────

test('normalizeInterMentionWhitespaceForEdit: replaces &nbsp; between spans with space', () => {
  const html = '<span data-username="alice">Alice</span>&nbsp;<span data-username="bob">Bob</span>';
  const result = normalizeInterMentionWhitespaceForEdit(html);
  assert.ok(result.includes('</span> <span'));
  assert.ok(!result.includes('&nbsp;'));
});

test('normalizeInterMentionWhitespaceForEdit: replaces multiple whitespace between mentions', () => {
  const html = '<mention>Alice</mention>   <mention>Bob</mention>';
  const result = normalizeInterMentionWhitespaceForEdit(html);
  assert.ok(result.includes('</mention> <mention'));
});

test('normalizeInterMentionWhitespaceForEdit: returns empty string as-is', () => {
  assert.equal(normalizeInterMentionWhitespaceForEdit(''), '');
});

test('normalizeInterMentionWhitespaceForEdit: does not modify text without mention gaps', () => {
  const html = '<p>Hello world</p>';
  assert.equal(normalizeInterMentionWhitespaceForEdit(html), html);
});
