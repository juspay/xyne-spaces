import type { UserGroupResponse } from "@/apps/types";
import type {
	SlackUsergroupObject,
	SlackUsergroupsListResponse,
} from "../types";

function toUnixSeconds(value: Date): number {
	return Math.floor(value.getTime() / 1000);
}

function transformUsergroup(
	group: UserGroupResponse & { users?: string[] },
	includeUsers: boolean,
	includeCount: boolean,
): SlackUsergroupObject {
	return {
		id: group.id,
		name: group.name,
		handle: group.alias ?? group.name,
		description: group.description ?? "",
		date_delete: group.isActive ? 0 : toUnixSeconds(group.updatedAt),
		date_create: toUnixSeconds(group.createdAt),
		date_update: toUnixSeconds(group.updatedAt),
		...(includeCount ? { user_count: group.memberCount } : {}),
		...(includeUsers ? { users: group.users ?? [] } : {}),
	};
}

export function transformUsergroupsListResponse(
	groups: Array<UserGroupResponse & { users?: string[] }>,
	options: { includeUsers?: boolean; includeCount?: boolean } = {},
): SlackUsergroupsListResponse {
	return {
		ok: true,
		usergroups: groups.map((group) =>
			transformUsergroup(
				group,
				options.includeUsers === true,
				options.includeCount !== false,
			),
		),
	};
}
