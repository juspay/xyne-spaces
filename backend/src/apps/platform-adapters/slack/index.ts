import type { IPlatformAdapter } from "../types";
import slackRouter from "./routes";

export class SlackAdapter implements IPlatformAdapter {
	readonly platformName = "slack";

	getRouter() {
		return slackRouter;
	}
}
