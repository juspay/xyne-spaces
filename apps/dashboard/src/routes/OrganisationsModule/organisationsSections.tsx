import { useMemo } from 'react';
import {
  BriefcaseJob,
  BuildingApartmentTwo,
  GitBranch,
  LayoutGridTwoVertical,
  Settings01,
  ShieldCheck,
  UserShield,
  UserThree,
} from '@xyne/icons';
import { Mail, UserCheck } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { useUserGroups } from '../../hooks/useUserGroup';
import type { PikaIcon } from '../../components/AppSidebar/navigationConfig';
import { organisationsAccess, type OrganisationsSectionKey } from './organisationsAccess';

export type { OrganisationsSectionKey };

export interface OrganisationsSection {
  key: OrganisationsSectionKey;
  label: string;
  icon: PikaIcon;
}

/** One entry in the Organisations sidebar; more than one section renders as tabs. */
export interface OrganisationsSectionGroup {
  key: string;
  label: string;
  icon: PikaIcon;
  /** Subtitle under the header when the entry renders as tabs. */
  description?: string;
  /** Settings that apply to the current workspace: the header names it. */
  showsWorkspaceName?: boolean;
  sections: OrganisationsSection[];
}

// lucide has no Solid/Stroke pair, so `variant` is dropped rather than passed to the <svg>.
const MailIcon: PikaIcon = ({ size, className }) => (
  <Mail size={typeof size === 'number' ? size : 16} className={className} />
);
const GuestIcon: PikaIcon = ({ size, className }) => (
  <UserCheck size={typeof size === 'number' ? size : 16} className={className} />
);

// Sidebar order. Workspace holds the workspace settings (formerly Workspace
// Management + User Management) as tabs; the others are single pages.
export const ORGANISATIONS_SECTION_GROUPS: OrganisationsSectionGroup[] = [
  {
    key: 'organisations',
    label: 'Organisations',
    icon: BuildingApartmentTwo,
    sections: [{ key: 'all', label: 'Organisations', icon: BuildingApartmentTwo }],
  },
  {
    key: 'workspace',
    label: 'Workspace',
    icon: BriefcaseJob,
    description: 'Settings, members and access for this workspace.',
    showsWorkspaceName: true,
    sections: [
      { key: 'general', label: 'General', icon: Settings01 },
      { key: 'members', label: 'Members', icon: UserShield },
      { key: 'invitations', label: 'Invitations', icon: MailIcon },
      { key: 'guests', label: 'Guest users', icon: GuestIcon },
      { key: 'repository-credentials', label: 'Repository credentials', icon: GitBranch },
      { key: 'toolbar', label: 'Toolbar', icon: LayoutGridTwoVertical },
    ],
  },
  {
    key: 'user-groups',
    label: 'User Groups',
    icon: UserThree,
    sections: [{ key: 'user-groups', label: 'User Groups', icon: UserThree }],
  },
  {
    key: 'roles',
    label: 'Roles',
    icon: ShieldCheck,
    sections: [{ key: 'roles', label: 'Roles', icon: ShieldCheck }],
  },
];

export const useOrganisationsAccess = (): Record<OrganisationsSectionKey, boolean> => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const userGroups = useUserGroups();
  const ownsUserGroup = userGroups.some(
    group => group.createdBy === user?.id && group.workspaceId === user?.workspaceId,
  );
  return useMemo(
    () => organisationsAccess(permissions, ownsUserGroup),
    [permissions, ownsUserGroup],
  );
};

export const useVisibleOrganisationsGroups = (): OrganisationsSectionGroup[] => {
  const access = useOrganisationsAccess();
  return useMemo(
    () =>
      ORGANISATIONS_SECTION_GROUPS.map(group => ({
        ...group,
        sections: group.sections.filter(section => access[section.key]),
      })).filter(group => group.sections.length > 0),
    [access],
  );
};

const sectionFromPath = (pathname: string): string | undefined =>
  /\/organisations\/([^/]+)/.exec(pathname)?.[1];

/** The visible sidebar entry the current URL belongs to, if any. */
export const useActiveOrganisationsGroup = (
  pathname: string,
): OrganisationsSectionGroup | undefined => {
  const groups = useVisibleOrganisationsGroups();
  const section = sectionFromPath(pathname);
  return groups.find(group => group.sections.some(s => s.key === section));
};
