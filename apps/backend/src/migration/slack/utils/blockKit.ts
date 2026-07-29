/**
 * Slack Block Kit Utilities
 * Common Block Kit structures for modals and messages
 */

export interface MigrationMessageData {
  syncDate?: string;
  userId?: string;
  syncOptions?: string[];
  xyneSpaceChannelId?: string;
  isJiraffeMigration?: boolean;
}

function formatSyncOptions(syncOptions?: string[]): string {
  if (!syncOptions || syncOptions.length === 0) {
    return 'None';
  }
  return syncOptions.join(', ');
}

export function getSyncModal(channelId?: string) {
  return {
    type: 'modal',
    callback_id: 'sync_modal',
    private_metadata: channelId ? JSON.stringify({ channel_id: channelId }) : undefined,
    title: {
      type: 'plain_text',
      text: 'Sync Configuration',
    },
    submit: {
      type: 'plain_text',
      text: 'Start Sync',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'sync_date',
        label: {
          type: 'plain_text',
          text: 'Select Start Date',
        },
        element: {
          type: 'datepicker',
          action_id: 'sync_date_picker',
          placeholder: {
            type: 'plain_text',
            text: 'Pick a start date',
          },
        },
      },
      {
        type: 'input',
        block_id: 'xyne_space_channel_id',
        label: {
          type: 'plain_text',
          text: 'Xyne Space Channel ID',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'xyne_space_channel_input',
          placeholder: {
            type: 'plain_text',
            text: 'Enter Xyne Space channel ID',
          },
        },
      },
      {
        type: 'input',
        block_id: 'sync_options',
        label: {
          type: 'plain_text',
          text: 'Sync Options',
        },
        element: {
          type: 'checkboxes',
          action_id: 'sync_checkboxes',
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'Include thread conversation',
              },
              value: 'include_threads',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Include attachments',
              },
              value: 'include_attachments',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Include conversation from deactivated users',
              },
              value: 'include_deactivated_users',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Include bot messages',
              },
              value: 'include_bot_messages',
            },
          ],
        },
        optional: true,
      },
    ],
  };
}

export function getSyncJiraffeModal(channelId?: string) {
  return {
    type: 'modal',
    callback_id: 'sync_jiraffe_modal',
    private_metadata: channelId ? JSON.stringify({ channel_id: channelId }) : undefined,
    title: {
      type: 'plain_text',
      text: 'Sync Jiraffe',
    },
    submit: {
      type: 'plain_text',
      text: 'Start Sync',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'all_titles_checkbox',
        label: {
          type: 'plain_text',
          text: 'All tickets',
        },
        element: {
          type: 'checkboxes',
          action_id: 'all_titles_checkbox_action',
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'All tickets',
              },
              value: 'all_titles',
            },
          ],
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'sync_date',
        label: {
          type: 'plain_text',
          text: 'Select Start Date',
        },
        element: {
          type: 'datepicker',
          action_id: 'sync_date_picker',
          placeholder: {
            type: 'plain_text',
            text: 'Pick a start date',
          },
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'xyne_space_channel_id',
        label: {
          type: 'plain_text',
          text: 'Xyne Space Channel ID',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'xyne_space_channel_input',
          placeholder: {
            type: 'plain_text',
            text: 'Enter Xyne Space channel ID',
          },
        },
      },
    ],
  };
}

export function getSyncParticipantsModal(channelId?: string) {
  return {
    type: 'modal',
    callback_id: 'sync_participants_modal',
    private_metadata: channelId ? JSON.stringify({ channel_id: channelId }) : undefined,
    title: {
      type: 'plain_text',
      text: 'Sync Participants',
    },
    submit: {
      type: 'plain_text',
      text: 'Start Sync',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'xyne_space_channel_id',
        label: {
          type: 'plain_text',
          text: 'Xyne Space Channel ID',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'xyne_space_channel_input',
          placeholder: {
            type: 'plain_text',
            text: 'Enter Xyne Space channel ID',
          },
        },
      },
    ],
  };
}

export function getSyncDmModal(channelId?: string) {
  return {
    type: 'modal',
    callback_id: 'sync_dm_modal',
    private_metadata: channelId ? JSON.stringify({ channel_id: channelId }) : undefined,
    title: {
      type: 'plain_text',
      text: 'Sync All DMs',
    },
    submit: {
      type: 'plain_text',
      text: 'Start Sync',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':information_source: This will migrate *all your DMs* (1:1 and group) to Xyne Spaces. Existing conversations will have messages inserted; new ones will be created automatically.',
        },
      },
      {
        type: 'input',
        block_id: 'user_token',
        label: {
          type: 'plain_text',
          text: 'Your Slack User Token',
        },
        hint: {
          type: 'plain_text',
          text: ':key: *How to get your Slack User Token:*\n1. Ensure you are an app collaborator for **Xyne Spaces**.\n2. Navigate to <https://app.slack.com/app-settings/T04T5CL7L/A09QL5AE5PY/oauth|App OAuth Settings> to request installation.\n3. Once approved, copy your token (`xoxp-...`) from either the *OAuth & Permissions* or *Install App* tabs.',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'user_token_input',
          placeholder: {
            type: 'plain_text',
            text: 'xoxp-...',
          },
        },
      },
    ],
  };
}

export function getMigrationMessageBlocks(data: MigrationMessageData) {
  const optionsText = formatSyncOptions(data.syncOptions);
  const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${data.isJiraffeMigration ? 'Jiraffe' : ''} Sync Date: ${today}`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Triggered by:* <@${data.userId}>`,
        },
      ],
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Data filled in form:*',
      },
    },
    ...(data.syncDate || (data.syncOptions && data.syncOptions.length > 0)
      ? [
          {
            type: 'section',
            fields: [
              ...(data.syncDate
                ? [
                    {
                      type: 'mrkdwn',
                      text: `*Sync Date:*\n${data.syncDate}`,
                    },
                  ]
                : []),
              ...(data.syncOptions && data.syncOptions.length > 0
                ? [
                    {
                      type: 'mrkdwn',
                      text: `*Sync Options:*\n${optionsText}`,
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(data.xyneSpaceChannelId
      ? [
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Xyne Space Channel:*\n${data.xyneSpaceChannelId}`,
              },
            ],
          },
        ]
      : []),
  ];
}

export function getMigrationMessageFallbackText(syncDate?: string): string {
  return `Sync Date: ${syncDate || 'N/A'}`;
}
