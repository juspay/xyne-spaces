import type { OrganisationsSectionKey } from '../../routes/OrganisationsModule/organisationsAccess';
import type { ActionDefinition } from './actions/action';
import { FORMS } from './forms/operableForm';

type AccessContext = {
  organisations: Record<OrganisationsSectionKey, boolean>;
};

type AppPage = {
  path: string;
  allowed: (access: AccessContext) => boolean;
};

export const APP_PAGES = {
  admin_invitations: {
    path: 'organisations/invitations',
    allowed: (access): boolean => access.organisations.invitations,
  },
  admin_organisations: {
    path: 'organisations/all',
    allowed: (access): boolean => access.organisations.all,
  },
  admin_general: {
    path: 'organisations/general',
    allowed: (access): boolean => access.organisations.general,
  },
  admin_members: {
    path: 'organisations/members',
    allowed: (access): boolean => access.organisations.members,
  },
  admin_guests: {
    path: 'organisations/guests',
    allowed: (access): boolean => access.organisations.guests,
  },
  admin_repository_credentials: {
    path: 'organisations/repository-credentials',
    allowed: (access): boolean => access.organisations['repository-credentials'],
  },
  admin_toolbar: {
    path: 'organisations/toolbar',
    allowed: (access): boolean => access.organisations.toolbar,
  },
  admin_user_groups: {
    path: 'organisations/user-groups',
    allowed: (access): boolean => access.organisations['user-groups'],
  },
  admin_roles: {
    path: 'organisations/roles',
    allowed: (access): boolean => access.organisations.roles,
  },
  // The create dialogs, opened by the page itself when the URL asks for them.
  admin_role_create: {
    path: 'organisations/roles?dialog=create',
    allowed: (access): boolean => access.organisations.roles,
  },
  admin_user_group_create: {
    path: 'organisations/user-groups?dialog=create',
    allowed: (access): boolean => access.organisations['user-groups'],
  },
  admin_organisation_create: {
    path: 'organisations/all?dialog=create',
    allowed: (access): boolean => access.organisations.all,
  },
  chat_new_message: {
    path: 'chat/search?mode=dm',
    allowed: (): boolean => true,
  },
  chat_browse_channels: {
    path: 'chat/search?mode=channels',
    allowed: (): boolean => true,
  },
  add_channel: {
    path: 'chat/dir?dialog=add_channel',
    allowed: (): boolean => true,
  },
  search_results: {
    path: 'search-results?tab=messages',
    allowed: (): boolean => true,
  },
  ai_agent_create: {
    path: 'ai/library/agent/create',
    allowed: (): boolean => true,
  },
  ai_library_agents: {
    path: 'ai/library?tab=agents',
    allowed: (): boolean => true,
  },
} satisfies Record<string, AppPage>;

export type PageId = keyof typeof APP_PAGES;

// Where the action starts: the page it opens, the page of the form it operates, or the page a
// task is done on by hand; none for a task anyone may do, or for listing the actions.
export const firstPage = (action: ActionDefinition): PageId | undefined => {
  const [first] = action.plan;
  if (!first || first.op === 'list_actions') return undefined;
  if (first.op === 'perform') return first.page;
  return first.op === 'open_page' ? first.page : FORMS[first.form].page;
};

// The page a request is done on, opened as soon as it starts, while Buddy asks for what it needs:
// its form's page, the page it opens, or the page a change done in code is done on by hand (the
// members, for a role). None for a task that opens a page of its own (a chat), or that is done
// anywhere (a message).
export const askingPage = (action: ActionDefinition): PageId | undefined => {
  const [first] = action.plan;
  return first?.op === 'perform' && action.effect !== 'change' ? undefined : firstPage(action);
};

export const visibleActions = (
  actions: readonly ActionDefinition[],
  access: AccessContext,
): ActionDefinition[] =>
  actions.filter(action => {
    const page = firstPage(action);
    return page === undefined || APP_PAGES[page].allowed(access);
  });
