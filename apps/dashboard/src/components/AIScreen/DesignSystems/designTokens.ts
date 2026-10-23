export const PALETTE_ROLES = [
  'primary',
  'accent',
  'background',
  'surface',
  'text',
  'muted',
  'border',
  'success',
  'warning',
  'danger',
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];

export interface TokenColor {
  token: string;
  value: string;
  hex: string | null;
  role: PaletteRole | null;
}

export interface TokenFont {
  token: string;
  family: string;
  stack: string;
}

export interface TokenScaleValue {
  token: string;
  value: string;
}

export interface DesignTokens {
  colors: TokenColor[];
  fonts: TokenFont[];
  typeSteps: TokenScaleValue[];
  radii: TokenScaleValue[];
  spacing: TokenScaleValue[];
  shadows: TokenScaleValue[];
  isEmpty: boolean;
}

const EMPTY: DesignTokens = {
  colors: [],
  fonts: [],
  typeSteps: [],
  radii: [],
  spacing: [],
  shadows: [],
  isEmpty: true,
};

export function stripCssComments(css: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = css.indexOf('/*', from);
    if (start === -1) return out + css.slice(from);
    out += css.slice(from, start);
    const end = css.indexOf('*/', start + 2);
    if (end === -1) return out;
    from = end + 2;
  }
}

export function normalizeHex(value: string): string | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!;
  if (digits.length === 3 || digits.length === 4) {
    const rgb = digits
      .slice(0, 3)
      .split('')
      .map(d => d + d)
      .join('');
    return `#${rgb.toUpperCase()}`;
  }
  if (digits.length === 6 || digits.length === 8) {
    return `#${digits.slice(0, 6).toUpperCase()}`;
  }
  return null;
}

function rgbToHex(value: string): string | null {
  const match = /^rgba?\(([^)]{1,120})\)$/i.exec(value.trim());
  if (!match) return null;
  const parts = match[1]!
    .split(/[,/\s]+/)
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map(p => {
    if (p.endsWith('%')) {
      const pct = Number(p.slice(0, -1));
      return Number.isFinite(pct) ? Math.round((pct / 100) * 255) : NaN;
    }
    return Number(p);
  });
  if (channels.some(c => !Number.isFinite(c) || c < 0 || c > 255)) return null;
  return `#${channels
    .map(c => Math.round(c).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function toHex(value: string): string | null {
  return normalizeHex(value) ?? rgbToHex(value);
}

function isColorValue(value: string): boolean {
  return /^(#|rgba?\(|hsla?\(|oklch\(|color\()/i.test(value.trim());
}

const ROLE_ALIASES: Record<string, PaletteRole> = {
  bg: 'background',
  fg: 'text',
  foreground: 'text',
  warn: 'warning',
  error: 'danger',
  negative: 'danger',
  positive: 'success',
};

function roleOf(token: string): PaletteRole | null {
  const lower = token.toLowerCase();
  for (const role of PALETTE_ROLES) if (lower === role) return role;
  const alias = ROLE_ALIASES[lower];
  if (alias) return alias;
  for (const role of PALETTE_ROLES) if (lower.endsWith(`-${role}`)) return role;
  for (const [name, role] of Object.entries(ROLE_ALIASES)) {
    if (lower.endsWith(`-${name}`)) return role;
  }
  for (const role of PALETTE_ROLES) if (lower.includes(`-${role}-`)) return role;
  return null;
}

export function familyOf(stack: string): string {
  const first = stack.split(',')[0] ?? '';
  return first.trim().replace(/^['"]|['"]$/g, '');
}

export function readCustomProperties(css: string): Array<{ token: string; value: string }> {
  const declarations: Array<{ token: string; value: string }> = [];
  const seen = new Set<string>();
  const re = /--([A-Za-z0-9_-]{1,80})\s*:\s*([^;}]{1,400})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripCssComments(css)))) {
    const token = match[1]!;
    const value = match[2]!.trim();
    if (!value || seen.has(token)) continue;
    seen.add(token);
    declarations.push({ token, value });
  }
  return declarations;
}

export function parseDesignTokens(tokensCss: string | null | undefined): DesignTokens {
  if (!tokensCss || !tokensCss.trim()) return EMPTY;

  const colors: TokenColor[] = [];
  const fonts: TokenFont[] = [];
  const typeSteps: TokenScaleValue[] = [];
  const radii: TokenScaleValue[] = [];
  const spacing: TokenScaleValue[] = [];
  const shadows: TokenScaleValue[] = [];

  for (const { token, value } of readCustomProperties(tokensCss)) {
    const lower = token.toLowerCase();

    if (isColorValue(value)) {
      colors.push({ token, value, hex: toHex(value), role: roleOf(token) });
      continue;
    }
    if (lower.includes('font') || lower.includes('family')) {
      fonts.push({ token, family: familyOf(value), stack: value });
      continue;
    }
    if (lower.includes('shadow') || lower.includes('elevation')) {
      shadows.push({ token, value });
      continue;
    }
    if (lower.includes('radius') || lower.includes('radii')) {
      radii.push({ token, value });
      continue;
    }
    if (lower.includes('space') || lower.includes('spacing') || lower.includes('gap')) {
      spacing.push({ token, value });
      continue;
    }
    if (lower.includes('text') || lower.includes('size') || lower.includes('leading')) {
      typeSteps.push({ token, value });
    }
  }

  const isEmpty =
    colors.length === 0 &&
    fonts.length === 0 &&
    typeSteps.length === 0 &&
    radii.length === 0 &&
    spacing.length === 0 &&
    shadows.length === 0;

  return { colors, fonts, typeSteps, radii, spacing, shadows, isEmpty };
}

const ROLE_ORDER = new Map<string, number>(PALETTE_ROLES.map((role, index) => [role, index]));

export function orderedPalette(colors: TokenColor[]): TokenColor[] {
  return [...colors].sort((a, b) => {
    const left = a.role ? (ROLE_ORDER.get(a.role) ?? 99) : 99;
    const right = b.role ? (ROLE_ORDER.get(b.role) ?? 99) : 99;
    if (left !== right) return left - right;
    return a.token.localeCompare(b.token);
  });
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  url: 'Website',
  screenshot: 'Screenshot',
  repo: 'Repository',
  file: 'File',
  library: 'Library',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
