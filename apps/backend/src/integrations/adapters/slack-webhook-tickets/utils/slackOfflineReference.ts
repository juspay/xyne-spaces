import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-operation offline snapshot of Slack reference data (users, usergroups, channels)
 * captured during migration collection. When present, fetchers resolve from it instead
 * of calling Slack, so ingestion runs with zero Slack API calls. Values match fetcher
 * return shapes; a miss returns null (no Slack fallback — ingestion must stay offline).
 */
export interface SlackOfflineReference {
  users: Map<string, unknown>;    // SlackUserInfo shape
  groups: Map<string, unknown>;   // SlackGroupInfo shape
  channels: Map<string, { id: string; name: string; isPrivate: boolean }>;
  /** Migration only: find-or-create a Xyne user by email so a not-yet-present mentioned person is created and linked. */
  createUser?: (email: string, name: string, isDeactivated: boolean) => Promise<string | undefined>;
}

const store = new AsyncLocalStorage<SlackOfflineReference>();

export const runWithSlackOfflineReference = <T>(ref: SlackOfflineReference, fn: () => Promise<T>): Promise<T> =>
  store.run(ref, fn);

export const slackOfflineReference = (): SlackOfflineReference | undefined => store.getStore();
