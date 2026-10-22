import { sanitizeFlowUrl } from '@/src/utils/flowUrlUtils';
import type { FlowComponentLike, FlowTextNormalizationOptions } from '@/src/utils/flowJsonMarkdown';

export type PrStatus = 'created' | 'merged' | 'reverted' | 'deleted' | 'declined';
export type PrProvider = 'github' | 'bitbucket' | 'gitlab' | 'other';

export type PrBadgeTone = 'created' | 'merged' | 'danger';

export type PrCardViewModel = {
  status: PrStatus;
  provider: PrProvider;
  title: string;
  ticketId?: string;
  desc?: string;
  detailsUrl?: string;
  url?: string;
  statusLabel: string;
  badgeTone: PrBadgeTone;
  openProviderLabel: string;
  openTicketLabel: string;
  displayTitle: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const optionalUrl = (value: unknown): string | undefined => {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const cleaned = sanitizeFlowUrl(raw);
  return cleaned ? cleaned : undefined;
};

const requiredString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const parsePrStatus = (value: unknown): PrStatus | null => {
  if (
    value === 'created' ||
    value === 'merged' ||
    value === 'reverted' ||
    value === 'deleted' ||
    value === 'declined'
  ) {
    return value;
  }
  return null;
};

export const parsePrProvider = (value: unknown): PrProvider => {
  if (value === 'github' || value === 'bitbucket' || value === 'gitlab') return value;
  return 'other';
};

export const prStatusLabel = (status: PrStatus): string => {
  switch (status) {
    case 'created':
      return 'PR Created';
    case 'merged':
      return 'PR Merged';
    case 'reverted':
      return 'PR Reverted';
    case 'deleted':
      return 'PR Deleted';
    case 'declined':
      return 'PR Declined';
  }
};

export const prBadgeToneForStatus = (status: PrStatus): PrBadgeTone => {
  if (status === 'created') return 'created';
  if (status === 'merged') return 'merged';
  return 'danger';
};

export const prProviderOpenLabel = (provider: PrProvider): string => {
  switch (provider) {
    case 'github':
      return 'Open in GitHub';
    case 'bitbucket':
      return 'Open in Bitbucket';
    case 'gitlab':
      return 'Open in GitLab';
    default:
      return 'Open pull request';
  }
};

/** Compact preview: flatten markdown-ish desc into a single-line-friendly string. */
export const prDescPreviewText = (desc: string): string =>
  desc
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const createPrCardViewModel = (component: FlowComponentLike): PrCardViewModel | null => {
  if (component.type !== 'pr') return null;

  const props = isRecord(component.props) ? component.props : undefined;
  const status = parsePrStatus(props?.['status']);
  const title = requiredString(props?.['title']);
  if (!status || !title) return null;

  const provider = parsePrProvider(props?.['provider']);
  const ticketId = optionalString(props?.['ticketId']);
  const desc = optionalString(props?.['desc']);
  const detailsUrl = optionalUrl(props?.['detailsUrl']);
  const url = optionalUrl(props?.['url']);

  return {
    status,
    provider,
    title,
    statusLabel: prStatusLabel(status),
    badgeTone: prBadgeToneForStatus(status),
    openProviderLabel: prProviderOpenLabel(provider),
    openTicketLabel: ticketId ? 'Open ticket' : 'View details',
    displayTitle: ticketId ? `${ticketId} ${title}` : title,
    ...(ticketId ? { ticketId } : {}),
    ...(desc ? { desc } : {}),
    ...(detailsUrl ? { detailsUrl } : {}),
    ...(url ? { url } : {}),
  };
};

export const findPrComponent = (
  components: FlowComponentLike[] | undefined,
): FlowComponentLike | undefined => {
  if (!components) return undefined;
  for (const component of components) {
    if (component.type === 'pr') return component;
    const nested = findPrComponent(component.children);
    if (nested) return nested;
  }
  return undefined;
};

export const isPrFlow = (flow: {
  data?: Record<string, unknown> | undefined;
  components?: FlowComponentLike[] | undefined;
}): boolean => {
  if (flow.data?.['kind'] === 'pr') return true;
  return findPrComponent(flow.components) !== undefined;
};

export const prComponentToMarkdown = (
  component: FlowComponentLike,
  _options: FlowTextNormalizationOptions = {},
): string => {
  const viewModel = createPrCardViewModel(component);
  if (!viewModel) return '';

  const lines = [`**${viewModel.statusLabel}**`, `**${viewModel.displayTitle}**`];
  if (viewModel.desc) lines.push(viewModel.desc);
  if (viewModel.url) lines.push(`[${viewModel.openProviderLabel}](${viewModel.url})`);
  return lines.join('\n\n');
};
