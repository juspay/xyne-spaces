import type { Query } from "@rocicorp/zero";
import type { Context, Schema } from "../../schema";
import { BaseQueryACL } from "../core/base-acl";
import type { SelectArgs } from "../core/types";
import { pollChannelScope } from "./poll-channel-scope";
import { pollResultAccessWhere } from "./poll-result-access";

export class PollQuestionResultsACL extends BaseQueryACL<"poll_question_results"> {
  constructor(ctx: Context) {
    super(ctx, "poll_question_results");
  }

  canSelect<TReturn>(
    query: Query<"poll_question_results", Schema, TReturn>,
    args?: SelectArgs,
  ): Query<"poll_question_results", Schema, TReturn> {
    const scope = pollChannelScope(this.ctx, args);
    return query.whereExists("poll", (poll) =>
      scope(poll.where(pollResultAccessWhere(this.ctx))),
    );
  }
}
