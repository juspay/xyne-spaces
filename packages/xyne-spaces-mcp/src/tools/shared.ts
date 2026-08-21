/**
 * The tool contract, and the one piece of enrichment every tool shares.
 */

import type { SpacesClient } from "../client.js";
import { asRows } from "../render.js";
import type { ToolResult } from "../render.js";

/**
 * A tool: its name, the description that decides whether a model reaches for it,
 * its JSON Schema, and the handler.
 *
 * `write: true` marks a tool that changes something. `XYNE_SPACES_READONLY` uses
 * it to drop those from `tools/list` entirely, so an agent attached to a
 * production workspace cannot pick one by accident.
 */
export interface ToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	write?: boolean;
	/**
	 * Zero catalog operations this tool calls, and the argument keys it sends.
	 *
	 * Declared rather than inferred, because `scripts/check-operations.mjs` reads
	 * it: an operation that no longer exists, or that has grown a required
	 * argument the tool does not send, fails the build instead of failing at run
	 * time with "Validation failed: Required, Required".
	 */
	catalog?: ReadonlyArray<{ name: string; sends: readonly string[] }>;
	/** Non-catalog endpoints this tool calls, as their route templates. */
	direct?: ReadonlyArray<{ method: "get" | "post"; path: string }>;
	handler: (args: Record<string, unknown>, client: SpacesClient) => Promise<ToolResult>;
}

// ── User directory ──────────────────────────────────────────────────────────

interface DirectoryUser {
	id: string;
	name?: string;
	email?: string;
	displayName?: string;
}

/**
 * Names for user ids, and ids for email addresses.
 *
 * Two problems, one lookup. Rows carry bare foreign keys — `assignedTo`,
 * `createdBy`, `senderId` — and rendering those raw gives the model an opaque
 * `cm…` where a person's name belongs. In the other direction, an agent knows
 * "someone@company.com" and never knows a Spaces user id, so any parameter that
 * names a person has to accept an email.
 *
 * `getUsersV2` returns the whole workspace directory in one call, so it is
 * fetched once and held for the life of the process. A directory that goes
 * slightly stale mid-session costs a display name; refetching per call would
 * cost a round trip on every render.
 */
class UserDirectory {
	private byId: Map<string, DirectoryUser> | undefined;
	private byEmail: Map<string, DirectoryUser> | undefined;
	private loading: Promise<void> | undefined;

	private async load(client: SpacesClient): Promise<void> {
		if (this.byId) return;
		if (this.loading) return this.loading;
		this.loading = (async () => {
			const rows = asRows<DirectoryUser>(await client.catalogQuery("getUsersV2", {}));
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
	private async ensure(client: SpacesClient): Promise<void> {
		try {
			await this.load(client);
		} catch {
			this.byId ??= new Map();
			this.byEmail ??= new Map();
		}
	}

	async prime(client: SpacesClient): Promise<void> {
		await this.ensure(client);
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
	async toUserId(client: SpacesClient, value: string | undefined): Promise<string | undefined> {
		if (!value) return undefined;
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		if (!trimmed.includes("@")) return trimmed;
		await this.ensure(client);
		return this.byEmail?.get(trimmed.toLowerCase())?.id;
	}
}

/** One directory per process, shared by every tool. */
export const users = new UserDirectory();
