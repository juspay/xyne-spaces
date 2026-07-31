import {
  createErrorTrace as createSharedErrorTrace,
  findError,
  serializeError,
  type ErrorTrace as SharedErrorTrace,
} from '@xyne/shared/logger';

export type ErrorTrace = SharedErrorTrace<'dashboard'>;

const workspaceFrame = (file: string): boolean =>
  /(?:^|\/)(?:apps\/dashboard\/src|dashboard\/src|src)\//.test(file.replace(/\\/g, '/'));

const createErrorTrace = (value: unknown): ErrorTrace =>
  createSharedErrorTrace(value, {
    runtime: 'dashboard',
    isWorkspaceFrame: workspaceFrame,
  });

export { createErrorTrace, findError, serializeError };
