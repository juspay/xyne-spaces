import type { Query } from "@rocicorp/zero";
import { type Schema, type Context } from "../../schema";
import { BaseQueryACL } from "../core/base-acl";
import { guestProjectAccessWhere, isGuestContext } from "../core/guest-acl-utils";

export class ProjectTagsACL extends BaseQueryACL<"project_tags"> {
  constructor(ctx: Context) {
    super(ctx, "project_tags");
  }

  canSelect<TReturn>(
    query: Query<"project_tags", Schema, TReturn>,
  ): Query<"project_tags", Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('project', (p) =>
        p
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestProjectAccessWhere(this.ctx)),
      );
    }

    return query.whereExists("project", (p) =>
      p.where("workspaceId", "=", this.ctx.workspaceId),
    );
  }
}
