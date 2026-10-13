import assert from 'node:assert/strict';
import type { APIResponse } from '@playwright/test';
import { Step } from 'gauge-ts';
import {
  assertStatus,
  fetchChannelTickets,
  getStoredChannelId,
  withDevAuthenticatedApiContext,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-api';
import { buildPubSubBatch } from '@/tests/03_e2e/11_xyne-desk/xyne-desk-mock-mail';
import {
  DESK_UI_TIMEOUT_MS,
  mockDeskMails,
  mockPubSubBatches,
  mockPubSubMessages,
  PUBSUB_PER_MESSAGE_TIMEOUT_MS,
  type PubSubBatch,
  type PubSubBulkResult,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';
import {
  assertValidChannelAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

function getPubSubBatch(batchAlias: string): PubSubBatch {
  const batch = mockPubSubBatches.get(batchAlias);
  assert.ok(batch, `Expected Pub/Sub batch "${batchAlias}" to be generated.`);
  return batch;
}

async function postPubSubBatch(
  batchAlias: string,
  channelAlias: string,
  userAlias: string,
  failAtMessageId?: string
): Promise<{ batch: PubSubBatch; response: APIResponse }> {
  const batch = getPubSubBatch(batchAlias);
  const channelId = getStoredChannelId(channelAlias, userAlias);
  const messages = mockPubSubMessages.get(batchAlias);
  assert.ok(messages, `Expected Pub/Sub messages for batch "${batchAlias}".`);
  const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
    apiContext.post('/api/test/desk/pubsub/bulk-gmail', {
      data: { channelId, historyId: batch.historyId, messages, failAtMessageId },
      timeout: DESK_UI_TIMEOUT_MS + messages.length * PUBSUB_PER_MESSAGE_TIMEOUT_MS,
    })
  );
  return { batch, response };
}

/** Asserts the channel holds exactly `expected` tickets from the batch, each title once. */
async function assertPubSubBatchTicketCount(
  batchAlias: string,
  channelAlias: string,
  userAlias: string,
  expected: number
): Promise<void> {
  const channelId = getStoredChannelId(channelAlias, userAlias);
  const tickets = await fetchChannelTickets(
    userAlias,
    channelId,
    'Desk Pub/Sub ticket verification'
  );
  const batchTitles = new Set(
    (mockPubSubMessages.get(batchAlias) ?? []).map((message) => String(message.subject))
  );
  const matching = tickets.filter((ticket) => batchTitles.has(String(ticket.title)));
  assert.equal(
    matching.length,
    expected,
    `Expected ${expected} tickets from batch "${batchAlias}" in channel "${channelAlias}".`
  );
  assert.equal(
    new Set(matching.map((ticket) => ticket.title)).size,
    expected,
    `Expected no duplicate tickets from batch "${batchAlias}" in channel "${channelAlias}".`
  );
}

export default class XyneDeskPubSubSteps {
  // ---------------------------------------------------------------------------
  // SETUP
  // ---------------------------------------------------------------------------

  @Step('generating <count> deterministic Pub/Sub Gmail messages as batch <batchAlias>')
  public async generateDeterministicPubSubBatch(count: string, batchAlias: string): Promise<void> {
    const total = Number.parseInt(count, 10);
    assert.ok(Number.isInteger(total) && total > 0 && total <= 1000, 'Batch size must be 1-1000.');
    const { batch, messages, mail } = buildPubSubBatch(total, batchAlias);
    mockPubSubBatches.set(batchAlias, batch);
    mockDeskMails.set(batchAlias, mail);
    mockPubSubMessages.set(batchAlias, messages);
  }

  // ---------------------------------------------------------------------------
  // ACTION
  // ---------------------------------------------------------------------------

  @Step(
    'publishing deterministic Pub/Sub batch <batchAlias> to Desk channel <channelAlias> for user <userAlias>'
  )
  public async publishDeterministicPubSubBatch(
    batchAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const { batch, response } = await postPubSubBatch(batchAlias, channelAlias, userAlias);
    await assertStatus(response, 'Deterministic Pub/Sub Gmail batch');
    const result = (await response.json()) as PubSubBulkResult;
    assert.equal(result.published, batch.messageIds.length);
    assert.equal(result.processed, batch.messageIds.length);
    assert.equal(result.created, batch.messageIds.length);
    assert.equal(result.duplicates, 0);
    assert.equal(result.skipped, 0);
    await assertPubSubBatchTicketCount(
      batchAlias,
      channelAlias,
      userAlias,
      batch.messageIds.length
    );
  }

  @Step(
    'republishing deterministic Pub/Sub batch <batchAlias> to Desk channel <channelAlias> for user <userAlias>'
  )
  public async republishDeterministicPubSubBatch(
    batchAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const { batch, response } = await postPubSubBatch(batchAlias, channelAlias, userAlias);
    await assertStatus(response, 'Deterministic Pub/Sub duplicate batch');
    const result = (await response.json()) as PubSubBulkResult;
    assert.equal(result.created, 0);
    assert.equal(result.duplicates, batch.messageIds.length);
  }

  @Step(
    'publishing deterministic Pub/Sub batch <batchAlias> to Desk channel <channelAlias> for user <userAlias> failing at message <failIndex>'
  )
  public async publishDeterministicPubSubBatchWithFailure(
    batchAlias: string,
    channelAlias: string,
    userAlias: string,
    failIndex: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const batch = getPubSubBatch(batchAlias);
    const index = Number.parseInt(failIndex, 10);
    assert.ok(
      Number.isInteger(index) && index > 0 && index < batch.messageIds.length,
      `Fail index must be inside the batch so some messages land before the failure.`
    );
    const { response } = await postPubSubBatch(
      batchAlias,
      channelAlias,
      userAlias,
      batch.messageIds[index]
    );
    assert.equal(response.status(), 503, 'Injected failure must surface as a retryable 503.');
    const result = (await response.json()) as { retryable?: boolean };
    assert.equal(result.retryable, true);
    batch.failedAtIndex = index;
    // Messages before the failure point are persisted; nothing at or after it is.
    await assertPubSubBatchTicketCount(batchAlias, channelAlias, userAlias, index);
  }

  @Step(
    'redelivering failed Pub/Sub batch <batchAlias> to Desk channel <channelAlias> for user <userAlias>'
  )
  public async redeliverFailedPubSubBatch(
    batchAlias: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const batch = getPubSubBatch(batchAlias);
    const { failedAtIndex } = batch;
    assert.ok(
      failedAtIndex !== undefined,
      `Expected Pub/Sub batch "${batchAlias}" to have failed before redelivery.`
    );
    const { response } = await postPubSubBatch(batchAlias, channelAlias, userAlias);
    await assertStatus(response, 'Redelivered Pub/Sub batch after failure');
    const result = (await response.json()) as PubSubBulkResult;
    assert.equal(result.duplicates, failedAtIndex, 'Already-persisted messages must dedupe.');
    assert.equal(result.created, batch.messageIds.length - failedAtIndex);
    await assertPubSubBatchTicketCount(
      batchAlias,
      channelAlias,
      userAlias,
      batch.messageIds.length
    );
  }

  // ---------------------------------------------------------------------------
  // ASSERTION
  // ---------------------------------------------------------------------------

  @Step(
    'verifying Desk channel <channelAlias> has no tickets from Pub/Sub batch <batchAlias> for user <userAlias>'
  )
  public async verifyChannelHasNoPubSubBatchTickets(
    channelAlias: string,
    batchAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    await assertPubSubBatchTicketCount(batchAlias, channelAlias, userAlias, 0);
  }
}
