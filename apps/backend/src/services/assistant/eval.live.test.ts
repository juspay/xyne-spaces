import { writeFileSync } from 'node:fs';
import {
  ACTIONS,
  isEntityRef,
  type ActionDefinition,
  type EntityRef,
  type FieldValue,
  type Plan,
  type TurnResponse,
} from '@xyne/shared/assistant';
import { normalizeName, type FoundRecord, type RecordFinder } from './records';
import { EMPTY_SESSION, parseSession, serializeSession, type AssistantSession } from './session';
import { handleTurn, type TurnServices } from './turn';
import { askJevInTime, jevConnection, JEV_TURN_MS } from './gateway';

/**
 * How well the assistant understands people, measured end to end: real sentences go through
 * `handleTurn` with the real Jev, against a made-up workspace with deliberately confusing
 * names. It scores only what the user would see (the action, its values, what it asks), so it
 * stays valid when the code behind it changes. Run it before and after any change to
 * understanding, and compare:
 *
 *   pnpm exec dotenv -e .env.local -- sh -c \
 *     'ASSISTANT_LIVE=1 pnpm exec jest --runInBand --runTestsByPath src/services/assistant/eval.live.test.ts'
 */

const person = (id: string, name: string): FoundRecord => ({
  record: { kind: 'person', id, name },
  detail: `${name.toLowerCase().replace(/\s+/g, '.')}@x.io`,
});
const channel = (id: string, name: string): FoundRecord => ({
  record: { kind: 'channel', id, name },
  detail: `#${name}`,
});
const thread = (id: string, name: string, channelId: string, people: string[]) => ({
  found: {
    record: { kind: 'thread' as const, id, name, channelId, channelName: channelId },
    detail: `#${channelId}`,
  },
  people,
});

const PEOPLE = [
  person('priya-shah', 'Priya Shah'),
  person('priya-nair', 'Priya Nair'),
  person('preeti', 'Preeti Sharma'),
  person('priti', 'Priti Verma'),
  person('daniel', 'Daniel Okafor'),
  person('arjun', 'Arjun Mehta'),
  person('meera', 'Meera Iyer'),
  person('sam', 'Sam Carter'),
  person('build-bot', 'Build Bot'),
  person('release-helper', 'Release Helper'),
  person('xyne-doctor', 'Xyne Doctor'),
];
const CHANNELS = [
  channel('general', 'general'),
  channel('design', 'design'),
  channel('design-review', 'design-review'),
  channel('android', 'android'),
  channel('ios', 'ios'),
  channel('release-planning', 'release-planning'),
  channel('ops-north', 'ops-north'),
  channel('ops-south', 'ops-south'),
  channel('sam-updates', 'sam-updates'),
  channel('random', 'random'),
];
const THREADS = [
  thread('t-pricing', 'Pricing change for annual plans', 'general', ['meera']),
  thread('t-login', 'Login errors after the update', 'android', ['daniel']),
  thread('t-login-ios', 'Login errors on the new build', 'ios', ['arjun']),
  thread('t-offsite', 'Offsite plan and venues', 'general', ['meera', 'sam']),
  thread('t-release', 'Release notes draft', 'release-planning', ['meera']),
  thread('t-release-old', 'Release notes for the last version', 'release-planning', ['arjun']),
  thread('t-migration', 'Migration rollback on staging', 'ops-north', ['daniel']),
  thread('t-hiring', 'Hiring plans for next quarter', 'general', ['priya-shah']),
];
const SELECTED_MESSAGE: FoundRecord = {
  record: {
    kind: 'message',
    id: 'm-selected',
    name: 'The build is green',
    channelId: 'android',
  },
  detail: '#android',
};

/** Like the database lookup: names containing every word said, else the same first letter. */
const workspace: RecordFinder = {
  async find(kind, mention, hints) {
    const words = normalizeName(mention)
      .split(' ')
      .filter((word) => word.length >= 2);
    if (kind === 'thread') {
      const topicWords = words.filter((word) => word.length >= 4);
      return THREADS.filter(
        ({ found, people }) =>
          topicWords.every((word) => normalizeName(found.record.name).includes(word)) &&
          (hints?.people ?? []).every((id) => id === 'me' || people.includes(id)) &&
          (hints?.channels ?? []).every((id) => id === found.record.channelId)
      ).map(({ found }) => found);
    }
    if (kind === 'message') return [];
    const pool = kind === 'person' ? PEOPLE : CHANNELS;
    const named = pool.filter(({ record }) =>
      words.every((word) => normalizeName(record.name).includes(word))
    );
    if (named.length > 0 || kind === 'channel') return named;
    return pool.filter(({ record }) => record.name.toLowerCase().startsWith(words[0]?.[0] ?? '#'));
  },
  async get(kind, id) {
    if (kind === 'channel') return CHANNELS.find(({ record }) => record.id === id) ?? null;
    if (kind === 'thread')
      return THREADS.find(({ found }) => found.record.id === id)?.found ?? null;
    if (kind === 'message' && id === SELECTED_MESSAGE.record.id) return SELECTED_MESSAGE;
    return null;
  },
};

type Expected = string | string[];

interface EvalCase {
  name: string;
  group: 'request' | 'follow-up' | 'not a task';
  /** Sentences, or `tap:<option id>` for a button. */
  turns: string[];
  /** The channel open on the left, by id. */
  screen?: string;
  /** The thread open in the chat route, by conversation id. */
  threadScreen?: string;
  /** Whether the selected message is the one opened with Ask AI. */
  messageOnScreen?: boolean;
  /** Use typed input for this case; voice is the default. */
  via?: 'typed' | 'voice';
  /** Fail the live eval if this core messaging behavior is misunderstood. */
  required?: boolean;
  /** The action the user wanted, or what kind of sentence it was when it is not a task. */
  action?: string;
  /** Actions offered when the destination is ambiguous. */
  actionChoices?: string[];
  kind?: 'help' | 'greeting' | 'thanks' | 'question' | 'unclear' | 'cannot';
  /** Values the request should hold: record ids, choice ids, or the words of a text field. */
  values?: Record<string, Expected>;
  /** The field the assistant should be asking about at the end. */
  asks?: string;
}

const CASES: EvalCase[] = [
  // Direct messages.
  {
    name: 'dm full name',
    group: 'request',
    turns: ['tell Priya Shah the build is green'],
    action: 'send_dm',
    values: { recipient: 'priya-shah', message: 'the build is green' },
  },
  {
    name: 'dm saying',
    group: 'request',
    turns: ["send a message to Daniel Okafor saying I'll be late"],
    action: 'send_dm',
    values: { recipient: 'daniel', message: "I'll be late" },
  },
  {
    name: 'dm hello',
    group: 'request',
    turns: ['DM Meera Iyer hello'],
    action: 'send_dm',
    values: { recipient: 'meera', message: 'hello' },
  },
  {
    name: 'dm that',
    group: 'request',
    turns: ['message Sam Carter that the deploy finished'],
    action: 'send_dm',
    values: { recipient: 'sam', message: 'the deploy finished' },
  },
  {
    name: 'dm let know',
    group: 'request',
    turns: ['let Daniel Okafor know the meeting moved to 4'],
    action: 'send_dm',
    values: { recipient: 'daniel', message: 'the meeting moved to 4' },
  },
  {
    name: 'dm filler words',
    group: 'request',
    turns: ['uh can you send Priya Shah a quick note saying thanks for the help'],
    action: 'send_dm',
    values: { recipient: 'priya-shah', message: 'thanks for the help' },
  },
  {
    name: 'clarify where to tell an agent',
    group: 'request',
    turns: ['tell Build Bot to check the latest crash'],
    actionChoices: ['send_dm', 'post_message'],
    required: true,
  },
  {
    name: 'dm question text',
    group: 'request',
    turns: ['text Arjun Mehta can we sync tomorrow'],
    action: 'send_dm',
    values: { recipient: 'arjun', message: 'can we sync tomorrow' },
  },
  {
    name: 'dm colon',
    group: 'request',
    turns: ['Send a direct message to Meera Iyer: the doc is ready'],
    action: 'send_dm',
    values: { recipient: 'meera', message: 'the doc is ready' },
  },
  {
    name: 'dm no message',
    group: 'request',
    turns: ['message Preeti Sharma'],
    action: 'send_dm',
    values: { recipient: 'preeti' },
    asks: 'message',
  },
  {
    name: 'dm nothing',
    group: 'request',
    turns: ['I want to send a message'],
    action: 'send_dm',
    asks: 'recipient',
  },
  {
    name: 'dm long',
    group: 'request',
    turns: [
      'tell Daniel Okafor the deploy is blocked because the migration failed on staging and we need to roll back tonight',
    ],
    action: 'send_dm',
    values: {
      recipient: 'daniel',
      message:
        'the deploy is blocked because the migration failed on staging and we need to roll back tonight',
    },
  },
  {
    name: 'dm first name tie',
    group: 'request',
    turns: ['tell Priya hi'],
    action: 'send_dm',
    values: { message: 'hi' },
    asks: 'recipient',
  },
  {
    name: 'dm sounds like',
    group: 'request',
    turns: ['tell Priti Sharma hi'],
    action: 'send_dm',
    values: { recipient: 'preeti', message: 'hi' },
  },
  {
    name: 'dm misheard surname',
    group: 'request',
    turns: ['message Danial Okafor hello'],
    action: 'send_dm',
    values: { recipient: 'daniel', message: 'hello' },
  },
  {
    name: 'dm ask him',
    group: 'request',
    turns: ['ping Arjun Mehta and ask if the review is done'],
    action: 'send_dm',
    values: { recipient: 'arjun' },
  },

  // Opening a direct message.
  {
    name: 'open dm',
    group: 'request',
    turns: ['open my DM with Priya Shah'],
    action: 'open_dm',
    values: { person: 'priya-shah' },
  },
  {
    name: 'open dm chat',
    group: 'request',
    turns: ['go to my chat with Daniel Okafor'],
    action: 'open_dm',
    values: { person: 'daniel' },
  },
  {
    name: 'open dm messages',
    group: 'request',
    turns: ['show my messages with Meera Iyer'],
    action: 'open_dm',
    values: { person: 'meera' },
  },

  // Posting in a channel.
  {
    name: 'post that',
    group: 'request',
    turns: ['post in general that the build is green'],
    action: 'post_message',
    values: { channel: 'general', message: 'the build is green' },
  },
  {
    name: 'post here',
    group: 'request',
    turns: ['post hello here'],
    screen: 'general',
    action: 'post_message',
    values: { channel: 'general', message: 'hello' },
  },
  {
    name: 'post say in',
    group: 'request',
    turns: ['say good morning in the design channel'],
    action: 'post_message',
    values: { channel: 'design', message: 'good morning' },
  },
  {
    name: 'post go to mention',
    group: 'request',
    turns: ['go to android and mention Arjun Mehta to check the crash'],
    action: 'post_message',
    values: { channel: 'android', mentions: ['arjun'], message: 'check the crash' },
    required: true,
  },
  {
    name: 'post everyone',
    group: 'request',
    turns: ['in release planning, tell everyone the release is on friday'],
    action: 'post_message',
    values: { channel: 'release-planning', message: 'the release is on friday' },
  },
  {
    name: 'post colon',
    group: 'request',
    turns: ['post in ios: new build is out'],
    action: 'post_message',
    values: { channel: 'ios', message: 'new build is out' },
  },
  {
    name: 'post open mention agent',
    group: 'request',
    turns: ['open the general channel and mention Build Bot and ask it to check the latest crash'],
    action: 'post_message',
    values: { channel: 'general', mentions: ['build-bot'], message: 'check the latest crash' },
  },
  {
    name: 'post share',
    group: 'request',
    turns: ['share in random that lunch is here'],
    action: 'post_message',
    values: { channel: 'random', message: 'lunch is here' },
  },
  {
    name: 'post update saying',
    group: 'request',
    turns: ['can you post an update in design saying the mocks are ready'],
    action: 'post_message',
    values: { channel: 'design', message: 'the mocks are ready' },
  },
  {
    name: 'post write here',
    group: 'request',
    turns: ["write here that I'm running five minutes late"],
    screen: 'design',
    action: 'post_message',
    values: { channel: 'design', message: "I'm running five minutes late" },
  },
  {
    name: 'post tell channel',
    group: 'request',
    turns: ['tell the design channel that the review moved to 3'],
    action: 'post_message',
    values: { channel: 'design', message: 'the review moved to 3' },
  },
  {
    name: 'post channel like a person',
    group: 'request',
    turns: ['post in sam updates that the report is out'],
    action: 'post_message',
    values: { channel: 'sam-updates', message: 'the report is out' },
  },

  // Creating a channel.
  {
    name: 'create called',
    group: 'request',
    turns: ['create a channel called ops weekly'],
    action: 'create_channel',
    values: { name: 'ops weekly' },
    asks: 'visibility',
  },
  {
    name: 'create private named',
    group: 'request',
    turns: ['make a private channel named launch'],
    action: 'create_channel',
    values: { name: 'launch', visibility: 'private' },
  },
  {
    name: 'create with members',
    group: 'request',
    turns: ['create a public channel design sync and add Priya Shah and Arjun Mehta'],
    action: 'create_channel',
    values: { name: 'design sync', visibility: 'public', members: ['priya-shah', 'arjun'] },
  },
  {
    name: 'create for',
    group: 'request',
    turns: ['I need a new channel for the offsite'],
    action: 'create_channel',
  },
  {
    name: 'create first message',
    group: 'request',
    turns: ['set up a channel called growth and post welcome everyone'],
    action: 'create_channel',
    values: { name: 'growth', firstMessage: 'welcome everyone' },
  },
  {
    name: 'create help me',
    group: 'request',
    turns: ['can you help me create a channel'],
    action: 'create_channel',
    asks: 'name',
  },
  {
    name: 'create private with',
    group: 'request',
    turns: ['new private channel called hiring with Meera Iyer'],
    action: 'create_channel',
    values: { name: 'hiring', visibility: 'private', members: ['meera'] },
  },

  // Opening a channel.
  {
    name: 'open channel',
    group: 'request',
    turns: ['open the android channel'],
    action: 'open_channel',
    values: { channel: 'android' },
  },
  {
    name: 'open take me',
    group: 'request',
    turns: ['take me to release planning'],
    action: 'open_channel',
    values: { channel: 'release-planning' },
  },
  {
    name: 'open go to',
    group: 'request',
    turns: ['go to design review'],
    action: 'open_channel',
    values: { channel: 'design-review' },
  },
  {
    name: 'open switch',
    group: 'request',
    turns: ['switch to ios'],
    action: 'open_channel',
    values: { channel: 'ios' },
  },
  {
    name: 'open show me',
    group: 'request',
    turns: ['show me the general channel'],
    action: 'open_channel',
    values: { channel: 'general' },
  },
  {
    name: 'open bare',
    group: 'request',
    turns: ['open random'],
    action: 'open_channel',
    values: { channel: 'random' },
  },

  // Finding a conversation.
  {
    name: 'find about',
    group: 'request',
    turns: ['find the thread about the pricing change'],
    action: 'find_conversation',
    values: { conversation: 't-pricing' },
  },
  {
    name: 'find where did we',
    group: 'request',
    turns: ['where did we talk about the hiring plans'],
    action: 'find_conversation',
    values: { conversation: 't-hiring' },
  },
  {
    name: 'find with person',
    group: 'request',
    turns: ['find the messages where Meera Iyer and I discussed the offsite'],
    action: 'find_conversation',
    values: { conversation: 't-offsite' },
  },
  {
    name: 'find in channel',
    group: 'request',
    turns: ['search for the conversation about login errors in the android channel'],
    action: 'find_conversation',
    values: { conversation: 't-login' },
  },
  {
    name: 'find polite me',
    group: 'request',
    turns: ['find me a thread about the migration rollback'],
    action: 'find_conversation',
    values: { conversation: 't-migration' },
  },
  {
    name: 'find person talked',
    group: 'request',
    turns: ['open the thread where Daniel Okafor talked about the migration'],
    action: 'find_conversation',
    values: { conversation: 't-migration' },
  },
  {
    name: 'find several',
    group: 'request',
    turns: ['look for messages about release notes'],
    action: 'find_conversation',
    asks: 'conversation',
  },

  // Not tasks.
  { name: 'hi', group: 'not a task', turns: ['hi'], kind: 'greeting' },
  { name: 'hello there', group: 'not a task', turns: ['hello there'], kind: 'greeting' },
  { name: 'thanks', group: 'not a task', turns: ['thanks'], kind: 'thanks' },
  { name: 'bye', group: 'not a task', turns: ["that's all, bye"], kind: 'thanks' },
  { name: 'what can you do', group: 'not a task', turns: ['what can you do'], kind: 'help' },
  { name: 'how does this work', group: 'not a task', turns: ['how does this work'], kind: 'help' },
  { name: 'who owns', group: 'not a task', turns: ['who owns billing'], kind: 'question' },
  {
    name: 'what did we decide',
    group: 'not a task',
    turns: ['what did we decide about the launch'],
    kind: 'question',
  },
  { name: 'weather', group: 'not a task', turns: ["what's the weather today"], kind: 'question' },
  { name: 'noise', group: 'not a task', turns: ['uh the'], kind: 'unclear' },
  { name: 'reminder', group: 'not a task', turns: ['set a reminder for 5pm'], kind: 'cannot' },
  {
    name: 'forward selected message to a person',
    group: 'request',
    turns: ['forward this message to Priya Shah'],
    messageOnScreen: true,
    action: 'forward_message',
    values: { message: 'm-selected', recipient: 'priya-shah' },
    required: true,
  },
  {
    name: 'forward selected message to an ambiguous name',
    group: 'request',
    turns: ['forward this message to Priya', 'tap:priya-shah'],
    messageOnScreen: true,
    action: 'forward_message',
    values: { message: 'm-selected', recipient: 'priya-shah' },
    required: true,
  },
  {
    name: 'share selected message to a channel',
    group: 'request',
    turns: ['share this in #design'],
    messageOnScreen: true,
    action: 'forward_to_channel',
    values: { message: 'm-selected', channel: 'design' },
    required: true,
  },
  {
    name: 'reply in the thread open on screen',
    group: 'request',
    turns: ['reply here saying looks good'],
    threadScreen: 't-login',
    action: 'reply_in_thread',
    values: { thread: 't-login', message: 'looks good' },
    required: true,
  },
  {
    name: 'reply to a thread by topic with typed input',
    group: 'request',
    turns: ['Reply to the thread about the release notes draft saying looks good'],
    via: 'typed',
    action: 'reply_in_thread',
    values: { thread: 't-release', message: 'looks good' },
    required: true,
  },

  // Follow-ups: the sentence only makes sense with what came before.
  {
    name: 'answer name then private',
    group: 'follow-up',
    turns: ['create a channel', 'call it ops weekly', 'private'],
    action: 'create_channel',
    values: { name: 'ops weekly', visibility: 'private' },
  },
  {
    name: 'answer message',
    group: 'follow-up',
    turns: ['send a message to Daniel Okafor', 'the build is green'],
    action: 'send_dm',
    values: { recipient: 'daniel', message: 'the build is green' },
  },
  {
    name: 'which one by name',
    group: 'follow-up',
    turns: ['tell Priya hi', 'Priya Nair'],
    action: 'send_dm',
    values: { recipient: 'priya-nair', message: 'hi' },
  },
  {
    name: 'which one by surname',
    group: 'follow-up',
    turns: ['tell Priya hi', 'Shah'],
    action: 'send_dm',
    values: { recipient: 'priya-shah', message: 'hi' },
  },
  {
    name: 'which one by number',
    group: 'follow-up',
    turns: ['tell Priya hi', 'the second one'],
    action: 'send_dm',
    values: { recipient: 'priya-nair', message: 'hi' },
  },
  {
    name: 'correction',
    group: 'follow-up',
    turns: ['create a channel called ops weekly', 'actually make it private'],
    action: 'create_channel',
    values: { name: 'ops weekly', visibility: 'private' },
  },
  {
    name: 'no to name',
    group: 'follow-up',
    turns: ['create a channel', 'no'],
    action: 'create_channel',
    asks: 'name',
  },
  {
    name: 'aside then answer',
    group: 'follow-up',
    turns: ['create a channel called launch', 'what can you do', 'public'],
    action: 'create_channel',
    values: { name: 'launch', visibility: 'public' },
  },
  {
    name: 'narrow search by person',
    group: 'follow-up',
    turns: ['look for messages about release notes', 'the one with Meera Iyer'],
    action: 'find_conversation',
    values: { conversation: 't-release' },
  },
  {
    name: 'narrow search by channel',
    group: 'follow-up',
    turns: ['find messages about login errors', 'the one in the ios channel'],
    action: 'find_conversation',
    values: { conversation: 't-login-ios' },
    required: true,
  },
  {
    name: 'ask an agent to check the latest crash in the open thread',
    group: 'follow-up',
    turns: ['mention Build Bot in this thread and ask it to check the latest crash'],
    threadScreen: 't-login',
    action: 'reply_in_thread',
    values: {
      thread: 't-login',
      mentions: ['build-bot'],
      message: 'check the latest crash',
    },
    required: true,
  },
  {
    name: 'ask agent to summarize the open thread',
    group: 'follow-up',
    turns: ['invoke Xyne Doctor and ask it to summarize this thread'],
    threadScreen: 't-login',
    action: 'reply_in_thread',
    values: {
      thread: 't-login',
      mentions: ['xyne-doctor'],
      message: 'summarize this thread',
    },
    required: true,
  },
  {
    name: 'keep a task ending in a framing word',
    group: 'follow-up',
    turns: ['Mention Xyne Doctor and ask it to explain who I should talk to'],
    threadScreen: 't-login',
    action: 'reply_in_thread',
    values: {
      thread: 't-login',
      mentions: ['xyne-doctor'],
      message: 'explain who I should talk to',
    },
    required: true,
  },
  {
    name: 'new request mid-way',
    group: 'follow-up',
    turns: ['send a message to Arjun Mehta', 'tell Meera Iyer the doc is ready'],
    action: 'send_dm',
    values: { recipient: 'meera', message: 'the doc is ready' },
    required: true,
  },
  {
    name: 'new request while message is pending',
    group: 'follow-up',
    turns: ['message Daniel Okafor', 'let Meera Iyer know the review moved to four'],
    action: 'send_dm',
    values: { recipient: 'meera', message: 'the review moved to four' },
    required: true,
  },
  {
    name: 'add member mid-way',
    group: 'follow-up',
    turns: ['create a channel called growth', 'also add Priya Shah'],
    action: 'create_channel',
    values: { name: 'growth', members: ['priya-shah'] },
  },
  {
    name: 'answer post text',
    group: 'follow-up',
    turns: ['post in design', 'the mocks are ready'],
    action: 'post_message',
    values: { channel: 'design', message: 'the mocks are ready' },
  },
  {
    name: 'bare name answer',
    group: 'follow-up',
    turns: ['create a channel', 'Random.'],
    action: 'create_channel',
    values: { name: 'Random' },
  },
  {
    name: 'greeting as message',
    group: 'follow-up',
    turns: ['message Sam Carter', 'hello!'],
    action: 'send_dm',
    values: { recipient: 'sam', message: 'hello' },
  },
  {
    name: 'add two members',
    group: 'follow-up',
    turns: ['create a private channel called launch', 'add Priya Nair and Arjun Mehta'],
    action: 'create_channel',
    values: { name: 'launch', visibility: 'private', members: ['priya-nair', 'arjun'] },
  },
  {
    name: 'here then yes',
    group: 'follow-up',
    turns: ['post hello here', 'yes'],
    screen: 'design',
    action: 'post_message',
    values: { channel: 'design', message: 'hello' },
  },
  {
    name: 'channel answer',
    group: 'follow-up',
    turns: ['I want to post something', 'in android', 'the build is green'],
    action: 'post_message',
    values: { channel: 'android', message: 'the build is green' },
  },
];

/** What the user ended up with: the action, its values, and the question on screen. */
interface Observed {
  action: string | null;
  actionChoices: string[];
  values: Record<string, FieldValue>;
  asks: string | null;
  kind: string | null;
}

function observe(session: AssistantSession, response: TurnResponse): Observed {
  const draft = session.conversation.active;
  const asks = session.question?.kind === 'detail' ? session.question.field : null;
  if (response.run && session.run) {
    const action = ACTIONS.get(session.run.action);
    return {
      action: session.run.action,
      actionChoices: [],
      values: action ? valuesFromPlan(action, response.run.plan) : {},
      asks: null,
      kind: null,
    };
  }
  return {
    action: draft?.action ?? null,
    actionChoices:
      session.question?.kind === 'action' ? session.question.options.map(({ id }) => id) : [],
    values: draft?.values ?? {},
    asks,
    kind: draft ? null : kindOf(response),
  };
}

/** Reads the field values back out of a plan, by lining it up with the action's plan. */
function valuesFromPlan(action: ActionDefinition, plan: Plan): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  let at = 0;
  for (const step of action.plan as Array<Record<string, unknown>>) {
    const ran = plan[at] as Record<string, unknown> | undefined;
    if (!ran || ran.op !== step.op) continue;
    at += 1;
    for (const [key, param] of Object.entries(step)) {
      if (typeof param === 'string' && param.startsWith('$') && ran[key] !== undefined) {
        values[param.slice(1)] = ran[key] as FieldValue;
      }
    }
  }
  return values;
}

function kindOf(response: TurnResponse): string {
  if (response.handoff) return 'question';
  if (response.say.startsWith('I can’t do that yet')) return 'cannot';
  const kinds = Object.entries(response.debug?.kind ?? {}).sort(([, a], [, b]) => b - a);
  return kinds[0]?.[0] ?? 'unknown';
}

/** One line per turn, to see why a case missed: ASSISTANT_EVAL_TRACE=1. */
function trace(
  name: string,
  said: string,
  response: TurnResponse,
  session: AssistantSession
): void {
  const draft = session.conversation.active;
  const open = draft?.open.map(({ field, said, options }) => ({
    field,
    said,
    options: options.map(({ id }) => id),
  }));
  const debug = response.debug?.actions
    ?.map((a) => `${a.action} ${a.probability.toFixed(2)}`)
    .join(', ');
  // eslint-disable-next-line no-console
  console.log(
    `${name} | “${said}” → “${response.say}” | draft ${draft ? `${draft.action} ${JSON.stringify(draft.values)}` : '—'} | open ${JSON.stringify(open)} | awaiting ${JSON.stringify(draft?.awaiting)} | plan ${response.run ? JSON.stringify(response.run.plan) : '—'} | ${debug ?? ''} | continues ${response.debug?.continues ?? '—'}`
  );
}

const words = (text: string): string => normalizeName(text.replace(/[“”"']/g, ''));

function matches(expected: Expected, actual: FieldValue | undefined): boolean {
  if (actual === undefined) return false;
  if (Array.isArray(expected)) {
    const ids = (Array.isArray(actual) ? actual : [actual])
      .filter(isEntityRef)
      .map((ref) => ref.id);
    return ids.length === expected.length && expected.every((id) => ids.includes(id));
  }
  if (isEntityRef(actual)) return actual.id === expected;
  if (Array.isArray(actual)) return false;
  return words(actual) === words(expected);
}

function describeValue(value: FieldValue | undefined): string {
  if (value === undefined) return '—';
  if (Array.isArray(value)) return value.map((ref) => ref.id).join('+');
  return isEntityRef(value) ? value.id : `“${value}”`;
}

interface Score {
  group: string;
  name: string;
  action: boolean | null;
  actionChoices: boolean | null;
  fields: Array<{ field: string; ok: boolean; got: string }>;
  asks: boolean | null;
  kind: boolean | null;
  /** Jev did not answer (a gateway refusal or timeout), so the case says nothing about understanding. */
  jevFailed: boolean;
  required: boolean;
  ms: number[];
}

const live = process.env.ASSISTANT_LIVE === '1' ? describe : describe.skip;

live('understanding, end to end, with the real Jev', () => {
  const scores: Score[] = [];

  beforeAll(() => {
    if (!jevConnection()) {
      throw new Error('Live Jev evaluation needs LITELLM_BASE_URL and LITELLM_API_KEY.');
    }
  });

  afterAll(() => {
    const rate = (checks: boolean[]): string =>
      checks.length ? `${checks.filter(Boolean).length}/${checks.length}` : '—';
    const rows = ['request', 'follow-up', 'not a task', 'all'].map((group) => {
      const inGroup = scores.filter((score) => group === 'all' || score.group === group);
      const pick = (key: 'action' | 'actionChoices' | 'asks' | 'kind'): boolean[] =>
        inGroup.map((score) => score[key]).filter((ok): ok is boolean => ok !== null);
      const fields = inGroup.flatMap((score) => score.fields.map(({ ok }) => ok));
      const whole = inGroup.map(
        (score) =>
          score.action !== false &&
          score.actionChoices !== false &&
          score.asks !== false &&
          score.kind !== false &&
          score.fields.every(({ ok }) => ok)
      );
      return `${group.padEnd(11)} cases ${rate(whole).padEnd(7)} action ${rate(pick('action')).padEnd(7)} choice ${rate(pick('actionChoices')).padEnd(7)} fields ${rate(fields).padEnd(7)} asks ${rate(pick('asks')).padEnd(6)} kind ${rate(pick('kind'))}`;
    });
    const misses = scores
      .filter(
        (score) =>
          score.action === false ||
          score.actionChoices === false ||
          score.asks === false ||
          score.kind === false ||
          score.fields.some(({ ok }) => !ok)
      )
      .map((score) => {
        const wrong = score.fields
          .filter(({ ok }) => !ok)
          .map(({ field, got }) => `${field}=${got}`);
        return `  ✗ ${score.name}${score.action === false ? ' [action]' : ''}${score.actionChoices === false ? ' [action choices]' : ''}${score.asks === false ? ' [asks]' : ''}${score.kind === false ? ' [kind]' : ''} ${wrong.join(' ')}`;
      });
    const failed = scores.filter((score) => score.jevFailed);
    const requiredMisses = scores.filter(
      (score) =>
        score.required &&
        (score.jevFailed ||
          score.action === false ||
          score.actionChoices === false ||
          score.fields.some(({ ok }) => !ok))
    );
    const ms = scores.flatMap((score) => score.ms).sort((a, b) => a - b);
    const p = (q: number): number => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? 0;
    const report = [
      ...rows,
      `jev failed ${failed.length}${failed.length ? ` (${failed.map(({ name }) => name).join(', ')})` : ''}`,
      `turn time  median ${p(0.5)} ms · p90 ${p(0.9)} ms`,
      ...misses,
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(`\n${report}\n`);
    if (process.env.ASSISTANT_EVAL_OUT) {
      writeFileSync(process.env.ASSISTANT_EVAL_OUT, JSON.stringify({ report, scores }, null, 2));
    }
    if (failed.length > 0) {
      throw new Error(
        `Jev returned no usable answer for ${failed.length} live evaluation case(s).`
      );
    }
    if (requiredMisses.length > 0) {
      throw new Error(
        `Core assistant cases failed: ${requiredMisses.map(({ name }) => name).join(', ')}.`
      );
    }
  });

  it.each(CASES)(
    '$name',
    async (evalCase) => {
      let session: AssistantSession = EMPTY_SESSION;
      // Like production: every Jev request of a turn shares one deadline.
      let deadline = 0;
      const services: TurnServices = {
        catalog: ACTIONS,
        sessions: {
          load: async () => parseSession(serializeSession(session)),
          save: async (_identity, next) => {
            session = next;
          },
        },
        records: workspace,
        askJev: (state, questions) => askJevInTime(state, questions, deadline),
        newId: (() => {
          let id = 0;
          return () => `id-${++id}`;
        })(),
        debug: true,
      };
      const onScreen: EntityRef[] = [
        ...(evalCase.screen ? [{ kind: 'channel' as const, id: evalCase.screen, name: '' }] : []),
        ...(evalCase.threadScreen
          ? [
              {
                kind: 'thread' as const,
                id: evalCase.threadScreen,
                name: '',
                channelId: 'android',
                channelName: 'android',
              },
            ]
          : []),
        ...(evalCase.messageOnScreen ? [SELECTED_MESSAGE.record] : []),
      ];
      const identity = { workspaceId: 'w', userId: 'me', sessionId: 's' };

      let response: TurnResponse | undefined;
      let jevFailed = false;
      const ms: number[] = [];
      for (const turn of evalCase.turns) {
        const startedAt = Date.now();
        deadline = startedAt + JEV_TURN_MS;
        const input = turn.startsWith('tap:')
          ? { kind: 'choose' as const, optionId: turn.slice(4) }
          : { kind: 'text' as const, text: turn, via: evalCase.via ?? 'voice' };
        response = await handleTurn(input, identity, services, { onScreen });
        ms.push(Date.now() - startedAt);
        jevFailed ||= response.say.startsWith('I couldn’t work that out');
        if (process.env.ASSISTANT_EVAL_TRACE) trace(evalCase.name, turn, response, session);
      }
      const seen = observe(session, response!);

      scores.push({
        group: evalCase.group,
        name: evalCase.name,
        action: evalCase.action ? seen.action === evalCase.action : null,
        actionChoices: evalCase.actionChoices
          ? seen.actionChoices.length === evalCase.actionChoices.length &&
            evalCase.actionChoices.every((id) => seen.actionChoices.includes(id))
          : null,
        fields: Object.entries(evalCase.values ?? {}).map(([field, expected]) => ({
          field,
          ok: matches(expected, seen.values[field]),
          got: describeValue(seen.values[field]),
        })),
        asks: evalCase.asks ? seen.asks === evalCase.asks : null,
        kind: evalCase.kind ? seen.kind === evalCase.kind : null,
        jevFailed,
        required: evalCase.required ?? false,
        ms,
      });
    },
    60_000
  );
});
