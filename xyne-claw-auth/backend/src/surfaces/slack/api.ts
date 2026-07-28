/**
 * The one door to Slack's Web API. Every Slack call in this surface uses a
 * WebClient built here, so transport policy — timeout, retries, rate-limit
 * backoff — is configured in exactly one place.
 *
 * Slack's SDK owns the transport now; `fetch` must not appear anywhere else in
 * surfaces/slack/ except the response_url hook, which is not a Web API method.
 */
import { WebClient, type WebClientOptions } from "@slack/web-api";
import { createLogger } from "../../logger.js";
import { RESPONSE_URL_RETRY_DELAY_MS, SLACK_API_MAX_RETRIES, SLACK_API_TIMEOUT_MS } from "./const.js";

const log = createLogger("slack-api");

const clientOptions: WebClientOptions = {
  timeout: SLACK_API_TIMEOUT_MS,
  retryConfig: { retries: SLACK_API_MAX_RETRIES },
};

/** Slack does not export its Manifest type from the package root; derive it from
 *  the method signature so it tracks the SDK instead of drifting. */
export type SlackManifest = Parameters<WebClient["apps"]["manifest"]["update"]>[0]["manifest"];

export function slackClient(token: string): WebClient {
  return new WebClient(token, clientOptions);
}

export function slackClientWithoutToken(): WebClient {
  return new WebClient(undefined, clientOptions);
}

export function slackErrorCode(error: unknown): string | undefined {
  const data = (error as { data?: { error?: unknown } } | undefined)?.data;
  return typeof data?.error === "string" ? data.error : undefined;
}

export function isSlackApiError(error: unknown): boolean {
  return slackErrorCode(error) !== undefined;
}

/**
 * Post to a Slack `response_url` — the one-time, ~30-minute callback Slack hands
 * out with a slash command. It is NOT a Web API method (opaque pre-signed URL,
 * no bearer token), so WebClient cannot send it; this is the surface's only
 * remaining direct `fetch`, kept here so the "one door" property still holds.
 *
 * Used after the 3-second ack has already been sent, which makes it the last
 * channel available for telling a user their command failed. It therefore
 * retries and never throws: callers are already on an error path.
 */
export async function postResponseUrl(
  responseUrl: string,
  message: { text: string; responseType?: "ephemeral" | "in_channel" },
): Promise<boolean> {
  const body = JSON.stringify({
    response_type: message.responseType ?? "ephemeral",
    text: message.text,
  });

  for (let attempt = 1; attempt <= SLACK_API_MAX_RETRIES; attempt += 1) {
    try {
      // eslint-disable-next-line no-restricted-globals -- documented response_url exemption
      const response = await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(SLACK_API_TIMEOUT_MS),
      });
      if (response.ok) return true;
      // 4xx means the URL is spent or malformed — retrying cannot help.
      if (response.status < 500 && response.status !== 429) {
        log.warn(`[slack-api] response_url rejected: http_${response.status}`);
        return false;
      }
      log.warn(`[slack-api] response_url attempt ${attempt} failed: http_${response.status}`);
    } catch {
      // Swallow the error object: a fetch error can carry the request, and the
      // response_url is itself a bearer-equivalent secret.
      log.warn(`[slack-api] response_url attempt ${attempt} failed: network`);
    }
    if (attempt < SLACK_API_MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RESPONSE_URL_RETRY_DELAY_MS * attempt));
    }
  }
  return false;
}
