/**
 * Per-message sender display overrides — Slack's `username` and `icon_url` on
 * `chat.postMessage`.
 *
 * Slack lets a bot replace the displayed name and avatar for one message without
 * changing the posting identity, so one app install can present several logical
 * senders (e.g. "Infra-SwitchV1" vs "Infra-SwitchV2"). Xyne stores both on
 * `Message.metadata`, which is already in the Zero schema, so the values reach the
 * dashboard with no migration. The dashboard reads them as
 * `MessageMetadata.senderNameOverride` / `senderIconOverride` and only renders them
 * on BOT messages.
 *
 * `icon_emoji` is deliberately NOT supported: Xyne's avatar square renders an image
 * or initials only (see Avatar.tsx), so an emoji avatar would be a new visual state
 * for a component used app-wide — a design decision, not a transform. Slack clients
 * that send it fall back to the app's normal avatar.
 *
 * SECURITY — why the keys are stripped below: both postMessage endpoints accept
 * free-form `metadata` (`z.record(z.unknown())`) that is spread into the stored
 * message. If callers could write these keys directly, any future scope gate on the
 * overrides (Slack requires `chat:write.customize`) would be bypassable by setting
 * the metadata keys instead. Stripping them here means a stored override can only
 * come from the validated request fields, so adding that gate later is a one-line
 * change at the two call sites.
 */

/** Reserved `Message.metadata` keys. Callers cannot set them directly. */
export const SENDER_NAME_OVERRIDE_KEY = 'senderNameOverride';
export const SENDER_ICON_OVERRIDE_KEY = 'senderIconOverride';

/** Slack's cap on a custom bot username. */
export const SENDER_NAME_MAX_LENGTH = 80;
/** Generous but bounded, so a pathological URL cannot bloat every message row. */
export const SENDER_ICON_URL_MAX_LENGTH = 2048;

/**
 * Normalise a caller-supplied `username`.
 *
 * Control characters are stripped because the value renders as the author line, where
 * a newline would let a caller forge extra UI rows. A blank or non-string value yields
 * no override, so it cannot blank out the real sender name.
 */
function normalizeName(username: unknown): string | undefined {
  if (typeof username !== 'string') return undefined;
  return username.replace(/[\u0000-\u001F\u007F]/g, ' ').trim() || undefined;
}

/**
 * Normalise a caller-supplied `icon_url`.
 *
 * Only absolute http(s) URLs are accepted. The value becomes an `<img src>` in every
 * viewer's browser, so `javascript:`, `data:` and relative values are rejected rather
 * than passed through — the browser must end up fetching an ordinary remote image and
 * nothing else. Note this is NOT proxied: the URL's host sees each viewer's IP, the
 * same as it already does for an absolute `user.picture`.
 */
function normalizeIconUrl(iconUrl: unknown): string | undefined {
  if (typeof iconUrl !== 'string') return undefined;
  const trimmed = iconUrl.trim();
  if (!trimmed || trimmed.length > SENDER_ICON_URL_MAX_LENGTH) return undefined;

  try {
    const { protocol } = new URL(trimmed);
    if (protocol !== 'http:' && protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }

  return trimmed;
}

export interface SenderOverrides {
  /** Slack's `username`. */
  username?: unknown;
  /** Slack's `icon_url`. */
  iconUrl?: unknown;
}

/**
 * Build the metadata to persist, applying the sender display overrides.
 *
 * Both reserved keys are stripped from `callerMetadata` and then re-set from the
 * validated fields. Returns `undefined` when there is nothing to store, matching the
 * previous behaviour of passing `metadata` straight through.
 */
export function applySenderOverrides(
  callerMetadata: Record<string, unknown> | undefined,
  overrides: SenderOverrides,
): Record<string, unknown> | undefined {
  const name = normalizeName(overrides.username);
  const icon = normalizeIconUrl(overrides.iconUrl);

  const {
    [SENDER_NAME_OVERRIDE_KEY]: _reservedName,
    [SENDER_ICON_OVERRIDE_KEY]: _reservedIcon,
    ...rest
  } = callerMetadata ?? {};

  const result: Record<string, unknown> = { ...rest };
  if (name) result[SENDER_NAME_OVERRIDE_KEY] = name;
  if (icon) result[SENDER_ICON_OVERRIDE_KEY] = icon;

  return Object.keys(result).length > 0 ? result : undefined;
}
