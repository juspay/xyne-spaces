import type { TableName } from '../acl/core/types';

export type SideEffectOperation = 'insert' | 'update' | 'delete' | 'upsert';

export interface PreviousValue {
  channelId: string;
}

export interface SideEffectJobConfig {
  entityType: TableName;
  entityId: string;
  operation: SideEffectOperation;
  args?: any;
  previousValue?: PreviousValue;
}

export type SideEffectJobsAccumulator = SideEffectJobConfig[];

export type SideEffectOperationConfigMap = {
  [K in TableName]?: SideEffectOperation[];
};

export const SIDE_EFFECT_OPERATION_CONFIG: SideEffectOperationConfigMap = {
  messages: ['insert', 'delete'],
  reactions: ['insert', 'delete'],
  call_participants: ["insert", "update"],
  conversations: ['insert', 'delete'],
  calls: ['update'],
};

export function createSideEffectJobsAccumulator(): SideEffectJobsAccumulator {
  return [];
}
