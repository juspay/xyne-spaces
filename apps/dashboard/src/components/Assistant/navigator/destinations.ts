/**
 * The app's map for the navigator: every place a user might ask to go, with its path. Jev picks
 * one of these in a single call and code navigates straight there, instead of clicking screen
 * by screen. Paths are workspace-relative: the app's `navigate` adds the workspace id.
 *
 * `item` destinations stand for one specific thing of a kind (a canvas by name, a DM with a
 * person). For those, a second pick chooses among the user's own items of that kind, and
 * `path` is where to go when none of them matches.
 */
export type ItemKind = 'canvas' | 'dm' | 'channel' | 'agent' | 'person';

/**
 * Opens a form that has neither a page nor a button to click: the app already listens for these
 * events (hooks/useGlobalShortcuts.ts, AppSidebar.tsx). Forms behind a button are not listed by
 * selector: `finishByClicking` lets Jev find the button on screen instead.
 */
export type Opener = { type: 'event'; name: string };

export interface Destination {
  /** Jev option id: lower snake_case. */
  id: string;
  title: string;
  /** What Jev reads: what the place is and the words people use for it. */
  description: string;
  path: string;
  item?: ItemKind;
  /** Set for forms that open in place rather than at `path`. */
  open?: Opener;
  /**
   * The form opens from a button on the page: go to `path` (stay put when empty), then the click
   * agent finds and presses the button, and stops as soon as the form is open.
   */
  finishByClicking?: true;
  /** Said to the user once there, e.g. what is left for them to do. */
  note?: string;
  /**
   * Opening this creates something (a blank canvas). Only used when Jev is very sure the user
   * asked for it; otherwise the user is sent to `fallback` instead.
   */
  creates?: { minConfidence: number; fallback: { path: string; title: string; note: string } };
}

export const ITEM_TYPE_WORDS: Record<ItemKind, string> = {
  canvas: 'canvas (document)',
  person: 'person to message',
  dm: 'direct message conversation',
  channel: 'channel',
  agent: 'AI agent',
};

export const DESTINATIONS: readonly Destination[] = [
  // ----- Specific items, picked by name in a second step -----
  {
    id: 'canvas_item',
    title: 'a canvas',
    description:
      'One specific canvas (document, doc, page, note) opened by its name, e.g. "open the canvas named Roadmap", "open my New canvas".',
    path: '/chat/canvas',
    item: 'canvas',
  },
  {
    id: 'dm_item',
    title: 'a DM',
    description:
      'The direct message (DM, chat, conversation) with one specific person, by their name, e.g. "open my dm with Om", "message Priya", "oms dm".',
    path: '/chat/dm',
    item: 'dm',
  },
  {
    id: 'channel_item',
    title: 'a channel',
    description:
      'One specific chat channel by its name: any goal saying "<name> channel" or "#<name>", e.g. "open the release channel", "#design", "go to the infra channel".',
    path: '/chat/dir',
    item: 'channel',
  },
  {
    id: 'agent_item',
    title: 'an agent',
    description:
      'One specific AI agent in Agent Hub by its name, e.g. "open the code review agent".',
    path: '/ai/library',
    item: 'agent',
  },

  // ----- Forms: opened for the user, who fills them in and submits -----
  {
    id: 'create_channel',
    title: 'Create channel form',
    description:
      'Create a new channel: open the "create channel" form, e.g. "create channel", "make a new channel".',
    path: '/chat/dir?dialog=add_channel',
    note: 'fill in the form and press Create',
  },
  {
    id: 'new_dm_item',
    title: 'a new DM',
    description:
      'Start or create a direct message with one specific person by their name, e.g. "create dm with Om", "start a chat with Priya", "message Rahul".',
    path: '/chat/search?mode=dm',
    item: 'person',
    note: 'type your message and send it',
  },
  {
    id: 'new_message',
    title: 'New message',
    description:
      'Start a new message or chat without naming anyone yet: pick who to message, e.g. "new message", "start a chat".',
    path: '/chat/search?mode=dm',
  },
  {
    id: 'new_canvas',
    title: 'a new canvas',
    description: 'Create a new canvas (document, doc, note), e.g. "create a canvas", "new doc".',
    // The app's own new-canvas route: it creates one "Untitled Canvas" and opens it. A canvas
    // has no form, so the blank canvas is what the user fills in.
    path: '/chat/canvas/new',
    note: 'give it a title and start writing',
    creates: {
      minConfidence: 0.9,
      fallback: {
        path: '/chat/canvas',
        title: 'Canvases',
        note: 'press New Canvas in the sidebar to create one',
      },
    },
  },
  {
    id: 'create_agent',
    title: 'Create agent form',
    description: 'Create a new AI agent: the create agent form.',
    path: '/ai/library/agent/create',
    note: 'fill in the form and press Create',
  },
  {
    id: 'create_skill',
    title: 'Create skill form',
    description: 'Create a new AI skill: the create skill form.',
    path: '/ai/library/skill/create',
    note: 'fill in the form and press Create',
  },
  {
    id: 'create_subagent',
    title: 'Create subagent form',
    description: 'Create a new AI subagent: the create subagent form.',
    path: '/ai/library/subagent/create',
    note: 'fill in the form and press Create',
  },
  {
    id: 'create_automation',
    title: 'New automation',
    description: 'Create a new automation: the automation builder.',
    path: '/automations/new',
    note: 'build it and save',
  },
  {
    id: 'create_view',
    title: 'New ticket view',
    description: 'Create a new ticket view: the project view builder.',
    path: '/projects/views/new',
    note: 'set it up and save',
  },
  {
    id: 'invite_people',
    title: 'Invite people',
    description: 'Invite people or teammates to the workspace: the invite dialog.',
    // The invite button is in the app sidebar, on every page.
    path: '',
    finishByClicking: true,
    note: 'add their emails and send the invites',
  },
  {
    id: 'schedule_call',
    title: 'Schedule a call',
    description: 'Schedule a call or meeting for later: the schedule call form.',
    path: '/calls',
    finishByClicking: true,
    note: 'pick the time and people, then schedule it',
  },
  {
    id: 'start_call',
    title: 'Start a call',
    description: 'Start an instant call or meeting now: the start call dialog.',
    path: '/calls',
    finishByClicking: true,
    note: 'choose who to call and start it',
  },
  {
    id: 'set_status',
    title: 'Set status',
    description:
      'Set my status: the status form (available, away, busy, in a meeting, on leave), e.g. "set my status", "change status", "mark me as away".',
    path: '',
    open: { type: 'event', name: 'xyne-open-status' },
    note: 'pick a status and save',
  },
  {
    id: 'preferences',
    title: 'Preferences',
    description: 'Open preferences / user settings (theme, notifications…).',
    path: '',
    open: { type: 'event', name: 'xyne-open-preferences' },
  },
  {
    id: 'create_user_group',
    title: 'User groups',
    description: 'Create a user group or team.',
    path: '/organisations/user-groups',
    note: 'press Create to add the group',
  },
  {
    id: 'create_role',
    title: 'Roles',
    description: 'Create a role with permissions.',
    path: '/organisations/roles',
    note: 'press Create to add the role',
  },

  // ----- Chat -----
  {
    id: 'chat_home',
    title: 'Chat',
    description: 'Chat home: the channels directory and conversations sidebar.',
    path: '/chat/dir',
  },
  {
    id: 'dm_list',
    title: 'DMs',
    description: 'The list of all direct messages (DMs, inbox of private chats), not one person.',
    path: '/chat/dm',
  },
  {
    id: 'canvas_list',
    title: 'Canvases',
    description: 'All canvases: the list of documents, docs and notes, not one specific canvas.',
    path: '/chat/canvas',
  },
  {
    id: 'bookmarks',
    title: 'Bookmarks',
    description: 'Bookmarks: saved messages and items saved for later.',
    path: '/chat/bookmarks',
  },
  {
    id: 'drafts_sent',
    title: 'Drafts & Sent',
    description: 'Drafts and sent messages.',
    path: '/chat/drafts-sent',
  },
  {
    id: 'scheduled_messages',
    title: 'Scheduled messages',
    description: 'Messages scheduled to be sent later.',
    path: '/chat/scheduled',
  },
  {
    id: 'activity',
    title: 'Activity',
    description:
      'Activity: notifications, @mentions of the user, reactions and things that need attention.',
    path: '/chat/activity',
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'Calendar: the week view of meetings and events.',
    path: '/chat/activity/calendar',
  },
  {
    id: 'threads',
    title: 'Threads',
    description: 'Threads: replies and thread conversations the user is part of.',
    path: '/chat/dir/threads',
  },
  {
    id: 'unreads',
    title: 'Unreads',
    description: 'Unread messages across channels.',
    path: '/chat/dir/unreads',
  },
  {
    id: 'recap',
    title: 'Recap',
    description: 'Recap: summaries of what happened in channels.',
    path: '/chat/dir/recap',
  },
  {
    id: 'my_tickets',
    title: 'My tickets',
    description: 'Tickets assigned to the user, from chat.',
    path: '/chat/dir/my-tickets',
  },

  // ----- Xyne AI -----
  {
    id: 'ai_chat',
    title: 'Ask AI',
    description: 'Xyne AI / Ask AI: a new full-screen AI chat with the assistant.',
    path: '/ai',
  },
  {
    id: 'agent_hub',
    title: 'Agent Hub',
    description: 'Agent Hub: the library of AI agents, skills, subagents, MCPs and apps.',
    path: '/ai/library',
  },
  {
    id: 'ai_knowledge',
    title: 'Knowledge',
    description: 'Knowledge: the AI knowledge base, files and collections the AI can use.',
    path: '/ai/knowledge',
  },
  {
    id: 'digital_twin',
    title: 'Digital twin',
    description: 'Digital twin: the AI version of the user.',
    path: '/ai/digital-twin',
  },
  {
    id: 'ai_organization',
    title: 'AI Organization',
    description: 'Xyne AI organization settings.',
    path: '/ai/organization',
  },
  {
    id: 'ai_metrics',
    title: 'AI Metrics',
    description: 'Xyne AI usage metrics.',
    path: '/ai/metrics',
  },
  {
    id: 'ai_settings',
    title: 'AI Settings',
    description: 'Xyne AI settings and preferences.',
    path: '/ai/settings',
  },
  {
    id: 'morning_brief',
    title: 'Morning Brief',
    description: 'Morning brief / daily brief: the daily AI summary.',
    path: '/ai/daily-brief',
  },

  // ----- Other apps -----
  {
    id: 'calls',
    title: 'Calls',
    description: 'Calls: call history, meetings, upcoming and scheduled calls.',
    path: '/calls',
  },
  {
    id: 'recordings',
    title: 'Recordings',
    description: 'Recordings of calls and meetings.',
    path: '/recordings',
  },
  {
    id: 'tickets',
    title: 'Tickets',
    description: 'Tickets: projects, boards and issues (task tracker).',
    path: '/projects',
  },
  {
    id: 'sdlc',
    title: 'SDLC',
    description: 'SDLC hub: software development, pull requests, releases and engineering work.',
    path: '/sdlc',
  },
  {
    id: 'support',
    title: 'Support desk',
    description: 'Support / Desk: customer support tickets and inbox.',
    path: '/support',
  },
  {
    id: 'workflows',
    title: 'Workflows',
    description: 'Workflows.',
    path: '/workflows',
  },
  {
    id: 'automations',
    title: 'Automations',
    description: 'Automations and their runs and approvals.',
    path: '/automations',
  },
  {
    id: 'dashboards',
    title: 'Dashboards',
    description: 'Dashboards and analytics dashboards.',
    path: '/dashboards',
  },
  {
    id: 'apps',
    title: 'Apps',
    description: 'Apps and integrations.',
    path: '/apps',
  },
  {
    id: 'forms',
    title: 'Forms',
    description: 'Forms.',
    path: '/forms',
  },
  {
    id: 'team_intelligence',
    title: 'Team intelligence',
    description: 'Team intelligence: insights about teams and members.',
    path: '/team-intelligence',
  },
  {
    id: 'release_manager',
    title: 'Release manager',
    description: 'Release manager app: release plans and release tickets (not a chat channel).',
    path: '/releaseManager',
  },

  // ----- Organisation admin -----
  {
    id: 'org_general',
    title: 'Organisation settings',
    description: 'Organisation / workspace general settings.',
    path: '/organisations/general',
  },
  {
    id: 'org_members',
    title: 'Members',
    description: 'Organisation members: people in the workspace.',
    path: '/organisations/members',
  },
  {
    id: 'org_invitations',
    title: 'Invitations',
    description: 'Pending invitations to the workspace.',
    path: '/organisations/invitations',
  },
  {
    id: 'org_guests',
    title: 'Guests',
    description: 'Guest users of the workspace.',
    path: '/organisations/guests',
  },
  {
    id: 'org_user_groups',
    title: 'User groups',
    description: 'User groups and teams.',
    path: '/organisations/user-groups',
  },
  {
    id: 'org_roles',
    title: 'Roles',
    description: 'Roles and permissions.',
    path: '/organisations/roles',
  },
];
