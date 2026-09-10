import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { issueAutomationWebhook } from '../../../api/automationsApi';

export function WebhookEndpointPanel({
  automationId,
}: {
  automationId: string | null;
}): React.ReactElement {
  const { data, isSuccess } = useQuery({
    queryKey: ['automation-webhook', automationId],
    queryFn: () => issueAutomationWebhook(automationId as string),
    enabled: !!automationId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const intro = (
    <p className='text-[11px] text-muted-foreground'>
      Send a <code>POST</code> to this URL to trigger this automation. The secret is part of the URL
      — treat the whole URL as a secret.
    </p>
  );

  return (
    <div className='pointer-events-auto flex flex-col gap-2 rounded-md border border-border bg-background p-3'>
      {!automationId ? (
        <p className='text-[11px] text-muted-foreground'>
          Save the automation to generate its webhook URL.
        </p>
      ) : data?.url ? (
        <>
          {intro}
          <CopyRow label='POST URL' value={data.url} />
          <p className='text-[11px] text-amber-600 dark:text-amber-400'>
            Copy this now — the URL contains the secret and is shown only once. It can’t be
            retrieved later.
          </p>
        </>
      ) : isSuccess ? (
        <>
          {intro}
          <p className='text-[11px] text-muted-foreground'>
            The webhook URL was shown once when it was created and can’t be displayed again.
          </p>
        </>
      ) : null}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className='flex items-center gap-2'>
      <span className='w-16 shrink-0 text-[11px] font-medium text-muted-foreground'>{label}</span>
      <code className='min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px] text-foreground'>
        {value}
      </code>
      <button
        type='button'
        aria-label={`Copy ${label}`}
        onClick={copy}
        data-track-category='automation-builder'
        data-track-name='CopyWebhookEndpointValue'
        className='flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground'
      >
        {copied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
      </button>
    </div>
  );
}
