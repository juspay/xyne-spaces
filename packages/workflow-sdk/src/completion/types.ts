/**
 * Continuing a run from outside — the inbound half of what `ingest/` does for
 * starting one.
 *
 * The SDK names no URL and authenticates nobody: a host authenticates the
 * caller with its own middleware, then calls `runtime.deliver`. What arrives is
 * a {@link Delivery}; what the engine did with it is a {@link DeliveryOutcome},
 * which the host maps to a status code. The outcomes are data rather than
 * thrown messages because a machine caller has to decide from the answer
 * whether to retry, stop, or fix its body.
 */

import type { PayloadError } from '../common/validate-payload.js';
import type { Attachment } from '../common/attachment.js';

/** Which parked node a delivery is for. */
export interface Address {
  readonly executionId: string;
  /**
   * The author's own step id, as written in the config — unique across a
   * workflow, and stable across runs, which is why it can go in a URL at
   * authoring time when no execution exists yet.
   */
  readonly stepId: string;
  /**
   * The exact node, for a step id with more than one parked instance. The
   * engine resolves it from `stepId` whenever that is unambiguous, so a caller
   * only needs it for a fan-out.
   */
  readonly nodePath?: string;
  /**
   * Which attempt of the gate this answers. A gate that re-parks — an agent
   * re-dispatch, another round of a cycle — carries one, and a stale answer to
   * the attempt before is superseded rather than applied.
   */
  readonly fence?: number;
}

/**
 * One file of a multipart delivery — already in storage.
 *
 * A reference rather than bytes, because the host streamed the part into its
 * store while parsing: nothing between the socket and the store ever held the
 * whole file, so a delivery's memory cost is the same whether it carries a
 * kilobyte or a gigabyte.
 *
 * The consequence is that bytes exist before the engine has judged them. Every
 * outcome other than `applied` therefore deletes what it was sent.
 */
export interface DeliveryFile {
  /** The multipart field name — which key of the payload this file belongs to. */
  readonly fieldName: string;
  readonly attachment: Attachment;
}

/** What the outside world reported. */
export interface Delivery {
  /**
   * The body, or a multipart request's text fields. File parts come separately
   * in {@link files}, because they are not payload until they are stored.
   */
  readonly payload: unknown;
  /**
   * Uploaded files, merged into the payload under their field names once
   * stored. Needs a StorageAdapter on the runtime.
   */
  readonly files?: readonly DeliveryFile[];
  /**
   * How {@link payload} was encoded. `multipart` means every field arrived as
   * text whatever it represents, so the engine re-reads each against the gate's
   * contract; `json` (the default) means it is already typed and is left alone.
   *
   * The distinction matters because one URL takes both: without it the same
   * contract would hand a step `"7003"` from one sender and `7003` from the
   * other, and nothing downstream would catch it.
   */
  readonly encoding?: 'json' | 'multipart';
  /**
   * The sender's id for this delivery. A repeat of one already applied is a
   * duplicate rather than an error, which is what makes `curl --retry` safe.
   */
  readonly deliveryId?: string;
}

/**
 * What the engine did. `ignored` means the delivery was understood and
 * deliberately dropped — the sender should stop, not retry.
 */
export type DeliveryOutcome =
  | { readonly kind: 'applied'; readonly nodePath: string }
  | {
      readonly kind: 'ignored';
      readonly reason: 'duplicate' | 'already_answered' | 'superseded' | 'run_ended';
    }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not_ready' }
  | { readonly kind: 'ambiguous'; readonly nodePaths: readonly string[] }
  | { readonly kind: 'invalid'; readonly issues: readonly PayloadError[] };

/**
 * The status a host should answer with. A recommendation, not a rule — the host
 * owns its API.
 *
 * `ignored` answers 2xx on purpose: a non-2xx makes a sender's recovery worker
 * redeliver a payload we dropped deliberately.
 */
export function httpStatusFor(outcome: DeliveryOutcome): number {
  switch (outcome.kind) {
    case 'applied':
      return 202;
    case 'ignored':
      return 200;
    case 'not_ready':
      return 409;
    case 'ambiguous':
      return 400;
    case 'invalid':
      return 422;
    case 'unknown':
      return 404;
  }
}
