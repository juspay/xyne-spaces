/**
 * Typed resource attributes via declaration merging (the "Register" pattern).
 *
 * A product attaches its own scoping data — a folder's department, a workflow's
 * team — to resources at creation. The framework carries and stores it
 * **opaquely** (it never reads it); the product reads it, **typed**, in its
 * authorizer and UI.
 *
 * To type it, augment `Register` once, anywhere in the app:
 *
 * ```ts
 * declare module '@xyne/workflow-sdk' {
 *   interface Register {
 *     attributes: {
 *       folder:   { department: string };
 *       workflow: { team: string };
 *     };
 *   }
 * }
 * ```
 *
 * Every touchpoint — create inputs, the stored record, the authorizer's
 * `ref.record.attributes`, the client, and the UI attribute-field slots — then
 * resolves to your shape from that single declaration, with **no generics**
 * threaded through the framework's signatures. Un-augmented, attributes are
 * `unknown`, so nothing changes until a product opts in.
 *
 * This mirrors how TanStack Router (`Register`) and Express (`Request`
 * augmentation) let consumers extend framework types without generics.
 */
import type { AuthContext } from '../router/types.js';

export interface Register {}

type ResolvedAttributes = Register extends { attributes: infer A }
  ? A
  : Record<string, unknown>;

/**
 * The product's auth-context shape — the same opt-in as {@link ResolvedAttributes}.
 *
 * Declared once:
 * ```ts
 * declare module '@xyne/workflow-sdk' {
 *   interface Register { authContext: { userId: string; workspaceId: string } }
 * }
 * ```
 *
 * Its first use is {@link StorageScope}: a caller-initiated blob write has a person
 * and no workflow, so the caller has to be able to say which tenant it is for.
 *
 * NOTE: this does not yet constrain the `TCtx` generic threaded through
 * `WorkflowRuntime` / `WorkflowAuthorizer` / `RouterOptions`. Until it does, a host
 * declaring one and passing the other can drift — see the cast in the router's
 * storage call sites. Constraining `TCtx extends ResolvedAuthContext` is the
 * follow-up, and would let hosts drop those generics entirely.
 */
export type ResolvedAuthContext = Register extends { authContext: infer C }
  ? C
  : AuthContext;

/** The product's attribute shape for a resource kind — `unknown` if unaugmented. */
export type ResourceAttributes<K extends string> = K extends keyof ResolvedAttributes
  ? ResolvedAttributes[K]
  : unknown;

/** Resource kinds that carry product attributes at creation. */
export type AttributedResource = 'folder' | 'workflow' | 'credential';
