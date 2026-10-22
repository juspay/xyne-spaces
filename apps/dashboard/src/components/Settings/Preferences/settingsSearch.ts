import type { PreferenceSection } from '.';

/**
 * One searchable setting inside the Preferences modal.
 *
 * `label` is what the search result shows. `anchors` are visible text fragments used to
 * find the row once its section is rendered, so the modal can scroll to it; they default
 * to `[label]`. Keep them in sync with the copy in Preferences.tsx — the
 * settingsSearch test fails if an anchor no longer appears in the source.
 */
export interface SettingsSearchEntry {
  section: PreferenceSection;
  label: string;
  description?: string;
  keywords?: string[];
  anchors?: string[];
}

export const SETTINGS_INDEX: SettingsSearchEntry[] = [
  // Appearance
  {
    section: 'appearance',
    label: 'Theme',
    description: 'Classic, Summer Breeze or Midnight',
    keywords: ['dark mode', 'light mode', 'colour', 'color', 'night'],
    anchors: ['Summer Breeze'],
  },

  // Notifications
  {
    section: 'notifications',
    label: 'Default notification level',
    description: 'Desktop and mobile notifications',
    keywords: ['alerts', 'push', 'mute', 'all messages', 'mentions only'],
  },
  {
    section: 'notifications',
    label: '@channel and @here mentions',
    description: 'Receive notifications for channel-wide mentions',
    keywords: ['alerts'],
  },
  {
    section: 'notifications',
    label: 'Thread reply notifications',
    description: 'Receive notifications for replies in threads you follow',
    keywords: ['alerts', 'replies'],
  },
  {
    section: 'notifications',
    label: 'Keywords',
    description: 'Get notified when a message contains a keyword',
    keywords: ['alerts', 'highlight words', 'watch words'],
  },

  // Availability
  {
    section: 'availability',
    label: 'Pause ticket assignment',
    description: 'Stop receiving new ticket assignments',
    keywords: ['away', 'leave', 'vacation', 'out of office', 'ooo', 'round robin'],
    anchors: ['ticket assignment'],
  },

  // Voice
  {
    section: 'voice',
    label: 'Voice Signature',
    description: 'Record your voice so meetings can identify you',
    keywords: ['speaker', 'transcript', 'diarization'],
  },

  // Calls
  {
    section: 'calls',
    label: 'Join with microphone turned off',
    keywords: ['mute', 'mic', 'audio'],
  },
  {
    section: 'calls',
    label: 'Join with camera turned off',
    description: 'Disable your camera when joining a call',
    keywords: ['video', 'webcam'],
  },
  {
    section: 'calls',
    label: 'Call media quality',
    description: 'Video and screen-share capture quality',
    keywords: ['resolution', 'hd', '1080p', '720p', 'bandwidth', 'screen share'],
  },
  {
    section: 'calls',
    label: 'Use new calls experience',
    description: 'Switch between the classic and redesigned calls list',
    keywords: ['beta', 'v2'],
  },
  {
    section: 'calls',
    label: 'Open calls in a separate window',
    keywords: ['pop out', 'window'],
  },
  {
    section: 'calls',
    label: 'Menu bar / system tray icon',
    keywords: ['tray', 'menubar'],
    anchors: ['Menu bar icon', 'System tray icon'],
  },
  {
    section: 'calls',
    label: 'Floating recording pill',
    keywords: ['recording indicator'],
  },
  {
    section: 'calls',
    label: 'Meeting Detection',
    keywords: ['auto record', 'zoom', 'google meet'],
  },
  {
    section: 'calls',
    label: 'Disconnect Calendar',
    description: 'Stops calendar sync and clears the stored connection',
    keywords: ['google calendar', 'revoke'],
  },

  // Recordings
  {
    section: 'recordings',
    label: 'Use new recording experience',
    keywords: ['beta', 'v2'],
  },
  {
    section: 'recordings',
    label: 'LLM summary generation model',
    keywords: ['ai model', 'meeting summary', 'gpt', 'claude'],
  },
  {
    section: 'recordings',
    label: 'Default summary template',
    keywords: ['meeting notes', 'summary format'],
  },

  // Messaging
  {
    section: 'messaging',
    label: 'Press Enter to send or add a new line',
    keywords: ['enter key', 'shift enter', 'send message', 'newline', 'keyboard'],
    anchors: ['When writing a message, press'],
  },
  {
    section: 'messaging',
    label: 'Open formatting by default',
    description: 'Show the formatting toolbar automatically in message composers',
    keywords: ['rich text', 'bold', 'markdown', 'composer'],
  },
  {
    section: 'messaging',
    label: 'Allow @channel/@here in thread replies',
    keywords: ['mentions'],
  },
  {
    section: 'messaging',
    label: 'Show thread tags',
    keywords: ['labels'],
  },
  {
    section: 'messaging',
    label: 'Open links in external browser',
    keywords: ['urls', 'chrome', 'safari'],
  },
  {
    section: 'messaging',
    label: 'Suggest related conversations',
    description: 'Show related threads, tickets, canvases and calls while you write',
    keywords: ['related context', 'suggestions'],
  },

  // Browser (Electron only — the modal drops it elsewhere)
  { section: 'browser', label: 'Home page', keywords: ['start page', 'new tab'] },
  { section: 'browser', label: 'Picture in picture', keywords: ['pip', 'video'] },
  { section: 'browser', label: 'Browsing history', keywords: ['history'] },
  { section: 'browser', label: 'Clear site data', keywords: ['cookies', 'cache'] },
  { section: 'browser', label: 'Import sign-ins', keywords: ['passwords', 'login', 'chrome'] },

  // Launch
  {
    section: 'launch',
    label: 'Open AI on launch',
    description: 'Start with the Xyne AI landing page instead of chat',
    keywords: ['startup', 'home'],
  },
  {
    section: 'launch',
    label: 'Collapse sidebar for apps',
    keywords: ['hide sidebar'],
  },
  {
    section: 'launch',
    label: 'Open workspace automatically',
    keywords: ['side panel', 'artifacts'],
  },
  { section: 'launch', label: 'Morning brief', keywords: ['daily brief', 'digest'] },
  { section: 'launch', label: 'Claw', keywords: ['overlay', 'assistant'] },

  // Toolbar / Inbox / Channel tabs / Message actions
  {
    section: 'toolbar',
    label: 'Sidebar items',
    description: 'Choose what appears in your sidebar and in what order',
    keywords: ['reorder', 'hide', 'navigation', 'more menu'],
    anchors: ['Choose what appears in your sidebar'],
  },
  {
    section: 'inbox',
    label: 'Inbox shortcuts',
    description: 'The shortcuts above your channel list in Chat',
    keywords: ['reorder', 'hide'],
    anchors: ['The shortcuts above your channel list'],
  },
  {
    section: 'channelTabs',
    label: 'Channel tabs',
    description: 'Choose which tabs show in a channel',
    keywords: ['apps', 'tab bar', 'reorder'],
    anchors: ['Tabs are per channel'],
  },
  {
    section: 'messageActions',
    label: 'Message hover actions',
    description: 'The bar that appears when you hover a message',
    keywords: ['reactions', 'reply', 'toolbar', 'quick actions'],
    anchors: ['The bar that appears when you hover a message'],
  },

  // Calendar
  {
    section: 'calendar',
    label: 'Calendar visibility',
    description: 'Make your calendar visible to others',
    keywords: ['availability', 'free busy', 'schedule', 'privacy'],
  },

  // Password
  {
    section: 'password',
    label: 'Change password',
    keywords: ['reset', 'security', 'login'],
    anchors: ['Manage your account password'],
  },

  // Developer
  { section: 'developer', label: 'Show send indicators', keywords: ['debug'] },
  { section: 'developer', label: 'Streams', keywords: ['deck', 'beta'] },
  { section: 'developer', label: 'Screen actions', keywords: ['auto', 'automation'] },
  { section: 'developer', label: 'Intent suggestions', keywords: ['ai', 'model'] },
  {
    section: 'developer',
    label: 'Changelog',
    keywords: ['version', 'release notes', "what's new"],
  },
];

export interface SettingsSearchResult extends SettingsSearchEntry {
  /** Lower is better. */
  score: number;
  labelParts: Array<{ text: string; match: boolean }>;
}

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@/]+/g, ' ')
    .trim();

const startsWord = (text: string, term: string): boolean =>
  text.startsWith(term) || text.includes(` ${term}`);

/**
 * Rank settings for `query`. Every whitespace-separated term must match somewhere
 * (label, keywords, section name or description). Label hits rank above keyword hits,
 * which rank above section-name and description hits. A term matches from the start of a
 * word, except that four or more letters also match inside a word; section names and
 * descriptions need at least three letters. Results come grouped by section, the
 * section with the best hit first. Settings whose section is absent from `sectionLabels`
 * (hidden on this platform) are never returned.
 */
export const searchSettings = (
  query: string,
  sectionLabels: Partial<Record<PreferenceSection, string>>,
  index: SettingsSearchEntry[] = SETTINGS_INDEX,
): SettingsSearchResult[] => {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(' ');

  const results: SettingsSearchResult[] = [];
  index.forEach((entry, order) => {
    const sectionLabel = sectionLabels[entry.section];
    if (sectionLabel === undefined) return;

    const label = normalize(entry.label);
    const section = normalize(sectionLabel);
    const keywords = normalize((entry.keywords ?? []).join(' '));
    const description = normalize(entry.description ?? '');

    let score = 0;
    for (const term of terms) {
      const inner = term.length >= 4;
      if (startsWord(label, term)) score += 0;
      else if (inner && label.includes(term)) score += 1;
      else if (startsWord(keywords, term)) score += 2;
      else if (term.length >= 3 && (startsWord(section, term) || startsWord(description, term)))
        score += 3;
      else if (inner && (keywords.includes(term) || description.includes(term))) score += 4;
      else return;
    }

    const lower = entry.label.toLowerCase();
    const hits = new Array<boolean>(lower.length).fill(false);
    for (const term of terms) {
      for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + 1)) {
        if (term.length >= 4 || !/[a-z0-9]/.test(lower[at - 1] ?? '')) {
          hits.fill(true, at, at + term.length);
        }
      }
    }
    const labelParts: SettingsSearchResult['labelParts'] = [];
    hits.forEach((match, i) => {
      const last = labelParts[labelParts.length - 1];
      if (last?.match === match) last.text += entry.label[i] ?? '';
      else labelParts.push({ text: entry.label[i] ?? '', match });
    });

    // Stable tie-break on index order (which follows the nav order).
    results.push({ ...entry, score: score * 1000 + order, labelParts });
  });

  results.sort((a, b) => a.score - b.score);
  const sectionOrder = [...new Set(results.map(result => result.section))];
  return results.sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section));
};

/**
 * Find the rendered row for `entry` inside `container`, matching visible text against
 * its anchors. Returns the nearest card-like ancestor so the highlight covers the row.
 */
export const findSettingElement = (
  container: HTMLElement,
  entry: SettingsSearchEntry,
): HTMLElement | null => {
  const anchors = (entry.anchors ?? [entry.label]).map(a => a.toLowerCase());
  const candidates = Array.from(container.querySelectorAll<HTMLElement>('p, span, label'));
  for (const anchor of anchors) {
    for (const el of candidates) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.includes(anchor)) {
        const card = el.closest<HTMLElement>('.rounded-lg');
        return card && card !== container && container.contains(card) ? card : el;
      }
    }
  }
  return null;
};
