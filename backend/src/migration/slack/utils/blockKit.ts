/**
 * Slack Block Kit Utilities
 * Common Block Kit structures for modals and messages
 */

export interface MigrationMessageData {
  syncDate?: string;
  userId?: string;
  syncOptions?: string[];
  xyneSpaceChannelId?: string;
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
          ],
        },
        optional: true,
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
        text: `Sync Date: ${today}`,
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
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Sync Date:*\n${data.syncDate || 'N/A'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Sync Options:*\n${optionsText}`,
        },
      ],
    },
    ...(data.xyneSpaceChannelId
      ? [
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Xyne Space Channel ID:*\n${data.xyneSpaceChannelId}`,
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
