import { describe, expect, it } from 'vitest';
import { ChannelScopeType } from '@xyne/shared';
import {
  getChannelSortName,
  isSelfDMChannel,
  pinSelfDMLast,
  sortChannelsAlphabetically,
} from '../ChatDirectory.utils';

const ME = 'cm_me';
// Ids deliberately ordered opposite to names: id order is zara < aman.
const ZARA = 'cm_a_zara';
const AMAN = 'cm_z_aman';
const BHAVYA = 'cm_m_bhavya';

const usersById = new Map([
  [ME, { name: 'Tanmay Shree', displayName: null }],
  [ZARA, { name: 'Zara Khan', displayName: null }],
  [AMAN, { name: 'Aman Gupta', displayName: 'aman' }],
  [BHAVYA, { name: 'Bhavya Rao', displayName: null }],
]);

type TestChannel = { id: string; name: string; scopeType: ChannelScopeType };

const dm = (
  id: string,
  others: string[],
  scopeType: ChannelScopeType = ChannelScopeType.DM,
): TestChannel => ({
  id,
  name: [ME, ...others].sort().join(','),
  scopeType,
});
const selfDm: TestChannel = { id: 'self', name: ME, scopeType: ChannelScopeType.DM };
const channel = (id: string, name: string): TestChannel => ({
  id,
  name,
  scopeType: ChannelScopeType.DEFAULT,
});

describe('DM alphabetical sort', () => {
  it('sorts 1:1 DMs by the other participant name, not by participant ids', () => {
    const list = [dm('dm-zara', [ZARA]), dm('dm-aman', [AMAN])];
    // Raw names would put Zara first because her id sorts lower.
    expect(sortChannelsAlphabetically(list, ME, usersById).map(c => c.id)).toEqual([
      'dm-aman',
      'dm-zara',
    ]);
  });

  it('prefers displayName and is case-insensitive', () => {
    expect(getChannelSortName(dm('dm-aman', [AMAN]), ME, usersById)).toBe('aman');
    const list = [dm('dm-bhavya', [BHAVYA]), dm('dm-aman', [AMAN])];
    expect(sortChannelsAlphabetically(list, ME, usersById).map(c => c.id)).toEqual([
      'dm-aman',
      'dm-bhavya',
    ]);
  });

  it('sorts group DMs by their joined participant names', () => {
    const group = dm('group', [ZARA, BHAVYA], ChannelScopeType.GROUP_DM);
    expect(getChannelSortName(group, ME, usersById)).toBe('Zara Khan, Bhavya Rao');
    const list = [group, dm('dm-aman', [AMAN])];
    expect(sortChannelsAlphabetically(list, ME, usersById).map(c => c.id)).toEqual([
      'dm-aman',
      'group',
    ]);
  });

  it('falls back to the raw name when participants have not synced yet', () => {
    expect(getChannelSortName(dm('dm-x', ['cm_unknown']), ME, usersById)).toBe(
      ['cm_unknown', ME].sort().join(','),
    );
  });

  it('leaves regular channels sorted by channel name', () => {
    const list = [channel('c2', 'Zeta'), channel('c1', 'alpha')];
    expect(sortChannelsAlphabetically(list, ME, usersById).map(c => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('self DM placement', () => {
  it('detects only the current user’s own DM', () => {
    expect(isSelfDMChannel(selfDm, ME)).toBe(true);
    expect(isSelfDMChannel(dm('dm-aman', [AMAN]), ME)).toBe(false);
    expect(isSelfDMChannel(channel('c', ME), ME)).toBe(false);
  });

  it('pins the self DM last while keeping the rest in order', () => {
    const list = [selfDm, dm('dm-zara', [ZARA]), dm('dm-aman', [AMAN])];
    expect(pinSelfDMLast(list, ME).map(c => c.id)).toEqual(['dm-zara', 'dm-aman', 'self']);
  });

  it('keeps the self DM last after an alphabetical sort (own name would sort mid-list)', () => {
    const list = [selfDm, dm('dm-zara', [ZARA]), dm('dm-aman', [AMAN])];
    const sorted = pinSelfDMLast(sortChannelsAlphabetically(list, ME, usersById), ME);
    expect(sorted.map(c => c.id)).toEqual(['dm-aman', 'dm-zara', 'self']);
  });

  it('is a no-op when there is no self DM', () => {
    const list = [dm('dm-zara', [ZARA])];
    expect(pinSelfDMLast(list, ME)).toEqual(list);
  });
});
