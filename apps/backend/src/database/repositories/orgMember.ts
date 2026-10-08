import { BaseRepository } from './base';
import { markAccountClaimsStale } from '@/auth/claimsWatermark';
import { Prisma } from '@prisma/client';

export type OrgMember = Prisma.OrgMemberGetPayload<{}>;
export type CreateOrgMemberInput = Prisma.OrgMemberCreateInput;
export type UpdateOrgMemberInput = Prisma.OrgMemberUpdateInput;

export class OrgMemberRepository extends BaseRepository<OrgMember, CreateOrgMemberInput, UpdateOrgMemberInput> {
  constructor() {
    super('orgMember');
  }

  async create(data: CreateOrgMemberInput): Promise<OrgMember> {
    return await this.db.orgMember.create({
      data,
    });
  }

  async findById(memberId: string): Promise<OrgMember | null> {
    return await this.db.orgMember.findUnique({
      where: { memberId },
    });
  }

  async findByEmail(email: string): Promise<OrgMember | null> {
    return await this.db.orgMember.findUnique({
      where: { email },
    });
  }

  async findMany(options?: { where?: Prisma.OrgMemberWhereInput }): Promise<OrgMember[]> {
    return await this.db.orgMember.findMany(options || {});
  }

  async update(memberId: string, data: UpdateOrgMemberInput): Promise<OrgMember> {
    const updated = await this.db.orgMember.update({
      where: { memberId },
      data,
    });
    // `orgRole`, `orgId` and org membership itself ride in the access JWT and are never re-read on
    // the stateless path. Stamped at the write, not at the callers, for the same reason as
    // UserRepository.update.
    if (data.role !== undefined || data.orgId !== undefined || data.leftAt !== undefined) {
      await markAccountClaimsStale(memberId);
    }
    return updated;
  }

  async delete(memberId: string): Promise<OrgMember> {
    const deleted = await this.db.orgMember.delete({
      where: { memberId },
    });
    await markAccountClaimsStale(memberId);
    return deleted;
  }
}
