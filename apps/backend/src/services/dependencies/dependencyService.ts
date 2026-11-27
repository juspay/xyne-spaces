import {
  createBlocksTx, changeBlocksTx, updateSubTicketGatingTx, withDependencyWrite,
  type DependencyActor,
} from '@/bypassAcl/transactions/dependencyService';
import type { CreateBlocksInput, DependencySettings } from './types';
export { readDependencies } from '@/bypassAcl/transactions/dependencyRead';

export const createBlocks = (actor: DependencyActor, input: CreateBlocksInput) =>
  withDependencyWrite(actor, (tx, resolved) => createBlocksTx(tx, resolved, input));
export const updateBlocks = (actor: DependencyActor, id: string, input: DependencySettings, reason?: string) =>
  withDependencyWrite(actor, (tx, resolved) => changeBlocksTx(tx, resolved, id, 'update', input, reason));
export const deleteBlocks = (actor: DependencyActor, id: string, reason?: string) =>
  withDependencyWrite(actor, (tx, resolved) => changeBlocksTx(tx, resolved, id, 'delete', undefined, reason));
export const markSatisfied = (actor: DependencyActor, id: string, reason?: string) =>
  withDependencyWrite(actor, (tx, resolved) => changeBlocksTx(tx, resolved, id, 'satisfy', undefined, reason));
export const updateSubTicketGating = (actor: DependencyActor, id: string, input: DependencySettings, reason?: string) =>
  withDependencyWrite(actor, (tx, resolved) => updateSubTicketGatingTx(tx, resolved, id, input, reason));
