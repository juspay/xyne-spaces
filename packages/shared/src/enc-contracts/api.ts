import { appsChatPostMessage, appsChatUpdateMessage } from './contracts/apps.js';

/**
 * Every REST API that has a route contract, grouped the way the backend serves them. The
 * backend serves a group with `api.routes(API.<group>, { ... })`, which needs a handler for
 * every entry: adding a contract here without serving it is a type error in the backend.
 *
 * Routes move here one group at a time; anything not here is still mounted the old way.
 */
export const API = {
  apps: {
    chat: {
      postMessage: appsChatPostMessage,
      updateMessage: appsChatUpdateMessage,
    },
  },
} as const;
