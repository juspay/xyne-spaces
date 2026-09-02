/**
 * Covers the frame when the app breaks, with the error and a way to act on it.
 *
 * Two sources feed it. `sandpack.error` is the bundler's report — a file that
 * does not compile, a dependency that will not resolve, a throw its own window
 * handler saw — and carries no component stack. The app's own report comes over
 * postMessage from the boundary the synthesized entry wraps the root in
 * (xyneDataRuntime.source.ts) and does, so it wins when both arrive. Both clear
 * on `start`: a rebuild — the next version landing in the pane, a refresh — is
 * a fresh chance, and a stale error over a working app would be worse than none.
 *
 * Replaces Sandpack's own error overlay (`showSandpackErrorOverlay={false}` on
 * the preview), which shows the same text and offers nothing to do about it.
 * Bundler timeouts are deliberately not routed here: that is Sandpack's
 * `LoadingOverlay`, with its Restart button, and not something the agent can
 * fix.
 *
 * "Fix with AI" sends `fix: <error>` into the thread as a new turn, so the agent
 * repairs the app on its next cycle from the same text a person would have
 * pasted. It is only offered where there is a thread to send to — see
 * `AppCreationModeSignal.submitPrompt`.
 *
 * One request per error, enforced here rather than left to the composer. The
 * composer refuses a second send only once a reply is streaming, which leaves
 * both a race (the click before `pending` flips) and a gap (an agent that
 * answers without rebuilding), and either way a live-looking button after the
 * request is already in the thread reads as "that did nothing". The rearm is
 * the bundler's `start`: a new build is a new chance to fail, and its error is
 * a new error.
 */

import { useEffect, useMemo, useState, type MutableRefObject, type ReactElement } from 'react';
import { useSandpack } from '@codesandbox/sandpack-react';
import { AlertTriangle, Check, Copy, Loader2, Sparkles, X } from 'lucide-react';
import { isAppArtifactMessage } from './artifactData.constants';
import { useAppCreationModeSignal } from './appCreationModeContext';
import type { PreviewClientRef } from './useArtifactDataBridge';

interface ArtifactRenderError {
  message: string;
  /** `path:line:column`, when the bundler knows it and the message doesn't already say. */
  location?: string;
  componentStack?: string;
}

/** Lines of component stack worth sending: the leaf and its nearest ancestors
 *  name the culprit; the rest is the app's shell, repeated on every error. */
const COMPONENT_STACK_LINES = 6;

/** The error as text — what gets copied, and what the agent is sent. */
export function describeArtifactError(error: ArtifactRenderError): string {
  const lines = [error.message];
  if (error.location) lines.push(`at ${error.location}`);
  if (error.componentStack) {
    const frames = error.componentStack
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, COMPONENT_STACK_LINES);
    if (frames.length > 0) lines.push('Component stack:', ...frames.map(frame => `  ${frame}`));
  }
  return lines.join('\n');
}

/** Sandpack's own report, in the same shape as the app's. */
function fromSandpack(
  error: { message: string; path?: string; line?: number; column?: number } | null,
): ArtifactRenderError | null {
  if (!error) return null;
  const message = error.message.trim() || 'Unknown error';
  const location =
    error.path && !message.includes(error.path)
      ? [error.path, error.line, error.column].filter(part => part !== undefined).join(':')
      : undefined;
  return { message, ...(location ? { location } : {}) };
}

export const ArtifactErrorOverlay = ({
  fill,
  previewRef,
}: {
  fill: boolean;
  /** Identifies our iframe: several artifacts can be mounted at once and they
   *  all post to this same window. */
  previewRef: MutableRefObject<PreviewClientRef | null>;
}): ReactElement | null => {
  const { sandpack, listen } = useSandpack();
  const { submitPrompt } = useAppCreationModeSignal();
  const [appError, setAppError] = useState<ArtifactRenderError | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refused, setRefused] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    const unsubscribe = listen(message => {
      if (message.type !== 'start') return;
      setAppError(null);
      setDismissed(false);
      setRefused(false);
      setRequested(false);
    });
    const onMessage = (event: MessageEvent): void => {
      if (!isAppArtifactMessage(event.data) || event.data.type !== 'error') return;
      const target = previewRef.current?.getClient()?.iframe?.contentWindow ?? null;
      if (!target || event.source !== target) return;
      const { message, componentStack } = event.data;
      const next: ArtifactRenderError = {
        message: message?.trim() || 'Unknown error',
        ...(componentStack ? { componentStack } : {}),
      };
      // React (dev) raises a boundary-caught error on `window` first and in
      // componentDidCatch second, so one failure arrives twice. Keep the first
      // report unless the later one is the richer of the two.
      setAppError(prev => (prev && !next.componentStack ? prev : next));
    };
    window.addEventListener('message', onMessage);
    return (): void => {
      unsubscribe();
      window.removeEventListener('message', onMessage);
    };
  }, [listen, previewRef]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return (): void => window.clearTimeout(timer);
  }, [copied]);

  const error = useMemo(() => appError ?? fromSandpack(sandpack.error), [appError, sandpack.error]);
  if (!error || dismissed) return null;

  const text = describeArtifactError(error);

  return (
    <div
      className={`absolute inset-0 z-30 flex items-center justify-center p-4 ${
        fill ? 'bg-background' : 'bg-card'
      }`}
      role='alert'
    >
      <div className='flex w-full max-w-md flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4'>
        <div className='flex items-start gap-2'>
          <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-destructive' aria-hidden='true' />
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium text-foreground'>This app hit an error</p>
            <pre className='mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground'>
              {text}
            </pre>
          </div>
          <button
            type='button'
            onClick={() => setDismissed(true)}
            className='-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            aria-label='Dismiss'
            title='Dismiss and show the app anyway'
            data-track-category='AskAI'
            data-track-name='ReactArtifactDismissError'
          >
            <X className='h-4 w-4' aria-hidden='true' />
          </button>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {submitPrompt && (
            <button
              type='button'
              disabled={requested}
              onClick={() => {
                if (requested) return;
                const sent = submitPrompt(`fix: ${text}`);
                setRequested(sent);
                setRefused(!sent);
              }}
              className='flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60'
              data-track-category='AskAI'
              data-track-name='ReactArtifactFixWithAI'
            >
              {requested ? (
                <>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' aria-hidden='true' />
                  Fix requested
                </>
              ) : (
                <>
                  <Sparkles className='h-3.5 w-3.5' aria-hidden='true' />
                  Fix with AI
                </>
              )}
            </button>
          )}
          <button
            type='button'
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => setCopied(true));
            }}
            className='flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent'
            data-track-category='AskAI'
            data-track-name='ReactArtifactCopyError'
          >
            {copied ? (
              <Check className='h-3.5 w-3.5 text-emerald-500' aria-hidden='true' />
            ) : (
              <Copy className='h-3.5 w-3.5' aria-hidden='true' />
            )}
            {copied ? 'Copied' : 'Copy error'}
          </button>
          {refused && (
            <span className='text-xs text-muted-foreground'>
              Wait for the current reply to finish, then try again.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
