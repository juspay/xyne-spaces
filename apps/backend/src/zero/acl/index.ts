export { BaseACL as BaseTableACL } from './core/base-acl';
export { ACLFactory } from './core/acl-factory';

export type {
  QueryContext,
  TableName,
} from './core/types';

export {
  MutationACLError,
} from './core/types';

export {
  wrapMutatorsWithACL,
  wrapTransactionWithACL
} from './wrappers';
