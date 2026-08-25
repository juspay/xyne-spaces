import type { Transaction, UpdateValue } from '@rocicorp/zero';
import { MessageArtifactStatus, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

/**
 * Artifact rows are written by the server (the message side-effect worker and
 * the call lifecycle) for everything except one transition: the author closing
 * their own artifact. Only that transition is opened up here.
 *
 * Insert and delete stay on BaseACL's deny-all — the projection is derived from
 * message content and must never be authored by a client.
 */
export class MessageArtifactsACL extends BaseACL<'message_artifacts'> {
  // Closing may only move the lifecycle forward. Everything else on the row —
  // the projected message fields, the linked call — is server-owned.
  private static readonly CLOSE_KEYS = ['id', 'status', 'updatedAt'];

  async canUpdate(
    args: UpdateValue<TableSchema<'message_artifacts'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const artifact = await tx.run(zql.message_artifacts.where('id', '=', args.id).one());
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

    const argsKeys = Object.keys(args);
    if (!argsKeys.every((key) => MessageArtifactsACL.CLOSE_KEYS.includes(key))) {
      throw new MutationACLError(
        'Message artifact update failed: only the lifecycle status may be changed',
        'message_artifacts',
      );
    }
    if (args.status !== MessageArtifactStatus.CANCELLED) {
      throw new MutationACLError(
        'Message artifact update failed: only closing an artifact is allowed',
        'message_artifacts',
      );
    }

    const message = await tx.run(
      zql.messages.where('messageId', '=', artifact.messageId).one(),
    );
    if (!message) {
      throw new MutationACLError(
        'Message artifact update failed: source message does not exist',
        'message_artifacts',
      );
    }
    if (message.senderId !== this.ctx.userID) {
      throw new MutationACLError(
        'Message artifact update failed: only the author can close this artifact',
        'message_artifacts',
      );
    }
  }
}
