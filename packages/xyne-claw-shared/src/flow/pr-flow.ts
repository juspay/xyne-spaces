/**
 * PR card — renders a pull request the agent opened (or advanced) as a FlowUI
 * v2.0 `pr` component (dashboard: components/flowUI/nodes/PrNode.tsx). Unlike the
 * plan, the field set is status-INVARIANT (a flat object, not a discriminated
 * union): every status carries the same fields; only the badge/label/glyph
 * presentation varies, and that is derived in the renderer.
 *
 * It is PROVIDER-AGNOSTIC: `provider` selects the glyph + the "Open in
 * <Provider>" label; any host the runtime can't classify is 'other' (generic
 * git glyph + neutral label). This is what lets one card serve GitHub, Bitbucket,
 * GitLab and anything else.
 *
 * LIFECYCLE (one evolving card per PR): post ONCE via Spaces postMessage({ flow }),
 * then re-render IN PLACE via updateMessage({ flowJSON }) as the status advances
 * (created → merged / reverted / deleted / declined). Both the post and every update MUST
 * use the SAME screenId — derive it deterministically from PR identity with
 * `prScreenId(...)` so the emitter never has to remember it. Source-of-truth
 * schema + zod validation lives in @xyne/shared:
 * shared/src/validation/flowSchema.ts (`prComponentSchema`).
 *
 * Paired with the runtime interception of the `*__create_pull_request` /
 * `*__merge_pull_request` subagent tools and the claw-auth /webhook/progress
 * `kind:"pr"` handler (renderPrCard) that does the post-then-update.
 */

import { FlowBuilder, type FlowComponent, type FlowDefinition } from './builder.js';

/** Which git host the PR lives on — drives presentation only (mirrors PrProvider in @xyne/shared). */
export type PrProvider = 'github' | 'bitbucket' | 'gitlab' | 'other';

/** PR lifecycle status the `pr` component renders (mirrors PrStatus in @xyne/shared).
 *  `declined` is emitted only by the inbound webhook path (a PR closed without
 *  merging); the agent tool path emits created/merged. */
export type PrStatus = 'created' | 'merged' | 'reverted' | 'deleted' | 'declined';

/** Stable component id — the `pr` component inside the flow. Kept stable across
 *  updates so the card reconciles in place. */
export const PR_COMPONENT_ID = 'pr';

/** Canonical, provider-neutral PR fact the runtime normalizes provider-specific
 *  tool responses into. Everything past `title` is optional. */
export interface PrCardInput {
  provider: PrProvider;
  status: PrStatus;
  title: string;
  /** The pull request URL (provider-neutral). */
  url?: string;
  /** Linked ticket/issue id, e.g. "XYNE-1234". */
  ticketId?: string;
  /** PR description / summary. */
  desc?: string;
  /** Ticket/issue link (distinct from the PR `url`). */
  detailsUrl?: string;
  /** Branch the PR merges INTO (github `base.ref`, bitbucket `destination.branch.name`). */
  targetBranch?: string | undefined;
  /** Branch the PR merges FROM (github `head.ref`, bitbucket `source.branch.name`). */
  sourceBranch?: string | undefined;
}

/** The bits of PR identity used to key the (stable) screenId + the emitter's
 *  message-id map. Whatever is available is used, most-specific first. */
export interface PrIdentity {
  provider?: PrProvider;
  /** "owner/repo" (github) or "PROJECT/repo" (bitbucket), if known. */
  repo?: string;
  /** PR number/id, if known. */
  number?: number | string;
  /** PR url — the fallback identity when number is absent. */
  url?: string;
}

/** Lowercase, collapse every run of non-alphanumerics to a single dash, trim
 *  dashes. Keeps screenIds stable and DOM/attribute-safe. */
function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministic screenId for a PR card, keyed on identity so the post and every
 * subsequent status update collapse into ONE card. Preference order:
 *   provider+repo+number  →  provider+number  →  slug(url)  →  bare 'agent-pr'.
 * Same identity in → same screenId out (pure), which is exactly what the
 * post-then-updateMessage lifecycle relies on.
 */
export function prScreenId(identity: PrIdentity): string {
  const { provider, repo, number, url } = identity;
  const parts: string[] = [];
  if (provider) parts.push(provider);
  if (repo) parts.push(slug(repo));
  if (number !== undefined && number !== null && `${number}`.length > 0) parts.push(`${number}`);
  if (parts.length >= 2) return `agent-pr-${parts.join('-')}`;
  if (url) {
    const fromUrl = slug(url.replace(/^https?:\/\//, ''));
    if (fromUrl) return `agent-pr-${fromUrl}`;
  }
  // Last resort: number/provider alone, else the bare id. Not ideal for
  // in-place updates, but never invalid.
  return parts.length ? `agent-pr-${parts.join('-')}` : 'agent-pr';
}

/**
 * Build the PR card as a single `pr` component. Deterministic (pure) so it can be
 * re-rendered on every status change and diffed cheaply by the client.
 *
 * `opts.screenId` should normally be `prScreenId(identity)`; if omitted it is
 * derived from `{ provider, ...opts.identity }`. `opts.data` carries flow-level
 * routing that webhook.ts wraps with withSpacesAppId (the PR card is read-only,
 * so this is informational — there is no flow-action round-trip).
 */
export function buildPrFlow(
  pr: PrCardInput,
  opts?: {
    screenId?: string;
    /** Identity used to derive the screenId when `screenId` is not passed. */
    identity?: Omit<PrIdentity, 'provider'>;
    title?: string;
    data?: Record<string, unknown>;
  },
): FlowDefinition {
  // Derive a stable screenId from PR identity unless the caller passed one.
  // Build the identity without ever assigning `undefined` (exactOptionalPropertyTypes).
  const identity: PrIdentity = { provider: pr.provider, ...(opts?.identity ?? {}) };
  if (identity.url === undefined && pr.url !== undefined) identity.url = pr.url;
  const screenId = opts?.screenId ?? prScreenId(identity);
  const cardTitle = opts?.title ?? 'Pull Request';

  const props: Record<string, unknown> = {
    status: pr.status,
    provider: pr.provider,
    title: pr.title,
    ...(pr.ticketId ? { ticketId: pr.ticketId } : {}),
    ...(pr.desc ? { desc: pr.desc } : {}),
    ...(pr.detailsUrl ? { detailsUrl: pr.detailsUrl } : {}),
    ...(pr.url ? { url: pr.url } : {}),
  };

  const prComponent: FlowComponent = { id: PR_COMPONENT_ID, type: 'pr', props };

  // Human-readable notification/preview fallback. Flow-card messages store an
  // inner text fallback (Spaces shows it in notifications + wherever the widget
  // isn't rendered); default is a generic "Flow JSON", so we ship a meaningful
  // one — e.g. "PR merged · fix: XYNE-5272 …". Read by chatController.
  const STATUS_LABEL: Record<PrStatus, string> = {
    created: 'created',
    merged: 'merged',
    reverted: 'reverted',
    deleted: 'deleted',
    declined: 'declined',
  };
  const fallbackText = `PR ${STATUS_LABEL[pr.status]} · ${pr.title}`;

  return new FlowBuilder(screenId)
    .setTitle(cardTitle)
    .addComponent(prComponent)
    .setData({ kind: 'pr', fallbackText, ...(opts?.data ?? {}) })
    .build();
}
