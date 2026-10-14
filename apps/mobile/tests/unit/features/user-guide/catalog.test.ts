import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

import { GUIDE_CATEGORIES } from '@/src/features/user-guide/categories';
import { USER_GUIDES } from '@/src/features/user-guide/guides';
import { GUIDE_SEARCH_SUGGESTIONS, searchGuides } from '@/src/features/user-guide/search';
import { extractStepIconKeys } from '@/src/features/user-guide/step-tokens';
import type { GuideIconKey, MobileGuide } from '@/src/features/user-guide/types';

/**
 * Icon keys the renderer knows. Listed here rather than imported from
 * guide-icons.tsx because that module pulls in react-native-svg, which node
 * cannot load. Keep in sync with GUIDE_ICONS; the drift test below catches a
 * key used by the catalog that is missing from either side.
 */
const KNOWN_ICON_KEYS: ReadonlySet<GuideIconKey> = new Set<GuideIconKey>([
  'Activity',
  'AlarmClock',
  'Archive',
  'AtSign',
  'Bell',
  'BellRing',
  'Bookmark',
  'Camera',
  'CalendarClock',
  'Check',
  'ChevronRight',
  'CirclePlay',
  'CircleQuestionMark',
  'Clock',
  'Compass',
  'Copy',
  'FileText',
  'Forward',
  'Hand',
  'Hash',
  'Image',
  'Info',
  'LifeBuoy',
  'LogIn',
  'Mail',
  'MessageCircle',
  'MessagesSquare',
  'Mic',
  'MicOff',
  'MousePointerClick',
  'Palette',
  'Paperclip',
  'PenLine',
  'Phone',
  'PhoneIncoming',
  'Pin',
  'Plus',
  'Presentation',
  'QrCode',
  'Reply',
  'ScreenShare',
  'Search',
  'Send',
  'Settings2',
  'Share2',
  'Siren',
  'SmilePlus',
  'Sparkles',
  'Star',
  'Sunrise',
  'SwitchCamera',
  'Ticket',
  'Trash2',
  'Type',
  'UserCheck',
  'UserRound',
  'Users',
  'Vibrate',
  'Video',
  'Volume2',
  'StartThread',
  'SendToChannel',
  'Mention',
  'Huddle',
  'Call',
]);

/** Desktop vocabulary that must never appear in a phone guide. */
const FORBIDDEN_PHRASES = [
  /\bclick\b/i,
  /\bhover\b/i,
  /\bright-click\b/i,
  /\bcmd\s*\+/i,
  /\bctrl\s*\+/i,
  /\bsidebar\b/i,
  /\bkeyboard shortcut/i,
];

const MIN_STEPS = 3;
const MAX_STEPS = 7;

function stepText(step: MobileGuide['steps'][number]): string {
  return typeof step === 'string' ? step : step.text;
}

/**
 * Every route the `app/` tree can resolve, with route groups and `/index`
 * stripped so `/(protected)/(tabs)/dms` and `/dms` compare equal.
 */
function collectAppRoutes(): Set<string> {
  const appDir = join(process.cwd(), 'app');
  const routes = new Set<string>();

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || entry.startsWith('_') || entry.startsWith('+')) continue;
      const rel = relative(appDir, full).replace(/\.tsx?$/, '');
      routes.add(normalizeRoute(`/${rel}`));
    }
  };

  walk(appDir);
  return routes;
}

function normalizeRoute(href: string): string {
  const pathOnly = href.split(/[?#]/)[0] ?? href;
  const segments = pathOnly
    .split('/')
    .filter(segment => segment.length > 0 && !/^\(.*\)$/.test(segment));
  if (segments[segments.length - 1] === 'index') segments.pop();
  return `/${segments.join('/')}`;
}

describe('user guide catalog', () => {
  const byId = new Map(USER_GUIDES.map(guide => [guide.id, guide]));
  const categoryIds = new Set(GUIDE_CATEGORIES.map(category => category.id));

  it('has unique, kebab-case ids', () => {
    assert.equal(byId.size, USER_GUIDES.length);
    for (const guide of USER_GUIDES) {
      assert.match(guide.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad id: ${guide.id}`);
    }
  });

  it('places every guide in a known category', () => {
    for (const guide of USER_GUIDES) {
      assert.ok(categoryIds.has(guide.category), `${guide.id}: unknown category ${guide.category}`);
    }
  });

  it('keeps between 3 and 7 steps per guide, each with content', () => {
    for (const guide of USER_GUIDES) {
      assert.ok(
        guide.steps.length >= MIN_STEPS && guide.steps.length <= MAX_STEPS,
        `${guide.id}: ${guide.steps.length} steps`,
      );
      for (const step of guide.steps) {
        assert.ok(stepText(step).trim().length > 0, `${guide.id}: empty step`);
      }
    }
  });

  it('uses phone vocabulary, never desktop vocabulary', () => {
    for (const guide of USER_GUIDES) {
      const corpus = [guide.title, guide.tagline, guide.tip ?? '', guide.caution ?? '']
        .concat(guide.steps.map(stepText))
        .join('\n');
      for (const pattern of FORBIDDEN_PHRASES) {
        assert.doesNotMatch(corpus, pattern, `${guide.id}: matches ${pattern}`);
      }
    }
  });

  it('starts every "Find in" path with a visible surface', () => {
    for (const guide of USER_GUIDES) {
      assert.ok(guide.findIn.length > 0, `${guide.id}: empty findIn`);
      for (const crumb of guide.findIn) {
        assert.ok(crumb.trim().length > 0, `${guide.id}: empty crumb`);
      }
    }
  });

  it('references only icons the renderer knows', () => {
    for (const guide of USER_GUIDES) {
      assert.ok(KNOWN_ICON_KEYS.has(guide.icon), `${guide.id}: unknown icon ${guide.icon}`);
      for (const step of guide.steps) {
        for (const key of extractStepIconKeys(stepText(step))) {
          assert.ok(
            KNOWN_ICON_KEYS.has(key as GuideIconKey),
            `${guide.id}: unknown step icon [[${key}]]`,
          );
        }
      }
    }
  });

  it('points every "Try it" at a real route in the app tree', () => {
    const routes = collectAppRoutes();
    for (const guide of USER_GUIDES) {
      if (!guide.tryIt) continue;
      const normalized = normalizeRoute(guide.tryIt.href);
      assert.ok(routes.has(normalized), `${guide.id}: no route for ${guide.tryIt.href}`);
      assert.ok(guide.tryIt.label.trim().length > 0, `${guide.id}: empty tryIt label`);
    }
  });

  it('links related guides that exist and never to itself', () => {
    for (const guide of USER_GUIDES) {
      for (const relatedId of guide.related ?? []) {
        assert.ok(byId.has(relatedId), `${guide.id}: unknown related ${relatedId}`);
        assert.notEqual(relatedId, guide.id, `${guide.id}: related to itself`);
      }
    }
  });

  it('has keywords on every guide and a video only when it is a URL', () => {
    for (const guide of USER_GUIDES) {
      assert.ok(guide.keywords.length > 0, `${guide.id}: no keywords`);
      if (guide.videoUrl) {
        assert.match(guide.videoUrl, /^https:\/\//, `${guide.id}: videoUrl must be https`);
      }
    }
  });

  it('ships a launch set with at least one P0 guide per major surface', () => {
    const p0Categories = new Set(
      USER_GUIDES.filter(guide => guide.priority === 'P0').map(guide => guide.category),
    );
    for (const required of ['start', 'messaging', 'calls', 'you'] as const) {
      assert.ok(p0Categories.has(required), `no P0 guide in ${required}`);
    }
  });

  it('opens with a Start here path that ends on the SOS guide', () => {
    const startHere = USER_GUIDES.filter(guide => guide.category === 'start').map(g => g.id);
    assert.deepEqual(startHere, [
      'sign-in',
      'find-your-way',
      'workspaces',
      'gestures',
      'sos-alerts',
    ]);
  });

  it('returns results for every search suggestion', () => {
    for (const suggestion of GUIDE_SEARCH_SUGGESTIONS) {
      assert.ok(searchGuides(USER_GUIDES, suggestion).length > 0, `no results for ${suggestion}`);
    }
  });
});
