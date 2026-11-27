import { BaseQueryACL } from '../base-acl';

/** Private audit text can name restricted tickets. No generic user read/write path is permitted. */
export class TicketDependencyOverridesACL extends BaseQueryACL {
  async getWhereClause(): Promise<Record<string, unknown>> {
    return { id: { in: [] } };
  }

  async getMutateWhere(): Promise<Record<string, unknown>> {
    return { id: { in: [] } };
  }

  async canCreate(): Promise<boolean> {
    return false;
  }
}
