import { hasValue, type ActionDefinition } from './action';

export const ADMINISTRATION_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'invite_people',
    starter: 1,
    title: 'Invite people',
    hint: 'Bring your teammates into the workspace',
    guide: [
      'Under Send New Invitation, type their email and pick Admin, Member or Guest.',
      'A guest also needs a channel or canvas, picked below.',
      'Click Send, then Send Invitation.',
    ],
    intent: {
      description:
        'Invite a new person to join the workspace by their email address, which is how a user is created or added.',
      examples: [
        'I want to create a user',
        'Can you create a user for me?',
        'Add a user',
        'Invite Vinit@juspay.in',
        'Invite priya dot nair at juspay dot in as admin',
        'Invite ravi@acme.com as a guest to #design',
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
          instead: 'that is add_to_channel',
        },
        {
          when: 'seeing, editing or removing people who already belong',
          instead: 'that is manage_members',
        },
        {
          when: 'changing the role of someone who already belongs',
          instead: 'that is change_member_role',
        },
      ],
    },
    effect: 'send',
    fields: {
      email: {
        kind: 'text',
        parse: 'email',
        required: true,
        ask: "What's the email address of the person to invite?",
        label: 'email',
        describe: 'the email address of the person to invite, as said or typed',
      },
      // The page's own default: not asked, unless the user says otherwise.
      role: {
        kind: 'choice',
        default: 'Member',
        ask: 'Should they join as a member, an admin or a guest?',
        label: 'role',
        describe: 'the role they join with: member, admin or guest',
        options: [
          { id: 'member', label: 'Member' },
          { id: 'admin', label: 'Admin' },
          { id: 'guest', label: 'Guest' },
        ],
      },
      // Optional with no offer: a guest without one is refused, and picks it on the page.
      channel: {
        kind: 'channel',
        ask: 'Which channel should the guest join?',
        label: 'to',
        describe: 'for a guest only: the channel they are invited to, just its name',
      },
    },
    // One address at a time: several said together are chosen from, one by one.
    summary: ({ email, role, channel }): string => {
      const guestOf = role?.trim() === 'Guest' && channel?.trim() ? ` to #${channel.trim()}` : '';
      return `Invite ${email?.trim()} as ${role?.trim() || 'Member'}${guestOf}`;
    },
    plan: [
      { op: 'fill', form: 'invite' },
      { op: 'submit', form: 'invite' },
    ],
    done: 'Invitation sent to {email}.',
    onRefused: [
      {
        when: /not part of any organi[sz]ation/i,
        offer: 'add_to_organisation',
        say: "{email} isn't in your organisation yet. Want me to add them to the organisation first?",
      },
    ],
  },
  {
    id: 'add_to_organisation',
    title: 'Add to organisation',
    hint: 'Add someone to your organisation by email',
    guide: ['Open your organisation, type their email under Add Member by Email, and click Add.'],
    intent: {
      description:
        'Add a person to the organisation by their email address, which they need before they can be invited to a workspace.',
      examples: [
        'add deepanshu@juspay.in to the organisation',
        'add him to our org first',
        'add priya dot nair at juspay dot in to my organisation',
        'put this email in the organisation',
      ],
      notFor: [
        {
          when: 'inviting someone to the workspace',
          instead: 'that is invite_people',
        },
        {
          when: 'seeing or creating organisations',
          instead: 'that is manage_organisations',
        },
      ],
    },
    effect: 'change',
    fields: {
      email: {
        kind: 'text',
        parse: 'email',
        required: true,
        ask: "What's the email address of the person to add to the organisation?",
        label: 'email',
        describe: 'the email address of the person to add, as said or typed',
      },
    },
    summary: ({ email }): string => `Add ${email?.trim()} to your organisation`,
    // Done as the organisation's Add Member by Email does it, by those who may open that page.
    plan: [{ op: 'perform', task: 'addToOrganisation', page: 'admin_organisations' }],
    done: '{email} is in your organisation now.',
  },
  {
    id: 'revoke_invitation',
    title: 'Revoke an invitation',
    hint: 'Take back an invitation that was not accepted',
    guide: ['Under Pending Invitations, find their email and click Revoke.'],
    intent: {
      description: 'Revoke the pending invitation that was sent to one email address.',
      examples: [
        'Revoke the invite for priya@acme.com',
        'Cancel the invitation to rahul at juspay dot in',
        'Take back the invite I sent to neha@example.com',
      ],
      notFor: [
        {
          when: 'seeing pending invitations, or revoking one without saying whose',
          instead: 'that is manage_invitations',
        },
        {
          when: 'revoking every invitation, or several at once',
          instead: 'none of these: a bulk or destructive request is not one of these actions',
        },
      ],
    },
    effect: 'change',
    fields: {
      email: {
        kind: 'text',
        parse: 'email',
        required: true,
        ask: 'Which email address was the invitation sent to?',
        label: 'email',
        describe: 'the email address the invitation was sent to, as said or typed',
      },
    },
    summary: ({ email }): string => `Revoke the invitation to ${email?.trim()}`,
    plan: [{ op: 'perform', task: 'revokeInvitation', page: 'admin_invitations' }],
    done: 'Revoked the invitation to {email}.',
  },
  {
    id: 'manage_invitations',
    title: 'Manage invitations',
    hint: 'See pending invitations and revoke them',
    guide: ['Pending Invitations lists each one sent; click Revoke beside one to take it back.'],
    intent: {
      description: 'See the invitations that were sent, and revoke one that has not been accepted.',
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
        {
          when: 'revoking the invitation sent to an email address the user gives',
          instead: 'that is revoke_invitation',
        },
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'admin_invitations' }],
  },
  {
    id: 'manage_organisations',
    title: 'Manage organisations',
    hint: 'See organisations and their members',
    guide: ['Open an organisation to see its members, add one by email, or change their role.'],
    intent: {
      description: 'See the organisations and their members, or manage who belongs to one.',
      examples: [
        'Show organisations',
        'Who is in our organisation?',
        'Open the organisations page',
        'Show the join requests',
      ],
      notFor: [
        {
          when: 'creating a new organisation or workspace',
          instead: 'that is create_organisation or create_workspace',
        },
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'admin_organisations' }],
  },
  {
    id: 'create_workspace',
    title: 'Create a workspace',
    hint: 'Add a community workspace',
    guide: [
      'Under Create Community Workspace, which an organisation owner or admin sees, type a Workspace Name, pick a Joining Policy and click Create Community Workspace.',
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
    effect: 'change',
    fields: {
      name: {
        kind: 'text',
        required: true,
        ask: 'What should the workspace be called?',
        label: 'name',
        describe: "the new workspace's name, often after 'called' or 'named'",
      },
      // The page's own default: not asked, unless the user says otherwise.
      joining: {
        kind: 'choice',
        default: 'Open',
        ask: 'Who can join: anyone, those you approve, or only those invited?',
        label: 'joining',
        describe:
          'who may join: open (anyone), request to join (approved by an admin) or invite only',
        options: [
          { id: 'open', label: 'Open' },
          { id: 'request', label: 'Request to join' },
          { id: 'invite', label: 'Invite only' },
        ],
      },
    },
    plan: [
      { op: 'fill', form: 'workspace_create' },
      { op: 'submit', form: 'workspace_create' },
    ],
    done: 'Done — {name} is created. Opening it now.',
  },
  {
    id: 'create_organisation',
    title: 'Create an organisation',
    hint: 'Set up a new organisation',
    guide: [
      'Click Create New Org.',
      'Fill in Organisation Name, Workspace Name and Owner Email, then click Create.',
    ],
    intent: {
      description: 'Create a new organisation.',
      examples: [
        'Make a new org',
        'Create an organization',
        'I want to create an org',
        'Add a new organisation',
        'Create an org called Acme owned by ceo@acme.com',
      ],
    },
    effect: 'change',
    fields: {
      name: {
        kind: 'text',
        required: true,
        ask: 'What should the organisation be called?',
        label: 'name',
        describe: "the new organisation's name, often after 'called' or 'named'",
      },
      workspace: {
        kind: 'text',
        required: true,
        ask: 'What should its first workspace be called?',
        label: 'workspace',
        describe: "the name of the organisation's first workspace",
      },
      owner: {
        kind: 'text',
        parse: 'email',
        required: true,
        ask: "What's the email address of its owner?",
        label: 'owner',
        describe: 'the email address of the person who will own it, as said or typed',
      },
    },
    plan: [
      { op: 'fill', form: 'organisation_create' },
      { op: 'submit', form: 'organisation_create' },
    ],
    done: 'Done — {name} is created, and an invitation is on its way to {owner}.',
  },
  {
    id: 'workspace_settings',
    title: 'Set up your workspace',
    hint: 'See the workspace settings',
    guide: [
      'Under General Settings, edit the Workspace Name and Description, then click Save Changes.',
    ],
    intent: {
      description: 'Open the settings of the current workspace, to look at or set them up.',
      examples: [
        'Set up my workspace',
        'Change the workspace settings',
        'Open the workspace settings',
        'Show the general settings',
      ],
      notFor: [
        {
          when: 'creating a new workspace',
          instead: 'that is create_workspace',
        },
        {
          when: 'giving the workspace a new name or description',
          instead: 'that is rename_workspace',
        },
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'admin_general' }],
  },
  {
    id: 'rename_workspace',
    title: 'Rename the workspace',
    hint: 'Change its name or description',
    guide: [
      'Under General Settings, edit the Workspace Name and Description, then click Save Changes.',
    ],
    intent: {
      description: 'Change the name or the description of the workspace the user is in.',
      examples: [
        'Rename the workspace to Design Team',
        'Rename the workspace',
        'Change the workspace description to where the design team works',
        'Update the workspace name',
      ],
      notFor: [
        {
          when: 'creating a new workspace',
          instead: 'that is create_workspace',
        },
      ],
    },
    effect: 'change',
    fields: {
      name: {
        kind: 'text',
        ask: 'What should the workspace be called?',
        label: 'name',
        describe: "the workspace's new name, often after 'to' or 'called'",
      },
      description: {
        kind: 'longtext',
        ask: 'What should its description say?',
        label: 'description',
        describe: "the workspace's new description, in the user's words",
      },
    },
    requireOneOf: ['name', 'description'],
    summary: ({ name, description }): string =>
      [
        hasValue(name) && `Rename the workspace to “${name.trim()}”`,
        hasValue(description) &&
          `${hasValue(name) ? 'set' : 'Set'} its description to “${description.trim()}”`,
      ]
        .filter(Boolean)
        .join(', and '),
    plan: [
      { op: 'fill', form: 'workspace_general' },
      { op: 'submit', form: 'workspace_general' },
    ],
    done: 'Done — the workspace settings are saved.',
  },
  {
    id: 'manage_members',
    title: 'Manage members',
    hint: 'See, edit and remove people',
    guide: [
      'Search members by name or email.',
      'The menu beside a member makes them an admin or a member, or removes them; Edit access sets what they can use.',
    ],
    intent: {
      description: 'See, edit or remove the people who already belong to the workspace.',
      examples: [
        'Manage members',
        'Go to users',
        'Who has access to this workspace?',
        'Edit a member',
        'Show me the members',
      ],
      notFor: [
        {
          when: 'inviting or adding new people',
          instead: 'that is invite_people',
        },
        {
          when: 'making someone an admin or a member, or changing their role',
          instead: 'that is change_member_role',
        },
        {
          when: 'removing one person from the workspace',
          instead: 'that is remove_member',
        },
        {
          when: 'adding someone to a channel',
          instead: 'that is add_to_channel',
        },
        {
          when: 'removing, deleting or revoking everyone or everything at once, or asking to be given power',
          instead: 'none of these: a bulk or destructive request is not one of these actions',
        },
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'admin_members' }],
  },
  {
    id: 'change_member_role',
    title: "Change a member's role",
    hint: 'Make someone an admin or a member',
    guide: ['On Members, open the menu beside them and choose Make admin or Make member.'],
    intent: {
      description:
        'Make one person who already belongs to the workspace an admin, or a member again.',
      examples: [
        'Make Priya an admin',
        'Change the role of Rahul to admin',
        'I want to change the role of a user',
        'Make Neha a member again',
        'Promote Ankit to admin',
      ],
      notFor: [
        {
          when: 'inviting someone new, even as an admin, or anyone named by email',
          instead: 'that is invite_people',
        },
        {
          when: 'creating, editing or filling roles, the named sets of people',
          instead: 'that is create_role or manage_roles',
        },
        {
          when: 'changing everyone at once, or asking to be given power',
          instead: 'none of these: a bulk or destructive request is not one of these actions',
        },
      ],
    },
    effect: 'change',
    fields: {
      person: {
        kind: 'person',
        required: true,
        ask: 'Whose role should I change?',
        label: 'member',
        describe: 'the one person whose workspace role changes',
      },
      role: {
        kind: 'choice',
        required: true,
        ask: 'Should they be an admin or a member?',
        label: 'role',
        describe: 'the workspace role they get: admin or member',
        options: [
          { id: 'admin', label: 'Admin' },
          { id: 'member', label: 'Member' },
        ],
      },
    },
    summary: ({ person, role }): string => `Change ${person?.trim()}'s role to ${role?.trim()}`,
    plan: [{ op: 'perform', task: 'changeMemberRole', page: 'admin_members' }],
    done: "Done — {person}'s role is now {role}.",
  },
  {
    id: 'remove_member',
    title: 'Remove a member',
    hint: 'Take one person out of the workspace',
    guide: ['On Members, open the menu beside them, choose Remove from workspace, then Remove.'],
    intent: {
      description: 'Remove one named person from the workspace, so they lose access to it.',
      examples: [
        'Remove Rahul from the workspace',
        'Remove a user from the workspace',
        'Take Ankit out of this workspace',
        'Kick Priya out of the workspace',
      ],
      notFor: [
        {
          when: 'removing someone from a channel',
          instead: 'none of these: removing people from a channel is not one of these actions',
        },
        {
          when: 'removing, deleting or revoking everyone or several people at once',
          instead: 'none of these: a bulk or destructive request is not one of these actions',
        },
        {
          when: "revoking a guest's access",
          instead: 'that is manage_guests',
        },
      ],
    },
    effect: 'change',
    fields: {
      person: {
        kind: 'person',
        required: true,
        ask: 'Who should I remove from the workspace?',
        label: 'removing',
        describe: 'the one person to remove from the workspace',
      },
    },
    summary: ({ person }): string =>
      `Remove ${person?.trim()} from the workspace, so they lose access to everything in it`,
    plan: [{ op: 'perform', task: 'removeMember', page: 'admin_members' }],
    done: '{person} has been removed from the workspace.',
  },
  {
    id: 'manage_guests',
    title: 'Manage guest users',
    hint: 'See guests and revoke their access',
    guide: [
      'Search guests by name, email or what they can open, and click Revoke to end their access.',
      'To invite a guest, use Invitations and pick Guest.',
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
        {
          when: 'removing, deleting or revoking everyone or everything at once',
          instead: 'none of these: a bulk or destructive request is not one of these actions',
        },
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'admin_guests' }],
  },
  {
    id: 'repository_credentials',
    title: 'Manage repository credentials',
    hint: 'Connect GitHub or Bitbucket',
    // Tokens are pasted by the user into the page; the assistant never takes one.
    guide: [
      'Click Add credential, pick GitHub or Bitbucket, and paste the token there yourself.',
      'Replace token or delete a credential from its row.',
    ],
    intent: {
      description:
        'See, add or replace the GitHub or Bitbucket credentials the workspace uses for repositories.',
      examples: [
        'Where can I add repository credentials?',
        'Add a GitHub token',
        'Connect Bitbucket',
        'Replace the repo token',
        'Show the repository credentials',
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'admin_repository_credentials' }],
  },
  {
    id: 'toolbar_settings',
    title: 'Set up the toolbar',
    hint: 'Choose the toolbar items everyone sees',
    guide: ['Search the toolbar items, and switch each one on or off for the workspace.'],
    intent: {
      description: "Choose which items the workspace's toolbar shows, for everyone in it.",
      examples: [
        'Hide an item from the toolbar',
        'Change the toolbar',
        'Where can I turn off toolbar items?',
        'Show the toolbar settings',
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'admin_toolbar' }],
  },
  {
    id: 'create_user_group',
    title: 'Create a user group',
    hint: 'Group people to share access',
    guide: [
      'Click Create User Group and type a User Group Name, and a description if you like.',
      'Add people on the Members tab, then click Create User Group.',
    ],
    intent: {
      description: 'Create a user group, a named set of people who share access.',
      examples: [
        'Create a user group',
        'Add a team',
        'Make a new group',
        'Set up a user group for engineering',
        'Create a user group called platform',
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
    effect: 'change',
    fields: {
      name: {
        kind: 'text',
        required: true,
        ask: 'What should the user group be called?',
        label: 'name',
        describe:
          "the user group's name, often after 'called', 'named' or 'for' (a team like finance)",
      },
      // Optional with no offer: it is only filled in when the user says it.
      description: {
        kind: 'longtext',
        ask: 'What is the group for?',
        label: 'description',
        describe: "what the group is for, in the user's words; not its name",
      },
    },
    plan: [
      { op: 'fill', form: 'user_group_create' },
      { op: 'submit', form: 'user_group_create' },
    ],
    done: 'Done — {name} is created. Add its members on the Members tab.',
  },
  {
    id: 'manage_user_groups',
    title: 'Manage user groups',
    hint: 'See, edit and deactivate groups',
    guide: [
      'Each group has Edit, to rename it or change its members, and Deactivate.',
      'Taking someone out asks whether to hand off their open tickets.',
    ],
    intent: {
      description:
        'See the existing user groups, edit one or change its members, or deactivate it.',
      examples: [
        'How can I edit a user group?',
        'See all user groups',
        'Remove Rahul from the finance group',
        'I want to deactivate a group',
        'Show the user groups',
      ],
      notFor: [
        {
          when: 'creating a new user group',
          instead: 'that is create_user_group',
        },
        {
          when: 'renaming a group the user names, or adding people to it',
          instead: 'that is update_user_group',
        },
        {
          when: 'creating a channel for a team to talk in',
          instead: 'that is create_channel; a channel is a conversation, not a user group',
        },
      ],
    },
    effect: 'navigate',
    fields: {},
    plan: [{ op: 'open_page', page: 'admin_user_groups' }],
  },
  {
    id: 'update_user_group',
    title: 'Update a user group',
    hint: 'Rename a group or add people to it',
    guide: ['Click Edit on the group: rename it under About, and add people on the Members tab.'],
    intent: {
      description: 'Rename an existing user group the user names, or add people to it.',
      examples: [
        'Add Priya and Rahul to the finance group',
        'Rename the finance group to accounts',
        'Put Neha in the platform team',
        'Update the design user group',
      ],
      notFor: [
        {
          when: 'removing people from a group, or deactivating it',
          instead: 'that is manage_user_groups',
        },
        {
          when: 'adding someone to a channel',
          instead: 'that is add_to_channel',
        },
        {
          when: 'adding everyone at once',
          instead: 'none of these: a bulk request is not one of these actions',
        },
      ],
    },
    effect: 'change',
    fields: {
      group: {
        kind: 'text',
        required: true,
        ask: 'Which user group?',
        label: 'group',
        describe:
          "the existing group's name, the words before 'group' or 'team': finance in 'the finance group'",
      },
      add: {
        kind: 'people',
        ask: 'Who should I add to it?',
        label: 'adding',
        describe: 'the people to add to the group',
      },
      name: {
        kind: 'text',
        ask: 'What should it be called now?',
        label: 'renamed to',
        describe: "the group's new name, after 'rename to' or 'call it'",
      },
    },
    requireOneOf: ['add', 'name'],
    summary: ({ group, add, name }): string =>
      `Update the user group ${group?.trim()}: ${[
        hasValue(add) && `add ${add.trim()}`,
        hasValue(name) && `rename it to “${name.trim()}”`,
      ]
        .filter(Boolean)
        .join(', and ')}`,
    plan: [{ op: 'perform', task: 'updateUserGroup', page: 'admin_user_groups' }],
    done: 'Done — {group} is updated.',
  },
  {
    id: 'create_role',
    title: 'Create a role',
    hint: 'Name a set of people to use across the workspace',
    guide: [
      'Click Create role and type a Name in capitals, like XYNE_PM, and a description if you like.',
      'Click Create, then Add members to it.',
    ],
    intent: {
      description:
        'Create a role, a named set of people that can be referenced across the workspace.',
      examples: [
        'Create a role',
        'Add new permissions',
        'Make a new role',
        'Set up a role for managers',
        'Can you create a new role? Say moderator.',
        'Make a role called moderator',
      ],
      notFor: [
        {
          when: 'seeing or editing existing roles',
          instead: 'that is manage_roles',
        },
      ],
    },
    effect: 'change',
    fields: {
      name: {
        kind: 'text',
        required: true,
        ask: 'What should the role be called?',
        label: 'name',
        describe: "the role's name, often after 'called', 'named' or 'say'; not what it is for",
      },
      // Optional with no offer: it is only filled in when the user says it.
      description: {
        kind: 'longtext',
        ask: 'What is the role for?',
        label: 'description',
        describe: "what the role is for, in the user's words; not its name",
      },
    },
    plan: [
      { op: 'fill', form: 'role_create' },
      { op: 'submit', form: 'role_create' },
    ],
    done: 'Done — {name} is created. Add people to it on the page.',
  },
  {
    id: 'manage_roles',
    title: 'Manage roles',
    hint: 'See roles, edit them and change who has them',
    guide: [
      'Pick a role on the left.',
      'Edit role renames or describes it; Add members and Remove change who has it.',
    ],
    intent: {
      description: 'See all roles, edit a role, or add and remove the people in it.',
      examples: [
        'How to see all roles?',
        'How to edit existing role?',
        'Edit the moderator role',
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
    plan: [{ op: 'open_page', page: 'admin_roles' }],
  },
];
