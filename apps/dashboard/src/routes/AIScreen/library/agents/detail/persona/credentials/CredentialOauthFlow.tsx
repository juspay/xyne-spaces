import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
import { Textarea } from '@/components/ui/Textarea';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  exchangeAgentOauth,
  pollAgentCopilotLogin,
  startAgentCopilotLogin,
  startAgentOauth,
  type AgentCopilotDeviceCode,
  type AgentOauthFlow,
} from './agentCredentialsService';

type OauthProvider = 'codex' | 'claude' | 'copilot';

const COPY: Record<OauthProvider, { button: string; blurb: string; alternative: string }> = {
  copilot: {
    button: 'Sign in with GitHub',
    blurb:
      'GitHub shows a device code — enter it on github.com to authorize. The token is stored on the agent, so every run uses it. Note this spends the signing-in account’s Copilot seat for everyone who runs this agent.',
    alternative: 'Prefer a raw token? Switch auth type to API key and paste it instead.',
  },
  claude: {
    button: 'Sign in with Claude',
    blurb:
      'Sign in with the team’s Claude account. Anthropic then shows a code — paste it (or the whole redirect URL) below. This captures a refreshable token, so it won’t silently expire like a pasted one, and the team’s Pro/Max quota is used.',
    alternative: 'Prefer a long-lived token? Run `claude setup-token` and paste it as an API key.',
  },
  codex: {
    button: 'Sign in with ChatGPT',
    blurb:
      'Sign in with the team’s ChatGPT account. OpenAI then shows a code — paste it (or the whole redirect URL) below. This stores a refreshable token bundle rather than a raw key.',
    alternative: 'Prefer a raw key? Switch auth type to API key and paste it instead.',
  },
};

/**
 * The paste-back step exists because both providers redirect to a loopback port
 * we don't own, so the browser can't hand the code back to us directly.
 */
export function CredentialOauthFlow({
  slug,
  provider,
  onConnected,
}: {
  slug: string;
  provider: OauthProvider;
  onConnected: () => void;
}): ReactElement {
  const [flow, setFlow] = useState<AgentOauthFlow | null>(null);
  const [device, setDevice] = useState<AgentCopilotDeviceCode | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[provider];
  const isDeviceFlow = provider === 'copilot';
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  // GitHub's device flow has no redirect, so authorization only lands here by
  // polling. Backs off when GitHub asks us to.
  useEffect(() => {
    if (!device) return undefined;
    let cancelled = false;
    let delay = Math.max(device.interval, 1) * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (): Promise<void> => {
      try {
        const result = await pollAgentCopilotLogin(slug);
        if (cancelled) return;
        if (result.status === 'approved') {
          setDevice(null);
          onConnectedRef.current();
          return;
        }
        if (result.status === 'slow_down') delay += 5000;
        timer = setTimeout(() => void tick(), delay);
      } catch (err) {
        if (cancelled) return;
        setDevice(null);
        setError(clawErrorText(err, 'Sign-in failed'));
      }
    };

    timer = setTimeout(() => void tick(), delay);
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [device, slug]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (isDeviceFlow) {
        const next = await startAgentCopilotLogin(slug);
        setDevice(next);
        window.open(next.verificationUri, '_blank', 'noopener,noreferrer');
        return;
      }
      const next = await startAgentOauth(slug, provider);
      setFlow(next);
      window.open(next.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(clawErrorText(err, 'Could not start sign-in'));
    } finally {
      setBusy(false);
    }
  };

  const complete = async (): Promise<void> => {
    if (!flow || !code.trim() || provider === 'copilot') return;
    setBusy(true);
    setError(null);
    try {
      await exchangeAgentOauth(slug, provider, { code: code.trim(), state: flow.state });
      setFlow(null);
      setCode('');
      onConnected();
    } catch (err) {
      setError(clawErrorText(err, 'Sign-in failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='flex w-full flex-col gap-2.5 rounded-2xl border border-border bg-muted/40 p-3'>
      <p className='text-xs leading-4 text-muted-foreground'>{copy.blurb}</p>

      {device ? (
        <>
          <div className='flex items-center gap-2'>
            <code className='rounded-lg border border-border bg-card px-2.5 py-1 font-mono text-sm tracking-[0.2em] text-foreground'>
              {device.userCode}
            </code>
            <a
              href={device.verificationUri}
              target='_blank'
              rel='noopener noreferrer'
              className='text-xs underline underline-offset-2'
            >
              Enter it on github.com
            </a>
          </div>
          <span className='flex items-center gap-2 text-xs leading-4 text-muted-foreground'>
            <Loader2 className='size-3.5 animate-spin' aria-hidden />
            Waiting for authorization…
          </span>
          <Button
            variant='ghost'
            onClick={() => {
              setDevice(null);
              setError(null);
            }}
            className='h-8 w-fit rounded-lg text-sm'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: cancel copilot oauth'
          >
            Cancel
          </Button>
        </>
      ) : !flow ? (
        <Button
          variant='outline'
          onClick={() => void start()}
          loading={busy}
          disabled={busy}
          className='h-8 w-fit rounded-lg text-sm'
          data-track-category='Claw Agents'
          data-track-name={`Agent detail v2: start ${provider} oauth`}
        >
          {busy ? 'Opening…' : copy.button}
        </Button>
      ) : (
        <>
          <p className='text-xs leading-4 text-muted-foreground'>
            If the tab didn’t open,{' '}
            <a
              href={flow.url}
              target='_blank'
              rel='noopener noreferrer'
              className='underline underline-offset-2'
            >
              open it here
            </a>
            .
          </p>
          <Textarea
            value={code}
            onChange={event => setCode(event.target.value)}
            placeholder='Paste the code, or the full callback URL'
            rows={3}
          />
          <div className='flex items-center gap-2'>
            <Button
              onClick={() => void complete()}
              loading={busy}
              disabled={busy || !code.trim()}
              className='h-8 rounded-lg text-sm'
              data-track-category='Claw Agents'
              data-track-name={`Agent detail v2: complete ${provider} oauth`}
            >
              {busy ? 'Verifying…' : 'Complete sign-in'}
            </Button>
            <Button
              variant='ghost'
              onClick={() => {
                setFlow(null);
                setCode('');
                setError(null);
              }}
              disabled={busy}
              className='h-8 rounded-lg text-sm'
              data-track-category='Claw Agents'
              data-track-name={`Agent detail v2: cancel ${provider} oauth`}
            >
              Cancel
            </Button>
          </div>
        </>
      )}

      {error && <p className='text-xs leading-4 text-destructive'>{error}</p>}
      <p className='text-[11px] leading-4 text-muted-foreground'>{copy.alternative}</p>
    </div>
  );
}
