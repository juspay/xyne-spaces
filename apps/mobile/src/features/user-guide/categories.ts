import type { GuideCategory, GuideCategoryId } from './types';

/**
 * Categories follow the phone's own map — the bottom tabs and the More menu —
 * rather than the dashboard's org-level grouping, so every "Find in" breadcrumb
 * begins with something the user can see on screen.
 */
export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
  {
    id: 'start',
    title: 'Start here',
    description: 'Sign in, find your way around, learn the gestures',
    icon: 'Compass',
  },
  {
    id: 'messaging',
    title: 'Messaging',
    description: 'Channels, DMs, writing and acting on messages',
    icon: 'MessagesSquare',
  },
  {
    id: 'channel-tools',
    title: 'Channel tools',
    description: 'Info, members, files, pins and notifications',
    icon: 'Info',
  },
  {
    id: 'calls',
    title: 'Calls',
    description: 'Start, answer and revisit calls',
    icon: 'Phone',
  },
  {
    id: 'work',
    title: 'Stay on top of work',
    description: 'Activity, search, Morning Brief and tickets',
    icon: 'Activity',
  },
  {
    id: 'desks',
    title: 'Xyne Desks',
    description: 'Support desks and email replies',
    icon: 'LifeBuoy',
  },
  {
    id: 'you',
    title: 'You and your device',
    description: 'Status, sharing, notifications and appearance',
    icon: 'UserRound',
  },
];

export const GUIDE_CATEGORY_BY_ID: Readonly<Record<GuideCategoryId, GuideCategory>> =
  Object.fromEntries(GUIDE_CATEGORIES.map(category => [category.id, category])) as Record<
    GuideCategoryId,
    GuideCategory
  >;
