import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import Input from '../../ui/Input';
import { useCopyButton } from '../../../hooks/useCopyButton';
import { getXCallbackUrl, type XAppKeys } from '../../../services/clients/socialMediaDeskApi';

export const EMPTY_X_APP_KEYS: XAppKeys = {
  clientId: '',
  clientSecret: '',
  consumerKey: '',
  consumerSecret: '',
};

/** The backend rejects shorter values; X's keys and secrets are all well over this. */
export const X_MIN_KEY_LENGTH = 10;

const isKeyValid = (value: string): boolean => value.trim().length >= X_MIN_KEY_LENGTH;

export const isXAppKeysComplete = (keys: XAppKeys): boolean =>
  [keys.clientId, keys.clientSecret, keys.consumerKey, keys.consumerSecret].every(isKeyValid);

export const trimXAppKeys = (keys: XAppKeys): XAppKeys => ({
  clientId: keys.clientId.trim(),
  clientSecret: keys.clientSecret.trim(),
  consumerKey: keys.consumerKey.trim(),
  consumerSecret: keys.consumerSecret.trim(),
});

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
  const { copied, copy } = useCopyButton();
  const { data: callbackUrl, isError } = useQuery({
    queryKey: ['x-callback-url'],
    queryFn: getXCallbackUrl,
    staleTime: Infinity,
  });

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
            onClick={() => callbackUrl && copy(callbackUrl)}
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
              aria-invalid={value[field.key].length > 0 && !isKeyValid(value[field.key])}
              data-track-category={trackCategory}
              data-track-name={`edit-x-${field.key}`}
            />
            <span>
              {value[field.key].length > 0 && !isKeyValid(value[field.key])
                ? 'Looks incomplete: copy the whole value'
                : `From “${field.hint}”`}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};
