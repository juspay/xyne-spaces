/**
 * Sandbox card — renders the resources a kata sandbox exposes as a FlowUI v2.0
 * `sandbox` component (dashboard: components/flowUI/nodes/SandboxNode.tsx).
 *
 * One row per resource — "Code Changes" and "Live preview", each with an Open
 * link. Row labels and glyphs are DERIVED in the renderer; this builder ships
 * only the URLs, so the wire never carries presentation.
 *
 * The screenId is keyed on the sandbox id, so the card can later be re-rendered
 * in place via updateMessage (e.g. to drop the links once the sandbox is torn
 * down) without the emitter having to remember a message id.
 *
 * Emitted by the claw-auth /webhook/progress sandbox-preview branch, which fires
 * once per run the first time a sandbox tool succeeds. Source-of-truth schema +
 * zod validation lives in @xyne/shared: shared/src/validation/flowSchema.ts
 * (`sandboxComponentSchema`).
 */

import { FlowBuilder, type FlowComponent, type FlowDefinition } from './builder.js';

/** Stable component id — kept stable across updates so the card reconciles in place. */
export const SANDBOX_COMPONENT_ID = 'sandbox';

/** The resources a sandbox exposes. `previewUrl` is the noVNC session (always
 *  present — it is why the card is posted); `codeUrl` is the code browser, which
 *  a sandbox may not run. */
export interface SandboxCardInput {
  previewUrl: string;
  codeUrl?: string;
  /** Overrides the default line of prose above the rows. */
  desc?: string;
}

/** The line above the rows. Says what is happening and that the session is
 *  shared — the two things a reader needs before deciding to click Open. Kept
 *  free of jargon (no noVNC/chromium) since the row labels already name what
 *  each link is. */
const DEFAULT_DESC = 'Working in a sandbox — anyone here can watch, or drive the browser.';

/** Deterministic screenId keyed on the sandbox id, so the post and any later
 *  update collapse into ONE card. Falls back to the bare id when no sandbox id
 *  is known (never invalid, just not update-able). */
export function sandboxScreenId(sandboxId?: string): string {
  const slug = (sandboxId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `agent-sandbox-${slug}` : 'agent-sandbox';
}

/**
 * Build the sandbox card as a single `sandbox` component. Deterministic (pure).
 *
 * `opts.screenId` should normally be `sandboxScreenId(sandboxId)`. `opts.data`
 * carries flow-level routing that webhook.ts wraps with withSpacesAppId — the
 * card is read-only, so this is informational.
 */
export function buildSandboxFlow(
  sandbox: SandboxCardInput,
  opts?: {
    screenId?: string;
    /** Sandbox id used to derive the screenId when `screenId` is not passed. */
    sandboxId?: string;
    data?: Record<string, unknown>;
  },
): FlowDefinition {
  const screenId = opts?.screenId ?? sandboxScreenId(opts?.sandboxId);

  const props: Record<string, unknown> = {
    previewUrl: sandbox.previewUrl,
    ...(sandbox.codeUrl ? { codeUrl: sandbox.codeUrl } : {}),
    desc: sandbox.desc ?? DEFAULT_DESC,
  };

  const component: FlowComponent = { id: SANDBOX_COMPONENT_ID, type: 'sandbox', props };

  // Human-readable notification fallback — Spaces shows this wherever the
  // widget isn't rendered (notifications, unsupported clients). Default is a
  // generic "Flow JSON", so ship a meaningful one. Read by chatController.
  const fallbackText = props['desc'] as string;

  // No .setTitle: FlowRenderer prints any flow title as an <h2> above the
  // components, and the card is meant to read as message prose + attachment —
  // a "Sandbox" heading on top of it is chrome the design does not have.
  return new FlowBuilder(screenId)
    .addComponent(component)
    .setData({ kind: 'sandbox', fallbackText, ...(opts?.data ?? {}) })
    .build();
}
