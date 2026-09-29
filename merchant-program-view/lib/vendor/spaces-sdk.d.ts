/**
 * Types for the slim vendored bundle (lib/vendor/spaces-sdk.js). Re-exports the
 * real types from @xyne/spaces-sdk (installed in node_modules) and narrows
 * createClient to the resources the slim bundle includes — keep this Pick<> in
 * sync with scripts/slim-spaces-entry.js.
 */
import type { SpacesClient, SpacesClientOptions } from '@xyne/spaces-sdk';

export type { SpacesClientOptions } from '@xyne/spaces-sdk';

/** The subset of SpacesClient the slim bundle exposes. */
export type SlimSpacesClient = Pick<SpacesClient, 'users' | 'channels' | 'conversations' | 'messages' | 'search' | 'tickets' | 'projects' | 'boards' | 'activities' | 'claw' | 'supportTickets' | 'workspace' | 'forms' | 'userGroups'>;

export declare function createClient(options?: SpacesClientOptions): SlimSpacesClient;
