import { ACTIONS } from '@xyne/shared/assistant';
import type { JevAnswer, JevQuestion, JevState } from '@/services/queryIntent/jevClient';
import { readingFor } from './fields';
import { buildIntentQuestions, decideIntent, rankActions, sentenceKind } from './intent';

/**
 * The phrase set: real sentences and what the assistant should make of them, checked against
 * the real Jev. It needs the gateway key, so it runs only when asked:
 *
 *   npx dotenv -e .env.local -- env ASSISTANT_LIVE=1 npx jest src/services/assistant/phrases
 *
 * Add cases with every new action, and whenever a way of saying something goes wrong. A miss is
 * fixed in the action's data (an example, a "not for"), not in code.
 */

interface PhraseCase {
  say: string;
  /** The action it should start, and the words it should read for it. */
  action?: string;
  fields?: Record<string, string | string[]>;
  /** For sentences that are not requests: help, greeting, thanks, question, unclear. */
  kind?: string;
}

const CASES: PhraseCase[] = [
  {
    say: 'Send a message to Dipanshu saying the review is done',
    action: 'send_dm',
    fields: { recipient: 'Dipanshu', message: 'the review is done' },
  },
  {
    say: 'tell Priya the build is green',
    action: 'send_dm',
    fields: { recipient: 'Priya', message: 'the build is green' },
  },
  {
    say: "let Daniel know I'm running late",
    action: 'send_dm',
    fields: { recipient: 'Daniel', message: "I'm running late" },
  },
  {
    say: 'message Priya this is ready for review',
    action: 'send_dm',
    fields: { recipient: 'Priya', message: 'this is ready for review' },
  },
  {
    say: 'Create a DM with Daniel and message hello',
    action: 'send_dm',
    fields: { recipient: 'Daniel', message: 'hello' },
  },
  {
    say: 'send hello to Deepanshu Sharma',
    action: 'send_dm',
    fields: { recipient: 'Deepanshu Sharma', message: 'hello' },
  },
  { say: 'DM Deepanshu', action: 'send_dm', fields: { recipient: 'Deepanshu' } },
  { say: 'can you help me create a channel', action: 'create_channel' },
  { say: "let's make a channel called ops", action: 'create_channel', fields: { name: 'ops' } },
  {
    say: 'make a private channel named Random',
    action: 'create_channel',
    fields: { name: 'Random', visibility: 'private' },
  },
  {
    say: 'create a channel called design review and add Priya',
    action: 'create_channel',
    fields: { name: 'design review', members: ['Priya'] },
  },
  { say: 'open the Android channel', action: 'open_channel', fields: { channel: 'Android' } },
  {
    say: 'take me to release planning',
    action: 'open_channel',
    fields: { channel: 'release planning' },
  },
  {
    say: 'Can you find me the messages where me and Deepanshu are discussing about mobile par?',
    action: 'find_conversation',
    fields: { conversation: 'mobile par' },
  },
  {
    say: 'Find me a thread where me and Dipanshu are discussing about mobile perf.',
    action: 'find_conversation',
    fields: { conversation: 'mobile perf', with: ['Dipanshu'] },
  },
  {
    say: 'find the thread where Karan and I discussed the release',
    action: 'find_conversation',
    fields: { with: ['Karan'] },
  },
  {
    say: 'open the thread about the release plan',
    action: 'find_conversation',
    fields: { conversation: 'release plan' },
  },
  {
    say: 'where did we talk about login errors',
    action: 'find_conversation',
    fields: { conversation: 'login errors' },
  },
  {
    say: 'post in general that the build is green',
    action: 'post_message',
    fields: { channel: 'general', message: 'the build is green' },
  },
  { say: 'post hello here', action: 'post_message', fields: { channel: 'here', message: 'hello' } },
  {
    say: 'go to general and mention Deepanshu to do the RCA',
    action: 'post_message',
    fields: { channel: 'general', mentions: ['Deepanshu'] },
  },
  {
    say: 'open the general channel and mention Xyne Doctor and ask it to check the latest crash',
    action: 'post_message',
    fields: { channel: 'general', mentions: ['Xyne Doctor'], message: 'check the latest crash' },
  },
  { say: 'hi', kind: 'greeting' },
  { say: 'thanks', kind: 'thanks' },
  { say: 'what can you do', kind: 'help' },
  { say: 'how does this work?', kind: 'help' },
  { say: 'what did we decide about the launch', kind: 'question' },
  { say: 'who owns billing?', kind: 'question' },

  { say: 'uh the', kind: 'unclear' },
];

const live = process.env.ASSISTANT_LIVE === '1' ? describe : describe.skip;

live('the phrase set, against the real Jev', () => {
  let ask: (
    state: JevState,
    questions: Record<string, JevQuestion>
  ) => Promise<Record<string, JevAnswer> | null>;

  beforeAll(async () => {
    // Loaded only for live runs: these read the gateway settings from the environment.
    const { askJev } = await import('@/services/queryIntent/jevClient');
    const { jevConnection } = await import('./gateway');
    ask = (state, questions) =>
      askJev(state, questions, 8000, undefined, {
        connection: jevConnection(),
      });
  });

  it.each(CASES)(
    '$say',
    async ({ say, action, fields, kind }) => {
      const { state, questions } = buildIntentQuestions(say, ACTIONS, null);
      const answers = await ask(state, questions);
      expect(answers).not.toBeNull();
      const decision = decideIntent(rankActions(answers!, ACTIONS));

      if (kind) {
        expect(decision.kind).toBe('none');
        expect(sentenceKind(answers!)).toBe(kind);
        return;
      }
      expect(decision).toEqual({ kind: 'act', action });
      if (!fields) return;
      const reading = readingFor(ACTIONS.get(action!)!, say);
      const picked = await ask(reading.state, reading.questions);
      expect(reading.read(picked!)).toMatchObject(fields);
    },
    15_000
  );
});
