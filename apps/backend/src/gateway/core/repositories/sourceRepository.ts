import type { ExternalSource } from '@prisma/client';
import { ExternalSourceRepository, db } from '../../re-exports';

/** ExternalSource CONNECTION rows and name lookups every use case shares. */
export class SourceRepository {
  private readonly sources = new ExternalSourceRepository();

  async findById(id: string): Promise<ExternalSource | null> {
    return await this.sources.findById(id);
  }

  async findByName(name: string): Promise<ExternalSource | null> {
    return await this.sources.findByName(name);
  }

  async findActiveConfig(workspaceId: string, sourceType: string): Promise<ExternalSource | null> {
    return await db.externalSource.findFirst({
      where: { workspaceId, sourceType, recordType: 'CONNECTION', isActive: true },
    });
  }

  async findActiveNames(names: string[]): Promise<Set<string>> {
    if (names.length === 0) return new Set();
    const rows = await db.externalSource.findMany({
      where: { name: { in: names }, isActive: true },
      select: { name: true },
    });
    return new Set(rows.map((row) => row.name));
  }

  async createConfig(data: {
    name: string;
    sourceType: string;
    displayName: string;
    externalWorkspaceId: string;
    credentials: string;
    description: string | null;
    workspaceId: string;
    createdBy: string;
  }): Promise<ExternalSource> {
    return await db.externalSource.create({
      data: {
        recordType: 'CONNECTION',
        name: data.name,
        sourceType: data.sourceType,
        displayName: data.displayName,
        credentials: data.credentials,
        description: data.description,
        workspaceId: data.workspaceId,
        externalIdentifier: data.externalWorkspaceId,
        createdBy: data.createdBy,
      },
    });
  }

  async update(
    id: string,
    data: {
      credentials?: string;
      displayName?: string;
      description?: string | null;
      isActive?: boolean;
    }
  ): Promise<void> {
    await this.sources.update(id, data);
  }
}
