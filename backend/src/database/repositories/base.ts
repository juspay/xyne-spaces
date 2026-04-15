import { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { QueryOptions, PaginationOptions, PaginatedResult } from '@/types/database';

export abstract class BaseRepository<T, CreateInput, UpdateInput> {
  protected db: PrismaClient;
  protected modelName: string;

  constructor(modelName: string) {
    this.db = DatabaseClient.getInstance();
    this.modelName = modelName;
  }

  abstract create(data: CreateInput): Promise<T>;
  abstract findById(id: string): Promise<T | null>;
  abstract findMany(options?: QueryOptions): Promise<T[]>;
  abstract update(id: string, data: UpdateInput): Promise<T>;
  abstract delete(id: string): Promise<T>;

  protected buildPaginationQuery(options: PaginationOptions) {
    const { page, pageSize } = options;
    return {
      skip: (page - 1) * pageSize,
      take: pageSize,
    };
  }

  protected async paginate<TResult>(
    findManyQuery: () => Promise<TResult[]>,
    countQuery: () => Promise<number>,
    options: PaginationOptions
  ): Promise<PaginatedResult<TResult>> {
    const [data, total] = await Promise.all([
      findManyQuery(),
      countQuery(),
    ]);

    return {
      data,
      pagination: {
        page: options.page,
        pageSize: options.pageSize,
        total,
        totalPages: Math.ceil(total / options.pageSize),
      },
    };
  }

  protected createDateTimeFilter(dateRange?: { start?: Date; end?: Date }) {
    if (!dateRange) return {};

    const filter: Record<string, any> = {};

    if (dateRange.start) {
      filter.gte = dateRange.start;
    }

    if (dateRange.end) {
      filter.lte = dateRange.end;
    }

    return filter;
  }

  protected createSearchFilter(searchTerm: string, fields: string[]) {
    return {
      OR: fields.map(field => ({
        [field]: {
          contains: searchTerm,
          mode: 'insensitive' as const,
        },
      })),
    };
  }

  protected createStatusFilter(statuses: string[]) {
    if (statuses.length === 0) return {};

    return {
      status: {
        in: statuses,
      },
    };
  }

  async validateExists(id: string): Promise<boolean> {
    try {
      const result = await this.findById(id);
      return result !== null;
    } catch {
      return false;
    }
  }

  async validateRequired(value: any, fieldName: string): Promise<void> {
    if (value === undefined || value === null) {
      throw new Error(`${fieldName} is required`);
    }
  }

  async validateString(value: any, fieldName: string, maxLength?: number): Promise<void> {
    this.validateRequired(value, fieldName);

    if (typeof value !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }

    if (maxLength && value.length > maxLength) {
      throw new Error(`${fieldName} must be less than ${maxLength} characters`);
    }
  }

  async validateEnum(value: any, fieldName: string, validValues: string[]): Promise<void> {
    this.validateRequired(value, fieldName);

    if (!validValues.includes(value)) {
      throw new Error(`${fieldName} must be one of: ${validValues.join(', ')}`);
    }
  }
}