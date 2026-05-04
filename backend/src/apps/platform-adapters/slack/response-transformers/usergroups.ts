import type { UserGroupResponse } from "@/apps/types";
import type {
	SlackUsergroupObject,
	SlackUsergroupsListResponse,
} from "../types";

function toUnixSeconds(value: Date): number {
	return Math.floor(value.getTime() / 1000);
}

function transformUsergroup(group: UserGroupResponse): SlackUsergroupObject {
	return {
		id: group.id,
		name: group.name,
		handle: group.alias ?? group.name,
		description: group.description ?? "",
		date_delete: group.isActive ? 0 : toUnixSeconds(group.updatedAt),
		user_count: group.memberCount,
		date_create: toUnixSeconds(group.createdAt),
		date_update: toUnixSeconds(group.updatedAt),
	};
}

export function transformUsergroupsListResponse(
	groups: UserGroupResponse[],
): SlackUsergroupsListResponse {
	return {
		ok: true,
		usergroups: groups.map(transformUsergroup),
	};
}
