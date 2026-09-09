/**
 * Canonical event-category aliases.
 *
 * The frontend historically emitted the same feature area under several
 * spellings (CALLS/Calls/calls, XyneAI/XYNE_AI/xyne-ai, ...). The source was
 * canonicalized in one pass, but clients running older bundles (Electron,
 * mobile) keep emitting the old spellings for a while — this map folds them
 * into the canonical category at ingestion so aggregation stays clean.
 *
 * It is also the alias table for querying data recorded BEFORE the
 * canonicalization: rows older than the cutover keep their original
 * event_category, so historical queries should expand a canonical category
 * to [canonical, ...aliases].
 */
export const TRACKING_CATEGORY_ALIASES: Record<string, string> = {
  calls: 'CALLS',
  Calls: 'CALLS',
  call: 'CALLS',
  CALL: 'CALLS',
  XYNE_AI: 'XyneAI',
  'xyne-ai': 'XyneAI',
  TICKETS: 'Tickets',
  SUPPORT: 'Support',
  KnowledgeBase: 'knowledge-base',
  FILE_VIEWER: 'FileViewer',
  WorkspaceManagement: 'workspace-management',
  Profile: 'PROFILE',
  SETTINGS: 'Settings',
  UserGroup: 'UserGroups',
  calendar: 'CALENDAR',
  notifications: 'NOTIFICATIONS',
  BOARD_CONFIG: 'board_config',
  BOARD_EDIT: 'board_edit',
  BoardCreate: 'BOARD_CREATE',
  'chat-input': 'CHAT_INPUT',
  User_Guide: 'USER_GUIDE',
  ChatInfo: 'CHAT_INFO',
  'component-editor': 'COMPONENT_EDITOR',
  DASHBOARD_EDITOR: 'COMPONENT_EDITOR',
  'ask-ai': 'AskAI',
  KanbanBoard: 'KANBAN',
  Navigation: 'NAVIGATION',
  Form: 'Forms',
  ScheduledMessages: 'scheduled-message',
  Automation: 'automation-builder',
  BOARD: 'Board',
};

export function canonicalizeTrackingCategory(category: string): string {
  return TRACKING_CATEGORY_ALIASES[category] ?? category;
}
