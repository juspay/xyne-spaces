import type { Prisma, PrismaClient } from '@prisma/client';
import { transaction, type TxCapableClient } from '../base';
import { db } from '@/database/client';
import { createConnectGroupForEntity, ConnectEntityType } from '@/database/connectGroup';

/**
 * Slack Connect — create a canvas and its private connect_group row atomically.
 *
 * A canvas with a connectId but no connect_group row is invisible to connectReach (matches neither
 * branch) and unrepairable through the app, so the two writes must commit together. The caller mints
 * `connectId` and stamps it on `data`; we also pass it to the group row. Not ACL-wrapped by design —
 * this is a bypass operation (see /ACL_BYPASS_AUDIT.md).
 */
export function createCanvasWithConnectGroupTx(
  data: Prisma.CanvasUncheckedCreateInput,
  hostWorkspaceId: string,
  connectId: string,
  client: TxCapableClient = db,
) {
  return transaction(
    ['Canvas', 'ConnectGroup'],
    'createCanvasWithConnectGroup: canvas and its connect_group row must commit atomically; tx is not ACL-wrapped',
    client,
    async (tx) => {
      const canvas = await tx.canvas.create({ data });
      await createConnectGroupForEntity(tx, {
        entityType: ConnectEntityType.CANVAS,
        entityId: canvas.id,
        hostWorkspaceId,
        connectId,
      });
      return canvas;
    },
  );
}

/** Slack Connect — create a channel and its private connect_group row atomically (see above). */
export function createChannelWithConnectGroupTx(
  data: Prisma.ChannelUncheckedCreateInput,
  hostWorkspaceId: string,
  connectId: string,
  client: TxCapableClient = db,
) {
  return transaction(
    ['Channel', 'ConnectGroup'],
    'createChannelWithConnectGroup: channel and its connect_group row must commit atomically; tx is not ACL-wrapped',
    client,
    async (tx) => {
      const channel = await tx.channel.create({ data });
      await createConnectGroupForEntity(tx, {
        entityType: ConnectEntityType.CHANNEL,
        entityId: channel.id,
        hostWorkspaceId,
        connectId,
      });
      return channel;
    },
  );
}

/**
 * Slack Connect — channel + connect_group where the caller's `client` may already be an interactive
 * transaction (e.g. workspace bootstrap runs inside its own tx). When it is a full client we open a
 * transaction; when it is already a tx we run the two writes directly on it (the caller owns atomicity).
 */
export async function createChannelWithConnectGroupMaybeTx(
  client: PrismaClient | Prisma.TransactionClient,
  data: Prisma.ChannelUncheckedCreateInput,
  hostWorkspaceId: string,
  connectId: string,
): Promise<{ id: string }> {
  const insert = async (tx: Prisma.TransactionClient): Promise<{ id: string }> => {
    const channel = await tx.channel.create({ data, select: { id: true } });
    await createConnectGroupForEntity(tx, {
      entityType: ConnectEntityType.CHANNEL,
      entityId: channel.id,
      hostWorkspaceId,
      connectId,
    });
    return channel;
  };
  return typeof (client as PrismaClient).$transaction === 'function'
    ? createChannelWithConnectGroupTxWrapped(client as TxCapableClient, insert)
    : insert(client as Prisma.TransactionClient);
}

function createChannelWithConnectGroupTxWrapped(
  client: TxCapableClient,
  insert: (tx: Prisma.TransactionClient) => Promise<{ id: string }>,
) {
  return transaction(
    ['Channel', 'ConnectGroup'],
    'createChannelWithConnectGroup (maybe-tx): channel and its connect_group row must commit atomically; tx is not ACL-wrapped',
    client,
    insert,
  );
}
