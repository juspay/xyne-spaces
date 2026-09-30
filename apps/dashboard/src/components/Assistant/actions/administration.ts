import type { ActionArea } from './action';

export const ADMINISTRATION = {
  id: 'administration',
  description:
    'Administration: inviting people, creating workspaces, organisations, user groups and roles, and seeing or editing the workspace settings, members, invitations, guests, user groups and roles that exist ("create a user", "set up my workspace", "manage members", "edit a role").',
  actions: [
    {
      id: 'invite_people',
      title: 'Invite people',
      hint: 'Bring your teammates into the workspace',
      guide: [
        "Under Send New Invitation, type the person's email address.",
        'Pick a role: Admin, Member or Guest (for a guest, also pick a channel or canvas).',
        'Click Send, then click Send Invitation to confirm.',
      ],
      intent: {
        description: 'Invite new people to join the workspace.',
        examples: [
          'I want to create a user',
          'Invite some users',
          'Add a new member',
          'Invite my teammates to the workspace',
          'Get my whole team in here',
          'Onboard my team',
        ],
        notFor: [
          {
            when: 'seeing pending invitations or revoking one',
            instead: 'that is manage_invitations',
          },
          {
            when: 'adding someone to a channel or a conversation',
            instead:
              'none of these: changing who is in an existing channel is not one of these actions',
          },
          {
            when: 'seeing, editing or removing people who already belong',
            instead: 'that is manage_members',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Invitations',
      plan: [{ op: 'open_page', page: 'admin_invitations' }],
      done: 'Opened Invitations.',
    },
    {
      id: 'manage_invitations',
      title: 'Manage invitations',
      hint: 'See pending invitations and revoke them',
      guide: [
        'Under Pending Invitations, see who has been invited and who has accepted.',
        'Click Revoke next to an invitation that has not been accepted.',
      ],
      intent: {
        description:
          'See the invitations that were sent, and revoke one that has not been accepted.',
        examples: [
          'How can I see pending invitations?',
          'Revoke an invitation',
          'Who have I invited but has not joined yet?',
          'Cancel an invitation I sent',
          'View all invitations',
        ],
        notFor: [
          {
            when: 'sending a new invitation',
            instead: 'that is invite_people',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Invitations',
      plan: [{ op: 'open_page', page: 'admin_invitations' }],
      done: 'Opened Invitations.',
    },
    {
      id: 'create_workspace',
      title: 'Create a workspace',
      hint: 'Add a community workspace',
      guide: [
        'Under Create Community Workspace, type a Workspace Name.',
        'Choose a Joining Policy: Open, Request to join or Invite only.',
        'Click Create Community Workspace.',
      ],
      intent: {
        description: 'Create a new workspace.',
        examples: [
          'I want to create a workspace',
          'Make a new workspace',
          'Add a workspace',
          'Create a workspace for my team',
        ],
        notFor: [
          {
            when: 'setting up, renaming or changing the workspace the user is already in',
            instead: 'that is workspace_settings',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Organisations',
      plan: [{ op: 'open_page', page: 'admin_organisations' }],
      done: 'Opened Organisations.',
    },
    {
      id: 'create_organisation',
      title: 'Create an organisation',
      hint: 'Set up a new organisation',
      guide: [
        'Click Create New Org.',
        'Fill in the Organisation Name, Workspace Name and Owner Email.',
        'Click Create.',
      ],
      intent: {
        description: 'Create a new organisation.',
        examples: [
          'Make a new org',
          'Create an organization',
          'I want to create an org',
          'Add a new organisation',
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Organisations',
      plan: [{ op: 'open_page', page: 'admin_organisations' }],
      done: 'Opened Organisations.',
    },
    {
      id: 'workspace_settings',
      title: 'Set up your workspace',
      hint: 'Change the name and description',
      guide: ['Edit the Workspace Name and, if needed, the Description.', 'Click Save Changes.'],
      intent: {
        description:
          'Open the settings of the current workspace to set it up, rename it or change it.',
        examples: [
          'Set up my workspace',
          'Rename the workspace',
          'Change the workspace settings',
          'Open the workspace settings',
        ],
        notFor: [
          {
            when: 'creating a new workspace',
            instead: 'that is create_workspace',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open General settings',
      plan: [{ op: 'open_page', page: 'admin_general' }],
      done: 'Opened General settings.',
    },
    {
      id: 'manage_members',
      title: 'Manage members',
      hint: 'See, edit and remove people',
      guide: [
        'Search for the person by name or email.',
        'Click Edit access to change which resources they can use.',
        'Open the More actions menu and choose Make admin, Make member or Remove from workspace.',
      ],
      intent: {
        description: 'See, edit or remove the people who already belong to the workspace.',
        examples: [
          'Manage members',
          'Make someone an admin',
          'Go to users',
          'Who has access to this workspace?',
          'Edit a member',
          'Remove a user from the workspace',
        ],
        notFor: [
          {
            when: 'inviting or adding new people',
            instead: 'that is invite_people',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Members',
      plan: [{ op: 'open_page', page: 'admin_members' }],
      done: 'Opened Members.',
    },
    {
      id: 'manage_guests',
      title: 'Manage guest users',
      hint: 'See guests and revoke their access',
      guide: [
        'Search by guest, email, entity or grant type.',
        "Click the bin icon on a grant, then click Revoke to remove that guest's access.",
        'Click Refresh to reload the list.',
      ],
      intent: {
        description: 'See the guests who have access to the workspace, and revoke their access.',
        examples: [
          'How do I see guest users?',
          'Manage guests',
          "Revoke a guest's access",
          'View all guests',
          'Who are the guests in my workspace?',
        ],
        notFor: [
          {
            when: 'inviting a new guest',
            instead: 'that is invite_people, with the Guest role',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Guest users',
      plan: [{ op: 'open_page', page: 'admin_guests' }],
      done: 'Opened Guest users.',
    },
    {
      id: 'create_user_group',
      title: 'Create a user group',
      hint: 'Group people to share access',
      guide: [
        'Click Create User Group.',
        'Type a User Group Name; the alias and description are optional.',
        'Open the Members tab to pick who belongs to it.',
        'Click Create User Group.',
      ],
      intent: {
        description: 'Create a user group, a named set of people who share access.',
        examples: [
          'Create a user group',
          'Add a team',
          'Make a new group',
          'Set up a user group for engineering',
        ],
        notFor: [
          {
            when: 'seeing or editing existing user groups',
            instead: 'that is manage_user_groups',
          },
          {
            when: 'creating a channel for a team to talk in',
            instead: 'that is create_channel; a channel is a conversation, not a user group',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open User groups',
      plan: [{ op: 'open_page', page: 'admin_user_groups' }],
      done: 'Opened User groups.',
    },
    {
      id: 'manage_user_groups',
      title: 'Manage user groups',
      hint: 'See, edit and deactivate groups',
      guide: [
        'Search for the group by name.',
        'Click Edit on its card. The About tab holds the name, alias and description; the Members tab holds the people.',
        'Click Update User Group to save changes to the details.',
        'Click Deactivate on a card to switch a group off, or Reactivate to turn it back on.',
      ],
      intent: {
        description:
          'See the existing user groups, edit one or change its members, or deactivate it.',
        examples: [
          'How can I edit a user group?',
          'Edit an existing user group',
          'Change the members of a group',
          'See all user groups',
          'I want to deactivate a group',
          'How do I change a team?',
        ],
        notFor: [
          {
            when: 'creating a new user group',
            instead: 'that is create_user_group',
          },
          {
            when: 'creating a channel for a team to talk in',
            instead: 'that is create_channel; a channel is a conversation, not a user group',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open User groups',
      plan: [{ op: 'open_page', page: 'admin_user_groups' }],
      done: 'Opened User groups.',
    },
    {
      id: 'create_role',
      title: 'Create a role',
      hint: 'Name a set of people to use across the workspace',
      guide: [
        'Click Create role (or New role if no role is selected).',
        'Type a Name in capitals and underscores, like XYNE_PM; the description is optional.',
        'Click Create, then click Add users to put people in it.',
      ],
      intent: {
        description:
          'Create a role, a named set of people that can be referenced across the workspace.',
        examples: [
          'Create a role',
          'Add new permissions',
          'Make a new role',
          'Set up a role for managers',
        ],
        notFor: [
          {
            when: 'seeing or editing existing roles',
            instead: 'that is manage_roles',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Roles',
      plan: [{ op: 'open_page', page: 'admin_roles' }],
      done: 'Opened Roles.',
    },
    {
      id: 'manage_roles',
      title: 'Manage roles',
      hint: 'See roles, edit them and change who has them',
      guide: [
        'Pick a role from the Roles list to see its members.',
        'Click Edit role, change the Name or Description, then click Save.',
        'Click Add users to put people in the role, or Remove next to someone to take them out.',
      ],
      intent: {
        description: 'See all roles, edit a role, or add and remove the people in it.',
        examples: [
          'How to see all roles?',
          'How to edit existing role?',
          'Edit a role',
          'Show me the members of a role',
          'Remove someone from a role',
          'View roles',
        ],
        notFor: [
          {
            when: 'creating a new role',
            instead: 'that is create_role',
          },
        ],
      },
      effect: 'navigate',
      fields: {},
      summarize: 'Open Roles',
      plan: [{ op: 'open_page', page: 'admin_roles' }],
      done: 'Opened Roles.',
    },
  ],
} satisfies ActionArea;
