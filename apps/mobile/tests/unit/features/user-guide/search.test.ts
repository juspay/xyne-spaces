import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countGuides,
  filterGuidesForAccess,
  findGuideById,
  getBrowseSections,
  getGuidesInCategory,
  getNextGuideInCategory,
  getPositionInCategory,
  getRelatedGuides,
  getStartHereGuides,
  groupGuidesByCategory,
  isGuideCategoryId,
} from '@/src/features/user-guide/catalog-utils';
import { normalizeGuideQuery, searchGuides } from '@/src/features/user-guide/search';
import type { MobileGuide } from '@/src/features/user-guide/types';

const guide = (overrides: Partial<MobileGuide> & Pick<MobileGuide, 'id'>): MobileGuide => ({
  title: overrides.id,
  tagline: '',
  category: 'messaging',
  icon: 'Info',
  findIn: ['More'],
  steps: ['Tap one.', 'Tap two.', 'Tap three.'],
  keywords: [],
  priority: 'P1',
  ...overrides,
});

const FIXTURE: MobileGuide[] = [
  guide({ id: 'sign-in', title: 'Sign in', category: 'start', priority: 'P0' }),
  guide({
    id: 'gestures',
    title: 'Gestures you should know',
    category: 'start',
    priority: 'P0',
    keywords: ['swipe'],
  }),
  guide({ id: 'sos', title: 'What an SOS alert looks like', category: 'start' }),
  guide({
    id: 'reminders',
    title: 'Bookmarks and reminders',
    tagline: 'Save a message for later',
    keywords: ['remind', 'snooze'],
    priority: 'P0',
    steps: ['Long-press a message.', 'Tap "Remind me".', 'Pick "Tomorrow morning".'],
    related: ['gestures', 'missing'],
  }),
  guide({ id: 'drafts', title: 'Drafts', category: 'messaging' }),
  guide({
    id: 'tickets',
    title: 'Tickets',
    category: 'work',
    requires: 'tickets',
    keywords: ['ticket'],
  }),
  guide({
    id: 'share',
    title: 'Share into Xyne from other apps',
    category: 'you',
    keywords: ['share sheet', 'photo'],
    steps: ['Tap Share.', 'Pick a chat.', 'Add a caption.', 'Send.'],
  }),
];

describe('normalizeGuideQuery', () => {
  it('trims, lowercases and collapses whitespace', () => {
    assert.equal(normalizeGuideQuery('  Share   A Photo '), 'share a photo');
  });
});

describe('searchGuides', () => {
  it('returns the catalog unchanged for an empty query', () => {
    assert.deepEqual(
      searchGuides(FIXTURE, '   ').map(g => g.id),
      FIXTURE.map(g => g.id),
    );
  });

  it('is case-insensitive and ranks title matches first', () => {
    const ids = searchGuides(FIXTURE, 'REMINDERS').map(g => g.id);
    assert.equal(ids[0], 'reminders');
  });

  it('matches keywords and step text', () => {
    assert.deepEqual(
      searchGuides(FIXTURE, 'snooze').map(g => g.id),
      ['reminders'],
    );
    assert.deepEqual(
      searchGuides(FIXTURE, 'tomorrow morning').map(g => g.id),
      ['reminders'],
    );
  });

  it('matches multi-word queries across fields', () => {
    const ids = searchGuides(FIXTURE, 'share a photo').map(g => g.id);
    assert.equal(ids[0], 'share');
  });

  it('drops guides that match nothing', () => {
    assert.deepEqual(searchGuides(FIXTURE, 'zzzz'), []);
  });
});

describe('catalog utils', () => {
  it('hides permission-gated guides when access is missing', () => {
    const withoutTickets = filterGuidesForAccess(FIXTURE, { canReadTickets: false });
    assert.ok(!withoutTickets.some(g => g.id === 'tickets'));
    const withTickets = filterGuidesForAccess(FIXTURE, { canReadTickets: true });
    assert.ok(withTickets.some(g => g.id === 'tickets'));
  });

  it('finds guides by id and tolerates missing ids', () => {
    assert.equal(findGuideById(FIXTURE, 'share')?.id, 'share');
    assert.equal(findGuideById(FIXTURE, 'nope'), null);
    assert.equal(findGuideById(FIXTURE, undefined), null);
  });

  it('recognises topic ids', () => {
    assert.equal(isGuideCategoryId('messaging'), true);
    assert.equal(isGuideCategoryId('nope'), false);
    assert.equal(isGuideCategoryId(undefined), false);
  });

  it('reads the Start here path in catalog order', () => {
    assert.deepEqual(
      getStartHereGuides(FIXTURE).map(g => g.id),
      ['sign-in', 'gestures', 'sos'],
    );
  });

  it('groups by topic in fixed order and skips empty topics', () => {
    const sections = groupGuidesByCategory(FIXTURE);
    assert.deepEqual(
      sections.map(s => [s.category.id, s.guides.map(g => g.id)]),
      [
        ['start', ['sign-in', 'gestures', 'sos']],
        ['messaging', ['reminders', 'drafts']],
        ['work', ['tickets']],
        ['you', ['share']],
      ],
    );
  });

  it('leaves the Start here topic out of the browse list', () => {
    assert.deepEqual(
      getBrowseSections(FIXTURE).map(s => s.category.id),
      ['messaging', 'work', 'you'],
    );
    assert.deepEqual(
      getGuidesInCategory(FIXTURE, 'messaging').map(g => g.id),
      ['reminders', 'drafts'],
    );
  });

  it('walks to the next guide in the topic and stops at the end', () => {
    const reminders = findGuideById(FIXTURE, 'reminders');
    const drafts = findGuideById(FIXTURE, 'drafts');
    assert.ok(reminders && drafts);
    assert.equal(getNextGuideInCategory(FIXTURE, reminders)?.id, 'drafts');
    assert.equal(getNextGuideInCategory(FIXTURE, drafts), null);
    assert.deepEqual(getPositionInCategory(FIXTURE, drafts), { index: 2, total: 2 });
  });

  it('resolves related guides and ignores unknown ids', () => {
    const reminders = findGuideById(FIXTURE, 'reminders');
    assert.ok(reminders);
    assert.deepEqual(
      getRelatedGuides(FIXTURE, reminders).map(g => g.id),
      ['gestures'],
    );
  });

  it('counts guides', () => {
    assert.equal(countGuides(FIXTURE), 7);
  });
});
