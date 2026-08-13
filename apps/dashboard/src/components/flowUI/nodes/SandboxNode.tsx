import React from 'react';
import { toast } from 'sonner';
import { FileCode, EyeScan, CopyDefault } from '@xyne/icons';
import type { FlowComponent, SandboxProps } from '@xyne/shared';
import { CardShell } from './cardPrimitives';
import { openLink } from '../../../utils/openLink';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';

/**
 * Sandbox artifact — one line of prose, then a read-only list of the resources
 * the agent's kata sandbox exposes. One row per resource: glyph, label, a copy-
 * link button, and an "Open" link.
 *
 * The flow carries NO title (buildSandboxFlow omits it) — FlowRenderer prints a
 * flow title as an <h2> above the components, and this card is meant to read as
 * message prose + attachment, not a headed panel. `desc` is that prose, and is
 * also what the DM/channel list preview shows (utils/flowPreview reads `desc`).
 *
 * Presentation is DERIVED here, never shipped on the wire: the emitter sends
 * URLs only, and this file owns the label + glyph for each. A row renders
 * exactly when its URL is present and is an http(s) target — `previewUrl` is
 * required by the schema (it is why the card exists), `codeUrl` is optional, so
 * a sandbox with no code server shows one row instead of a dead link.
 *
 * Rows carry `bg-background` (the design's white) over CardShell's muted fill,
 * and hairline separators come from `border-t` on every row but the first —
 * matching the design's stacked, overflow-clipped row borders.
 *
 * The "Open" links live INSIDE the `.jp-message-html` container, so they need
 * `!text-foreground !no-underline` to beat the global `.jp-message-html a` rule
 * (blue + underline) that otherwise wins by specificity — same treatment as
 * PrNode's FooterLink.
 *
 * ── Wire contract (backend emits this) ───────────────────────────────────────
 * The sandbox is one component inside a FlowJSON FlowDefinition. Source of truth
 * + zod validation: shared/src/validation/flowSchema.ts (`sandboxComponentSchema`).
 * The whole FlowDefinition is JSON-stringified, `"`→`&quot;` escaped, and stored
 * in messages.content as: <div data-flow-json="…">Flow JSON</div>. Built by
 * `buildSandboxFlow` (xyne-claw-shared) and posted by claw-auth's
 * /webhook/progress sandbox-preview branch.
 *
 *   { version: '2.0', screenId: 'agent-sandbox-<sandboxId>',   // no title
 *     state: { values:{}, touched:{}, errors:{}, submitting:false,
 *              submitted:false, history:[], loadingComponentIds:[] },  // always empty
 *     components: [{
 *       id: 'sandbox', type: 'sandbox',
 *       props: {
 *         previewUrl: string,   // required — noVNC session
 *         codeUrl?: string,     // optional — code browser
 *         desc?: string,        // optional — the line above the rows
 *       },
 *     }] }
 *
 * props is .strict() — unknown keys are rejected at chatController validation.
 */
interface SandboxNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

// Only http(s) targets are rendered — mirrors LinkNode's guard so a
// payload-supplied URL can't inject a javascript: target.
const isHttpUrl = (url?: string): url is string => !!url && /^https?:\/\//i.test(url);

export const SandboxNode: React.FC<SandboxNodeProps> = ({ node }) => {
  const props = node.props as SandboxProps | undefined;

  const previewUrl = isHttpUrl(props?.previewUrl) ? props.previewUrl : undefined;
  const codeUrl = isHttpUrl(props?.codeUrl) ? props.codeUrl : undefined;
  if (!previewUrl && !codeUrl) return null;

  const desc = props?.desc?.trim();

  return (
    <div className='flex flex-col gap-3'>
      {desc && (
        <p className='text-[15px] font-medium leading-[1.5] tracking-[-0.1px] text-foreground'>
          {desc}
        </p>
      )}
      <CardShell style={node.style}>
        {codeUrl && (
          <ResourceRow
            icon={<FileCode variant='Duo Solid' size={20} />}
            label='Code Changes'
            href={codeUrl}
            trackName='CLICK_OPEN_CODE'
            copyTrackName='CLICK_COPY_CODE_LINK'
          />
        )}
        {previewUrl && (
          <ResourceRow
            icon={<EyeScan variant='Contrast' size={20} />}
            label='Live preview'
            href={previewUrl}
            trackName='CLICK_OPEN_PREVIEW'
            copyTrackName='CLICK_COPY_PREVIEW_LINK'
          />
        )}
      </CardShell>
    </div>
  );
};

const ResourceRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  href: string;
  trackName: string;
  copyTrackName: string;
}> = ({ icon, label, href, trackName, copyTrackName }) => {
  // `force: 'external'` — a sandbox is a live noVNC/code session, so it always
  // belongs in the system browser: Electron's shell.openExternal, the RN
  // bridge, or a new web tab. Without the force, openLink honours the user's
  // "open links in app" preference and Electron would hand the URL to the
  // in-app browser panel (and ⌘-click would invert it) instead.
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    openLink(href, event, { force: 'external' });
  };

  // copyTextToClipboard rather than navigator.clipboard.writeText directly: it
  // is async, so a missing Clipboard API (insecure context) surfaces as a
  // rejection the error toast can catch instead of an uncaught TypeError.
  const handleCopy = (): void => {
    void copyTextToClipboard(href).then(
      () => toast.success(`${label} link copied`),
      () => toast.error(`Couldn't copy ${label} link`),
    );
  };

  return (
    <div className='flex items-center justify-between gap-3 border-t border-border bg-background p-4 first:border-t-0'>
      <div className='flex min-w-0 items-center gap-3'>
        {/* Both glyphs are two-tone in one accent hue, so they take a single
            colour token and render their tint from its own opacity. */}
        <span className='flex shrink-0 items-center text-[var(--sandbox-icon)]'>{icon}</span>
        <p className='truncate text-[15px] font-medium leading-[1.2] text-foreground'>{label}</p>
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        <button
          type='button'
          onClick={handleCopy}
          aria-label={`Copy ${label} link`}
          title={`Copy ${label} link`}
          className='shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          data-track-category='SANDBOX_ARTIFACT'
          data-track-name={copyTrackName}
        >
          <CopyDefault size={16} />
        </button>
        {/* Kept a real anchor so middle-click and "copy link address" still work;
            the primary click is intercepted above. */}
        <a
          href={href}
          target='_blank'
          rel='noopener noreferrer'
          onClick={handleClick}
          className='shrink-0 rounded-[10px] border border-border px-2 py-1 text-sm font-medium leading-[1.2] !text-foreground !no-underline transition-colors hover:bg-accent hover:!text-foreground'
          data-track-category='SANDBOX_ARTIFACT'
          data-track-name={trackName}
        >
          Open
        </a>
      </div>
    </div>
  );
};
