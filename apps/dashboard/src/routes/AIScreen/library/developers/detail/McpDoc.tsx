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
      {
        name: 'spaces_ticket_link_sub_ticket',
        description: 'Make an existing ticket a sub-ticket of another.',
        write: true,
      },
      {
        name: 'spaces_ticket_unlink_sub_ticket',
        description: 'Detach a sub-ticket from its parent.',
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

const SERVER_NAME = 'xyne-spaces';
const MCP_PACKAGE = '@xyne/spaces-mcp';
const SETUP_OPTIONS = [
  'Claude Code',
  'Cursor',
  'VS Code',
  'Claude Desktop and others',
  'In the xyne-spaces repo',
] as const;

/** How every client launches the published server, pointed at this deployment. */
function serverConfig(baseUrl: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return { command: 'npx', args: ['-y', MCP_PACKAGE], env: { XYNE_SPACES_BASE_URL: baseUrl } };
}

/** Cursor's install deep link takes the server config as base64 JSON. */
function cursorInstallUrl(baseUrl: string): string {
  const config = btoa(JSON.stringify(serverConfig(baseUrl)));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** VS Code's install deep link takes the named server config as URL-encoded JSON. */
function vscodeInstallUrl(baseUrl: string): string {
  const config = { name: SERVER_NAME, type: 'stdio', ...serverConfig(baseUrl) };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`;
}

function InstallLink({
  href,
  label,
  trackName,
}: {
  href: string;
  label: string;
  trackName: string;
}): ReactElement {
  return (
    <a
      href={href}
      data-track-category='Developer tools'
      data-track-name={trackName}
      className='flex h-8 w-fit items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90'
    >
      {label}
    </a>
  );
}

function ConnectInstructions({ option }: { option: (typeof SETUP_OPTIONS)[number] }): ReactElement {
  const baseUrl = spacesBaseUrl();
  if (option === 'In the xyne-spaces repo') {
    return (
      <Text>
        Nothing to do. The repo&apos;s <InlineCode>.mcp.json</InlineCode> registers the server and{' '}
        <InlineCode>pnpm install</InlineCode> builds it from{' '}
        <InlineCode>packages/xyne-spaces-mcp</InlineCode>, so an agent opened at the repo root
        already has it, running the latest code. Go straight to signing in.
      </Text>
    );
  }
  if (option === 'Claude Code') {
    return (
      <>
        <Text>Run this once. It adds the server to every project:</Text>
        <CodeBlock
          code={`claude mcp add --scope user ${SERVER_NAME} \\\n  --env XYNE_SPACES_BASE_URL=${baseUrl} \\\n  -- npx -y ${MCP_PACKAGE}`}
          trackName='Spaces MCP: copy Claude Code command'
        />
      </>
    );
  }
  if (option === 'Cursor') {
    return (
      <>
        <Text>Click to add it to Cursor, then confirm the install in Cursor:</Text>
        <InstallLink
          href={cursorInstallUrl(baseUrl)}
          label='Add to Cursor'
          trackName='Spaces MCP: install in Cursor'
        />
      </>
    );
  }
  if (option === 'VS Code') {
    return (
      <>
        <Text>
          Click to add it to VS Code, then confirm the install. Its tools are used in Copilot&apos;s
          agent mode.
        </Text>
        <InstallLink
          href={vscodeInstallUrl(baseUrl)}
          label='Add to VS Code'
          trackName='Spaces MCP: install in VS Code'
        />
      </>
    );
  }
  const config = JSON.stringify({ mcpServers: { [SERVER_NAME]: serverConfig(baseUrl) } }, null, 2);
  return (
    <>
      <Text>
        Add this to your client&apos;s MCP config and restart it. In Claude Desktop that is Settings
        → Developer → Edit Config; for Windsurf, Zed or Continue it is the client&apos;s own MCP
        config file.
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
          The server is published on npm as <InlineCode>{MCP_PACKAGE}</InlineCode> and your agent
          runs it with <InlineCode>npx</InlineCode>, so there is nothing to clone or build. You need{' '}
          <strong>Node.js 22</strong> or later.
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
              update tickets, add this to the server&apos;s <InlineCode>env</InlineCode> in your
              client&apos;s MCP config (with Claude Code, add{' '}
              <InlineCode>--env XYNE_SPACES_READONLY=0</InlineCode> to the command above), then
              restart your agent:
            </Text>
            <CodeBlock
              code='"XYNE_SPACES_READONLY": "0"'
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
