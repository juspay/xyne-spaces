import type { Query } from "@rocicorp/zero";
import { type Schema, type Context } from "../../schema";
import { BaseQueryACL } from "../core/base-acl";

export class ProjectTagsACL extends BaseQueryACL<"project_tags"> {
  constructor(ctx: Context) {
    super(ctx, "project_tags");
  }

  canSelect<TReturn>(
    query: Query<"project_tags", Schema, TReturn>,
  ): Query<"project_tags", Schema, TReturn> {
    return query.whereExists("project", (p) =>
      p.where("workspaceId", "=", this.ctx.workspaceId),
    );
  }
}
