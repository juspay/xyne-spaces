import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_INDEX, searchSettings } from '../settingsSearch';
import type { PreferenceSection } from '..';

const ALL_SECTIONS: Record<PreferenceSection, string> = {
  appearance: 'Appearance',
  notifications: 'Notifications',
  availability: 'Availability',
  voice: 'Voice',
  calls: 'Calls',
  recordings: 'Recordings',
  messaging: 'Messaging',
  browser: 'Browser',
  launch: 'Launch',
  toolbar: 'Toolbar',
  inbox: 'Inbox',
  channelTabs: 'Channel tabs',
  messageActions: 'Message actions',
  calendar: 'Calendar',
  password: 'Password',
  developer: 'Developer',
};

const labels = (
  query: string,
  sections: Partial<Record<PreferenceSection, string>> = ALL_SECTIONS,
) => searchSettings(query, sections).map(r => r.label);

describe('searchSettings', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(labels('')).toEqual([]);
    expect(labels('   ')).toEqual([]);
  });

  it('matches setting labels case-insensitively', () => {
    expect(labels('CAMERA')[0]).toBe('Join with camera turned off');
  });

  it('matches synonyms through keywords', () => {
    expect(labels('dark mode')).toEqual(['Theme']);
    expect(labels('mute')).toContain('Join with microphone turned off');
    expect(labels('vacation')).toEqual(['Pause ticket assignment']);
  });

  it('requires every term to match', () => {
    expect(labels('camera xyzzy')).toEqual([]);
  });

  it('lets terms span the setting and its section', () => {
    expect(labels('calls').length).toBeGreaterThan(3);
    expect(labels('calls camera')).toEqual(['Join with camera turned off']);
  });

  it('ranks label matches above description/keyword matches', () => {
    expect(labels('notification')[0]).toBe('Default notification level');
  });

  it('hides settings whose section is not available on this platform', () => {
    const { browser: _browser, ...noBrowser } = ALL_SECTIONS;
    expect(labels('picture in picture', noBrowser)).toEqual([]);
    expect(labels('picture in picture')).toEqual(['Picture in picture']);
  });
});

describe('SETTINGS_INDEX', () => {
  // Guard against copy drift: each anchor must still appear in the Preferences UI source,
  // otherwise clicking a result opens the section but cannot scroll to the row.
  const settingsDir = join(__dirname, '..', '..');
  const source = [
    ...readdirSync(join(settingsDir, 'Preferences')).map(f => join(settingsDir, 'Preferences', f)),
    ...readdirSync(settingsDir).map(f => join(settingsDir, f)),
  ]
    .filter(f => f.endsWith('.tsx'))
    .map(f => readFileSync(f, 'utf8'))
    .join('\n')
    .replace(/\s+/g, ' ');

  it.each(SETTINGS_INDEX.map(e => [e.label, e] as const))(
    '"%s" anchors exist in the UI',
    (_, e) => {
      const anchors = e.anchors ?? [e.label];
      expect(anchors.some(a => source.includes(a))).toBe(true);
    },
  );

  it('covers every section', () => {
    const covered = new Set(SETTINGS_INDEX.map(e => e.section));
    for (const section of Object.keys(ALL_SECTIONS)) expect(covered).toContain(section);
  });
});
