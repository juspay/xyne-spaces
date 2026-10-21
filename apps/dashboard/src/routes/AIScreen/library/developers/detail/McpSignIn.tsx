import { type ReactElement, useCallback, useEffect, useState } from 'react';
import type { SpacesMcpStatus } from '@/types/electron';
import { cn } from '@/utils/classNames';
import { spacesBaseUrl } from '../developerTools';
import { Callout, CodeBlock, InlineCode, Text } from './docPrimitives';

const MCP_PACKAGE = '@xyne/spaces-mcp';

/**
 * The desktop app's bridge to `~/.xyne/agent/spaces.json`, when it has one.
 * Checked by function rather than by "is this the desktop app": a desktop
 * build from before the bridge loads this same page.
 */
function desktopBridge(): {
  getStatus: () => Promise<SpacesMcpStatus>;
  signIn: NonNullable<NonNullable<Window['electronAPI']>['signInSpacesMcp']>;
} | null {
  const api = window.electronAPI;
  if (typeof api?.getSpacesMcpStatus !== 'function' || typeof api.signInSpacesMcp !== 'function') {
    return null;
  }
  return { getStatus: api.getSpacesMcpStatus, signIn: api.signInSpacesMcp };
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The sign-in, from a terminal: the only way in a browser. */
function TerminalSignIn({ baseUrl }: { baseUrl: string }): ReactElement {
  return (
    <>
      <Text>
        Ask your agent to run <InlineCode>spaces_login</InlineCode>, or run this once in a terminal.
        Either opens an approval page with a short code: check it matches, then approve.
      </Text>
      <CodeBlock
        code={`XYNE_SPACES_BASE_URL=${baseUrl} npx -y ${MCP_PACKAGE} login`}
        trackName='Spaces MCP: copy login command'
      />
      <Callout tone='warning'>
        Never approve a sign-in link someone else sent you: approving gives whoever started it
        access to your account.
      </Callout>
    </>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  primary,
  trackName,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
  trackName: string;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={busy}
      data-track-category='Developer tools'
      data-track-name={trackName}
      className={cn(
        'flex h-8 w-fit items-center rounded-lg px-3 text-xs font-medium transition-opacity disabled:opacity-60',
        primary
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'border border-border text-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

/** What the saved session's state means, in a sentence. */
function describeStatus(status: SpacesMcpStatus): {
  tone: 'ok' | 'warn' | 'neutral';
  text: string;
} {
  switch (status.state) {
    case 'signed_in':
      return {
        tone: 'ok',
        text:
          `Signed in${status.user ? ` as ${status.user.name} (${status.user.email})` : ''} until ` +
          `${formatTime(status.until)}${status.renewsAutomatically ? ', renewed automatically' : ''}.`,
      };
    case 'signed_out':
      return { tone: 'neutral', text: 'Not signed in on this computer.' };
    case 'expired':
      return { tone: 'warn', text: `The session expired on ${formatTime(status.expiredAt)}.` };
    case 'invalid':
      return {
        tone: 'warn',
        text: 'Spaces no longer accepts the saved session. It was signed out, or your access changed.',
      };
    case 'other_deployment':
      return { tone: 'warn', text: `Signed in to a different Spaces (${status.baseUrl}).` };
    case 'unreachable':
      return { tone: 'warn', text: `Couldn't check: ${status.message}` };
    case 'unavailable':
      return { tone: 'neutral', text: 'Sign-in status is only available in the main window.' };
  }
}

/**
 * Step 2 of the MCP page. In the desktop app: the saved session's status and a
 * one-click sign-in. Elsewhere: how to sign in from the agent or a terminal.
 */
export function McpSignIn(): ReactElement {
  const baseUrl = spacesBaseUrl();
  // Read once: the bridge does not change while the page is open
  const [bridge] = useState(desktopBridge);
  const [status, setStatus] = useState<SpacesMcpStatus | null>(null);
  const [busy, setBusy] = useState<'checking' | 'signing-in' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    setBusy('checking');
    setError(null);
    try {
      setStatus(await bridge.getStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [bridge]);

  useEffect(() => {
    void check();
  }, [check]);

  const signIn = async (): Promise<void> => {
    if (!bridge) return;
    setBusy('signing-in');
    setError(null);
    try {
      const result = await bridge.signIn();
      if (result.ok) setStatus(result.status);
      else setError(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!bridge || status?.state === 'unavailable') {
    return (
      <>
        <TerminalSignIn baseUrl={baseUrl} />
        {!bridge && (
          <Text>
            In the Xyne Spaces desktop app, this step is one click and shows whether you are signed
            in.
          </Text>
        )}
      </>
    );
  }

  const described = status ? describeStatus(status) : null;
  const signedIn = status?.state === 'signed_in';

  return (
    <>
      <Text>
        Signs the MCP in as you, on this computer, for every agent you have connected. The session
        is saved to <InlineCode>~/.xyne/agent/spaces.json</InlineCode>, and agents already running
        pick it up on their next request.
      </Text>
      <div className='flex w-full flex-col gap-3 rounded-2xl border border-border bg-card p-4'>
        <div className='flex items-start gap-2 text-sm leading-[22px]'>
          <span
            aria-hidden
            className={cn(
              'mt-2 size-2 shrink-0 rounded-full',
              described?.tone === 'ok'
                ? 'bg-emerald-500'
                : described?.tone === 'warn'
                  ? 'bg-amber-500'
                  : 'bg-muted-foreground/40',
            )}
          />
          <span className='text-foreground/80' role='status'>
            {busy === 'checking' && !status
              ? 'Checking…'
              : busy === 'signing-in'
                ? 'Signing in…'
                : (described?.text ?? 'Checking…')}
          </span>
        </div>
        <div className='flex flex-wrap gap-2'>
          <ActionButton
            label={signedIn ? 'Sign in again' : 'Sign in Spaces MCP'}
            onClick={() => void signIn()}
            busy={busy !== null}
            primary={!signedIn}
            trackName='Spaces MCP: sign in from desktop app'
          />
          <ActionButton
            label='Check again'
            onClick={() => void check()}
            busy={busy !== null}
            trackName='Spaces MCP: check sign-in status'
          />
        </div>
      </div>
      {error && <Callout tone='warning'>{error}</Callout>}
      <Text>
        A client that sets <InlineCode>XYNE_SPACES_COOKIE</InlineCode> in its own MCP config uses
        that session instead, and this status does not cover it.
      </Text>
    </>
  );
}
