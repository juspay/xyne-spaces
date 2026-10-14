import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import {
  applyComposerHtml,
  applyComposerPlainText,
  composerHtmlToPlainText,
  createComposerSendableTextState,
  evaluateComposerSendUi,
  readSendableComposerText,
  resetComposerSendableText,
  shouldAttemptComposerSend,
} from '@/src/components/input-composer/utils/conversation-input.utils';

const att = (status: ComposerAttachment['status']): ComposerAttachment =>
  ({ status }) as unknown as ComposerAttachment;

const sendUi = (
  state: ReturnType<typeof createComposerSendableTextState>,
  attachments: readonly ComposerAttachment[] = [],
  isSending = false,
  isMutating = false,
) => evaluateComposerSendUi(state, attachments, isSending, isMutating);

describe('composer sendable-text state machine', () => {
  it('starts empty and not sendable', () => {
    const state = createComposerSendableTextState();
    assert.equal(state.plainTextSynced, false);
    assert.equal(readSendableComposerText(state), '');
    assert.equal(sendUi(state).canSend, false);
    assert.equal(sendUi(state).hasComposerContent, false);
    assert.equal(shouldAttemptComposerSend(state, 0), false);
  });

  it('enables send from HTML-only typing before onChangeText fires', () => {
    let state = createComposerSendableTextState();
    state = applyComposerHtml(state, '<p>Ready to send</p>');
    assert.equal(state.plainTextSynced, false);
    assert.equal(readSendableComposerText(state), 'Ready to send');
    assert.equal(sendUi(state).canSend, true);
    assert.equal(shouldAttemptComposerSend(state, 0), true);
  });

  it('enables send from onChangeText even if HTML is still empty', () => {
    let state = createComposerSendableTextState();
    state = applyComposerPlainText(state, 'hello');
    assert.equal(state.plainTextSynced, true);
    assert.equal(readSendableComposerText(state), 'hello');
    assert.equal(sendUi(state).canSend, true);
  });

  it('keeps send enabled while typing then HTML catching up', () => {
    let state = createComposerSendableTextState();
    state = applyComposerPlainText(state, 'hello');
    state = applyComposerHtml(state, '<p>hello</p>');
    assert.equal(sendUi(state).canSend, true);
    assert.equal(readSendableComposerText(state), 'hello');
  });

  it('does not treat whitespace-only text as sendable once text is synced', () => {
    let state = createComposerSendableTextState();
    state = applyComposerPlainText(state, '   ');
    state = applyComposerHtml(state, '<p>Hello</p>');
    assert.equal(readSendableComposerText(state), '   ');
    assert.equal(sendUi(state).canSend, false);
    assert.equal(shouldAttemptComposerSend(state, 0), false);
  });

  it('blocks send after delete even when a stale onChangeHtml still has the old body', () => {
    let state = createComposerSendableTextState();
    state = applyComposerPlainText(state, 'Hello');
    state = applyComposerHtml(state, '<p>Hello</p>');
    state = applyComposerPlainText(state, '');
    assert.equal(readSendableComposerText(state), '');
    assert.equal(sendUi(state).canSend, false);
    assert.equal(shouldAttemptComposerSend(state, 0), false);

    state = applyComposerHtml(state, '<p>Hello</p>');
    assert.equal(composerHtmlToPlainText(state.html).trim(), 'Hello');
    assert.equal(readSendableComposerText(state), '');
    assert.equal(sendUi(state).canSend, false);
    assert.equal(sendUi(state).hasComposerContent, false);
    assert.equal(shouldAttemptComposerSend(state, 0), false);
  });

  it('stays disabled after HTML catches up to the empty field', () => {
    let state = createComposerSendableTextState();
    state = applyComposerPlainText(state, 'Hello');
    state = applyComposerHtml(state, '<p>Hello</p>');
    state = applyComposerPlainText(state, '');
    state = applyComposerHtml(state, '<p></p>');
    assert.equal(readSendableComposerText(state), '');
    assert.equal(sendUi(state).canSend, false);
  });

  it('re-enables send after the user types again following a full delete', () => {
    let state = createComposerSendableTextState();
    state = applyComposerPlainText(state, 'Hello');
    state = applyComposerPlainText(state, '');
    state = applyComposerHtml(state, '<p>Hello</p>');
    state = applyComposerPlainText(state, 'Hi again');
    assert.equal(readSendableComposerText(state), 'Hi again');
    assert.equal(sendUi(state).canSend, true);
  });

  it('treats send/clear as an asserted empty pair so a later stale HTML event cannot revive send', () => {
    let state = createComposerSendableTextState();
    state = applyComposerPlainText(state, 'Hello');
    state = applyComposerHtml(state, '<p>Hello</p>');
    state = resetComposerSendableText('', '');
    assert.equal(state.plainTextSynced, true);
    assert.equal(sendUi(state).canSend, false);

    state = applyComposerHtml(state, '<p>Hello</p>');
    assert.equal(readSendableComposerText(state), '');
    assert.equal(sendUi(state).canSend, false);
    assert.equal(shouldAttemptComposerSend(state, 0), false);
  });

  it('still allows HTML fallback for an HTML-only restored draft', () => {
    const state = resetComposerSendableText('', '<p>Draft body</p>');
    assert.equal(state.plainTextSynced, false);
    assert.equal(readSendableComposerText(state), 'Draft body');
    assert.equal(sendUi(state).canSend, true);
    assert.equal(shouldAttemptComposerSend(state, 0), true);
  });

  it('restores a text+html draft as sendable, then honors a later delete', () => {
    let state = resetComposerSendableText('Draft body', '<p>Draft body</p>');
    assert.equal(state.plainTextSynced, true);
    assert.equal(sendUi(state).canSend, true);

    state = applyComposerPlainText(state, '');
    assert.equal(sendUi(state).canSend, false);
    state = applyComposerHtml(state, '<p>Draft body</p>');
    assert.equal(sendUi(state).canSend, false);
  });

  it('restores a failed-send snapshot with plain text as sendable', () => {
    const state = resetComposerSendableText('unsent', '<p>unsent</p>');
    assert.equal(sendUi(state).canSend, true);
    assert.equal(shouldAttemptComposerSend(state, 0), true);
  });
});

describe('evaluateComposerSendUi with attachments and in-flight flags', () => {
  it('allows sending an uploaded attachment with empty text', () => {
    const state = applyComposerPlainText(createComposerSendableTextState(), '');
    assert.equal(sendUi(state, [att('uploaded')]).canSend, true);
    assert.equal(shouldAttemptComposerSend(state, 1), true);
  });

  it('blocks sending while an attachment is pending, even with text', () => {
    const state = applyComposerPlainText(createComposerSendableTextState(), 'hi');
    assert.equal(sendUi(state, [att('uploading')]).canSend, false);
    assert.equal(sendUi(state, [att('local')]).canSend, false);
  });

  it('blocks sending while already sending or mutating attachments', () => {
    const state = applyComposerPlainText(createComposerSendableTextState(), 'hi');
    assert.equal(sendUi(state, [], true, false).canSend, false);
    assert.equal(sendUi(state, [], false, true).canSend, false);
  });

  it('does not treat a failed attachment as enough to send', () => {
    const state = applyComposerPlainText(createComposerSendableTextState(), '');
    const ui = sendUi(state, [att('failed')]);
    assert.equal(ui.canSend, false);
    assert.equal(ui.hasComposerContent, true);
  });
});
