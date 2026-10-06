import { UserRepository } from "@/database/repositories/users";
import { logger } from "@/utils/logger";
import type { SlackAttachment, SlackBlock } from "@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes";

/**
 * Slack legacy *handle* mentions: `<@harimohan.sharma>` instead of `<@U099FJD9QC8>`.
 *
 * Slack keeps a per-workspace-unique `name` field on every user (`users.info` →
 * `user.name`), auto-derived from the email local part at signup. The form was
 * deprecated in favour of `<@USERID>` for new messages, but Slack's renderer still
 * resolves `<@name>` against that handle index — which is why callers (Alertmanager
 * templates, internal tooling, maker-checker notifications) still emit it.
 *
 * Xyne has no handle index, but it has the string Slack derived the handle FROM: the
 * email local part. This module rewrites a handle mention into the Xyne user id form
 * the rest of the pipeline already resolves, so no shared resolver changes.
 *
 * Scoped to `chat.postMessage` on purpose — it is applied by `transformPostMessage`
 * only, not by the ephemeral/update transformers and not by the webhook-ticket or
 * migration paths that share the downstream resolvers.
 */

/** `<@token>` or `<@token|label>`. Loose like `extractAllSlackIds`; the token is classified below. */
const USER_MENTION_REGEX = /<@([^<>|\s]+)(?:\|[^<>]*)?>/g;

/** Slack-native ids are uppercase (U099FJD9QC8, W…, B…); Xyne CUIDs are lowercase. */
function isSlackNativeId(token: string): boolean {
	return /^[A-Z][A-Z0-9]+$/.test(token);
}

/**
 * True when the token cannot be an id of any kind, so it is unambiguously a handle.
 * Neither a Slack id nor a CUID can contain `.`, `-`, `_`, `+` or `@`.
 *
 * Pure-alphanumeric tokens (`harry`, or a CUID like `cmp4d91bd005uvldnmch36fll`) are
 * deliberately NOT treated as definite handles: they are still looked up, but on a miss
 * they are left untouched so the existing `findById` CUID path keeps working.
 */
function isDefiniteHandle(token: string): boolean {
	return /[.\-_+@]/.test(token);
}

type Resolution =
	/** Single match — replace the whole token with the Xyne id form. */
	| { kind: "id"; userId: string }
	/** Unresolvable handle — degrade to plain `@handle` text rather than "@unknown user". */
	| { kind: "text" }
	/** Leave the token exactly as-is for the downstream resolvers. */
	| { kind: "skip" };

/**
 * Resolve one mention token.
 *
 * A bare handle is matched against the email local part; a full email
 * (`<@harry@example.com>`) is matched against the email itself — Slack has no such
 * form, but callers that emit handles generally hold the address, not the handle.
 */
async function resolveToken(
	token: string,
	workspaceId: string,
	userRepo: UserRepository,
): Promise<Resolution> {
	if (isSlackNativeId(token)) return { kind: "skip" };

	const definite = isDefiniteHandle(token);
	const miss: Resolution = definite ? { kind: "text" } : { kind: "skip" };

	const atIndex = token.indexOf("@");
	if (atIndex !== -1) {
		// Full email address rather than a handle.
		const user = await userRepo.findByEmailCaseInsensitive(token, workspaceId);
		return user ? { kind: "id", userId: user.id } : miss;
	}

	const matches = await userRepo.findManyByEmailLocalPart(token, workspaceId);
	if (matches.length === 1) return { kind: "id", userId: matches[0].id };

	if (matches.length > 1) {
		// An email local part is not unique within a workspace (harry@a.com, harry@b.com).
		// Slack cannot hit this because its handles ARE unique, so there is no behaviour to
		// copy; pinging the wrong person is worse than not pinging, so we degrade to text.
		logger.warn("[handleMentions] Ambiguous handle mention — resolving to plain text", {
			handle: token,
			workspaceId,
			matchCount: matches.length,
		});
		return { kind: "text" };
	}

	return miss;
}

/**
 * Build the replacement for every distinct `<@…>` token in `source`.
 * Tokens resolving to `skip` are omitted, so the caller leaves them alone.
 */
async function buildReplacements(
	source: string,
	workspaceId: string,
): Promise<Map<string, string>> {
	const tokens = new Set(
		Array.from(source.matchAll(USER_MENTION_REGEX), (match) => match[1]),
	);
	if (tokens.size === 0) return new Map();

	const userRepo = new UserRepository();
	const resolutions = await Promise.all(
		[...tokens].map(async (token) => {
			try {
				return [token, await resolveToken(token, workspaceId, userRepo)] as const;
			} catch (error) {
				logger.error("[handleMentions] Failed to resolve mention token", { token, error });
				return [token, { kind: "skip" } as Resolution] as const;
			}
		}),
	);

	const replacements = new Map<string, string>();
	for (const [token, resolution] of resolutions) {
		if (resolution.kind === "id") replacements.set(token, `<@${resolution.userId}>`);
		else if (resolution.kind === "text") replacements.set(token, `@${token}`);
	}
	return replacements;
}

function applyReplacements(source: string, replacements: Map<string, string>): string {
	if (replacements.size === 0) return source;
	return source.replace(USER_MENTION_REGEX, (whole, token: string) => {
		return replacements.get(token) ?? whole;
	});
}

export type HandleResolvableParts = {
	text?: string;
	blocks?: SlackBlock[];
	attachments?: SlackAttachment[];
};

/**
 * Rewrite Slack legacy handle mentions in a `chat.postMessage` payload into the
 * `<@xyneUserId>` form the downstream resolvers already understand.
 *
 * `blocks`/`attachments` are rewritten via stringify → replace → parse, the same
 * approach `resolveSlackMessageParts` uses: a mention token carries no JSON
 * metacharacters, and neither does a Xyne user id, so the round-trip is lossless.
 *
 * Returns the parts unchanged when there is nothing to rewrite (the common case),
 * and never throws — an unresolvable payload is returned as-is so the message still
 * sends.
 */
export async function resolveSlackHandleMentions<T extends HandleResolvableParts>(
	parts: T,
	workspaceId: string,
): Promise<T> {
	const serialisedBlocks = parts.blocks?.length ? JSON.stringify(parts.blocks) : "";
	const serialisedAttachments = parts.attachments?.length
		? JSON.stringify(parts.attachments)
		: "";
	const combined = [parts.text ?? "", serialisedBlocks, serialisedAttachments].join("\n");

	if (!combined.includes("<@")) return parts;

	try {
		const replacements = await buildReplacements(combined, workspaceId);
		if (replacements.size === 0) return parts;

		const rewritten: T = { ...parts };
		if (parts.text) {
			rewritten.text = applyReplacements(parts.text, replacements);
		}
		if (serialisedBlocks) {
			rewritten.blocks = JSON.parse(
				applyReplacements(serialisedBlocks, replacements),
			) as SlackBlock[];
		}
		if (serialisedAttachments) {
			rewritten.attachments = JSON.parse(
				applyReplacements(serialisedAttachments, replacements),
			) as SlackAttachment[];
		}
		return rewritten;
	} catch (error) {
		logger.error("[handleMentions] Rewrite failed, sending payload unchanged", {
			workspaceId,
			error,
		});
		return parts;
	}
}
