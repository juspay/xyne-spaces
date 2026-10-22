import type { ExternalSource } from '@prisma/client';
import { db, encrypt } from '../../re-exports';
import type { GatewayErrorCode } from '../errors';
import type { Pair, PairStatus, ProviderId } from '../types';

export interface CreatePairInput {
  name: string;
  sourceType: string;
  displayName: string;
  workspaceId: string;
  connectionId: string;
  externalId: string;
  spacesId: string;
  channelId?: string;
  createdBy: string;
}

// A pair's sourceType is `<provider id>-<use case>`.
const providerOf = (sourceType: string): ProviderId => sourceType.split('-')[0] as ProviderId;

function toPair(row: ExternalSource): Pair {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: providerOf(row.sourceType),
    connectionId: row.recordParentId ?? '',
    externalId: row.externalIdentifier ?? '',
    spacesId: row.spacesIdentifier ?? '',
    status: row.isActive ? 'ACTIVE' : 'PAUSED',
    statusReason: row.recordState,
    createdBy: row.createdBy ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * PAIR rows in ExternalSource: one external resource ⇄ one Spaces resource. Given a use case's sourceType
 * suffix, it reads only that use case's pairs; without one, every use case's.
 */
export class PairRepository {
  constructor(private readonly sourceTypeSuffix?: string) {}

  async findById(id: string): Promise<Pair | null> {
    const row = await db.externalSource.findFirst({ where: { id, ...this.scope } });
    return row && toPair(row);
  }

  async findByName(name: string): Promise<Pair | null> {
    const row = await db.externalSource.findFirst({ where: { name, ...this.scope } });
    return row && toPair(row);
  }

  async findBySpacesId(spacesId: string): Promise<Pair | null> {
    const row = await db.externalSource.findFirst({
      where: { spacesIdentifier: spacesId, ...this.scope },
    });
    return row && toPair(row);
  }

  /** Uses the (workspaceId, sourceType) index. */
  async listActiveSpacesIds(workspaceId: string): Promise<string[]> {
    const rows = await db.externalSource.findMany({
      where: { workspaceId, isActive: true, ...this.scope },
      select: { spacesIdentifier: true },
    });
    return rows.flatMap((row) => (row.spacesIdentifier ? [row.spacesIdentifier] : []));
  }

  async listByConnection(connectionId: string): Promise<Pair[]> {
    const rows = await db.externalSource.findMany({
      where: { recordParentId: connectionId, ...this.scope },
    });
    return rows.map(toPair);
  }

  async create(data: CreatePairInput): Promise<Pair> {
    const row = await db.externalSource.create({
      data: {
        recordType: 'PAIR',
        name: data.name,
        sourceType: data.sourceType,
        displayName: data.displayName,
        credentials: encrypt('{}'), // a PAIR uses its CONNECTION's credentials
        workspaceId: data.workspaceId,
        recordParentId: data.connectionId,
        externalIdentifier: data.externalId,
        spacesIdentifier: data.spacesId,
        channelId: data.channelId ?? null,
        createdBy: data.createdBy,
      },
    });
    return toPair(row);
  }

  async setStatus(
    id: string,
    status: PairStatus,
    statusReason: GatewayErrorCode | null = null
  ): Promise<Pair> {
    const row = await db.externalSource.update({
      where: { id },
      data: { isActive: status === 'ACTIVE', recordState: statusReason },
    });
    return toPair(row);
  }

  async pauseByConnection(connectionId: string, statusReason: GatewayErrorCode): Promise<void> {
    await db.externalSource.updateMany({
      where: { recordParentId: connectionId, ...this.scope, isActive: true },
      data: { isActive: false, recordState: statusReason },
    });
  }

  async delete(id: string): Promise<void> {
    await db.externalSource.delete({ where: { id } });
  }

  private get scope() {
    return {
      recordType: 'PAIR',
      ...(this.sourceTypeSuffix ? { sourceType: { endsWith: this.sourceTypeSuffix } } : {}),
    };
  }
}
