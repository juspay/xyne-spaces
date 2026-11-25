import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose, as the other tests here (run via `pnpm --filter @xyne/shared test`).
import { initialMessageMdTemplate, isComposeTemplateName, runComposeTemplate } from '../dist/enc-contracts/compose.js';
import { buildInitialMessageMd } from '../dist/utils/activityMetadataParser.js';

/**
 * initialMessageMd: a conversation's initial_message_md composed by the encryption service when the
 * backend holds the message's content only encrypted. It must serialize exactly what
 * buildInitialMessageMd does for the same message, or a rebuild would rewrite every such block.
 */
const message = {
  messageId: 'msg-1',
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  senderId: 'bot-1',
  content: 'hello from a bot',
  msgType: 'BOT',
  hasAttachment: false,
  edited: false,
  isDeleted: false,
  showInChannel: false,
  visibleTo: null,
  createdAt: 1795640000000,
  metadata: { contentFormat: 'markdown' },
  nudgeCount: 0,
  isSent: true,
  reactions_md: null,
  link_preview_md: null,
  childConversationId: null,
};

test('initialMessageMd is a compose template the transformer accepts', () => {
  assert.equal(isComposeTemplateName('initialMessageMd'), true);
});

test('only the content is unreadable', () => {
  assert.deepEqual([...initialMessageMdTemplate.unreadableFields], ['content']);
});

test('composes the same block as buildInitialMessageMd', () => {
  // Inputs as the transformer gets them: the content decrypted, the rest as the message row holds it.
  assert.equal(runComposeTemplate('initialMessageMd', message), buildInitialMessageMd(message));
});

test('the block holds the content as text, not as ciphertext', () => {
  const md = runComposeTemplate('initialMessageMd', message);
  assert.ok(md.includes('hello from a bot'), md);
  assert.ok(!md.includes('ENC:'), md);
});

test('refuses inputs that are not a message', () => {
  assert.throws(() => runComposeTemplate('initialMessageMd', { messageId: 'msg-1' }));
});
