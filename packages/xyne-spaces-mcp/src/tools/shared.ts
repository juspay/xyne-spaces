/**
 * The tool contract, and the one piece of enrichment every tool shares.
 */

import { MAX_LIMIT, type SpacesClient, type User } from "@xyne/spaces-sdk";
import type { ToolResult } from "../render.js";

/**
 * What a handler is given.
 *
 * An object rather than the client alone, because `spaces_whoami` prints the
 * deployment it is talking to and the SDK client exposes no `baseUrl` getter.
 * It is also where anything else request-scoped would go.
 */
export interface ToolContext {
	readonly sdk: SpacesClient;
	readonly baseUrl: string;
}

/**
 * A tool: its name, the description that decides whether a model reaches for it,
 * its JSON Schema, and the handler.
 *
 * `write: true` marks a tool that changes something. `XYNE_SPACES_READONLY` uses
 * it to drop those from `tools/list` entirely, so an agent attached to a
 * production workspace cannot pick one by accident.
 *
 * There is no `catalog`/`direct` metadata any more. It existed so
 * `scripts/check-operations.mjs` could verify hand-written operation names and
 * argument sets against the backend; now that every call goes through
 * `@xyne/spaces-sdk`, the SDK's own `npm run verify` owns that, and a name or
 * argument this package gets wrong is a compile error rather than a runtime one.
 */
export interface ToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	write?: boolean;
	handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ── User directory ──────────────────────────────────────────────────────────

type DirectoryUser = Pick<User, "id"> & Partial<Pick<User, "name" | "email" | "displayName">>;

/**
 * Names for user ids, and ids for email addresses.
 *
 * Two problems, one lookup. Rows carry bare foreign keys — `assignedTo`,
 * `createdBy`, `senderId` — and rendering those raw gives the model an opaque
 * `cm…` where a person's name belongs. In the other direction, an agent knows
 * "someone@company.com" and never knows a Spaces user id, so any parameter that
 * names a person has to accept an email.
 *
 * Fetched once and held for the life of the process. A directory that goes
 * slightly stale mid-session costs a display name; refetching per call would
 * cost a round trip on every render.
 */
class UserDirectory {
	private byId: Map<string, DirectoryUser> | undefined;
	private byEmail: Map<string, DirectoryUser> | undefined;
	private loading: Promise<void> | undefined;

	/**
	 * Read every user, a page at a time.
	 *
	 * `users.listBasic` caps at 100 rows and clamps anything larger, so a
	 * workspace with more people than that needs the loop — without it the
	 * 101st person onwards renders as a raw id and their email resolves to
	 * nothing, silently and only on workspaces big enough to notice.
	 *
	 * The cost is real: the SDK's pagination windows an array the server
	 * already returned in full, so each page is another full-directory fetch.
	 * That is once per process, at prime time, and the alternative is wrong
	 * output — but it is the reason to prefer a server-side cursor wherever
	 * one exists.
	 */
	private async fetchAll(sdk: SpacesClient): Promise<DirectoryUser[]> {
		const rows: DirectoryUser[] = [];
		let offset = 0;
		// A generous stop: 100 pages is 10,000 users, past which something is
		// wrong and looping forever would be worse than a short directory.
		for (let page = 0; page < 100; page++) {
			const result = await sdk.users.listBasic({ limit: MAX_LIMIT, offset });
			rows.push(...result.items);
			if (!result.hasMore || result.items.length === 0) break;
			offset = result.nextOffset;
		}
		return rows;
	}

	private async load(sdk: SpacesClient): Promise<void> {
		if (this.byId) return;
		if (this.loading) return this.loading;
		this.loading = (async () => {
			const rows = await this.fetchAll(sdk);
			const byId = new Map<string, DirectoryUser>();
			const byEmail = new Map<string, DirectoryUser>();
			for (const row of rows) {
				if (!row?.id) continue;
				byId.set(row.id, row);
				if (row.email) byEmail.set(row.email.toLowerCase(), row);
			}
			this.byId = byId;
			this.byEmail = byEmail;
		})().finally(() => {
			this.loading = undefined;
		});
		return this.loading;
	}

	/**
	 * Load the directory, tolerating failure.
	 *
	 * Enrichment must never fail a tool: if the directory cannot be read, every
	 * label falls back to the raw id and the caller still gets its data.
	 */
	private async ensure(sdk: SpacesClient): Promise<void> {
		try {
			await this.load(sdk);
		} catch {
			this.byId ??= new Map();
			this.byEmail ??= new Map();
		}
	}

	async prime(sdk: SpacesClient): Promise<void> {
		await this.ensure(sdk);
	}

	/** `Name <email> (id: …)`, degrading to `userId: …` when unresolved. */
	label(id: string | undefined | null): string {
		if (!id) return "";
		const user = this.byId?.get(id);
		if (!user) return `userId: ${id}`;
		const name = user.displayName || user.name || "";
		const email = user.email ? ` <${user.email}>` : "";
		return name ? `${name}${email} (id: ${id})` : `userId: ${id}`;
	}

	/** Just the display name, for places where a full label would be noise. */
	name(id: string | undefined | null): string | undefined {
		if (!id) return undefined;
		const user = this.byId?.get(id);
		return user?.displayName || user?.name || undefined;
	}

	all(): DirectoryUser[] {
		return this.byId ? [...this.byId.values()] : [];
	}

	/**
	 * Accept an email address or a user id and return a user id.
	 *
	 * A value without `@` is passed straight through: it is either already an id,
	 * or it is wrong in a way this function cannot detect and the server will
	 * reject. Returns undefined when an email matches nobody, so the caller can
	 * say so rather than silently querying for nothing.
	 */
	async toUserId(sdk: SpacesClient, value: string | undefined): Promise<string | undefined> {
		if (!value) return undefined;
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		if (!trimmed.includes("@")) return trimmed;
		await this.ensure(sdk);
		return this.byEmail?.get(trimmed.toLowerCase())?.id;
	}
}

/** One directory per process, shared by every tool. */
export const users = new UserDirectory();
