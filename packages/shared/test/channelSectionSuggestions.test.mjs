import test from 'node:test';
import assert from 'node:assert/strict';

import { computeProjectSectionSuggestions } from '../dist/channelSectionSuggestions.js';

const project = (id, name, type = 'DEFAULT') => ({ id, name, type });

const channel = (id, projectId, overrides = {}) => ({
  id,
  projectId,
  scopeType: 'DEFAULT',
  type: 'DEFAULT',
  ...overrides,
});

const status = (channelId, overrides = {}) => ({
  channelId,
  sectionId: null,
  isStarred: false,
  isDeleted: false,
  ...overrides,
});

const compute = ({ channels, statuses, projects, existingSectionNames = [], ...rest }) =>
  computeProjectSectionSuggestions({
    channels,
    statuses,
    projects,
    existingSectionNames,
    ...rest,
  });

test('groups unsectioned channels by project', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p2'),
      channel('c4', 'p2'),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4')],
  });

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map(s => s.name).sort(),
    ['Infra', 'Platform'],
  );
});

test('excludes starred channels', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p1'),
      channel('c4', 'p2'),
      channel('c5', 'p2'),
    ],
    statuses: [
      status('c1'),
      status('c2'),
      status('c3', { isStarred: true }),
      status('c4'),
      status('c5'),
    ],
  });

  const platform = result.find(s => s.name === 'Platform');
  assert.deepEqual(platform.channelIds, ['c1', 'c2']);
});

test('a project drops out when the starred filter takes it below the threshold', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p2'),
      channel('c4', 'p2'),
      channel('c5', 'p2'),
    ],
    statuses: [
      status('c1'),
      status('c2', { isStarred: true }),
      status('c3'),
      status('c4'),
      status('c5'),
    ],
  });

  assert.deepEqual(
    result.map(s => s.name),
    ['Infra'],
  );
});

test('excludes channels already in a section', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p1'),
      channel('c4', 'p2'),
      channel('c5', 'p2'),
    ],
    statuses: [
      status('c1'),
      status('c2'),
      status('c3', { sectionId: 'existing-section' }),
      status('c4'),
      status('c5'),
    ],
  });

  const platform = result.find(s => s.name === 'Platform');
  assert.deepEqual(platform.channelIds, ['c1', 'c2']);
});

test('excludes deleted statuses and channels with no status row', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p1'),
      channel('c4', 'p1'),
      channel('c5', 'p2'),
      channel('c6', 'p2'),
    ],
    statuses: [
      status('c1'),
      status('c2'),
      status('c3', { isDeleted: true }),
      status('c5'),
      status('c6'),
    ],
  });

  const platform = result.find(s => s.name === 'Platform');
  assert.deepEqual(platform.channelIds, ['c1', 'c2']);
});

test('excludes non-default scope channels', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p1', { scopeType: 'GROUP_DM' }),
      channel('c4', 'p2'),
      channel('c5', 'p2'),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4'), status('c5')],
  });

  const platform = result.find(s => s.name === 'Platform');
  assert.deepEqual(platform.channelIds, ['c1', 'c2']);
});

test('excludes desk channel types', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p1', { type: 'EMAIL' }),
      channel('c4', 'p1', { type: 'SLACK' }),
      channel('c5', 'p2'),
      channel('c6', 'p2'),
    ],
    statuses: [
      status('c1'),
      status('c2'),
      status('c3'),
      status('c4'),
      status('c5'),
      status('c6'),
    ],
  });

  const platform = result.find(s => s.name === 'Platform');
  assert.deepEqual(platform.channelIds, ['c1', 'c2']);
});

test('excludes the DM project', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('dm', 'Direct Messages', 'DM')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'dm'),
      channel('c4', 'dm'),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4')],
  });

  assert.deepEqual(
    result.map(s => s.name),
    ['Platform'],
  );
});

test('drops groups below the minimum channel threshold', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [channel('c1', 'p1'), channel('c2', 'p1'), channel('c3', 'p2')],
    statuses: [status('c1'), status('c2'), status('c3')],
  });

  assert.deepEqual(
    result.map(s => s.name),
    ['Platform'],
  );
});

test('honours a custom minimum channel threshold', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p1'),
      channel('c4', 'p2'),
      channel('c5', 'p2'),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4'), status('c5')],
    minChannels: 3,
  });

  assert.deepEqual(
    result.map(s => s.name),
    ['Platform'],
  );
});

test('skips a project whose name collides with an existing section', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p2'),
      channel('c4', 'p2'),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4')],
    existingSectionNames: ['  platform '],
  });

  assert.deepEqual(
    result.map(s => s.name),
    ['Infra'],
  );
});

test('suggests only the first of two projects sharing a name', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'platform')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p1'),
      channel('c4', 'p2'),
      channel('c5', 'p2'),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4'), status('c5')],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'p1');
});

test('truncates long project names to the dialog limit', () => {
  const longName = 'x'.repeat(80);
  const result = compute({
    projects: [project('p1', longName), project('p2', 'Infra')],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p2'),
      channel('c4', 'p2'),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4')],
  });

  const truncated = result.find(s => s.id === 'p1');
  assert.equal(truncated.name.length, 50);
});

test('returns nothing when a single project holds every candidate channel', () => {
  const result = compute({
    projects: [project('p1', 'Platform')],
    channels: Array.from({ length: 14 }, (_, i) => channel(`c${i}`, 'p1')),
    statuses: Array.from({ length: 14 }, (_, i) => status(`c${i}`)),
  });

  assert.deepEqual(result, []);
});

test('suggests a dominant project when other candidates remain outside it', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      ...Array.from({ length: 10 }, (_, i) => channel(`a${i}`, 'p1')),
      channel('b1', 'p2'),
    ],
    statuses: [...Array.from({ length: 10 }, (_, i) => status(`a${i}`)), status('b1')],
  });

  assert.deepEqual(
    result.map(s => s.name),
    ['Platform'],
  );
});

test('still suggests a dominant project when a second viable project exists', () => {
  const result = compute({
    projects: [project('p1', 'Platform'), project('p2', 'Infra')],
    channels: [
      ...Array.from({ length: 9 }, (_, i) => channel(`a${i}`, 'p1')),
      channel('b1', 'p2'),
      channel('b2', 'p2'),
    ],
    statuses: [
      ...Array.from({ length: 9 }, (_, i) => status(`a${i}`)),
      status('b1'),
      status('b2'),
    ],
  });

  assert.deepEqual(
    result.map(s => s.name),
    ['Platform', 'Infra'],
  );
});

test('returns nothing when there are no candidate channels', () => {
  const result = compute({
    projects: [project('p1', 'Platform')],
    channels: [channel('c1', 'p1'), channel('c2', 'p1')],
    statuses: [status('c1', { isStarred: true }), status('c2', { sectionId: 's1' })],
  });

  assert.deepEqual(result, []);
});

test('orders suggestions by channel count then name', () => {
  const result = compute({
    projects: [
      project('p1', 'Beta'),
      project('p2', 'Alpha'),
      project('p3', 'Gamma'),
      project('p4', 'Delta'),
    ],
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      channel('c3', 'p2'),
      channel('c4', 'p2'),
      channel('c5', 'p3'),
      channel('c6', 'p3'),
      channel('c7', 'p3'),
      channel('c8', 'p4'),
      channel('c9', 'p4'),
      channel('c10', 'p4'),
    ],
    statuses: Array.from({ length: 10 }, (_, i) => status(`c${i + 1}`)),
  });

  assert.deepEqual(
    result.map(s => s.name),
    ['Delta', 'Gamma', 'Alpha', 'Beta'],
  );
});

import {
  computeActivitySectionSuggestions,
  clampActiveWindowDays,
} from '../dist/channelSectionSuggestions.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = n => NOW - n * DAY;

const activityChannel = (id, lastActivityAt) => channel(id, 'p1', { lastActivityAt });

const computeActivity = ({ channels, statuses, existingSectionNames = [], ...rest }) =>
  computeActivitySectionSuggestions({
    channels,
    statuses,
    existingSectionNames,
    nowMs: NOW,
    ...rest,
  });

test('splits candidates into Active and Quiet', () => {
  const result = computeActivity({
    channels: [
      activityChannel('c1', daysAgo(1)),
      activityChannel('c2', daysAgo(5)),
      activityChannel('c3', daysAgo(90)),
      activityChannel('c4', daysAgo(200)),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4')],
  });

  assert.deepEqual(
    result.map(s => s.kind),
    ['active', 'dormant'],
  );
  assert.deepEqual(result[0].channelIds, ['c1', 'c2']);
  assert.deepEqual(result[1].channelIds, ['c3', 'c4']);
  assert.equal(result[0].name, 'Active');
  assert.equal(result[1].name, 'Quiet');
});

test('respects a custom activity window', () => {
  const channels = [
    activityChannel('c1', daysAgo(1)),
    activityChannel('c2', daysAgo(3)),
    activityChannel('c3', daysAgo(40)),
    activityChannel('c4', daysAgo(50)),
  ];
  const statuses = [status('c1'), status('c2'), status('c3'), status('c4')];

  const wide = computeActivity({ channels, statuses, activeWindowDays: 60 });
  assert.deepEqual(wide, []);

  const narrow = computeActivity({ channels, statuses, activeWindowDays: 7 });
  assert.deepEqual(narrow.find(s => s.kind === 'active').channelIds, ['c1', 'c2']);
  assert.deepEqual(narrow.find(s => s.kind === 'dormant').channelIds, ['c3', 'c4']);
});

test('treats a missing lastActivityAt as dormant', () => {
  const result = computeActivity({
    channels: [
      activityChannel('c1', daysAgo(1)),
      activityChannel('c2', daysAgo(2)),
      channel('c3', 'p1'),
      channel('c4', 'p1'),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4')],
  });

  assert.deepEqual(result.find(s => s.kind === 'dormant').channelIds, ['c3', 'c4']);
});

test('drops an activity bucket below the minimum', () => {
  const result = computeActivity({
    channels: [
      activityChannel('c1', daysAgo(1)),
      activityChannel('c2', daysAgo(2)),
      activityChannel('c3', daysAgo(2)),
      activityChannel('c4', daysAgo(300)),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4')],
  });

  assert.deepEqual(
    result.map(s => s.kind),
    ['active'],
  );
});

test('skips an activity bucket whose name is taken', () => {
  const result = computeActivity({
    channels: [
      activityChannel('c1', daysAgo(1)),
      activityChannel('c2', daysAgo(2)),
      activityChannel('c3', daysAgo(300)),
      activityChannel('c4', daysAgo(400)),
    ],
    statuses: [status('c1'), status('c2'), status('c3'), status('c4')],
    existingSectionNames: ['  active '],
  });

  assert.deepEqual(
    result.map(s => s.kind),
    ['dormant'],
  );
});

test('excludes starred, deleted and already sectioned channels from activity buckets', () => {
  const result = computeActivity({
    channels: [
      activityChannel('c1', daysAgo(1)),
      activityChannel('c2', daysAgo(1)),
      activityChannel('c3', daysAgo(1)),
    ],
    statuses: [
      status('c1'),
      status('c2', { isStarred: true }),
      status('c3', { sectionId: 'existing' }),
    ],
  });

  assert.deepEqual(result, []);
});

test('clamps the activity window to the supported range', () => {
  assert.equal(clampActiveWindowDays(0), 1);
  assert.equal(clampActiveWindowDays(-5), 1);
  assert.equal(clampActiveWindowDays(10_000), 365);
  assert.equal(clampActiveWindowDays(Number.NaN), 30);
  assert.equal(clampActiveWindowDays(45.4), 45);
});

import { computeDmSectionSuggestions } from '../dist/channelSectionSuggestions.js';

const botDm = id => channel(id, 'dmProject', { scopeType: 'DM', isBotDm: true });
const humanDm = id => channel(id, 'dmProject', { scopeType: 'DM' });
const groupDm = id => channel(id, 'dmProject', { scopeType: 'GROUP_DM' });

const computeDm = ({ channels, statuses, existingSectionNames = [], ...rest }) =>
  computeDmSectionSuggestions({ channels, statuses, existingSectionNames, ...rest });

test('suggests Apps & Bots and Group DMs, leaving human DMs alone', () => {
  const result = computeDm({
    channels: [
      botDm('b1'),
      botDm('b2'),
      groupDm('g1'),
      groupDm('g2'),
      humanDm('h1'),
      humanDm('h2'),
    ],
    statuses: ['b1', 'b2', 'g1', 'g2', 'h1', 'h2'].map(id => status(id)),
  });

  assert.deepEqual(
    result.map(s => s.kind),
    ['bots', 'groupDms'],
  );
  assert.equal(result[0].name, 'Apps & Bots');
  assert.equal(result[1].name, 'Group DMs');
  assert.deepEqual(result[0].channelIds, ['b1', 'b2']);
  assert.deepEqual(result[1].channelIds, ['g1', 'g2']);

  const filed = result.flatMap(s => s.channelIds);
  assert.equal(filed.includes('h1'), false);
  assert.equal(filed.includes('h2'), false);
});

test('a group DM is never counted as a bot DM', () => {
  const result = computeDm({
    channels: [
      channel('g1', 'dmProject', { scopeType: 'GROUP_DM', isBotDm: true }),
      channel('g2', 'dmProject', { scopeType: 'GROUP_DM', isBotDm: true }),
      humanDm('h1'),
      humanDm('h2'),
    ],
    statuses: ['g1', 'g2', 'h1', 'h2'].map(id => status(id)),
  });

  assert.deepEqual(
    result.map(s => s.kind),
    ['groupDms'],
  );
  assert.deepEqual(result[0].channelIds, ['g1', 'g2']);
});

test('ignores regular channels in DM mode', () => {
  const result = computeDm({
    channels: [
      channel('c1', 'p1'),
      channel('c2', 'p1'),
      botDm('b1'),
      botDm('b2'),
      groupDm('g1'),
      groupDm('g2'),
    ],
    statuses: ['c1', 'c2', 'b1', 'b2', 'g1', 'g2'].map(id => status(id)),
  });

  const filed = result.flatMap(s => s.channelIds);
  assert.equal(filed.includes('c1'), false);
  assert.equal(filed.includes('c2'), false);
  assert.deepEqual(filed, ['b1', 'b2', 'g1', 'g2']);
});

test('excludes starred, deleted and already sectioned DMs', () => {
  const result = computeDm({
    channels: [botDm('b1'), botDm('b2'), botDm('b3'), groupDm('g1'), groupDm('g2')],
    statuses: [
      status('b1'),
      status('b2', { isStarred: true }),
      status('b3', { sectionId: 'existing' }),
      status('g1'),
      status('g2'),
    ],
  });

  assert.deepEqual(
    result.map(s => s.kind),
    ['groupDms'],
  );
});

test('skips a DM bucket whose name is already taken', () => {
  const result = computeDm({
    channels: [botDm('b1'), botDm('b2'), groupDm('g1'), groupDm('g2')],
    statuses: ['b1', 'b2', 'g1', 'g2'].map(id => status(id)),
    existingSectionNames: ['apps & bots'],
  });

  assert.deepEqual(
    result.map(s => s.kind),
    ['groupDms'],
  );
});

test('suppresses a lone DM bucket that covers every DM candidate', () => {
  const result = computeDm({
    channels: [botDm('b1'), botDm('b2')],
    statuses: ['b1', 'b2'].map(id => status(id)),
  });

  assert.deepEqual(result, []);
});
