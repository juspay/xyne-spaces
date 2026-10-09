import { CallVisibility, EntityUserAccess } from '../zero/types.js';

/**
 * A user's resolved standing on a recording, strongest first: `owner` is the
 * creator, `edit` an EDIT grant, `view` any other live route in. `null` means
 * no access at all.
 */
export type RecordingAccessLevel = 'owner' | 'edit' | 'view';

/**
 * Highest-wins ranking, because access can arrive by several routes at once.
 * Mirrors COLLECTION_ROLE_RANK in zero/mutators.ts: someone reached by a
 * channel VIEW grant who also holds a direct EDIT grant is an editor.
 */
export const RECORDING_ACCESS_RANK: Record<RecordingAccessLevel, number> = {
  view: 1,
  edit: 2,
  owner: 3,
};

/** The strongest of the levels collected, or `null` when there are none. */
export const strongestRecordingAccess = (
  levels: ReadonlyArray<RecordingAccessLevel | null | undefined>,
): RecordingAccessLevel | null =>
  levels.reduce<RecordingAccessLevel | null>(
    (best, level) =>
      level && (!best || RECORDING_ACCESS_RANK[level] > RECORDING_ACCESS_RANK[best]) ? level : best,
    null,
  );

/**
 * Stored grant level -> effective level. EDIT is the only elevation a share
 * carries; every other live value reads as view, so neither a legacy ADMIN row
 * nor an unrecognised one can quietly elevate someone. REVOKED never reaches
 * here — callers filter it out before ranking.
 */
export const recordingAccessFromGrant = (entityUserAccess: string): RecordingAccessLevel =>
  entityUserAccess === EntityUserAccess.EDIT ? 'edit' : 'view';

/** Whether `level` is at least as strong as `required`. */
export const recordingAccessAtLeast = (
  level: RecordingAccessLevel | null | undefined,
  required: RecordingAccessLevel,
): boolean => !!level && RECORDING_ACCESS_RANK[level] >= RECORDING_ACCESS_RANK[required];

export interface ResolveRecordingAccessParams {
  /** The viewer. `undefined` before auth hydrates, which resolves to no access. */
  currentUserId: string | null | undefined;
  createdByUserId: string | null | undefined;
  visibility: string | null | undefined;
  /**
   * Every live grant that reaches the viewer — direct, or through a user group
   * or channel they belong to. Membership is resolved by the caller: the
   * backend queries it, the client gets it from the Zero query.
   */
  grants: ReadonlyArray<{ entityUserAccess: string }>;
}

/**
 * The recording half of access resolution, shared so the client shows exactly
 * what the server will enforce. `CallShareService.hasAtLeast` is the
 * authority and adds the routes that only exist server-side (regular calls have
 * an audience; recordings do not).
 *
 * - creator                 -> `owner`
 * - a live EDIT grant       -> `edit`
 * - a live VIEW grant       -> `view`
 * - a public workspace link -> `view`, never more
 */
export const resolveRecordingAccessLevel = ({
  currentUserId,
  createdByUserId,
  visibility,
  grants,
}: ResolveRecordingAccessParams): RecordingAccessLevel | null => {
  if (!currentUserId) return null;
  if (createdByUserId === currentUserId) return 'owner';

  const levels: Array<RecordingAccessLevel | null> = grants.map(grant =>
    recordingAccessFromGrant(grant.entityUserAccess),
  );
  // A public link is view-only by design: it never confers edit rights and
  // never share management, however the viewer arrived at the recording.
  if (visibility === CallVisibility.PUBLIC) levels.push('view');

  return strongestRecordingAccess(levels);
};
