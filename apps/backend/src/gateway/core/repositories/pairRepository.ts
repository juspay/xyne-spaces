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
  createdBy: string;
}

// A pair's sourceType is `<provider id>-<use case>`, e.g. `slack-mirror`.
const providerOf = (sourceType: string): ProviderId => sourceType.split('-')[0] as ProviderId;

function toPair(row: ExternalSource): Pair {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: providerOf(row.sourceType),
    connectionId: row.parentId ?? '',
    externalId: row.externalIdentifier ?? '',
    spacesId: row.spacesId ?? '',
    status: row.isActive ? 'ACTIVE' : 'PAUSED',
    statusReason: row.statusReason,
    createdBy: row.createdBy ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * PAIR rows in ExternalSource: one external resource ⇄ one Spaces resource. Given a use case's sourceType
 * suffix (Mirror's is `-mirror`), it reads only that use case's pairs; without one, every use case's.
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
    const row = await db.externalSource.findFirst({ where: { spacesId, ...this.scope } });
    return row && toPair(row);
  }

  /** Uses the (workspaceId, sourceType) index. */
  async listActiveSpacesIds(workspaceId: string): Promise<string[]> {
    const rows = await db.externalSource.findMany({
      where: { workspaceId, isActive: true, ...this.scope },
      select: { spacesId: true },
    });
    return rows.flatMap((row) => (row.spacesId ? [row.spacesId] : []));
  }

  async listByConnection(connectionId: string): Promise<Pair[]> {
    const rows = await db.externalSource.findMany({
      where: { parentId: connectionId, ...this.scope },
    });
    return rows.map(toPair);
  }

  async create(data: CreatePairInput): Promise<Pair> {
    const row = await db.externalSource.create({
      data: {
        kind: 'PAIR',
        name: data.name,
        sourceType: data.sourceType,
        displayName: data.displayName,
        credentials: encrypt('{}'), // a PAIR uses its CONNECTION's credentials
        workspaceId: data.workspaceId,
        parentId: data.connectionId,
        externalIdentifier: data.externalId,
        spacesId: data.spacesId,
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
      data: { isActive: status === 'ACTIVE', statusReason },
    });
    return toPair(row);
  }

  async pauseByConnection(connectionId: string, statusReason: GatewayErrorCode): Promise<void> {
    await db.externalSource.updateMany({
      where: { parentId: connectionId, ...this.scope, isActive: true },
      data: { isActive: false, statusReason },
    });
  }

  async delete(id: string): Promise<void> {
    await db.externalSource.delete({ where: { id } });
  }

  private get scope() {
    return {
      kind: 'PAIR',
      ...(this.sourceTypeSuffix ? { sourceType: { endsWith: this.sourceTypeSuffix } } : {}),
    };
  }
}
