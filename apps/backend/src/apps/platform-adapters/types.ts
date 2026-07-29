import type { RequestHandler, Router } from "express";

export interface TransformContext {
	userId: string;
	appId: string;
	workspaceId?: string;
}

export interface IPlatformAdapter {
	readonly platformName: string;
	getRouter(): Router;
}

export class PlatformAdapterRegistry {
	private adapters = new Map<string, IPlatformAdapter>();

	register(adapter: IPlatformAdapter): void {
		this.adapters.set(adapter.platformName, adapter);
	}

	mountAll(parentRouter: Router, ...middleware: RequestHandler[]): void {
		for (const [name, adapter] of this.adapters) {
			parentRouter.use(`/${name}`, ...middleware, adapter.getRouter());
		}
	}
}
