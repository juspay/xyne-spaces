import { type ReactElement } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select/index';
import {
  AUTH_TYPE_OPTIONS,
  baseUrlPlaceholder,
  REASONING_OPTIONS,
  supportsAuthType,
  supportsOauth,
  supportsReasoning,
  type CredentialForm,
} from './credentialForm';
import { CredentialOauthFlow } from './CredentialOauthFlow';

const FIELD =
  'h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring';

const Field = ({
  label,
  optional = false,
  children,
}: {
  label: string;
  optional?: boolean;
  children: ReactElement;
}): ReactElement => (
  <div className='flex w-full flex-col gap-1.5'>
    <span className='flex items-center gap-1 text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
      {label}
      {optional && <span className='text-xs font-normal text-muted-foreground'>(optional)</span>}
    </span>
    {children}
  </div>
);

interface CredentialFormFieldsProps {
  form: CredentialForm;
  onChange: (next: CredentialForm) => void;
  editing: boolean;
  slug: string;
  onOauthConnected: () => void;
}

export function CredentialFormFields({
  form,
  onChange,
  editing,
  slug,
  onOauthConnected,
}: CredentialFormFieldsProps): ReactElement {
  const set = <K extends keyof CredentialForm>(key: K, value: CredentialForm[K]): void =>
    onChange({ ...form, [key]: value });

  // OAuth stores the token bundle server-side through its own exchange, so the
  // key field would have nothing to collect.
  const oauthProvider =
    form.authType === 'oauth_token' && supportsOauth(form.provider) ? form.provider : null;

  return (
    <div className='flex w-full flex-col gap-3'>
      {supportsAuthType(form.provider) && (
        <Field label='Auth type'>
          <Select
            value={form.authType}
            onValueChange={next => set('authType', next as CredentialForm['authType'])}
          >
            <SelectTrigger
              size='sm'
              aria-label='Auth type'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: credential auth type'
              className='h-11 w-full rounded-2xl'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTH_TYPE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {oauthProvider ? (
        <CredentialOauthFlow slug={slug} provider={oauthProvider} onConnected={onOauthConnected} />
      ) : (
        <Field label='API key' optional={editing}>
          <input
            value={form.apiKey}
            onChange={e => set('apiKey', e.target.value)}
            type='password'
            placeholder={editing ? 'Leave blank to keep the stored key' : 'sk-…'}
            aria-label='API key'
            autoComplete='off'
            autoFocus
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: credential api key'
            className={FIELD}
          />
        </Field>
      )}

      <Field label='Model' optional>
        <input
          value={form.model}
          onChange={e => set('model', e.target.value)}
          placeholder='Provider default'
          aria-label='Model'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: credential model'
          className={FIELD}
        />
      </Field>

      <Field label='Base URL' optional>
        <input
          value={form.baseUrl}
          onChange={e => set('baseUrl', e.target.value)}
          placeholder={baseUrlPlaceholder(form.provider)}
          aria-label='Base URL'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: credential base url'
          className={FIELD}
        />
      </Field>

      {supportsReasoning(form.provider) && (
        <Field label='Reasoning effort' optional>
          <Select
            value={form.reasoningEffort === '' ? 'default' : form.reasoningEffort}
            onValueChange={next =>
              set('reasoningEffort', next === 'default' ? '' : (next as 'low' | 'medium' | 'high'))
            }
          >
            <SelectTrigger
              size='sm'
              aria-label='Reasoning effort'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: credential reasoning effort'
              className='h-11 w-full rounded-2xl'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REASONING_OPTIONS.map(option => (
                <SelectItem
                  key={option.value || 'default'}
                  value={option.value === '' ? 'default' : option.value}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}
