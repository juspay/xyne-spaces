import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { MessageArtifactStatus, Schema, getSlashCommandArtifactDefinition } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

/**
 * The projected columns (`command`, `messagePreview`) are written by the message's
 * author from inside the send/update/delete mutators: the body they project may be
 * client-encrypted, so the server cannot derive them. Lifecycle (`status`,
 * `callExternalId`) stays server-owned except for the author closing their own
 * artifact. Every write is therefore gated on "this is the author of the source
 * message, in this workspace".
 */
export class MessageArtifactsACL extends BaseACL<'message_artifacts'> {
  // Closing may only move the lifecycle forward.
  private static readonly CLOSE_KEYS = ['id', 'status', 'updatedAt'];
  // An edit of the artifact message re-projects only the preview.
  private static readonly PREVIEW_KEYS = ['id', 'messagePreview'];

  private async requireOwnedArtifact(id: string, tx: Transaction<Schema>) {
    const artifact = await tx.run(zql.message_artifacts.where('id', '=', id).one());
    if (!artifact) {
      throw new MutationACLError(
        'Message artifact update failed: artifact does not exist',
        'message_artifacts',
      );
    }
    if (artifact.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Message artifact not found in this workspace',
        'message_artifacts',
      );
    }
    return artifact;
  }

  private async requireAuthoredMessage(messageId: string, action: string, tx: Transaction<Schema>) {
    const message = await tx.run(zql.messages.where('messageId', '=', messageId).one());
    if (!message) {
      throw new MutationACLError(
        `Message artifact ${action} failed: source message does not exist`,
        'message_artifacts',
      );
    }
    if (message.senderId !== this.ctx.userID) {
      throw new MutationACLError(
        `Message artifact ${action} failed: only the author can ${action} this artifact`,
        'message_artifacts',
      );
    }
    return message;
  }

  async canInsert(
    args: InsertValue<TableSchema<'message_artifacts'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Message artifact insert failed: workspace mismatch',
        'message_artifacts',
      );
    }
    // Inserted by the send mutators right after the message row, so the
    // message is visible to this transaction.
    const message = await this.requireAuthoredMessage(args.messageId, 'insert', tx);
    if (message.conversationId !== args.conversationId) {
      throw new MutationACLError(
        'Message artifact insert failed: conversation does not match the message',
        'message_artifacts',
      );
    }
    const conversation = await tx.run(
      zql.conversations.where('conversationId', '=', args.conversationId).one(),
    );
    if (!conversation || conversation.channelId !== args.channelId) {
      throw new MutationACLError(
        'Message artifact insert failed: channel does not match the conversation',
        'message_artifacts',
      );
    }
    // The command is the only projected field the server can and must trust: it
    // drives the one-open-artifact filter and routing, so it has to be registered.
    if (!getSlashCommandArtifactDefinition(args.command)) {
      throw new MutationACLError(
        'Message artifact insert failed: unknown slash command',
        'message_artifacts',
      );
    }
    if (args.status !== MessageArtifactStatus.ACTIVE || args.callExternalId) {
      throw new MutationACLError(
        'Message artifact insert failed: lifecycle fields are server-owned',
        'message_artifacts',
      );
    }
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'message_artifacts'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const artifact = await this.requireOwnedArtifact(args.id, tx);
    const argsKeys = Object.keys(args);

    const isClose = argsKeys.every((key) => MessageArtifactsACL.CLOSE_KEYS.includes(key));
    const isPreview = argsKeys.every((key) => MessageArtifactsACL.PREVIEW_KEYS.includes(key));
    if (!isClose && !isPreview) {
      throw new MutationACLError(
        'Message artifact update failed: only the lifecycle status or the preview may be changed',
        'message_artifacts',
      );
    }
    if (isClose && args.status !== undefined && args.status !== MessageArtifactStatus.CANCELLED) {
      throw new MutationACLError(
        'Message artifact update failed: only closing an artifact is allowed',
        'message_artifacts',
      );
    }

    await this.requireAuthoredMessage(artifact.messageId, 'update', tx);
  }

  async canDelete(
    args: DeleteID<TableSchema<'message_artifacts'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const artifact = await this.requireOwnedArtifact(args.id, tx);
    // Deleting the message deletes its artifact; the source row may already be
    // gone when this runs, so a missing message is allowed here.
    const message = await tx.run(
      zql.messages.where('messageId', '=', artifact.messageId).one(),
    );
    if (message && message.senderId !== this.ctx.userID) {
      throw new MutationACLError(
        'Message artifact delete failed: only the author can delete this artifact',
        'message_artifacts',
      );
    }
  }
}
