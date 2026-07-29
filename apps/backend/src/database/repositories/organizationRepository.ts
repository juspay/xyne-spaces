import { BaseRepository } from './base';
import { Organization } from '@prisma/client';
import { QueryOptions } from '@/types/database';

export interface CreateOrganizationInput {
  name: string;
  description?: string;
  createdBy: string;
  metadata?: Record<string, any>;
}

export interface UpdateOrganizationInput {
  name?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface OrganizationFilters {
  name?: string;
  createdBy?: string;
}

export class OrganizationRepository extends BaseRepository<Organization, CreateOrganizationInput, UpdateOrganizationInput> {
  constructor() {
    super('organization');
  }

  async create(data: CreateOrganizationInput): Promise<Organization> {
    await this.validateString(data.name, 'name', 255);
    await this.validateString(data.createdBy, 'createdBy');

    return await this.db.organization.create({
      data: {
        name: data.name,
        description: data.description,
        createdBy: data.createdBy,
        metadata: data.metadata,
      }
    });
  }

  async findById(id: string): Promise<Organization | null> {
    return await this.db.organization.findUnique({
      where: { orgId: id }
    });
  }

  async findByName(name: string): Promise<Organization | null> {
    return await this.db.organization.findUnique({
      where: { name }
    });
  }

  async findMany(options?: QueryOptions): Promise<Organization[]>;
  async findMany(filters?: OrganizationFilters): Promise<Organization[]>;
  async findMany(optionsOrFilters?: QueryOptions | OrganizationFilters): Promise<Organization[]> {
    const filters = optionsOrFilters as OrganizationFilters;
    const where: any = {};

    if (filters?.name) {
      where.name = {
        contains: filters.name,
        mode: 'insensitive'
      };
    }

    if (filters?.createdBy) {
      where.createdBy = filters.createdBy;
    }

    return await this.db.organization.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async update(id: string, data: UpdateOrganizationInput): Promise<Organization> {
    if (data.name) {
      await this.validateString(data.name, 'name', 255);
    }

    return await this.db.organization.update({
      where: { orgId: id },
      data: {
        ...data,
        updatedAt: new Date(),
      }
    });
  }

  async delete(id: string): Promise<Organization> {
    return await this.db.organization.delete({
      where: { orgId: id }
    });
  }

  // Organization-specific methods
  async searchByName(searchTerm: string): Promise<Organization[]> {
    return await this.findMany({ name: searchTerm });
  }

  async getOrganizationsByCreator(createdBy: string): Promise<Organization[]> {
    return await this.findMany({ createdBy });
  }

  async organizationExists(name: string): Promise<boolean> {
    const org = await this.findByName(name);
    return org !== null;
  }
}