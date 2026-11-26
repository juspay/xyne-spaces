import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsFilesInfo } from './files.contracts.js';

/** `/apps/files`: a file's metadata for bots. Key order is the mount order. */
export const filesRouter = defineRouter('/files', {
  info: appsFilesInfo,
});
