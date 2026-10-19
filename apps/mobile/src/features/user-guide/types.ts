/**
 * Content model for the in-app User Guide.
 *
 * Mirrors the dashboard's `UserGuideFeature` where the two agree (title,
 * tagline, steps, tip, keywords, videoUrl, `[[Icon]]` step tokens) and diverges
 * where a phone needs something different: `findIn` is a breadcrumb that starts
 * from a visible tab, `gesture` names the affordance, steps can be tagged per
 * OS, and `tryIt` deep-links into the real screen instead of a mock demo.
 *
 * Everything here is plain data — no React, no native modules — so the catalog
 * can be validated by the L1 logic tests.
 */

export type GuideCategoryId =
  'start' | 'messaging' | 'channel-tools' | 'calls' | 'work' | 'desks' | 'you';

export type GuideGesture = 'tap' | 'long-press' | 'swipe' | 'pull';

export type GuidePlatform = 'ios' | 'android';

/** P0 guides feed the "Start here" strip; P1/P2 only appear in their category. */
export type GuidePriority = 'P0' | 'P1' | 'P2';

/** Permission-gated guides hide when the user lacks the underlying access. */
export type GuideRequirement = 'tickets';

/**
 * Icon keys resolvable by `guide-icons.tsx`. Kept as a string union (not the
 * component map's keyof) so the catalog stays importable from node tests.
 */
export type GuideIconKey =
  // lucide-react-native
  | 'Activity'
  | 'AlarmClock'
  | 'Archive'
  | 'AtSign'
  | 'Bell'
  | 'BellRing'
  | 'Bookmark'
  | 'Camera'
  | 'CalendarClock'
  | 'Check'
  | 'ChevronRight'
  | 'CirclePlay'
  | 'CircleQuestionMark'
  | 'Clock'
  | 'Compass'
  | 'Copy'
  | 'FileText'
  | 'Forward'
  | 'Hand'
  | 'Hash'
  | 'Image'
  | 'Info'
  | 'LifeBuoy'
  | 'LogIn'
  | 'Mail'
  | 'MessageCircle'
  | 'MessagesSquare'
  | 'Mic'
  | 'MicOff'
  | 'MousePointerClick'
  | 'Palette'
  | 'Paperclip'
  | 'PenLine'
  | 'Phone'
  | 'PhoneIncoming'
  | 'Pin'
  | 'Plus'
  | 'Presentation'
  | 'QrCode'
  | 'Reply'
  | 'ScreenShare'
  | 'Search'
  | 'Send'
  | 'Settings2'
  | 'Share2'
  | 'Siren'
  | 'SmilePlus'
  | 'Sparkles'
  | 'Star'
  | 'Sunrise'
  | 'SwitchCamera'
  | 'Ticket'
  | 'Trash2'
  | 'Type'
  | 'UserCheck'
  | 'UserRound'
  | 'Users'
  | 'Vibrate'
  | 'Video'
  | 'Volume2'
  // app icons (src/components/icons)
  | 'StartThread'
  | 'SendToChannel'
  | 'Mention'
  | 'Huddle'
  | 'Call';

export interface GuideStep {
  /** May contain `[[IconKey]]` tokens, rendered as inline boxed glyphs. */
  text: string;
  /** Tag a step that only applies to one OS. Untagged steps apply to both. */
  platform?: GuidePlatform;
}

export interface GuideTryIt {
  label: string;
  /** An Expo Router href. Validated against the `app/` tree by the L1 tests. */
  href: string;
}

export interface MobileGuide {
  id: string;
  /** Task-shaped, e.g. "Answer calls on the lock screen". */
  title: string;
  /** One line; shown under the title in list rows. */
  tagline: string;
  category: GuideCategoryId;
  icon: GuideIconKey;
  /** Breadcrumb from something visible on screen: ['More', 'Bookmarks']. */
  findIn: string[];
  gesture?: GuideGesture;
  steps: Array<string | GuideStep>;
  tip?: string;
  /** A consequence the user should know before acting. */
  caution?: string;
  tryIt?: GuideTryIt;
  videoUrl?: string;
  requires?: GuideRequirement;
  /** Ids of guides shown in the "Related" footer. */
  related?: string[];
  keywords: string[];
  priority: GuidePriority;
}

export interface GuideCategory {
  id: GuideCategoryId;
  title: string;
  description: string;
  icon: GuideIconKey;
}
