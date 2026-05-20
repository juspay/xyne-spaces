import type {
	SlackUsersInfoRequest,
	SlackUsersLookupByEmailRequest,
} from "../types";

export interface UsersInfoArgs {
	userId: string;
}

export function transformUsersInfo(
	slackReq: SlackUsersInfoRequest,
): UsersInfoArgs {
	return { userId: slackReq.user };
}

export interface UsersLookupByEmailArgs {
	email: string;
}

export function transformUsersLookupByEmail(
	slackReq: SlackUsersLookupByEmailRequest,
): UsersLookupByEmailArgs {
	return { email: slackReq.email };
}
