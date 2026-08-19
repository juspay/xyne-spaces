import type { Query } from "@rocicorp/zero";
import type { Context, Schema } from "../../schema";
import { BaseQueryACL } from "../core/base-acl";

export class EntityAccessACL extends BaseQueryACL<"entity_access"> {
  constructor(ctx: Context) {
    super(ctx, "entity_access");
  }

  canSelect<TReturn>(
    query: Query<"entity_access", Schema, TReturn>,
  ): Query<"entity_access", Schema, TReturn> {
    return query
      .where("workspaceId", this.ctx.workspaceId)
      .where("userId", this.ctx.userID);
  }
}
