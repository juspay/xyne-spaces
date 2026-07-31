import {
  createCallSiteError,
  createErrorTrace as createSharedErrorTrace,
  findError,
  serializeError,
  type ErrorTrace as SharedErrorTrace,
} from '@xyne/shared/logger';

export type ErrorTrace = SharedErrorTrace<'backend'>;

const workspaceFrame = (file: string): boolean =>
  /(?:^|\/)(?:apps\/backend\/src|backend\/src|framework\/src)\//.test(file.replace(/\\/g, '/'));

const createErrorTrace = (value: unknown): ErrorTrace =>
  createSharedErrorTrace(value, {
    runtime: 'backend',
    isWorkspaceFrame: workspaceFrame,
  });

export { createCallSiteError, createErrorTrace, findError, serializeError };
