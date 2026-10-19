import type { EmailRecipientSummary } from '../types';
import { displayNameFromAddress, normalizeEmailAddress } from './parse-email-addresses';

/** Dashboard/Gmail-style "to me and N others" summary. */
export function summarizeRecipients(
  to: readonly string[],
  cc: readonly string[],
  currentUserEmail: string | null,
): EmailRecipientSummary {
  const toList = to.filter(Boolean);
  const ccList = cc.filter(Boolean);
  const total = toList.length + ccList.length;
  if (total === 0) return { label: 'no recipients', hasMultiple: false };

  const meLc = (currentUserEmail ?? '').trim().toLowerCase();
  const hasMe =
    !!meLc &&
    (toList.some(r => normalizeEmailAddress(r) === meLc) ||
      ccList.some(r => normalizeEmailAddress(r) === meLc));

  const others = total - (hasMe ? 1 : 0);

  if (hasMe) {
    if (others === 0) return { label: 'to me', hasMultiple: false };
    if (others === 1) return { label: 'to me and 1 other', hasMultiple: true };
    return { label: `to me and ${others} others`, hasMultiple: true };
  }

  const firstRaw = toList[0] ?? ccList[0] ?? '';
  const firstName = displayNameFromAddress(firstRaw);
  if (total === 1) return { label: `to ${firstName}`, hasMultiple: false };
  return {
    label: `to ${firstName} and ${total - 1} ${total - 1 === 1 ? 'other' : 'others'}`,
    hasMultiple: true,
  };
}
