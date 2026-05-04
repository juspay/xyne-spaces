import type { UserResponse } from "@/apps/types";
import type { SlackUsersInfoResponse } from "../types";

export function transformUsersInfoResponse(
	result: UserResponse,
): SlackUsersInfoResponse {
	const imageUrl = result.picture ?? "";

	return {
		ok: true,
		user: {
			id: result.userId,
			name: result.name,
			real_name: result.name,
			deleted: result.status !== "active",
			is_bot: result.userType === "BOT",
			is_admin: result.userType === "ADMIN",
			is_app_user: false,
			team_id: "",
			updated: Math.floor(result.joined.getTime() / 1000),
			profile: {
				real_name: result.name,
				display_name: result.name,
				email: result.email,
				image_24: imageUrl,
				image_32: imageUrl,
				image_48: imageUrl,
				image_72: imageUrl,
				image_192: imageUrl,
				image_512: imageUrl,
			},
		},
	};
}
