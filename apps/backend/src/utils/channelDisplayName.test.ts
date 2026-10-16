import { ChannelScopeType } from '@xyne/shared';
import {
  isDMScope,
  parseDMParticipantIds,
  resolveChannelMentionLabel,
  formatMentionLocation,
} from './channelDisplayName';

const names = new Map<string, string>([
  ['u1', 'Alice'],
  ['u2', 'Bob'],
  ['u3', 'Carol'],
  ['u4', 'Dave'],
  ['u5', 'Erin'],
]);

describe('channelDisplayName', () => {
  describe('isDMScope', () => {
    it('is true for DM and GROUP_DM only', () => {
      expect(isDMScope(ChannelScopeType.DM)).toBe(true);
      expect(isDMScope(ChannelScopeType.GROUP_DM)).toBe(true);
      expect(isDMScope(ChannelScopeType.DEFAULT)).toBe(false);
      expect(isDMScope(null)).toBe(false);
      expect(isDMScope(undefined)).toBe(false);
    });
  });

  describe('parseDMParticipantIds', () => {
    it('splits the id CSV for DM channels', () => {
      expect(parseDMParticipantIds('u1,u2,u3', ChannelScopeType.GROUP_DM)).toEqual(['u1', 'u2', 'u3']);
    });
    it('returns [] for a non-DM channel', () => {
      expect(parseDMParticipantIds('engineering', ChannelScopeType.DEFAULT)).toEqual([]);
    });
    it('tolerates spaces and empty segments', () => {
      expect(parseDMParticipantIds(' u1 , ,u2 ', ChannelScopeType.DM)).toEqual(['u1', 'u2']);
    });
  });

  describe('resolveChannelMentionLabel', () => {
    it('returns the raw name for a regular channel (caller prefixes #)', () => {
      expect(
        resolveChannelMentionLabel({
          scopeType: ChannelScopeType.DEFAULT,
          name: 'engineering',
          participantNames: names,
        }),
      ).toEqual({ label: 'engineering', isDm: false });
    });

    it('names a 1:1 DM after the other participant, not the id CSV', () => {
      expect(
        resolveChannelMentionLabel({
          scopeType: ChannelScopeType.DM,
          name: 'u1,u2',
          participantNames: names,
          viewerId: 'u1',
        }),
      ).toEqual({ label: 'Bob', isDm: true });
    });

    it('lists group-DM participant names excluding the viewer', () => {
      expect(
        resolveChannelMentionLabel({
          scopeType: ChannelScopeType.GROUP_DM,
          name: 'u1,u2,u3',
          participantNames: names,
          viewerId: 'u1',
        }),
      ).toEqual({ label: 'Bob, Carol', isDm: true });
    });

    it('summarises large group DMs as "and N others"', () => {
      expect(
        resolveChannelMentionLabel({
          scopeType: ChannelScopeType.GROUP_DM,
          name: 'u1,u2,u3,u4,u5',
          participantNames: names,
          viewerId: 'u1',
        }),
      ).toEqual({ label: 'Bob, Carol, Dave and 1 other', isDm: true });
    });

    it('falls back to a neutral phrase when names are unresolved — never a cuid', () => {
      const label = resolveChannelMentionLabel({
        scopeType: ChannelScopeType.GROUP_DM,
        name: 'ck1,ck2,ck3',
        participantNames: new Map(),
        viewerId: 'ck1',
      });
      expect(label.isDm).toBe(true);
      expect(label.label).toBe('a direct message');
      expect(label.label).not.toContain('ck2');
    });

    it('handles a self-DM', () => {
      expect(
        resolveChannelMentionLabel({
          scopeType: ChannelScopeType.DM,
          name: 'u1',
          participantNames: names,
          viewerId: 'u1',
        }),
      ).toEqual({ label: 'Alice (you)', isDm: true });
    });
  });

  describe('formatMentionLocation', () => {
    it('prefixes # for regular channels', () => {
      expect(
        formatMentionLocation({
          scopeType: ChannelScopeType.DEFAULT,
          name: 'engineering',
          participantNames: names,
        }),
      ).toBe('#engineering');
    });
    it('does NOT prefix # for DMs', () => {
      expect(
        formatMentionLocation({
          scopeType: ChannelScopeType.GROUP_DM,
          name: 'u1,u2,u3',
          participantNames: names,
          viewerId: 'u1',
        }),
      ).toBe('Bob, Carol');
    });
  });
});
