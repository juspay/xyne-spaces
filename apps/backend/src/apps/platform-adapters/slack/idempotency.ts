/**
 * Idempotency for the Slack-compatible chat.postMessage route.
 *
 * Slack's HTTP API dedupes retried deliveries when the client supplies a
 * `client_msg_id`; this adapter's route accepted every request unconditionally,
 * so an upstream client retrying (timeout, reconnect, alert-runner restart)
 * produced N identical messages in the thread.
 *
 * Two layers, both fail-open when Redis is unavailable:
 *
 *  1. Explicit idempotency key — `client_msg_id` in the body or an
 *     `Idempotency-Key` / `X-Idempotency-Key` header. The first request claims
 *     the key atomically (SET NX EX); identical requests within the TTL
 *     (default 24h) receive the original response verbatim.
 *
 *  2. Content dedupe (defense in depth for clients that send no key) — a short
 *     window (default 30s, tunable via SLACK_CONTENT_DEDUPE_WINDOW_SECONDS, 0
 *     disables) keyed on the caller + channel + thread + normalized content.
 *
 * Behaviour:
 *   - first request        -> handler runs, response cached (only when ok:true)
 *   - retry after success  -> HTTP 200, original body, X-Slack-Idempotent-Replay: true
 *   - concurrent duplicate -> polls for the in-flight result (up to 3s) and
 *                             replays it; on timeout responds HTTP 429 ratelimited
 *   - first attempt failed -> claim released, the retry goes through normally
 *
 * Keys are namespaced by the calling app (SHA-256 of its bearer token), so two
 * apps posting the same text never collide.
 */

import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { redisService } from "@/services/redisService";
import { logger } from "@/utils/logger";

const IDEMPOTENCY_TTL_SECONDS = Number(process.env.SLACK_IDEMPOTENCY_TTL_SECONDS ?? 86_400);
const CONTENT_DEDUPE_WINDOW_SECONDS = Number(process.env.SLACK_CONTENT_DEDUPE_WINDOW_SECONDS ?? 30);
const CLAIM_PLACEHOLDER = "__IN_FLIGHT__";
const IN_FLIGHT_POLL_INTERVAL_MS = 50;
const IN_FLIGHT_POLL_TIMEOUT_MS = 3000;
const MAX_KEY_LENGTH = 255;

interface PostMessageBody {
	channel?: unknown;
	text?: unknown;
	blocks?: unknown;
	attachments?: unknown;
	thread_ts?: unknown;
	client_msg_id?: unknown;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Keys are scoped per caller: the bearer token IS the app JWT. */
const tokenScope = (req: Request): string => sha256(req.headers.authorization ?? "").slice(0, 16);

function readIdempotencyKey(req: Request): string | null {
	const headerKey = req.header("Idempotency-Key") ?? req.header("X-Idempotency-Key");
	const bodyKey = (req.body as PostMessageBody | undefined)?.client_msg_id;
	const raw = (typeof headerKey === "string" && headerKey) || (typeof bodyKey === "string" && bodyKey) || "";
	const key = raw.trim();
	return key ? key.slice(0, MAX_KEY_LENGTH) : null;
}

const normalizeText = (value: unknown): string =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

function contentFingerprint(req: Request): string | null {
	const body = req.body as PostMessageBody | undefined;
	if (!body) return null;
	const parts = [
		tokenScope(req),
		typeof body.channel === "string" ? body.channel : "",
		typeof body.thread_ts === "string" ? body.thread_ts : "",
		normalizeText(body.text),
		body.blocks === undefined ? "" : JSON.stringify(body.blocks),
		body.attachments === undefined ? "" : JSON.stringify(body.attachments),
	];
	// No content to dedupe on — skip the keyless layer entirely.
	if (!parts[3] && !parts[4] && !parts[5]) return null;
	return sha256(parts.join("|"));
}

async function safeRedis<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		logger.warn("[SLACK-IDEMPOTENCY] Redis unavailable, failing open:", error);
		return fallback;
	}
}

type PollOutcome = { status: "replay"; payload: string } | { status: "released" } | { status: "timeout" };

/** While another request holds the claim, poll for its cached response. */
async function pollForResponse(key: string): Promise<PollOutcome> {
	const deadline = Date.now() + IN_FLIGHT_POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_POLL_INTERVAL_MS));
		const cached = await safeRedis(() => redisService.get(key), null);
		if (cached && cached !== CLAIM_PLACEHOLDER) return { status: "replay", payload: cached };
		if (cached === null) return { status: "released" }; // holder failed and released its claim
	}
	return { status: "timeout" };
}

const replayResponse = (res: Response, payload: string): void => {
	res.status(200).set("X-Slack-Idempotent-Replay", "true").type("application/json").send(payload);
};

const ratelimitResponse = (res: Response): void => {
	res.status(429)
		.set("Retry-After", String(Math.ceil(IN_FLIGHT_POLL_TIMEOUT_MS / 1000)))
		.json({ ok: false, error: "ratelimited" });
};

function safeJsonParse(value: string): { ok?: boolean } | null {
	try {
		return JSON.parse(value) as { ok?: boolean } | null;
	} catch {
		return null;
	}
}

/**
 * Wraps a chat.postMessage route handler with the two dedupe layers above.
 * With no idempotency key and the content window disabled, this is a pure
 * passthrough.
 */
export function withChatPostMessageIdempotency(handler: RequestHandler): RequestHandler {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		const scope = tokenScope(req);
		const idempotencyKey = readIdempotencyKey(req);
		const fingerprint = contentFingerprint(req);

		const idemKey = idempotencyKey ? `slack:idem:${scope}:${idempotencyKey}` : null;
		const dedupeKey =
			fingerprint && CONTENT_DEDUPE_WINDOW_SECONDS > 0 ? `slack:dedupe:${scope}:${fingerprint}` : null;

		const keys: Array<{ key: string; ttlSeconds: number }> = [];
		if (idemKey) keys.push({ key: idemKey, ttlSeconds: IDEMPOTENCY_TTL_SECONDS });
		if (dedupeKey) keys.push({ key: dedupeKey, ttlSeconds: CONTENT_DEDUPE_WINDOW_SECONDS });

		// 1. Serve a cached response for an already-handled request.
		for (const { key } of keys) {
			const cached = await safeRedis(() => redisService.get(key), null);
			if (cached && cached !== CLAIM_PLACEHOLDER) {
				logger.info(`[SLACK-IDEMPOTENT-REPLAY] key=${key}`);
				replayResponse(res, cached);
				return;
			}
		}

		// 2. Claim every key atomically (SET NX EX). Exactly one request wins.
		const claims = new Map<string, number>();
		for (const { key, ttlSeconds } of keys) {
			const won = await safeRedis(() => redisService.set(key, CLAIM_PLACEHOLDER, ttlSeconds, true), true);
			if (won) {
				claims.set(key, ttlSeconds);
				continue;
			}
			// Another request for the same logical message is in flight — wait for its result.
			const outcome = await pollForResponse(key);
			if (outcome.status === "replay") {
				logger.info(`[SLACK-IDEMPOTENT-REPLAY] key=${key} (concurrent)`);
				replayResponse(res, outcome.payload);
				return;
			}
			if (outcome.status === "timeout") {
				// The other request is taking too long. Ask the client to retry instead of
				// inserting a second copy; the original message exists either way.
				ratelimitResponse(res);
				return;
			}
			// "released": the earlier attempt failed — retry the claim once, then proceed
			// (fail-open) even if we lose it again.
			const wonRetry = await safeRedis(() => redisService.set(key, CLAIM_PLACEHOLDER, ttlSeconds, true), true);
			if (wonRetry) claims.set(key, ttlSeconds);
		}

		// 3. Run the real handler, capturing the JSON response it sends.
		let payload: string | null = null;
		const originalJson = res.json.bind(res);
		res.json = ((body: unknown) => {
			payload = typeof body === "string" ? body : JSON.stringify(body);
			return originalJson(body);
		}) as typeof res.json;

		try {
			await handler(req, res, next);
		} catch (error) {
			await Promise.all([...claims.keys()].map((key) => safeRedis(() => redisService.del(key), undefined)));
			throw error;
		}

		// 4. A successful response is cached verbatim; anything else releases the
		//    claims so the client's retry is not swallowed.
		const sentPayload = payload as string | null;
		const parsed = sentPayload ? safeJsonParse(sentPayload) : null;
		if (parsed?.ok === true && sentPayload) {
			await Promise.all(
				[...claims].map(([key, ttlSeconds]) =>
					safeRedis(() => redisService.set(key, sentPayload, ttlSeconds, false), null),
				),
			);
		} else {
			await Promise.all([...claims.keys()].map((key) => safeRedis(() => redisService.del(key), undefined)));
		}
	};
}
