import type { SlackUsersInfoRequest } from "../types";

export interface UsersInfoArgs {
	userId: string;
}

export function transformUsersInfo(
	slackReq: SlackUsersInfoRequest,
): UsersInfoArgs {
	return { userId: slackReq.user };
}
