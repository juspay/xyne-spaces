import { type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
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

const MODEL: { name: string; description: string }[] = [
  {
    name: 'collection',
    description: "Groups records, like a folder. 1–64 letters, digits, '.', '_' or '-'.",
  },
  { name: 'key', description: 'Names one record in a collection. Up to 256 characters.' },
  {
    name: 'value',
    description: 'Any JSON, up to 64 KB. Stored as-is and never searched or filtered on.',
  },
  {
    name: "scope 'user'",
    description: 'Private to the person using the app. The default for every write.',
  },
  {
    name: "scope 'global'",
    description: 'One record everyone who uses the app reads and writes. Last write wins.',
  },
];

const METHODS: { name: string; description: string; tag?: { label: string; write: boolean } }[] = [
  { name: 'get(key)', description: 'One record, or null. Your own record wins over a shared one.' },
  { name: 'getMany(keys)', description: 'Up to 50 records in one round trip.' },
  {
    name: 'list({ prefix, order, limit, offset })',
    description: 'A page of up to 100 records, sorted by key. hasMore says if there is another.',
  },
  {
    name: 'put(key, value, { scope })',
    description: 'Create or replace a record. The whole value is replaced.',
    tag: { label: 'write', write: true },
  },
  {
    name: 'remove(key, { scope })',
    description: 'Delete a record. Resolves false when there was nothing to delete.',
    tag: { label: 'write', write: true },
  },
];

const LIMITS: { name: string; description: string }[] = [
  { name: 'Value size', description: '64 KB of JSON per record.' },
  { name: 'List page', description: 'Up to 100 records; offsets up to 10,000.' },
  { name: 'Batch read', description: 'Up to 50 keys per getMany.' },
  { name: 'Records per app', description: '20,000. Updates and deletes always work.' },
  { name: 'Writes', description: '2,000 per hour per person.' },
];

export function StorageDoc(): ReactElement {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const cliPath = `${workspaceId ? `/${workspaceId}` : ''}/ai/library/developers/cli`;

  return (
    <>
      <StatRow
        stats={[
          { value: '0', label: 'servers or databases to run' },
          { value: '2', label: 'scopes: private or shared' },
          { value: '64 KB', label: 'of JSON per record' },
          { value: '20k', label: 'records per app' },
        ]}
      />

      <DocSection
        eyebrow='Where it comes from'
        title='Already in every app the CLI scaffolds'
        intro={
          <>
            There is nothing to install. Apps made with{' '}
            <Link
              to={cliPath}
              data-track-category='Developer tools'
              data-track-name='Storage SDK: open CLI'
              className='text-primary hover:underline'
            >
              the Spaces CLI
            </Link>{' '}
            get <InlineCode>storage</InlineCode> next to <InlineCode>spaces</InlineCode>.
          </>
        }
      >
        <CodeBlock
          caption='App.tsx'
          code={`import { xyne } from './lib/xyne';

const { storage } = await xyne();
const prefs = storage.collection<{ theme: string }>('prefs');

await prefs.put('me', { theme: 'dark' });
const saved = await prefs.get('me'); // { key, scope, value, createdAt, updatedAt } or null`}
          trackName='Storage SDK: copy quick start'
        />
        <div className='flex flex-col'>
          <Step n={1} title='Published in Spaces'>
            <Text>
              Spaces runs every storage call as the person using the app. The app holds no token and
              can only ever reach that person&apos;s records and the shared ones.
            </Text>
          </Step>
          <Step n={2} title='Running locally'>
            <Text>
              <InlineCode>npm run dev</InlineCode> uses the token and app id in{' '}
              <InlineCode>.env</InlineCode>. Run <InlineCode>spaces token</InlineCode> for the
              token, and <InlineCode>spaces app push</InlineCode> once so the app has an id: records
              belong to a saved app.
            </Text>
          </Step>
        </div>
      </DocSection>

      <DocSection
        eyebrow='What you can build'
        title='State that outlives the session'
        intro='Small JSON records, private to each person or shared by everyone who uses the app.'
      >
        <FeatureGrid
          features={[
            {
              title: 'Per-person preferences',
              body: 'Theme, filters, the last tab someone had open. Private by default.',
              example: "await prefs.put('me', { theme: 'dark' });",
            },
            {
              title: 'Shared team state',
              body: 'One board config or counter everyone who uses the app sees and edits.',
              example: "await config.put('board', cfg, { scope: 'global' });",
            },
            {
              title: 'Ordered logs and history',
              body: 'Use dates as keys, then list them newest first, a month at a time.',
              example: "await log.list({ prefix: '2026-10', order: 'desc' });",
            },
            {
              title: 'Defaults with overrides',
              body: "Save a shared default; a person's own record with the same key wins for them.",
              example: "await prefs.get('layout'); // theirs, else the shared one",
            },
          ]}
        />
      </DocSection>

      <DocSection
        eyebrow='Reference'
        title='How records are organised'
        intro='Records are found by key only. Keys sort as text, so use ISO dates and zero-padded numbers.'
      >
        <RefTable rows={MODEL} />
      </DocSection>

      <DocSection
        eyebrow='Reference'
        title='Collection methods'
        intro={
          <>
            Call these on <InlineCode>storage.collection(&apos;name&apos;)</InlineCode>. Reads
            return shared records plus your own.
          </>
        }
      >
        <RefTable rows={METHODS} />
        <Callout tone='warning'>
          <InlineCode>put</InlineCode> replaces the whole value, so read, change and write it back
          to update one field. A <InlineCode>list</InlineCode> can return both your record and the
          shared one for the same key; tell them apart by <InlineCode>scope</InlineCode>.
        </Callout>
      </DocSection>

      <DocSection eyebrow='Reference' title='Limits'>
        <RefTable rows={LIMITS} />
      </DocSection>
    </>
  );
}
