import { useState } from 'react';
import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import Input from '../../ui/Input';
import { getXCallbackUrl, type XAppKeys } from '../../../services/clients/socialMediaDeskApi';

export const EMPTY_X_APP_KEYS: XAppKeys = {
  clientId: '',
  clientSecret: '',
  consumerKey: '',
  consumerSecret: '',
};

export const isXAppKeysComplete = (keys: XAppKeys): boolean =>
  [keys.clientId, keys.clientSecret, keys.consumerKey, keys.consumerSecret].every(
    value => value.trim().length > 0,
  );

export const trimXAppKeys = (keys: XAppKeys): XAppKeys => ({
  clientId: keys.clientId.trim(),
  clientSecret: keys.clientSecret.trim(),
  consumerKey: keys.consumerKey.trim(),
  consumerSecret: keys.consumerSecret.trim(),
});

/** Messages for the backend's X error codes (OAuth redirects and 4xx bodies). */
export const X_ERROR_MESSAGES: Record<string, string> = {
  x_invalid_api_key:
    'X rejected the API Key and Secret. Copy them again from Keys and tokens in the X Developer Console.',
  x_invalid_client:
    'X rejected the OAuth 2.0 Client ID and Secret. Copy them again from Keys and tokens, and check the app is a confidential client (Web App).',
  x_missing_scopes:
    'The X app did not grant every permission. Set App permissions to "Read and write and Direct message", then connect again.',
  x_no_credits:
    'Your X developer account is out of credits. Buy credits in the X Developer Console, then connect again.',
  x_subscription_failed:
    'X did not allow this app to receive account events. Check the app permissions and try again.',
  x_auth_denied: 'X authorization was cancelled.',
  x_invalid_state: 'The X sign-in link expired. Please start again.',
  x_user_removed: 'Your access to this workspace changed during sign-in. Please start again.',
  x_account_mismatch:
    'You signed in to a different X account than the one being reconnected. Sign in to that account on x.com and try again.',
  x_account_already_connected: 'This X account is already connected to a desk.',
  x_keys_required: 'Enter the X app keys for this account.',
  x_unreachable:
    'The server cannot reach X (api.x.com). Ask your admin to allow outbound access to api.x.com, then try again.',
  x_connection_failed: 'Failed to connect X. Please try again.',
};

const FIELDS: Array<{ key: keyof XAppKeys; label: string; secret: boolean; hint: string }> = [
  { key: 'consumerKey', label: 'API Key', secret: false, hint: 'Consumer Keys' },
  { key: 'consumerSecret', label: 'API Key Secret', secret: true, hint: 'Consumer Keys' },
  {
    key: 'clientId',
    label: 'OAuth 2.0 Client ID',
    secret: false,
    hint: 'OAuth 2.0 Client ID and Client Secret',
  },
  {
    key: 'clientSecret',
    label: 'OAuth 2.0 Client Secret',
    secret: true,
    hint: 'OAuth 2.0 Client ID and Client Secret',
  },
];

interface XAppKeysFieldsProps {
  idPrefix: string;
  value: XAppKeys;
  onChange: (value: XAppKeys) => void;
  /** Shown above the fields; hide when the surrounding dialog already explains the setup. */
  showSetupSteps?: boolean;
  trackCategory: string;
}

/**
 * The customer's own X app: four keys plus the callback URL they must register. Secrets use
 * password inputs, are never prefilled, and are never shown back after saving.
 */
export const XAppKeysFields: React.FC<XAppKeysFieldsProps> = ({
  idPrefix,
  value,
  onChange,
  showSetupSteps = true,
  trackCategory,
}) => {
  const [copied, setCopied] = useState(false);
  const { data: callbackUrl, isError } = useQuery({
    queryKey: ['x-callback-url'],
    queryFn: getXCallbackUrl,
    staleTime: Infinity,
  });

  const copyCallback = async (): Promise<void> => {
    if (!callbackUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy — select the URL and copy it manually.');
    }
  };

  return (
    <div className='space-y-3'>
      {showSetupSteps && (
        <ol className='list-decimal space-y-1 pl-4 text-xs text-muted-foreground'>
          <li>
            In the X Developer Console, create a Project and App and buy credits. Your X account
            pays for this desk&apos;s X usage.
          </li>
          <li>
            Under User authentication settings choose <em>Web App, Automated App or Bot</em>, set
            App permissions to <em>Read and write and Direct message</em>, and add the callback URL
            below.
          </li>
          <li>Copy the four keys from Keys and tokens into the fields below.</li>
        </ol>
      )}

      <div className='space-y-1'>
        <span className='text-xs font-medium text-foreground'>Callback URL</span>
        <div className='flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2'>
          <code className='min-w-0 flex-1 truncate text-xs text-foreground'>
            {callbackUrl ?? (isError ? 'Could not load the callback URL' : 'Loading…')}
          </code>
          <button
            type='button'
            onClick={() => void copyCallback()}
            disabled={!callbackUrl}
            aria-label='Copy callback URL'
            className='shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50'
            data-track-category={trackCategory}
            data-track-name='copy-x-callback-url'
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-2'>
        {FIELDS.map(field => (
          <label
            key={field.key}
            htmlFor={`${idPrefix}-${field.key}`}
            className='flex flex-col gap-1 text-xs text-muted-foreground'
          >
            <span className='text-foreground'>
              {field.label} <span className='text-muted-foreground'>*</span>
            </span>
            <Input
              id={`${idPrefix}-${field.key}`}
              type={field.secret ? 'password' : 'text'}
              value={value[field.key]}
              onChange={event => onChange({ ...value, [field.key]: event.target.value })}
              autoComplete='off'
              spellCheck={false}
              data-track-category={trackCategory}
              data-track-name={`edit-x-${field.key}`}
            />
            <span>From “{field.hint}”</span>
          </label>
        ))}
      </div>
    </div>
  );
};
