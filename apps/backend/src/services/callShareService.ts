import { type Call, type Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { isRecording, shareEntityTypeFor } from '@/utils/callTypeUtils';
import {
  CallVisibility,
  recordingAccessAtLeast,
  recordingAccessFromGrant,
  strongestRecordingAccess,
  type RecordingAccessLevel,
} from '@xyne/shared';

/**
 * A user's resolved standing on a call, strongest first: `owner` is the
 * creator, `edit` an EDIT grant, `view` any other live route in. `null` means
 * no access at all.
 *
 * The levels and their ranking live in @xyne/shared so the client resolves the
 * viewer's own standing with the same rules this service enforces.
 */
export type CallAccessLevel = RecordingAccessLevel;

/**
 * The call fields access resolution depends on. Structural rather than the full
 * `Call` row so callers holding a narrow `select` can pass it straight in —
 * but `visibility` is required, not optional, so a caller can never silently
 * drop the public-link branch and get a stricter answer than the truth.
 */
export interface AccessResolvableCall {
  id: string;
  callType: string;
  channelId: string | null;
  workspaceId: string;
  createdByUserId: string;
  visibility: string | null;
}

/**
 * Read-side checks for who can see a call. Recording sharing writes are owned by
 * RecordingSharingService and its single REST command path.
 */
export class CallShareService {
  /**
   * Whether a caller belongs to a call's audience: its host, anyone who took part, or a
   * member of the channel it happened in. A channel call is offered to the channel, so a
   * member who could not attend can still read what came out of it.
   */
  async isCallAudience(
    call: { id: string; channelId: string | null; createdByUserId: string },
    userId: string,
  ): Promise<boolean> {
    if (call.createdByUserId === userId) return true;
    if (await repositories.calls.findParticipant(call.id, userId)) return true;
    if (!call.channelId) return false;
    return repositories.channelParticipants.isParticipant(call.channelId, userId);
  }

  /**
   * Whether the caller may act on the call at `required` strength or better.
   * The single place call access levels are resolved: the REST controllers and
   * the sharing command path all read their answer from here, so the ranking
   * rules live in exactly one place.
   *
   * Every route the caller has in is collected and the strongest kept:
   *
   * - creator                     -> `owner`
   * - a live EDIT grant           -> `edit`
   * - a live VIEW grant           -> `view`
   * - a public recording link     -> `view`, never more
   * - a regular call's audience   -> `view`
   *
   * A grant reaches the caller directly, or through a user group or channel
   * they belong to. Pass `tx` to resolve inside an open transaction.
   */
  async hasAtLeast(
    call: AccessResolvableCall,
    userId: string,
    workspaceId: string,
    required: CallAccessLevel,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (call.workspaceId !== workspaceId) return false;
    // `owner` outranks every threshold, so the creator never needs a lookup.
    if (call.createdByUserId === userId) return true;

    const levels: CallAccessLevel[] = [];

    if (isRecording(call)) {
      // A public link is view-only by design: it never confers edit rights and
      // never share management, however the viewer arrived at the recording.
      if (call.visibility === CallVisibility.PUBLIC) levels.push('view');
    } else if (await this.isCallAudience(call, userId)) {
      // Regular calls are readable by the people who were in them; recordings
      // are not, so this route is deliberately not offered to a recording.
      levels.push('view');
    }

    // Access is a max, so the routes still unchecked can only raise the answer.
    // Clearing the bar here means the grant lookup cannot change it — which is
    // what makes a public-link read cost no queries.
    if (recordingAccessAtLeast(strongestRecordingAccess(levels), required)) return true;

    const grants = await this.listActiveGrants(call, userId, workspaceId, tx);
    levels.push(...grants.map(grant => recordingAccessFromGrant(grant.entityUserAccess)));

    return recordingAccessAtLeast(strongestRecordingAccess(levels), required);
  }

  /**
   * Every live grant reaching the caller, resolved through their group and
   * channel memberships as well as a direct share.
   */
  private async listActiveGrants(
    call: AccessResolvableCall,
    userId: string,
    workspaceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Array<{ entityUserAccess: string }>> {
    const client = tx ?? db;
    const [groupMappings, channelParticipations] = await Promise.all([
      client.userGroupMapping.findMany({ where: { userId }, select: { userGroupId: true } }),
      client.channelParticipant.findMany({ where: { userId }, select: { channelId: true } }),
    ]);

    return repositories.entityAccess.listActiveForViewer(
      {
        workspaceId,
        shareableEntityType: shareEntityTypeFor(call.callType),
        entityId: call.id,
        userId,
        userGroupIds: groupMappings.map(mapping => mapping.userGroupId),
        channelIds: channelParticipations.map(participation => participation.channelId),
      },
      tx,
    );
  }

  /** Who may play or download a call's recording files. */
  async canViewRecordings(call: Call, userId: string): Promise<boolean> {
    if (isRecording(call) && (await this.hasAtLeast(call, userId, call.workspaceId, 'view')))
      return true;
    return this.isCallAudience(call, userId);
  }
}

export const callShareService = new CallShareService();
