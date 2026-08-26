import { randomUUID } from 'crypto';
import { WebClient } from '@slack/web-api';
import { AccessType } from '@xyne/shared';
import { encrypt } from '@/services/encryptionService';
import { repositories } from '@/database/repositories';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { isMigrationEncryptionConfigured } from './migrationCrypto';
import { config } from '@/config/env';
import { getWorkspaceIdByTeamId } from '@/migration/slack/slackMigrationBotConfig';
import { SlackMigrationEngine } from './engine';
import { MigrationStore } from './store';
import { MigrationQueues } from './queues';
import {
  ChannelInput,
  MigrationJob,
  MigrationJobView,
  MigrationStatus,
  MigrationType,
  QueueName,
  toView,
} from './types';

export interface Actor { userId: string; workspaceId: string; name?: string; email?: string; }

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

// Env separation comes from the dedicated MIGRATION_GCS_BUCKET, not the key.
const gcsPrefix = (id: string) => `slack-migration/${id}`;

export class SlackMigrationService {
  constructor(
    private readonly store: MigrationStore,
    private readonly queues: MigrationQueues,
    private readonly engine: SlackMigrationEngine,
  ) {}

  async submitDm(actor: Actor, tokenInput: string): Promise<MigrationJobView> {
    this.assertEncryptionReady();
    const token = tokenInput?.trim();
    if (!token?.startsWith('xox')) throw new HttpError(400, 'VALIDATION_ERROR', 'A valid Slack user token is required');

    const slack = new WebClient(token);
    const auth = await slack.auth.test().catch(() => null);
    if (!auth?.team_id || !auth?.user_id) throw new HttpError(400, 'VALIDATION_ERROR', 'Slack rejected the token (auth.test failed)');

    // Identity check: token's Slack email must match the signed-in Xyne email — blocks migrating someone else's DMs with a borrowed token.
    const info = await slack.users.info({ user: auth.user_id as string }).catch(() => null);
    const slackEmail = (info?.user as { profile?: { email?: string } } | undefined)?.profile?.email?.trim().toLowerCase();
    const xyneEmail = actor.email?.trim().toLowerCase();
    if (!slackEmail) {
      throw new HttpError(422, 'EMAIL_UNAVAILABLE', 'Could not read the Slack account email from this token (it may be missing the users:read.email scope).');
    }
    if (!xyneEmail || slackEmail !== xyneEmail) {
      throw new HttpError(403, 'EMAIL_MISMATCH', `This Slack token belongs to ${slackEmail}, which does not match your Xyne account${xyneEmail ? ` (${xyneEmail})` : ''}. Submit a token for your own Slack account.`);
    }

    const workspaceId = getWorkspaceIdByTeamId(auth.team_id as string);
    if (!workspaceId) {
      throw new HttpError(422, 'UNMAPPED_WORKSPACE', `No Xyne workspace is mapped to Slack team ${auth.team_id}`);
    }
    // Token's workspace must match the actor's, else owner and target workspace diverge.
    if (actor.workspaceId !== workspaceId) {
      throw new HttpError(403, 'WORKSPACE_MISMATCH', "This token belongs to a different workspace than the one you're in. Submit it from that workspace's dashboard.");
    }
    if (await this.store.hasDmMigration(workspaceId, actor.userId)) {
      throw new HttpError(409, 'CONFLICT', 'You already have a DM migration. An admin must delete it before you can submit again.');
    }

    const job = this.build(MigrationType.DM, actor, workspaceId, auth.team_id as string, {
      ownerSlackId: auth.user_id as string,
      encryptedToken: encrypt(token),
    });
    return this.persistAndQueue(job);
  }

  async submitChannel(actor: Actor, input: ChannelInput): Promise<MigrationJobView> {
    this.assertEncryptionReady();
    if (!input.slackChannelId || !input.xyneChannelId) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'slackChannelId and xyneChannelId are required');
    }
    if (await this.store.hasChannelMigration(actor.workspaceId, input.slackChannelId)) {
      throw new HttpError(409, 'CONFLICT', 'A migration for this channel is already in progress. You can request it again once it completes.');
    }
    const token = config.slackBotToken;
    if (!token) throw new HttpError(400, 'VALIDATION_ERROR', 'Central Slack workspace token is not configured');
    const slack = new WebClient(token);
    const auth = await slack.auth.test().catch(() => null);
    if (!auth?.team_id) throw new HttpError(400, 'VALIDATION_ERROR', 'Central token auth.test failed');

    // Resolve readable names up front — this also validates both channels exist.
    const info = await slack.conversations.info({ channel: input.slackChannelId }).catch(() => null);
    const ch = info?.channel as { name?: string; creator?: string; created?: number; is_member?: boolean } | undefined;
    const slackChannelName = ch?.name;
    if (!slackChannelName) {
      throw new HttpError(422, 'CHANNEL_NOT_FOUND', `Slack channel ${input.slackChannelId} not found, or the migration bot isn't in it.`);
    }
    if (!ch?.is_member) {
      throw new HttpError(422, 'BOT_NOT_IN_CHANNEL', `The Xyne Spaces bot isn't in #${slackChannelName}. In Slack, open the channel and run "/invite @Xyne Spaces", then submit again.`);
    }
    // Fail CLOSED: the requester must be a verified member of the Slack channel. If we can't
    // resolve their Slack id or the member list, reject — never skip the check.
    if (!actor.email) throw new HttpError(403, 'IDENTITY_UNVERIFIED', 'Cannot verify your Slack identity — sign in again.');
    let submitterSlackId: string | undefined;
    try {
      const r = await slack.users.lookupByEmail({ email: actor.email });
      submitterSlackId = (r.user as { id?: string } | undefined)?.id;
    } catch {
      throw new HttpError(403, 'IDENTITY_UNVERIFIED', 'Could not verify your Slack account (the migration bot may be missing the users:read.email scope). Ask an admin to grant it.');
    }
    if (!submitterSlackId) throw new HttpError(403, 'NOT_A_CHANNEL_MEMBER', `No Slack account matches ${actor.email}.`);
    let members: string[];
    try {
      members = await this.channelMemberIds(slack, input.slackChannelId);
    } catch {
      throw new HttpError(502, 'MEMBERSHIP_CHECK_FAILED', `Couldn't verify who's in #${slackChannelName} — please try again.`);
    }
    if (!members.includes(submitterSlackId)) {
      throw new HttpError(403, 'NOT_A_CHANNEL_MEMBER', `You're not a member of #${slackChannelName}. Join it in Slack, then request the migration.`);
    }
    const xyneChannel = await new ChannelRepository().findById(input.xyneChannelId);
    if (!xyneChannel || xyneChannel.workspaceId !== actor.workspaceId) {
      throw new HttpError(422, 'CHANNEL_NOT_FOUND', `No Xyne channel found for id ${input.xyneChannelId} in this workspace.`);
    }
    // Must be a member of the DESTINATION Xyne channel — not just the workspace — or anyone
    // could dump a private Slack channel into a channel they don't belong to.
    if (!(await repositories.channelParticipants.isParticipant(input.xyneChannelId, actor.userId))) {
      throw new HttpError(403, 'NOT_A_CHANNEL_MEMBER', `You must be a member of the destination Xyne channel "${xyneChannel.name}" to migrate into it.`);
    }

    const job = this.build(MigrationType.CHANNEL, actor, actor.workspaceId, auth.team_id as string, {
      encryptedToken: encrypt(token),
      channelInput: input,
      slackChannelName,
      xyneChannelName: xyneChannel.name,
      slackChannelCreator: ch?.creator,
      slackChannelCreated: ch?.created,
    });
    return this.persistAndQueue(job);
  }

  /** All member Slack ids of a channel (paginated) — used to confirm the requester is in it. */
  private async channelMemberIds(slack: WebClient, channelId: string): Promise<string[]> {
    const members: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await slack.conversations.members({ channel: channelId, limit: 1000, cursor });
      members.push(...(r.members ?? []));
      cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
    } while (cursor);
    return members;
  }

  async approve(id: string, actor: Actor): Promise<MigrationJobView> {
    const job = await this.mustGet(id, actor);
    if (job.status !== MigrationStatus.AWAITING_APPROVAL) {
      throw new HttpError(409, 'INVALID_STATE', `Only a migration awaiting approval can be approved (current: ${job.status})`);
    }
    const updated = await this.store.update(id, { currentQueue: QueueName.INGESTION });
    await this.queues.enqueue(QueueName.INGESTION, id, 'end');
    return toView(updated);
  }

  async stop(id: string, actor: Actor): Promise<MigrationJobView> {
    const job = await this.mustGet(id, actor);
    if (job.status === MigrationStatus.QUEUED) {
      await this.queues.removeJob(job.currentQueue, id).catch(() => undefined);
      return toView(await this.store.update(id, { status: MigrationStatus.STOPPED, stopReason: 'admin' }));
    }
    if (![MigrationStatus.COLLECTING, MigrationStatus.INGESTING].includes(job.status)) {
      throw new HttpError(409, 'INVALID_STATE', `Only a running migration can be stopped (current: ${job.status})`);
    }
    // Record reason (not identity) so the submitter sees a deliberate admin stop, not a failure.
    return toView(await this.store.update(id, { stopRequested: true, stopReason: 'admin' }));
  }

  async resume(id: string, actor: Actor, requireOwner = false): Promise<MigrationJobView> {
    const job = await this.mustGet(id, actor);
    if (requireOwner) this.assertOwner(job, actor);
    if (![MigrationStatus.STOPPED, MigrationStatus.FAILED].includes(job.status)) {
      throw new HttpError(409, 'INVALID_STATE', `Only a stopped or failed migration can be resumed (current: ${job.status})`);
    }
    // Admin-stopped ⇒ front (resumes next); failed/pod-killed ⇒ end (don't block others). §5.9
    const position = job.status === MigrationStatus.STOPPED ? 'front' : 'end';
    const updated = await this.store.update(id, { status: MigrationStatus.QUEUED, stopRequested: false, stopReason: undefined });
    await this.queues.enqueue(job.currentQueue, id, position);
    return toView(updated);
  }

  async remove(id: string, actor: Actor, requireOwner = false): Promise<void> {
    const job = await this.mustGet(id, actor);
    if (requireOwner) this.assertOwner(job, actor);
    if ([MigrationStatus.COLLECTING, MigrationStatus.INGESTING].includes(job.status)) {
      throw new HttpError(409, 'INVALID_STATE', 'Stop the migration before deleting it.');
    }
    if (job.status !== MigrationStatus.COMPLETED) {
      await this.engine.deletePrefix(job.gcsPrefix); // completed jobs already deleted their data
    }
    await this.queues.removeJob(QueueName.COLLECTION, id).catch(() => undefined);
    await this.queues.removeJob(QueueName.INGESTION, id).catch(() => undefined);
    await this.store.delete(id);
  }

  async listForAdmin(actor: Actor, limit = 500): Promise<MigrationJobView[]> {
    // Scope to the caller's workspace — slackmig:index is global, so filter after fetch.
    return (await this.store.list(limit, 0)).filter((j) => j.workspaceId === actor.workspaceId).map(toView);
  }

  async getMineList(actor: Actor): Promise<MigrationJobView[]> {
    return (await this.store.list(500, 0)).filter((j) => j.submittedByUserId === actor.userId).map(toView);
  }

  // Generic queue controls are COLLECTION-only; ingestion must use the gated
  // start/stop so blanket-admin endpoints can't bypass SLACK-MIGRATION-INGEST.
  pauseQueue(name: QueueName): Promise<void> {
    this.assertControllableQueue(name);
    return this.queues.pause(name);
  }
  resumeQueue(name: QueueName): Promise<void> {
    this.assertControllableQueue(name);
    return this.queues.resume(name);
  }
  // Only the collection queue is controllable here (ingestion is gated separately). An unknown name
  // (the route casts `req.params.queue as QueueName` unvalidated) must be a clean 400, not a raw 500.
  private assertControllableQueue(name: QueueName): void {
    if (name === QueueName.INGESTION) throw new HttpError(403, 'FORBIDDEN', 'Use the gated Start/Stop Ingestion control for the ingestion queue.');
    if (name !== QueueName.COLLECTION) throw new HttpError(400, 'VALIDATION_ERROR', `Unknown queue "${name}".`);
  }

  // ── Ingestion control (gated by the SLACK-MIGRATION-INGEST resource) ─────────
  // `approve` only stages onto the paused ingestion queue; starting/stopping it
  // requires the SLACK-MIGRATION-INGEST grant — the admin role is not enough.

  /** True if the user holds the ingestion permission (drives the UI + guards start/stop). */
  async canIngest(userId: string): Promise<boolean> {
    const resource = await repositories.resources.findByName('SLACK-MIGRATION-INGEST');
    if (!resource) return false;
    return repositories.resourceAccess.hasAccess(userId, resource.id, AccessType.ADMIN);
  }

  /** TICKET-MIGRATION admins manage Slack migrations too — this gates the admin panel alongside the workspace role. */
  async hasMigrationAdminResource(userId: string): Promise<boolean> {
    const resource = await repositories.resources.findByName('TICKET-MIGRATION');
    if (!resource) return false;
    return repositories.resourceAccess.hasAccess(userId, resource.id, AccessType.ADMIN);
  }

  private async assertCanIngest(userId: string): Promise<void> {
    if (!(await this.canIngest(userId))) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to start or stop migration ingestion.');
    }
  }

  /** canIngest + whether the ingestion queue is currently running (not paused). */
  async ingestionStatus(userId: string): Promise<{ canIngest: boolean; running: boolean }> {
    const [canIngest, paused] = await Promise.all([
      this.canIngest(userId),
      this.queues.isPaused(QueueName.INGESTION),
    ]);
    return { canIngest, running: !paused };
  }

  async startIngestion(userId: string): Promise<{ running: boolean }> {
    await this.assertCanIngest(userId);
    await this.queues.resume(QueueName.INGESTION);
    return { running: true };
  }

  async stopIngestion(userId: string): Promise<{ running: boolean }> {
    await this.assertCanIngest(userId);
    await this.queues.pause(QueueName.INGESTION);
    return { running: false };
  }

  private assertEncryptionReady(): void {
    if (!isMigrationEncryptionConfigured()) {
      throw new HttpError(500, 'CONFIG_ERROR', 'Migration encryption is not configured (set MIGRATION_ENC_KEYS and MIGRATION_ENC_ACTIVE).');
    }
  }

  private build(type: MigrationType, actor: Actor, workspaceId: string, teamId: string, extra: Partial<MigrationJob>): MigrationJob {
    const id = randomUUID();
    const now = Date.now();
    return {
      id, type, status: MigrationStatus.SUBMITTED, currentQueue: QueueName.COLLECTION,
      workspaceId, submittedByUserId: actor.userId, submittedByName: actor.name, teamId,
      gcsPrefix: gcsPrefix(id),
      checkpoint: { totalConversations: 0, collectedConversationIds: [], ingestedConversationIds: [] },
      stats: { conversations: 0, messages: 0 },
      stopRequested: false, heartbeatAt: now, createdAt: now, updatedAt: now,
      ...extra,
    };
  }

  private async persistAndQueue(job: MigrationJob): Promise<MigrationJobView> {
    await this.store.create(job);
    await this.queues.enqueue(QueueName.COLLECTION, job.id, 'end');
    return toView(job);
  }

  private async mustGet(id: string, actor: Actor): Promise<MigrationJob> {
    const job = await this.store.findById(id);
    // 404 (not 403) for another workspace's job — don't leak that the id exists.
    if (!job || job.workspaceId !== actor.workspaceId) throw new HttpError(404, 'NOT_FOUND', 'Migration not found');
    return job;
  }

  /** For member (non-admin) actions: the caller must be the person who submitted the job. */
  private assertOwner(job: MigrationJob, actor: Actor): void {
    if (job.submittedByUserId !== actor.userId) {
      throw new HttpError(403, 'FORBIDDEN', 'You can only manage your own migration.');
    }
  }
}
