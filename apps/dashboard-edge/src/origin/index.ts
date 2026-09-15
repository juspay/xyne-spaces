import type { Config } from '../config.js';
import { createHttpOrigin } from './http.js';
import { createStorageOrigin } from './storage.js';
import type { Origin } from './types.js';

export type { ObjectInfo, ObjectRead, Origin } from './types.js';
export { fingerprintOf } from './types.js';

export function createOrigin(cfg: Config['storage']): Origin {
  // gcs, s3 and azure all go through @xyne/storage; http is a plain origin.
  return cfg.backend === 'http' ? createHttpOrigin(cfg) : createStorageOrigin(cfg);
}
