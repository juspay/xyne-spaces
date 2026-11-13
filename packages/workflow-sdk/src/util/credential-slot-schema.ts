/**
 * Mark a component's credential fields in its config JSON Schema.
 *
 * A component calls this from its own `decorateConfigSchema`, so the component
 * decides which fields hold credentials, what they are called, how deeply they
 * are nested, and how many there are. The framework never marks fields itself.
 */

import type { CredentialRequirement } from '../connectors/core/credentials.js';
import type { CredentialTypeRef } from '../common/credentials.js';

/** The JSON Schema `format` the builder renders as a credential picker. */
export const CREDENTIAL_NAME_FORMAT = 'credential-name';

/**
 * A field's JSON Schema, marked as a credential picker limited to the accepted types.
 *
 *     props['credentialName'] = markCredentialField(props['credentialName'], this.credential);
 */
export function markCredentialField(
  fieldSchema: Record<string, unknown>,
  accepted: CredentialRequirement | undefined,
): Record<string, unknown> {
  const credentialTypes = (accepted ?? []).map((definition) => definition.credType);
  return {
    ...fieldSchema,
    format: CREDENTIAL_NAME_FORMAT,
    ...(credentialTypes.length > 0 ? { credentialTypes } : {}),
  };
}

/** The accepted types, as the UI needs them. */
export function credentialTypeRefs(accepted: CredentialRequirement | undefined): CredentialTypeRef[] {
  return (accepted ?? []).map((definition) => ({
    credType: definition.credType,
    label: definition.label,
  }));
}
