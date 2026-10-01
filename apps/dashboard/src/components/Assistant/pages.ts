import type { OrganisationsSectionKey } from '../../routes/OrganisationsModule/organisationsAccess';
import type { ActionDefinition, PageId } from './actions/action';

type AccessContext = {
  organisations: Record<OrganisationsSectionKey, boolean>;
};

type AppPage = {
  path: string;
  allowed: (access: AccessContext) => boolean;
};

export const APP_PAGES: Record<PageId, AppPage> = {
  admin_invitations: {
    path: 'organisations/invitations',
    allowed: access => access.organisations.invitations,
  },
  admin_organisations: {
    path: 'organisations/all',
    allowed: access => access.organisations.all,
  },
  admin_general: {
    path: 'organisations/general',
    allowed: access => access.organisations.general,
  },
  admin_members: {
    path: 'organisations/members',
    allowed: access => access.organisations.members,
  },
  admin_guests: {
    path: 'organisations/guests',
    allowed: access => access.organisations.guests,
  },
  admin_user_groups: {
    path: 'organisations/user-groups',
    allowed: access => access.organisations['user-groups'],
  },
  admin_roles: {
    path: 'organisations/roles',
    allowed: access => access.organisations.roles,
  },
  chat_new_message: {
    path: 'chat/search?mode=dm',
    allowed: () => true,
  },
  chat_browse_channels: {
    path: 'chat/search?mode=channels',
    allowed: () => true,
  },
  add_channel: {
    path: 'chat/dir?dialog=add_channel',
    allowed: () => true,
  },
  ai_agent_create: {
    path: 'ai/library/agent/create',
    allowed: () => true,
  },
};

export const visibleActions = (
  actions: readonly ActionDefinition[],
  access: AccessContext,
): ActionDefinition[] => actions.filter(action => APP_PAGES[action.page].allowed(access));
