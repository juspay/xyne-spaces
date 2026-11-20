import { AppError } from '@/middleware/errorHandler';

export type CallProviderCredentials = Record<string, unknown>;

/** A credential the connection form collects. Secret values are never sent back to the browser. */
export interface CallProviderField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'url';
  required: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string;
}

export interface CallProviderOption {
  id: string;
  label: string;
}

/** A rejected telephony request, with per-field messages for the form. */
export class CallConfigError extends AppError {
  constructor(
    message: string,
    statusCode = 400,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message, statusCode);
    this.name = 'CallConfigError';
  }
}

/**
 * What a call provider plugs into the shared telephony layer. Ingestion is separate: each provider
 * also registers an ExternalSource adapter whose platform name equals `id`.
 */
export interface CallProvider<C extends CallProviderCredentials = CallProviderCredentials> {
  /** ExternalSource.sourceType of its connections, and the prefix of their ingest source names. */
  id: string;
  displayName: string;
  fields: CallProviderField[];
  /** Call types a desk can create tickets for. */
  callTypes: CallProviderOption[];
  /** What calls are routed by, e.g. "Campaign"; unset when the provider has no routing keys. */
  routingKeyLabel?: string;
  /** Validates form input; a blank secret keeps the value from `existing`. Throws CallConfigError. */
  parseCredentials(input: Record<string, unknown>, existing?: C): C;
  /** Fields safe to show in the connection form (no secrets). */
  publicCredentials(credentials: C): Record<string, string>;
  /** The provider account; two connections to one account would overwrite each other's webhook. */
  accountKey(credentials: C): string;
  softphoneUrl(credentials: C): string | null;
  subscribeEvents?(credentials: C, webhookUrl: string): Promise<string>;
  listRoutingKeys?(credentials: C): Promise<string[]>;
}
