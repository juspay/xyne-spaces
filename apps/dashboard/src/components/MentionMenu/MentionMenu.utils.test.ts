import { describe, expect, it } from 'vitest';
import type { Channel, MentionResult } from '@xyne/shared';
import type { DisplaySearchResult } from '../../types/search';
import {
  MENTION_SECTIONS,
  buildAllSections,
  channelRow,
  initialSection,
  messageTime,
  peopleSuggestions,
  personRow,
  plainText,
  resultKind,
  resultRow,
  resultRowsFor,
  resultTitle,
  sectionToTab,
  stepSection,
  uniqueRows,
} from './MentionMenu.utils';

const result = (
  over: Partial<DisplaySearchResult> & Pick<DisplaySearchResult, 'type' | 'id'>,
): DisplaySearchResult => ({
  title: '',
  subtitle: '',
  relevanceScore: 1,
  metadata: {},
  ...over,
});

const message = (id: string, text = 'hello'): DisplaySearchResult =>
  result({
    type: 'conversation',
    id,
    title: 'general',
    context: text,
    searchContext: { senderName: 'Emma Wu' },
  });

const file = (id: string, subApp?: string, fileName = `${id}.pdf`): DisplaySearchResult =>
  result({
    type: 'attachment',
    id,
    title: fileName,
    searchContext: { fileName, ...(subApp ? { subApp } : {}) },
  });

const ticket = (id: string): DisplaySearchResult =>
  result({ type: 'ticket', id, title: `Ticket ${id}`, searchContext: { xyneId: `XYS-${id}` } });

const user = (id: string, over: Partial<MentionResult> = {}): MentionResult => ({
  id,
  name: `User ${id}`,
  type: 'user',
  ...over,
});

const channel = (id: string): { channel: Channel; displayName: string } => ({
  channel: { id, name: `channel-${id}` } as Channel,
  displayName: `channel-${id}`,
});

describe('plainText', () => {
  it('drops highlight and HTML tags without splitting words', () => {
    expect(plainText('Take a <hi>Barc</hi>lays to <b>explore</b>')).toBe(
      'Take a Barclays to explore',
    );
  });

  it('decodes entities, and only once', () => {
    expect(plainText('a &amp; b &lt;c&gt; &quot;d&quot; it&#39;s &amp;lt;')).toBe(
      'a & b <c> "d" it\'s &lt;',
    );
  });

  it('collapses whitespace, breaks included', () => {
    expect(plainText('  one<br/>two</p><p>three \n\n four  ')).toBe('one two three four');
  });

  it('keeps line breaks when asked', () => {
    expect(plainText('one<br>two</p><p>three\n\n\n\nfour  five', true)).toBe(
      'one\ntwo\nthree\n\nfour five',
    );
  });

  it('is empty for nothing', () => {
    expect(plainText(undefined)).toBe('');
    expect(plainText('')).toBe('');
  });
});

describe('messageTime', () => {
  const local = new Date(2026, 2, 27, 21, 48);

  it('formats epoch milliseconds', () => {
    expect(messageTime(local.getTime())).toEqual({ date: '27 Mar 2026', time: '9:48 PM' });
  });

  it('reads epoch seconds as seconds', () => {
    expect(messageTime(local.getTime() / 1000)).toEqual({ date: '27 Mar 2026', time: '9:48 PM' });
  });

  it('is null when missing', () => {
    expect(messageTime(undefined)).toBeNull();
    expect(messageTime(0)).toBeNull();
    expect(messageTime(Number.NaN)).toBeNull();
  });
});

describe('sections', () => {
  it('maps each section to its search tab; apps is the menu’s own', () => {
    expect(MENTION_SECTIONS.map(sectionToTab)).toEqual([
      'all',
      'users',
      'channels',
      'messages',
      'attachments',
      'canvas',
      'tickets',
    ]);
    expect(sectionToTab('apps')).toBeNull();
  });

  it('opens on the requested tab, else the first offered', () => {
    expect(initialSection('people', MENTION_SECTIONS)).toBe('people');
    expect(initialSection('people', ['channels', 'messages'])).toBe('channels');
  });

  it('cycles tabs both ways, wrapping', () => {
    const sections = ['all', 'people', 'apps'] as const;
    expect(stepSection(sections, 'people', false)).toBe('apps');
    expect(stepSection(sections, 'apps', false)).toBe('all');
    expect(stepSection(sections, 'all', true)).toBe('apps');
    expect(stepSection(sections, 'channels', false)).toBe('all');
    expect(stepSection(sections, 'channels', true)).toBe('apps');
    expect(stepSection([], 'people', false)).toBe('people');
  });
});

describe('resultKind', () => {
  it('sorts indexed results into the kinds the menu lists', () => {
    expect(resultKind(message('m1'))).toBe('message');
    expect(resultKind(file('f1'))).toBe('file');
    expect(resultKind(file('c1', 'canvas'))).toBe('canvas');
    expect(resultKind(file('t1', 'Transcript'))).toBe('call');
    expect(resultKind(ticket('1'))).toBe('ticket');
  });

  it('leaves out what cannot be mentioned', () => {
    expect(
      resultKind(result({ type: 'conversation', id: 'x', searchContext: { subApp: 'DESK' } })),
    ).toBeNull();
    expect(resultKind(file('d', 'DESK'))).toBeNull();
    expect(resultKind(file('r', 'rca'))).toBeNull();
    expect(resultKind(file('n', undefined, ''))).toBeNull();
    expect(resultKind(result({ type: 'collection', id: 'k', title: 'KB' }))).toBeNull();
    expect(resultKind(result({ type: 'user', id: 'u', title: 'Emma' }))).toBeNull();
    expect(resultKind(result({ type: 'channel', id: 'c', title: '#general' }))).toBeNull();
  });
});

describe('resultTitle', () => {
  it('shows the message text, the file name, the ticket title', () => {
    expect(resultTitle(message('m', 'I <hi>added</hi> feedback'))).toBe('I added feedback');
    expect(resultTitle(file('f', undefined, 'Q3 &amp; Q4.pdf'))).toBe('Q3 & Q4.pdf');
    expect(resultTitle(ticket('9'))).toBe('Ticket 9');
    expect(
      resultTitle(result({ type: 'ticket', id: 't', searchContext: { xyneId: 'XYS-1' } })),
    ).toBe('XYS-1');
  });
});

describe('rows', () => {
  it('ids are unique per kind', () => {
    expect(personRow(user('1')).id).toBe('person:1');
    expect(channelRow(channel('1').channel, 'x').id).toBe('channel:1');
    expect(resultRow(message('1')).id).toBe('conversation:1');
  });

  it('uniqueRows keeps the first of each id', () => {
    const rows = uniqueRows([resultRow(message('1')), resultRow(message('1', 'again'))]);
    expect(rows).toHaveLength(1);
  });

  it('a single-kind tab lists only its kind; calls sit under Files', () => {
    const results = [message('m'), file('f'), file('t', 'TRANSCRIPT'), file('c', 'CANVAS')];
    expect(resultRowsFor('files', results).map(r => r.id)).toEqual([
      'attachment:f',
      'attachment:t',
    ]);
    expect(resultRowsFor('canvas', results).map(r => r.id)).toEqual(['attachment:c']);
    expect(resultRowsFor('messages', results).map(r => r.id)).toEqual(['conversation:m']);
  });
});

describe('buildAllSections', () => {
  const people = [
    user('1'),
    user('g', { type: 'group', alias: 'design' }),
    user('2'),
    user('3'),
    user('4'),
    user('5'),
  ];
  const channels = Array.from({ length: 10 }, (_, i) => channel(String(i)));

  it('before typing: up to 4 people (users only) and 8 channels, nothing from the index', () => {
    const groups = buildAllSections({
      people,
      channels,
      results: [message('m')],
      hasQuery: false,
    });
    expect(groups.map(g => g.section)).toEqual(['people', 'channels']);
    expect(groups[0]!.rows.map(r => r.id)).toEqual([
      'person:1',
      'person:2',
      'person:3',
      'person:4',
    ]);
    expect(groups[1]!.rows).toHaveLength(8);
  });

  it('with a query: 3 people, 3 channels, then messages, files, canvas, tickets', () => {
    const groups = buildAllSections({
      people,
      channels,
      results: [
        ticket('1'),
        file('c', 'CANVAS'),
        message('m'),
        file('f'),
        file('t', 'TRANSCRIPT'),
        file('d', 'DESK'),
        result({ type: 'user', id: 'u', title: 'Emma' }),
      ],
      hasQuery: true,
    });
    expect(groups.map(g => [g.section, g.rows.length])).toEqual([
      ['people', 3],
      ['channels', 3],
      ['messages', 1],
      ['files', 2],
      ['canvas', 1],
      ['tickets', 1],
    ]);
    // Groups count as people once something is typed.
    expect(groups[0]!.rows.map(r => r.id)).toContain('person:g');
  });

  it('leaves out empty groups and repeated hits', () => {
    const groups = buildAllSections({
      people: [],
      channels: [],
      results: [message('m'), message('m')],
      hasQuery: true,
    });
    expect(groups).toEqual([{ section: 'messages', rows: [resultRow(message('m'))] }]);
  });
});

describe('peopleSuggestions', () => {
  const person = (id: string, name = `Name ${id}`): { id: string; name: string } => ({ id, name });

  it('leads with recent DM partners, then everyone else, never yourself, each once', () => {
    const people = peopleSuggestions({
      recent: [person('me'), person('a'), person('b')],
      hits: [person('b'), person('me'), person('c')],
      selfId: 'me',
      hasQuery: false,
    });
    expect(people.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('with a query lists only the matches', () => {
    const people = peopleSuggestions({
      recent: [person('a')],
      hits: [person('c'), person('me')],
      selfId: 'me',
      hasQuery: true,
    });
    expect(people.map(p => p.id)).toEqual(['c']);
  });

  it('caps recents at 8 and the whole list at 25', () => {
    const many = (prefix: string, n: number): Array<{ id: string; name: string }> =>
      Array.from({ length: n }, (_, i) => person(`${prefix}${i}`));
    const people = peopleSuggestions({
      recent: many('r', 12),
      hits: many('h', 40),
      selfId: 'me',
      hasQuery: false,
    });
    expect(people).toHaveLength(25);
    expect(people.filter(p => p.id.startsWith('r'))).toHaveLength(8);
  });

  it('uses the display name and keeps the email', () => {
    expect(
      peopleSuggestions({
        recent: [],
        hits: [{ id: 'a', name: 'asha', displayName: 'Asha K', email: 'asha@x.io' }],
        selfId: 'me',
        hasQuery: true,
      }),
    ).toEqual([{ id: 'a', name: 'Asha K', type: 'user', email: 'asha@x.io' }]);
  });
});
