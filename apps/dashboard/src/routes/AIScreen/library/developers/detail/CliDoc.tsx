import { type ReactElement } from 'react';
import { CLI_NPM_PACKAGE, CLI_NPM_MAJOR, spacesBaseUrl } from '../developerTools';
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

const COMMANDS: { group: string; rows: { name: string; description: string }[] }[] = [
  {
    group: 'Apps',
    rows: [
      {
        name: 'spaces app init [<dir>]',
        description: 'Scaffold an app in the current or a new folder.',
      },
      { name: 'spaces app push', description: 'Create the app on first push, or add a version.' },
      {
        name: 'spaces app publish',
        description: 'Push and make the app visible to the workspace.',
      },
      { name: 'spaces app unpublish', description: 'Make a published app private again.' },
      {
        name: 'spaces app archive [<appId>]',
        description:
          'Hide an app everywhere without deleting it. Its versions and published state are kept.',
      },
      {
        name: 'spaces app unarchive [<appId>]',
        description: 'Bring an archived app back exactly as it was.',
      },
      {
        name: 'spaces app versions',
        description: "List an app's versions, with head and published marked.",
      },
      { name: 'spaces app restore <v>', description: 'Move head back to a version. Reversible.' },
      {
        name: 'spaces app list [--workspace | --archived]',
        description: "Your apps, the workspace's published ones, or your archived ones.",
      },
      { name: 'spaces app pull <appId>', description: "Download an app's files into a folder." },
    ],
  },
  {
    group: 'Auth and config',
    rows: [
      {
        name: 'spaces app dev-setup [--yes]',
        description:
          'Move an app made before CLI 1.0.3 to SDK 0.3 and local dev with its own Spaces session.',
      },
      {
        name: 'spaces token',
        description: 'For apps not yet moved by dev-setup: write your browser session into .env.',
      },
      {
        name: 'spaces config set url <host>',
        description: 'Set the Spaces server the CLI talks to.',
      },
      { name: 'spaces config get [url]', description: 'Show a setting and where it came from.' },
    ],
  },
];

const SURFACES: { name: string; description: string }[] = [
  { name: 'toolbar', description: 'The left rail. The app gets the whole screen.' },
  { name: 'inbox', description: 'The Inbox menubar, beside the channel list. A narrow panel.' },
  { name: 'channel', description: "A tab in a channel's navbar. The app is told which channel." },
  { name: 'library', description: "Agent Hub → Apps → the app's own page. Full screen." },
  { name: 'chat', description: 'An artifact shown inside a conversation.' },
];

export function CliDoc(): ReactElement {
  const baseUrl = spacesBaseUrl();

  return (
    <>
      <StatRow
        stats={[
          { value: '1', label: 'command to scaffold an app' },
          { value: '5', label: 'places an app can live' },
          { value: '0', label: 'lines of sign-in code' },
          { value: `v${CLI_NPM_MAJOR}`, label: 'latest release on npm' },
        ]}
      />

      <DocSection
        eyebrow='Is this the right tool?'
        title='For apps that run inside Spaces'
        intro='Building a standalone app or script that runs outside Spaces? Use the SDK instead.'
      >
        <WhichToolCompare current='cli' />
      </DocSection>

      <DocSection
        eyebrow='What you get'
        title='A ready app template, not a blank folder'
        intro='spaces app init creates a working app you can run straight away and ship with one command.'
      >
        <FeatureGrid
          features={[
            {
              title: 'Template ready to run',
              body: 'Vite, React, TypeScript, Tailwind and shadcn/ui, with dependencies installed.',
              example: 'spaces app init my-app',
            },
            {
              title: 'The SDK already wired in',
              body: 'Read and write Spaces data as the viewer.',
              example: 'const { spaces } = await xyne();',
            },
            {
              title: 'One build, every surface',
              body: 'The app is told where it is open, and a dev badge lets you preview each place locally.',
              example: 'const ctx = useXyneContext(); // ctx.surface',
            },
            {
              title: 'Publish with versions',
              body: 'Push versions, publish to the workspace, roll back if something breaks.',
              example: 'spaces app publish',
            },
          ]}
        />
      </DocSection>

      <DocSection eyebrow='Get started' title='Install and ship your first app'>
        <Callout>
          macOS only for now, with Node 22 or later. Sign in to Spaces in Chrome, Brave, Edge, Arc
          or Firefox first: the CLI&apos;s app commands use that browser session, so there is no
          separate login. Local development signs in on its own: the first time the dev server talks
          to Spaces, it prints a sign-in link.
        </Callout>
        <div className='flex flex-col'>
          <Step n={1} title='Install from npm'>
            <CodeBlock
              code={`npm install -g ${CLI_NPM_PACKAGE}\nspaces help`}
              trackName='Spaces CLI: copy install'
            />
          </Step>
          <Step n={2} title='Point it at this Spaces'>
            <Text>
              The CLI has no built-in host, so tell it once. Your Spaces address is filled in below.
            </Text>
            <CodeBlock
              code={`spaces config set url ${baseUrl}`}
              trackName='Spaces CLI: copy config url'
            />
          </Step>
          <Step n={3} title='Scaffold, run and publish'>
            <CodeBlock
              code={`spaces app init my-app   # scaffold the template and install
cd my-app
npm run dev              # develop locally; prints a sign-in link the first time
spaces app publish       # ship it to your workspace`}
              trackName='Spaces CLI: copy quick start'
            />
            <Text>
              Then add it where it belongs: the toolbar, the Inbox menubar, a channel&apos;s tabs,
              or open it from <InlineCode>Agent Hub → Apps</InlineCode>.
            </Text>
          </Step>
        </div>
        <Callout>
          Rather not install anything? Run it straight from npm. This also sets this Spaces as the
          host, so later commands need no setup:
        </Callout>
        <CodeBlock
          code={`npx -y ${CLI_NPM_PACKAGE}@${CLI_NPM_MAJOR} app init my-app --url ${baseUrl}`}
          trackName='Spaces CLI: copy npx init'
        />
      </DocSection>

      <DocSection
        eyebrow='Good to know'
        title='Naming and renaming your app'
        intro={
          <>
            The app&apos;s name is <InlineCode>title</InlineCode> in{' '}
            <InlineCode>xyne.json</InlineCode>, at the root of the project.
          </>
        }
      >
        <CodeBlock
          caption='xyne.json'
          code={`{\n  "title": "Release Dashboard",\n  "entry": "/App.tsx"\n}`}
          trackName='Spaces CLI: copy xyne.json title'
        />
        <div className='flex flex-col'>
          <Step n={1} title='Name it'>
            <Text>
              Set <InlineCode>title</InlineCode> before your first push. The first{' '}
              <InlineCode>spaces app push</InlineCode> or{' '}
              <InlineCode>spaces app publish</InlineCode> creates the app with that name and records
              its <InlineCode>appId</InlineCode> in <InlineCode>xyne.json</InlineCode>.
            </Text>
          </Step>
          <Step n={2} title='Rename it'>
            <Text>
              Change <InlineCode>title</InlineCode> and push again. The app keeps its id and
              versions, and takes the new name.
            </Text>
            <CodeBlock code='spaces app publish' trackName='Spaces CLI: copy rename publish' />
            <Text>
              The name updates on every push, so a <InlineCode>spaces app push</InlineCode> renames
              a published app straight away, before you publish the new version.
            </Text>
          </Step>
        </div>
      </DocSection>

      <DocSection
        eyebrow='Reference'
        title='Commands'
        intro={
          <>
            Run <InlineCode>spaces &lt;command&gt; --help</InlineCode> for a command&apos;s flags.
          </>
        }
      >
        {COMMANDS.map(group => (
          <div key={group.group} className='flex flex-col gap-2'>
            <span className='text-xs font-medium text-muted-foreground'>{group.group}</span>
            <RefTable rows={group.rows} />
          </div>
        ))}
      </DocSection>

      <DocSection
        eyebrow='Reference'
        title='Where an app can live'
        intro={
          <>
            The app reads its surface from <InlineCode>useXyneContext()</InlineCode> and can lay
            itself out for each.
          </>
        }
      >
        <RefTable rows={SURFACES} />
      </DocSection>
    </>
  );
}
