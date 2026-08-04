import type { Query } from "@rocicorp/zero";
import type { Context, Schema } from "../../schema";
import { BaseQueryACL } from "../core/base-acl";

export class SummaryTemplatesACL extends BaseQueryACL<"summary_templates"> {
  constructor(ctx: Context) {
    super(ctx, "summary_templates");
  }

  canSelect<TReturn>(
    query: Query<"summary_templates", Schema, TReturn>,
  ): Query<"summary_templates", Schema, TReturn> {
    return query.where("workspaceId", this.ctx.workspaceId);
  }
}
