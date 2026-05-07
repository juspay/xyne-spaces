import { BaseRepository } from './base';
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
    return await this.db.orgMember.update({
      where: { memberId },
      data,
    });
  }

  async delete(memberId: string): Promise<OrgMember> {
    return await this.db.orgMember.delete({
      where: { memberId },
    });
  }
}
