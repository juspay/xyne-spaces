import type { Query } from "@rocicorp/zero";
import type { Context, Schema } from "../../schema";
import {
  AccessType,
  EntityUserAccess,
  ShareableEntityType,
  SummaryTemplateVisibility,
} from "../../schema";
import { BaseQueryACL } from "../core/base-acl";

export class SummaryTemplatesACL extends BaseQueryACL<"summary_templates"> {
  constructor(ctx: Context) {
    super(ctx, "summary_templates");
  }

  canSelect<TReturn>(
    query: Query<"summary_templates", Schema, TReturn>,
  ): Query<"summary_templates", Schema, TReturn> {
    return query
      .where("workspaceId", this.ctx.workspaceId)
      .where(({ or, and, cmp, exists }) =>
        or(
          cmp("createdBy", this.ctx.userID),
          cmp("visibility", SummaryTemplateVisibility.PUBLIC),
          and(
            cmp("visibility", SummaryTemplateVisibility.WAITING_FOR_APPROVAL),
            exists("workspaceResourceAccess", access =>
              access
                .where("accessType", AccessType.ADMIN)
                .where(({ or: accessOr, cmp: accessCmp, exists: accessExists }) =>
                  accessOr(
                    accessCmp("userId", this.ctx.userID),
                    accessExists("userGroup", group =>
                      group.whereExists("userGroupMappings", membership =>
                        membership.where("userId", this.ctx.userID),
                      ),
                    ),
                  ),
                )
                .whereExists("resource", resource => resource.where("name", "SCRIBE")),
            ),
          ),
          exists("shares", share =>
            share
              .where("workspaceId", this.ctx.workspaceId)
              .where("shareableEntityType", ShareableEntityType.SUMMARY_TEMPLATE)
              .where("entityUserAccess", "!=", EntityUserAccess.REVOKED)
              .where(({ or: shareOr, cmp: shareCmp, exists: shareExists }) =>
                shareOr(
                  shareCmp("userId", this.ctx.userID),
                  shareExists("userGroupMemberships", membership =>
                    membership.where("userId", this.ctx.userID),
                  ),
                  shareExists("channelMembers", member =>
                    member.where("userId", this.ctx.userID),
                  ),
                ),
              ),
          ),
        ),
      );
  }
}
