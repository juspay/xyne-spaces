import type { z } from 'zod';
import { BaseTrigger } from './base-trigger.js';
import type { TriggerExecutionContext } from './base-trigger.js';
import type { InboundHttpRequest, InboundReply, RawInboundRequest, Translation } from '../ingest/types.js';

/**
 * Webhook trigger — fires when an external service POSTs to
 * `<baseUrl>/webhooks/<workflowId>`.
 *
 * The author registers that URL with the provider by hand. On each request the
 * engine:
 *
 * 1. finds the workflow and checks it is active,
 * 2. resolves the trigger's credentials, rejecting the request if one is
 *    missing, revoked, or of a type the trigger does not accept,
 * 3. calls {@link handshake}, and sends its reply if it returns one,
 * 4. calls {@link verify} with the exact bytes and those credentials,
 * 5. parses the body,
 *
 * and only then calls {@link handleRequest}. Each event it returns must pass
 * the workflow's trigger filter to become a run.
 *
 * How a request is verified belongs to the connector: its provider's signing
 * scheme, its own utilities. The engine's part is that verification always
 * runs first and receives the right credentials. The URL carries no secret, so
 * an implementation that accepts everything leaves the workflow open to anyone
 * who learns its id.
 */
export abstract class WebhookTrigger<
  TConfig extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
  TRaw extends Record<string, unknown> = Record<string, unknown>,
> extends BaseTrigger<TConfig, TOutput, TRaw> {
  /**
   * Answer a provider's URL handshake: the request some providers send when the
   * URL is registered, before any real delivery, expecting a reply in their own
   * format. Return that reply, or `undefined` for every other request.
   *
   * Runs before {@link verify}, so the request is unauthenticated: some handshakes
   * are unsigned (Microsoft Graph's `validationToken`), and some arrive as GET
   * (Meta's `hub.challenge`). That is why a handshake can only reply, never start
   * a run. Match the provider's handshake exactly, echo only what it expects echoed,
   * and check a token it sends against the credentials where it sends one.
   *
   * A GET reaches no other method: when this returns `undefined` for one, the
   * sender gets 404. A signed handshake, such as Slack's `url_verification`, is
   * better answered from {@link handleRequest}, after verification.
   *
   * A thrown error is logged and the request carries on to {@link verify}.
   */
  handshake(
    _request: InboundHttpRequest,
    _config: z.infer<TConfig>,
    _ctx: TriggerExecutionContext,
  ): Promise<InboundReply | undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * Is this request really from the provider? Return false, or throw, to reject
   * it with 401. Runs before the body is parsed.
   *
   * Read a secret with `credentialValues(ctx.credentials, slot, 'secret')`.
   */
  abstract verify(
    request: InboundHttpRequest,
    config: z.infer<TConfig>,
    ctx: TriggerExecutionContext,
  ): Promise<boolean>;

  /**
   * Turn a verified request into events, and say what to reply.
   *
   * Should be pure: no network calls. Enrichment that needs the provider's API
   * belongs in `hydrate`, which runs before the run starts.
   */
  abstract handleRequest(
    request: RawInboundRequest,
    config: z.infer<TConfig>,
    ctx: TriggerExecutionContext,
  ): Promise<Translation<TRaw>>;
}
