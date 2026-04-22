const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatTime = (date: Date): string => {
  const h = date.getHours();
  const m = date.getMinutes();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${m.toString().padStart(2, '0')} ${suffix}`;
};

const formatRelative = (diffMs: number): string => {
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
  const diffHr = Math.floor(diffMs / 3600000);
  if (diffHr < 24) return `${diffHr} ${diffHr === 1 ? 'hour' : 'hours'} ago`;
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay < 7) return `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 5) return `${diffWk} ${diffWk === 1 ? 'week' : 'weeks'} ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo} ${diffMo === 1 ? 'month' : 'months'} ago`;
  const diffYr = Math.floor(diffDay / 365);
  return `${diffYr} ${diffYr === 1 ? 'year' : 'years'} ago`;
};

export interface EmailHeaderDate {
  short: string;
  full: string;
}

export const formatEmailHeaderDate = (timestamp: number | null | undefined): EmailHeaderDate => {
  if (!timestamp) return { short: 'Unknown date', full: 'Unknown date' };
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = formatTime(date);
  const monthShort = MONTHS_SHORT[date.getMonth()];
  const monthLong = MONTHS_LONG[date.getMonth()];
  const day = DAYS_SHORT[date.getDay()];
  const relative = formatRelative(diffMs);

  const short = isSameDay
    ? `${time} (${relative})`
    : `${monthShort} ${date.getDate()}, ${date.getFullYear()}, ${time} (${relative})`;

  return {
    short,
    full: `${day}, ${monthLong} ${date.getDate()}, ${date.getFullYear()} at ${time}`,
  };
};

export interface RecipientSummary {
  label: string;
  hasMultiple: boolean;
}

const normalizeEmail = (value: string): string => {
  const match = value.match(/<([^>]+)>/);
  const address = (match ? match[1] : value) || '';
  return address.trim().toLowerCase();
};

const displayNameFromAddress = (raw: string): string => {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match && match[1]) {
    return match[1].replace(/^["']|["']$/g, '').trim();
  }
  const address = trimmed.replace(/[<>]/g, '');
  return address.split('@')[0] || address;
};

export const summarizeRecipients = (
  to: readonly string[],
  cc: readonly string[],
  currentUserEmail: string | null,
): RecipientSummary => {
  const toList = to.filter(Boolean);
  const ccList = cc.filter(Boolean);
  const total = toList.length + ccList.length;
  if (total === 0) return { label: 'no recipients', hasMultiple: false };

  const meLc = (currentUserEmail ?? '').trim().toLowerCase();
  const hasMe =
    !!meLc &&
    (toList.some(r => normalizeEmail(r) === meLc) || ccList.some(r => normalizeEmail(r) === meLc));

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
};

const AVATAR_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-green-600',
  'bg-teal-600',
  'bg-sky-600',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-pink-500',
  'bg-rose-500',
];

export const avatarColorFor = (seed: string | null | undefined): string => {
  const value = (seed || '').trim().toLowerCase();
  if (!value) return 'bg-gray-400';
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx] ?? 'bg-gray-400';
};

export const avatarInitial = (name: string): string | null => {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const first = trimmed.charAt(0);
  if (!/[a-zA-Z0-9]/.test(first)) return null;
  return first.toUpperCase();
};
