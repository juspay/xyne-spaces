import { type ReactElement } from 'react';
import { spacesBaseUrl } from '../developerTools';
import {
  Callout,
  CodeBlock,
  DocSection,
  FeatureGrid,
  InlineCode,
  RefTable,
  StatRow,
  Step,
  Tabs,
  Text,
} from './docPrimitives';

interface McpTool {
  name: string;
  description: string;
  write?: boolean;
}

/** Every tool the server exposes, grouped as the agent meets them. */
const TOOL_GROUPS: { label: string; tools: McpTool[] }[] = [
  {
    label: 'Identity and search',
    tools: [
      { name: 'spaces_login', description: 'Sign in with Xyne SSO.' },
      { name: 'spaces_whoami', description: 'Who the session acts as, and when it expires.' },
      {
        name: 'spaces_search',
        description:
          'Full-text search across messages, tickets, channels, files, calls, emails, canvases and people.',
      },
      { name: 'spaces_users_list', description: 'Find people and their user ids.' },
    ],
  },
  {
    label: 'Channels, threads and messages',
    tools: [
      { name: 'spaces_channels_list', description: 'Channels you can see, with their ids.' },
      { name: 'spaces_channel_participants', description: "A channel's members and their roles." },
      { name: 'spaces_threads_list', description: 'Recent threads in a channel.' },
      { name: 'spaces_thread_get', description: 'One thread: opening message and participants.' },
      { name: 'spaces_messages_list', description: 'Every message in a thread, in full.' },
      { name: 'spaces_user_messages', description: 'What one person wrote, across Spaces.' },
      { name: 'spaces_drafts_list', description: 'Your unsent drafts.' },
      { name: 'spaces_channel_create', description: 'Create a channel.', write: true },
      { name: 'spaces_thread_create', description: 'Start a new thread.', write: true },
      { name: 'spaces_message_send', description: 'Reply in an existing thread.', write: true },
      { name: 'spaces_message_update', description: 'Edit a message you sent.', write: true },
      { name: 'spaces_message_react', description: 'Add or remove a reaction.', write: true },
    ],
  },
  {
    label: 'Tickets and projects',
    tools: [
      { name: 'spaces_tickets_list', description: 'Tickets for a project, board or person.' },
      { name: 'spaces_tickets_search', description: 'Find tickets by key or title.' },
      { name: 'spaces_ticket_get', description: 'One ticket in full.' },
      { name: 'spaces_ticket_activities', description: "A ticket's change history." },
      { name: 'spaces_projects_list', description: 'Projects and their ticket-key prefixes.' },
      { name: 'spaces_board_stages', description: "A project's boards and their stages." },
      { name: 'spaces_ticket_create', description: 'Create a ticket.', write: true },
      { name: 'spaces_ticket_update', description: 'Change ticket fields.', write: true },
      {
        name: 'spaces_ticket_transition',
        description: 'Move a ticket to another stage.',
        write: true,
      },
    ],
  },
  {
    label: 'Everything else',
    tools: [
      { name: 'spaces_notifications_list', description: 'Mentions, replies and ticket changes.' },
      { name: 'spaces_emails_list', description: 'Emails in a support desk or shared inbox.' },
      { name: 'spaces_calls_list', description: 'Calls and meetings.' },
      { name: 'spaces_canvases_list', description: 'Canvases: design notes, RFCs, meeting notes.' },
      { name: 'spaces_canvas_get', description: 'One canvas, as markdown.' },
      { name: 'spaces_claw_list_agents', description: 'Xyne Claw agents you can run.' },
      { name: 'spaces_claw_get_run', description: 'Status and result of a Claw run.' },
      {
        name: 'spaces_notifications_mark_read',
        description: 'Mark a notification as read.',
        write: true,
      },
      { name: 'spaces_claw_run', description: 'Hand a task to a Claw agent.', write: true },
    ],
  },
];

const ALL_TOOLS = TOOL_GROUPS.flatMap(group => group.tools);
const WRITE_COUNT = ALL_TOOLS.filter(tool => tool.write).length;

const SERVER_PATH = '<path-to-xyne-spaces>/packages/xyne-spaces-mcp/dist/index.js';
const SETUP_OPTIONS = ['In the xyne-spaces repo', 'Claude Code', 'Cursor and others'] as const;

function ConnectInstructions({ option }: { option: (typeof SETUP_OPTIONS)[number] }): ReactElement {
  const baseUrl = spacesBaseUrl();
  if (option === 'In the xyne-spaces repo') {
    return (
      <Text>
        Nothing to do. The repo&apos;s <InlineCode>.mcp.json</InlineCode> registers the server and{' '}
        <InlineCode>pnpm install</InlineCode> builds it, so an agent opened at the repo root already
        has it. Go straight to signing in.
      </Text>
    );
  }
  if (option === 'Claude Code') {
    return (
      <>
        <Text>To use it from any other project, register it once with Claude Code:</Text>
        <CodeBlock
          code={`claude mcp add --scope user xyne-spaces \\\n  --env XYNE_SPACES_BASE_URL=${baseUrl} \\\n  -- node ${SERVER_PATH}`}
          trackName='Spaces MCP: copy Claude Code command'
        />
      </>
    );
  }
  const config = JSON.stringify(
    {
      mcpServers: {
        'xyne-spaces': {
          command: 'node',
          args: [SERVER_PATH],
          env: { XYNE_SPACES_BASE_URL: baseUrl },
        },
      },
    },
    null,
    2,
  );
  return (
    <>
      <Text>
        Add it to your client&apos;s MCP config: <InlineCode>.cursor/mcp.json</InlineCode> for
        Cursor, or the equivalent file for Windsurf, Zed or Continue.
      </Text>
      <CodeBlock code={config} trackName='Spaces MCP: copy client config' />
    </>
  );
}

export function McpDoc(): ReactElement {
  return (
    <>
      <StatRow
        stats={[
          { value: String(ALL_TOOLS.length), label: 'tools' },
          { value: String(ALL_TOOLS.length - WRITE_COUNT), label: 'read tools, on by default' },
          { value: String(WRITE_COUNT), label: 'write tools, opt-in' },
          { value: 'SSO', label: 'sign-in, no keys to manage' },
        ]}
      />

      <DocSection
        eyebrow='Why use it'
        title='Your coding agent, with Spaces context'
        intro='Ask in plain language. The agent picks the tools, reads what it needs and answers with real links and ids.'
      >
        <FeatureGrid
          features={[
            {
              title: 'Catch up without opening Spaces',
              body: 'Summarise a channel, a thread or your notifications while you stay in the editor.',
              example: '“What did I miss in #deployments since yesterday?”',
            },
            {
              title: 'Work from tickets',
              body: 'Read a ticket and its history, then fix the bug it describes, with the context in hand.',
              example: '“Read XYNE-1234 and find the code it is about.”',
            },
            {
              title: 'Search everything you can see',
              body: 'Messages, tickets, canvases, emails, calls and people, ranked in one search.',
              example: '“Find the RFC canvas about rate limiting.”',
            },
            {
              title: 'Close the loop (with writes on)',
              body: 'Post the fix summary in the thread, move the ticket to review, react to a message.',
              example: '“Reply in that thread with what changed, then move the ticket to Review.”',
            },
          ]}
        />
      </DocSection>

      <DocSection eyebrow='Get started' title='Set up in three steps'>
        <Callout>
          The server ships in the <strong>xyne-spaces</strong> repository at{' '}
          <InlineCode>packages/xyne-spaces-mcp</InlineCode>. Clone the repo and run{' '}
          <InlineCode>pnpm install</InlineCode>, which builds it.
        </Callout>
        <div className='flex flex-col'>
          <Step n={1} title='Connect it to your agent'>
            <Tabs
              options={SETUP_OPTIONS}
              trackPrefix='Spaces MCP setup'
              render={option => <ConnectInstructions option={option} />}
            />
          </Step>
          <Step n={2} title='Sign in with Xyne SSO'>
            <Text>
              Ask your agent to run <InlineCode>spaces_login</InlineCode>. It opens an approval page
              and shows a short code. Check the page shows the same code as your terminal, then
              approve.
            </Text>
            <Callout tone='warning'>
              Never approve a sign-in link someone else sent you: approving gives whoever started it
              access to your account.
            </Callout>
          </Step>
          <Step n={3} title='Choose what it may do'>
            <Text>
              It starts <strong>read-only</strong>. To let it send messages, create threads and
              update tickets, turn writes on and restart your agent:
            </Text>
            <CodeBlock
              code='export XYNE_SPACES_READONLY=0'
              trackName='Spaces MCP: copy enable writes'
            />
            <Text>Writes are real and immediate, and other people see them.</Text>
          </Step>
        </div>
      </DocSection>

      <DocSection
        eyebrow='Reference'
        title='Every tool'
        intro='Tools marked “write” only appear once writes are turned on.'
      >
        {TOOL_GROUPS.map(group => (
          <div key={group.label} className='flex flex-col gap-2'>
            <span className='text-xs font-medium text-muted-foreground'>{group.label}</span>
            <RefTable
              rows={group.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                ...(tool.write ? { tag: { label: 'write', write: true } } : {}),
              }))}
            />
          </div>
        ))}
      </DocSection>
    </>
  );
}
