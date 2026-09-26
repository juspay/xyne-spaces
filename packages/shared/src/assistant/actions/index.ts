import { loadActions } from '../core/action.js';
import { CHANNELS } from './channels.js';
import { MESSAGING } from './messaging.js';

/**
 * Everything the assistant can do, grouped by area and checked once when the app starts.
 *
 * To add an action, add it to its area's file. To add an area, create a file like
 * messaging.ts and list it here.
 */
export const ACTIONS = loadActions([MESSAGING, CHANNELS]);
