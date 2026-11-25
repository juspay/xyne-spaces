import {
  UnreadableString,
  isCiphertextValue,
  reveal,
  runComposeTemplate,
  runExtractors,
  type ComposeInputs,
  type ExtractorName,
  type FieldFacts,
  type ComposeResult,
  type ComposeTemplate,
} from '@xyne/shared';
import { config } from '@/config/env';
import { getEncryptionProvider } from './provider';
import type { ComposeItemResult } from './types';
import { recordComposeError, recordComposed, type MetricSource } from '@/zero/zeroMetrics';

/** Entity type of the keys stored values are encrypted under. */
const WORKSPACE_ENTITY_TYPE = 'WORKSPACE';

/** One value to compose: a template, its inputs as the caller holds them, and the stored value it would replace. */
export type ComposeRequest<T extends ComposeTemplate = ComposeTemplate> = {
  template: T;
  inputs: ComposeInputs<T>;
  /** The value stored now, if any: an equal result comes back `unchanged`, so the write can be skipped. */
  current?: UnreadableString | null;
};

/**
 * Builds a value the server stores but cannot build itself, because it holds its parts only
 * encrypted (see COMPOSE_TEMPLATES). The caller passes the parts as it holds them, the
 * unreadable ones as `UnreadableString`, and gets the result back as an `UnreadableString`
 * (ciphertext under `workspaceId`'s key, to store as it is), or `unchanged`. It never reads the
 * text.
 *
 * With DB encryption on, the encryption service decrypts the parts, runs the template and
 * encrypts the result. With it off, the parts are plaintext and the template runs here, on the
 * values held; a part that is ciphertext then is an error, as in tx.read.
 */
export async function compose<T extends ComposeTemplate>(
  request: ComposeRequest<T>,
  options: { workspaceId: string },
): Promise<ComposeResult> {
  const [result] = await composeBatch([request as ComposeRequest], options);
  return result;
}

/** `compose` for many values, in one encryption-service call; one result per request, in order. */
export async function composeBatch(
  requests: readonly ComposeRequest[],
  options: { workspaceId: string },
): Promise<ComposeResult[]> {
  if (requests.length === 0) return [];
  const items = requests.map(({ template, inputs, current }) => ({
    template: template.name,
    inputs: heldInputs(template, inputs as Record<string, unknown>),
    current: current ? reveal(current) : null,
  }));
  const source: MetricSource = config.enc.enableDbEncryption ? 'enc-rust' : 'local';

  let results: ComposeItemResult[];
  try {
    results =
      source === 'enc-rust'
        ? await getEncryptionProvider().compose({ items, entityId: options.workspaceId, entityType: WORKSPACE_ENTITY_TYPE })
        : items.map(composeLocally);
  } catch (error) {
    for (const template of new Set(items.map(item => item.template))) recordComposeError({ template, source });
    throw error;
  }

  const byTemplate = new Map<string, boolean[]>();
  items.forEach((item, index) => {
    const list = byTemplate.get(item.template) ?? [];
    list.push(results[index].unchanged);
    byTemplate.set(item.template, list);
  });
  for (const [template, unchanged] of byTemplate) recordComposed({ template, source, unchanged });

  return results.map(result => (result.unchanged ? result : { unchanged: false, value: UnreadableString.make(result.value) }));
}

/**
 * `inputs` as they go to the encryption service: each of the template's unreadable fields as
 * the value it holds (stored ciphertext, or plaintext), the rest as they are. An
 * `UnreadableString` in any other field is refused: it would go out as "<redacted>".
 */
function heldInputs(template: ComposeTemplate, inputs: Record<string, unknown>): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(inputs)) {
    if (value instanceof UnreadableString) {
      if (!template.unreadableFields.includes(field)) {
        throw new Error(`compose ${template.name}: ${field} is not an unreadable input of the template`);
      }
      wire[field] = reveal(value);
    } else {
      wire[field] = value;
    }
  }
  return wire;
}

/** The template run here, on plaintext parts (DB encryption off). */
function composeLocally(item: { template: string; inputs: Record<string, unknown>; current: string | null }): ComposeItemResult {
  for (const [field, value] of Object.entries(item.inputs)) {
    if (isCiphertextValue(value)) {
      throw new Error(`compose ${item.template}: ${field} is ciphertext and DB encryption is off`);
    }
  }
  const value = runComposeTemplate(item.template, item.inputs);
  return item.current === value ? { unchanged: true } : { unchanged: false, value };
}

/**
 * `compose` for a value written through a service that takes the stored string rather than a
 * Zero mutation (e.g. a Xyne Apps message through conversationService): the built value exactly
 * as it is stored, ciphertext under `workspaceId`'s key while DB encryption is on. The caller
 * never reads it; it hands it to the write and to `deriveStoredFacts`.
 */
export async function composeForStorage<T extends ComposeTemplate>(
  request: Omit<ComposeRequest<T>, 'current'>,
  options: { workspaceId: string },
): Promise<string> {
  const result = await compose(request as ComposeRequest<T>, options);
  if (result.unchanged) throw new Error(`compose ${request.template.name}: no current value, yet unchanged`);
  return reveal(result.value);
}

/**
 * The named facts of a value as it is stored (`composeForStorage`'s result): from the encryption
 * service while DB encryption is on (it decrypts the value next to the extractors), else run
 * here on the plaintext.
 */
export async function deriveStoredFacts(
  value: string,
  names: readonly ExtractorName[],
  options: { workspaceId: string },
): Promise<FieldFacts> {
  if (names.length === 0) return {};
  if (!config.enc.enableDbEncryption) {
    if (isCiphertextValue(value)) throw new Error('deriveStoredFacts: the value is ciphertext and DB encryption is off');
    return runExtractors(value, names);
  }
  const [facts] = await getEncryptionProvider().deriveFacts({
    items: [{ value, derive: [...names] }],
    entityId: options.workspaceId,
    entityType: WORKSPACE_ENTITY_TYPE,
  });
  if (!facts) throw new Error('deriveStoredFacts: the encryption service returned no facts');
  return facts;
}
