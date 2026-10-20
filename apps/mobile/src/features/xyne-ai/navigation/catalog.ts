import type { Href } from 'expo-router';

import type { QuickActionSheet } from '@/src/features/quick-actions/state/sheet-store';
import { tabRoute } from '@/src/navigation/routes';

interface Intent {
  description: string;
  examples: readonly string[];
  notFor?: readonly { when: string; instead: string }[];
}

export type EntityKind = 'dm' | 'channel' | 'ticket' | 'profile';

/** What a command opens: a screen, a Spaces sheet, a dashboard page or a person, channel or ticket by name. */
export type Target =
  | { kind: 'screen'; href: Href | (() => Href) }
  | { kind: 'sheet'; sheet: QuickActionSheet }
  | { kind: 'web'; path: string }
  | { kind: 'entity'; entity: EntityKind };

/** Who the user is, as far as the catalog's `allowed` checks go. */
export interface NavigationAccess {
  spaces: boolean;
  tickets: boolean;
  beta: boolean;
  joinRequests: boolean;
  workspace: boolean;
  members: boolean;
  userGroups: boolean;
  roles: boolean;
}

export interface NavigationAction {
  id: string;
  title: string;
  intent: Intent;
  target: Target;
  /** Bare phrases that are a command on their own, such as "settings". */
  names?: readonly string[];
  allowed?: (access: NavigationAccess) => boolean;
}

/** One line for the intent classifier, worded like the dashboard's `intentCriteria`. */
function criteria({ description, examples, notFor = [] }: Intent): string {
  const quoted = examples.map(example => `"${example}"`).join(', ');
  const exclusions = notFor.map(({ when, instead }) => `${when} (${instead})`).join('; ');
  return [description, `Examples: ${quoted}.`, exclusions && `Not for: ${exclusions}.`]
    .filter(Boolean)
    .join(' ');
}

const screen = (href: Href | (() => Href)): Target => ({ kind: 'screen', href });

export const NAVIGATION_ACTIONS: readonly NavigationAction[] = [
  {
    id: 'open_dm',
    title: 'Open a direct message',
    target: { kind: 'entity', entity: 'dm' },
    intent: {
      description: 'Open the direct message (DM) conversation with a named person.',
      examples: ['message Priya', 'dm Sam Lee', 'chat with Ada', 'open my chat with Ann'],
      notFor: [
        { when: "opening a person's profile", instead: 'that is open_profile' },
        { when: 'opening a channel', instead: 'that is open_channel' },
        { when: 'no person is named', instead: 'that is start_chat' },
      ],
    },
  },
  {
    id: 'open_channel',
    title: 'Open a channel',
    target: { kind: 'entity', entity: 'channel' },
    intent: {
      description: 'Open a channel by its name.',
      examples: ['open #general', 'go to the design channel', 'show #launch'],
      notFor: [{ when: 'a direct message with a person', instead: 'that is open_dm' }],
    },
  },
  {
    id: 'open_ticket',
    title: 'Open a ticket',
    target: { kind: 'entity', entity: 'ticket' },
    intent: {
      description: 'Open one ticket by its key, such as ABC-123.',
      examples: ['open ticket ABC-123', 'show XYZ-42'],
      notFor: [{ when: 'browsing all tickets or desks', instead: 'that is open_desks' }],
    },
  },
  {
    id: 'open_profile',
    title: "Open a person's profile",
    target: { kind: 'entity', entity: 'profile' },
    intent: {
      description: "Open a named person's profile.",
      examples: ["open Ann's profile", 'show profile of Sam Lee'],
      notFor: [
        { when: 'messaging the person', instead: 'that is open_dm' },
        { when: "the user's own profile", instead: 'that is open_my_profile' },
      ],
    },
  },
  {
    id: 'open_my_profile',
    title: 'My profile',
    target: screen('/profile'),
    names: ['profile', 'me'],
    intent: {
      description: "Open the user's own profile.",
      examples: ['open my profile', 'show my profile', 'go to me'],
      notFor: [
        { when: 'a named person', instead: 'that is open_profile' },
        { when: 'changing the profile photo', instead: 'that is open_profile_photo' },
      ],
    },
  },
  {
    id: 'open_settings',
    title: 'Settings',
    target: screen('/settings'),
    names: ['settings'],
    intent: {
      description: 'Open the app settings.',
      examples: ['open settings', 'go to my settings', 'take me to settings'],
      notFor: [
        { when: 'notification options', instead: 'that is open_notification_settings' },
        { when: 'the theme or appearance', instead: 'that is open_theme_settings' },
        { when: 'asking how to change a setting', instead: 'none of these' },
      ],
    },
  },
  {
    id: 'open_notification_settings',
    title: 'Notification settings',
    target: screen('/settings/notifications'),
    names: ['notification settings', 'notifications'],
    intent: {
      description: 'Open the notification settings: sound, previews and pausing notifications.',
      examples: ['open notification settings', 'show my notification preferences'],
    },
  },
  {
    id: 'open_theme_settings',
    title: 'Theme',
    target: screen('/settings/theme'),
    names: ['theme', 'theme settings'],
    intent: {
      description: 'Open the theme settings: light, dark or system appearance.',
      examples: ['open theme settings', 'go to the theme', 'show appearance settings'],
      notFor: [{ when: 'the look of chat bubbles', instead: 'that is open_chat_theme' }],
    },
  },
  {
    id: 'open_chat_theme',
    title: 'Chat bubble style',
    target: screen('/settings/chat-theme/chat-bubble'),
    names: ['chat theme', 'chat bubble'],
    intent: {
      description: 'Open the chat bubble style settings.',
      examples: ['open chat theme', 'change my chat bubble style'],
      notFor: [{ when: 'light or dark appearance', instead: 'that is open_theme_settings' }],
    },
  },
  {
    id: 'open_status',
    title: 'Set status',
    target: screen('/settings/status'),
    names: ['status', 'set status'],
    intent: {
      description: 'Open the custom status editor, a short message with an emoji others can see.',
      examples: ['open my status', 'set my status', 'go to status'],
      notFor: [
        { when: 'being active or inactive', instead: 'that is open_online_status' },
        { when: 'pausing ticket assignment', instead: 'that is open_availability' },
      ],
    },
  },
  {
    id: 'open_online_status',
    title: 'Online status',
    target: screen('/settings/online-status'),
    names: ['online status'],
    intent: {
      description: 'Open the online status settings: appearing active or inactive.',
      examples: ['open online status', 'show my active status'],
      notFor: [{ when: 'a custom status message', instead: 'that is open_status' }],
    },
  },
  {
    id: 'open_availability',
    title: 'Availability',
    target: screen('/settings/availability'),
    names: ['availability'],
    intent: {
      description: 'Open the availability settings to pause or resume ticket assignment.',
      examples: ['open availability', 'go to my availability'],
      notFor: [{ when: 'a custom status message', instead: 'that is open_status' }],
    },
  },
  {
    id: 'open_profile_photo',
    title: 'Profile photo',
    target: screen('/settings/profile-photo'),
    names: ['profile photo'],
    intent: {
      description: "Open the screen to change the user's own profile photo.",
      examples: ['open my profile photo', 'change my profile picture'],
    },
  },
  {
    id: 'open_beta',
    title: 'Beta features',
    target: screen('/settings/beta'),
    names: ['beta'],
    allowed: ({ beta }) => beta,
    intent: {
      description: 'Open the beta settings to turn experimental features on or off.',
      examples: ['open beta', 'show beta features'],
    },
  },
  {
    id: 'open_join_requests',
    title: 'Join requests',
    target: screen('/settings/join-requests'),
    names: ['join requests'],
    allowed: ({ joinRequests }) => joinRequests,
    intent: {
      description: 'Open the requests from people asking to join the community.',
      examples: ['open join requests', 'show who wants to join'],
    },
  },
  {
    id: 'open_report_issue',
    title: 'Report an issue',
    target: screen('/report-issue'),
    names: ['report issue', 'report an issue', 'report a bug'],
    intent: {
      description: 'Open the form to report a problem with the app.',
      examples: ['open report issue', 'report a bug', 'go to report an issue'],
    },
  },
  {
    id: 'open_guide',
    title: 'Help',
    target: screen('/(protected)/guide'),
    names: ['help', 'guide', 'user guide'],
    intent: {
      description: 'Open the help and user guide.',
      examples: ['open help', 'show the user guide', 'go to guide'],
    },
  },
  {
    id: 'open_global_search',
    title: 'Search',
    target: screen('/global-search'),
    names: ['search', 'global search'],
    intent: {
      description: 'Open the search screen to look for people, channels, messages and files.',
      examples: ['open search', 'go to global search'],
      notFor: [{ when: 'a question to be answered', instead: 'none of these' }],
    },
  },
  {
    id: 'open_calls',
    title: 'Calls',
    target: screen(() => tabRoute('calls')),
    names: ['calls'],
    intent: {
      description: 'Open the calls tab with recent calls.',
      examples: ['open calls', 'go to my calls'],
      notFor: [{ when: 'call recordings', instead: 'that is open_recordings' }],
    },
  },
  {
    id: 'open_activity',
    title: 'Activity',
    target: screen(() => tabRoute('activity')),
    names: ['activity'],
    intent: {
      description: 'Open the activity tab with mentions, replies and reactions.',
      examples: ['open activity', 'go to activity'],
    },
  },
  {
    id: 'open_channels',
    title: 'Channels',
    target: screen(() => tabRoute('channels')),
    names: ['channels'],
    intent: {
      description: 'Open the channels tab, the list of all channels.',
      examples: ['open channels', 'show my channels'],
      notFor: [{ when: 'one named channel', instead: 'that is open_channel' }],
    },
  },
  {
    id: 'open_dms',
    title: 'Direct messages',
    target: screen(() => tabRoute('dms')),
    names: ['dms', 'direct messages'],
    intent: {
      description: 'Open the direct messages tab, the list of all DM conversations.',
      examples: ['open dms', 'show my direct messages'],
      notFor: [{ when: 'a conversation with a named person', instead: 'that is open_dm' }],
    },
  },
  {
    id: 'open_bookmarks',
    title: 'Bookmarks',
    target: screen('/(protected)/(shortcuts)/bookmarks'),
    names: ['bookmarks'],
    intent: {
      description: 'Open the list of messages the user saved for later.',
      examples: ['open bookmarks', 'show my saved messages'],
    },
  },
  {
    id: 'open_threads',
    title: 'Threads',
    target: screen('/(protected)/(shortcuts)/threads'),
    names: ['threads'],
    intent: {
      description: 'Open the list of threads the user takes part in.',
      examples: ['open threads', 'show my thread replies'],
    },
  },
  {
    id: 'open_drafts_sent',
    title: 'Drafts and sent',
    target: screen('/(protected)/(shortcuts)/drafts-sent'),
    names: ['drafts', 'sent', 'drafts & sent', 'drafts and sent'],
    intent: {
      description: 'Open drafts, scheduled messages and sent messages.',
      examples: ['open drafts', 'show my sent messages', 'go to drafts and sent'],
    },
  },
  {
    id: 'open_recordings',
    title: 'Recordings',
    target: screen('/(protected)/(shortcuts)/recordings'),
    names: ['recordings'],
    intent: {
      description: 'Open the meeting and call recordings.',
      examples: ['open recordings', 'show my call recordings'],
    },
  },
  {
    id: 'open_canvas',
    title: 'Canvas',
    target: screen('/(protected)/(shortcuts)/canvas'),
    names: ['canvas'],
    intent: {
      description: 'Open the docs and canvases of the workspace.',
      examples: ['open canvas', 'show my canvases'],
    },
  },
  {
    id: 'open_desks',
    title: 'Xyne Desks',
    target: screen('/xyne-desks'),
    names: ['desks', 'xyne desks'],
    allowed: ({ tickets }) => tickets,
    intent: {
      description: 'Open Xyne Desks, the support desks and their tickets.',
      examples: ['open desks', 'go to xyne desks'],
      notFor: [{ when: 'one specific ticket', instead: 'that is open_ticket' }],
    },
  },
  {
    id: 'open_morning_brief',
    title: 'Morning brief',
    target: screen('/(protected)/morning-brief'),
    names: ['morning brief'],
    intent: {
      description: "Open the morning brief, a summary of the user's day.",
      examples: ['open morning brief', 'show my brief'],
    },
  },
  {
    id: 'start_chat',
    title: 'New message',
    target: { kind: 'sheet', sheet: 'create-dm' },
    names: ['new message', 'new chat', 'start a chat'],
    allowed: ({ spaces }) => spaces,
    intent: {
      description: 'Start a new direct message (DM) without naming a person yet.',
      examples: ['new message', 'start a chat', 'compose a message'],
      notFor: [{ when: 'a person is named', instead: 'that is open_dm' }],
    },
  },
  {
    id: 'create_channel',
    title: 'Create a channel',
    target: { kind: 'sheet', sheet: 'create-channel' },
    names: ['create a channel', 'new channel'],
    allowed: ({ spaces }) => spaces,
    intent: {
      description: 'Create a new channel, a shared conversation for a team or a topic.',
      examples: ['create a channel', 'new channel', 'start a new channel'],
      notFor: [{ when: 'opening an existing channel', instead: 'that is open_channel' }],
    },
  },
  {
    id: 'create_agent',
    title: 'Create an agent',
    target: { kind: 'web', path: 'ai/library/agent/create' },
    names: ['create an agent', 'new agent'],
    intent: {
      description: 'Create a new AI agent with its own instructions, tools and knowledge.',
      examples: ['create an agent', 'build a new agent', 'add a custom agent'],
    },
  },
  {
    id: 'invite_people',
    title: 'Invite people',
    target: { kind: 'web', path: 'organisations/invitations' },
    names: ['invite people', 'invitations'],
    allowed: ({ workspace }) => workspace,
    intent: {
      description:
        'Invite new people to join the workspace, see the invitations that were sent, or revoke one.',
      examples: ['invite people', 'invite my teammates', 'show pending invitations'],
      notFor: [
        { when: 'managing people who already belong', instead: 'that is manage_members' },
        {
          when: 'adding someone to a channel',
          instead:
            'none of these: changing who is in an existing channel is not one of these actions',
        },
      ],
    },
  },
  {
    id: 'workspace_settings',
    title: 'Workspace settings',
    target: { kind: 'web', path: 'organisations/general' },
    names: ['workspace settings'],
    allowed: ({ workspace }) => workspace,
    intent: {
      description:
        'Open the settings of the current workspace to set it up, rename it or change it.',
      examples: ['open workspace settings', 'rename the workspace'],
      notFor: [{ when: 'the personal app settings', instead: 'that is open_settings' }],
    },
  },
  {
    id: 'manage_members',
    title: 'Manage members',
    target: { kind: 'web', path: 'organisations/members' },
    names: ['manage members', 'members'],
    allowed: ({ members }) => members,
    intent: {
      description: 'See, edit or remove the people who already belong to the workspace.',
      examples: ['manage members', 'go to members', 'remove a user from the workspace'],
      notFor: [{ when: 'inviting new people', instead: 'that is invite_people' }],
    },
  },
  {
    id: 'manage_guests',
    title: 'Manage guests',
    target: { kind: 'web', path: 'organisations/guests' },
    names: ['manage guests', 'guests'],
    allowed: ({ workspace }) => workspace,
    intent: {
      description: 'See the guests who have access to the workspace, and revoke their access.',
      examples: ['manage guests', 'show guest users'],
      notFor: [{ when: 'inviting a new guest', instead: 'that is invite_people' }],
    },
  },
  {
    id: 'manage_user_groups',
    title: 'Manage user groups',
    target: { kind: 'web', path: 'organisations/user-groups' },
    names: ['manage user groups', 'user groups', 'create a user group'],
    allowed: ({ userGroups }) => userGroups,
    intent: {
      description:
        'Create a user group, a named set of people who share access, or see and edit the existing ones.',
      examples: ['create a user group', 'manage user groups', 'edit a group'],
      notFor: [
        {
          when: 'creating a channel for a team to talk in',
          instead: 'that is create_channel; a channel is a conversation, not a user group',
        },
      ],
    },
  },
  {
    id: 'manage_roles',
    title: 'Manage roles',
    target: { kind: 'web', path: 'organisations/roles' },
    names: ['manage roles', 'roles', 'create a role'],
    allowed: ({ roles }) => roles,
    intent: {
      description:
        'Create a role, a named set of people referenced across the workspace, or see and edit the existing ones.',
      examples: ['create a role', 'manage roles', 'edit a role'],
    },
  },
];

/** The actions this user can be offered. */
export const availableActions = (access: NavigationAccess): NavigationAction[] =>
  NAVIGATION_ACTIONS.filter(({ allowed }) => allowed?.(access) ?? true);

/** What the intent classifier ranks. */
export const jevActions = (
  actions: readonly NavigationAction[],
): { id: string; description: string }[] =>
  actions.map(({ id, intent }) => ({ id, description: criteria(intent) }));

export const webUrl = (origin: string, workspaceId: string | null, path: string): string =>
  `${origin}/${workspaceId}/${path}`;
