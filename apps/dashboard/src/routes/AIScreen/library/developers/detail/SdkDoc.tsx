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
  Text,
} from './docPrimitives';
import { WhichToolCompare } from './WhichToolCompare';

/** The client's resources (`sdk.<name>`), as declared on SpacesClient. */
const RESOURCES: { name: string; description: string }[] = [
  { name: 'users', description: 'The signed-in user and people profiles.' },
  { name: 'search', description: 'Full-text search across everything the user can see.' },
  { name: 'channels', description: 'Membership, settings, participants, sidebar sections.' },
  { name: 'conversations', description: 'Threads: listing, reading, pinning, subscriptions.' },
  { name: 'messages', description: 'Messages, reactions, drafts and scheduled sends.' },
  { name: 'activities', description: 'The activity feed and its read state.' },
  { name: 'tickets', description: 'Tickets, sub-tickets, tags, references and approvals.' },
  { name: 'supportTickets', description: 'The support-desk view of tickets.' },
  { name: 'boards', description: 'Boards, stages, transitions and SLA policies.' },
  { name: 'projects', description: 'Projects and their tags, fields and applications.' },
  { name: 'canvases', description: 'Canvases: content, sharing, comments, versions, folders.' },
  { name: 'collections', description: 'Knowledge-base collections and permissions.' },
  { name: 'forms', description: 'Custom forms, mappings and submitted values.' },
  { name: 'calls', description: 'Calls, scheduling, participation and recordings.' },
  { name: 'email', description: 'Desk email: drafts, signatures, read state, labels.' },
  { name: 'recaps', description: 'Daily channel and project recaps, and nudges.' },
  { name: 'attachments', description: 'File uploads.' },
  { name: 'userGroups', description: 'Teams, membership and assignment routing.' },
  { name: 'dashboards', description: 'Dashboards, saved queries and tile layout.' },
  { name: 'automations', description: 'Automations and their approval lifecycle.' },
  { name: 'incidents', description: 'RCAs, impacts, corrective actions, release attribution.' },
  { name: 'preferences', description: "The user's settings, bookmarks and saved views." },
  { name: 'workspace', description: 'Shared links, repositories, emoji and reference data.' },
  { name: 'admin', description: 'Workspace and organisation administration.' },
  { name: 'claw', description: 'Run Xyne Claw agents and read their results.' },
  { name: 'connectors', description: 'External services through the user’s own connections.' },
];

export function SdkDoc(): ReactElement {
  const baseUrl = spacesBaseUrl();

  const quickStart = `import { createClient, xyneSsoLoginAndWait } from '@xyne/spaces-sdk';

const baseUrl = '${baseUrl}';

// Prints a link and a short code; the user approves in the browser.
const session = await xyneSsoLoginAndWait({ baseUrl, openBrowser: true });

const sdk = createClient({ baseUrl, session });
const me = await sdk.users.me();
console.log(\`Signed in as \${me.email}\`);`;

  return (
    <>
      <StatRow
        stats={[
          { value: '26', label: 'resources' },
          { value: '488', label: 'typed methods' },
          { value: '0', label: 'runtime dependencies' },
          { value: 'Node + web', label: 'runs in Node 18+ and browsers' },
        ]}
      />

      <DocSection
        eyebrow='Is this the right tool?'
        title='For apps that run outside Spaces'
        intro='Building something that lives inside Spaces instead? That is what the CLI is for.'
      >
        <WhichToolCompare current='sdk' />
      </DocSection>

      <DocSection
        eyebrow='What you can build'
        title='Everything the Spaces app does, from your own code'
        intro='Every read and write the product performs is a typed method, and every call runs as the signed-in user with their permissions.'
      >
        <FeatureGrid
          features={[
            {
              title: 'Bots and integrations',
              body: 'Post into threads when a deploy fails, a build finishes or an alert fires.',
              example: "await sdk.messages.send({ conversationId, content: 'Deploy is green.' });",
            },
            {
              title: 'Search-powered tools',
              body: 'Ranked search across messages, tickets, canvases, calls and people.',
              example: "await sdk.search.query({ q: 'rate limiting' });",
            },
            {
              title: 'Ticket workflows',
              body: 'Create, assign and tag tickets from your own forms, scripts or pipelines.',
              example: 'await sdk.tickets.assign(ticketId, userId);',
            },
            {
              title: 'AI agents on demand',
              body: 'Hand a task to a Xyne Claw agent and get its answer back, no extra credentials.',
              example: "await sdk.claw.runAndWait({ agent: 'ask-ai', task: '…' });",
            },
          ]}
        />
      </DocSection>

      <DocSection eyebrow='Get started' title='From install to first call'>
        <div className='flex flex-col'>
          <Step n={1} title='Install from npm'>
            <CodeBlock code='pnpm add @xyne/spaces-sdk' trackName='Spaces SDK: copy install' />
          </Step>
          <Step n={2} title='Sign the user in with Xyne SSO'>
            <Text>
              Your app never handles a password or a key. The user approves the sign-in in their
              browser, after checking the code on the page matches the one your app shows. Your
              Spaces URL is filled in below.
            </Text>
            <CodeBlock code={quickStart} trackName='Spaces SDK: copy quick start' />
          </Step>
          <Step n={3} title='Keep the session'>
            <Text>
              <InlineCode>session</InlineCode> holds the user&apos;s session cookie and its{' '}
              <InlineCode>expiresAt</InlineCode>. Store it securely and reuse it until it expires,
              then sign in again. The SDK sends it as a <InlineCode>Cookie</InlineCode> header on
              every request.
            </Text>
            <Callout>
              Treat the session like a password: it can do anything the user can, until it expires.
            </Callout>
          </Step>
        </div>
      </DocSection>

      <DocSection
        eyebrow='Reference'
        title='Resources'
        intro={
          <>
            Each is a property on the client, for example <InlineCode>sdk.tickets</InlineCode>. The
            full method list is in the package README on npm.
          </>
        }
      >
        <RefTable
          rows={RESOURCES.map(r => ({ name: `sdk.${r.name}`, description: r.description }))}
        />
      </DocSection>
    </>
  );
}
