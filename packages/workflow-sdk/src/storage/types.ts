/**
 * StorageAdapter — host plug-in for blob storage.
 *
 * Every verb takes or returns a stream, never a buffer: a file's size must not
 * decide how much memory the process uses. A step that genuinely needs bytes
 * goes through `ctx.files.buffer()`, which is bounded.
 *
 * The framework never opens an attachment's `handle` — only the host's adapter
 * knows what it addresses.
 */

import type { Readable } from 'node:stream';
import type { Attachment } from '../common/attachment.js';
import type { ResourceAttributes, ResolvedAuthContext } from '../authz/attributes.js';

/**
 * Which tenant a write belongs to — the adapter routes it to the right bucket /
 * prefix / tenant from this, so it is a security boundary, not a hint.
 *
 * It is the *workflow's* typed attributes, one shape produced from both places
 * a file can be born:
 *  - at execution, from the workflow record (no caller exists — a cron tick has
 *    no user, so the resource carries its own scope);
 *  - at upload, stamped from the caller's ctx by the router.
 *
 * Typed via {@link Register}; `unknown` until a product opts in — at which
 * point an adapter reaching for a field that isn't in the product's shape stops
 * compiling, which is the entire point of it not being a bag any more.
 */
/**
 * Who a blob operation is for.
 *
 * Two producers, because the two situations differ: at execution time there is no
 * caller, so the workflow's attributes answer it; at upload/download time there is
 * no workflow yet, so the caller does. Both are host-declared, and the SDK never
 * looks inside either — it only routes the value to the adapter.
 */
export type StorageScope = ResourceAttributes<'workflow'> | ResolvedAuthContext;

/** A file on its way in. */
export interface StorageFile {
  name: string;
  mimeType: string;
  /** Unread — the adapter pipes it straight to its store. */
  stream: Readable;
}

/** What an object turns out to be, without fetching it. */
export interface StorageInfo {
  size: number;
  mimeType: string;
}

export interface StorageAdapter {
  /**
   * Consume `file.stream` and return the reference the workflow will carry.
   * `scope` is what the adapter routes on — a security boundary, not a hint.
   */
  put(scope: StorageScope, file: StorageFile): Promise<Attachment>;

  /**
   * The bytes again, to pipe. `ref` is frequently client-supplied, so `scope`
   * is required: an adapter must refuse a reference owned by another tenant.
   */
  stream(ref: Attachment, scope: StorageScope): Promise<Readable>;

  /**
   * Size and type without transferring anything, or null if it is gone. Lets a
   * size limit refuse before a byte moves rather than after.
   */
  info(ref: Attachment, scope: StorageScope): Promise<StorageInfo | null>;

  /**
   * Remove the object. Called when bytes already accepted turn out to be
   * unusable — a duplicate, a stale attempt, a body the contract rejects.
   *
   * `scope` is optional because some callers reclaim a write with no caller to
   * name; an adapter must accept that and fall back to the handle. Best-effort:
   * a failure here must not turn a clean rejection into a server error.
   */
  delete(ref: Attachment, scope?: StorageScope): Promise<void>;

  /**
   * Optional: short-lived presigned URL. When present the download route
   * redirects and no bytes pass through the host; when absent it pipes
   * {@link stream} instead.
   */
  signUrl?(ref: Attachment, ttlSeconds: number): Promise<string>;
}
