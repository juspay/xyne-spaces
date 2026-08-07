const STORAGE_KEY = 'xyne-glass-scrim-opacity';
const USER_VAR = '--glass-scrim-opacity-user';
const EFFECTIVE_VAR = '--glass-scrim-opacity';

export const SCRIM_MIN = 5;
export const SCRIM_MAX = 90;
export const SCRIM_STEP = 1;

type StoredMap = Record<string, number>;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeGlassScrim(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function currentTheme(): string {
  if (typeof document === 'undefined') {
    return '';
  }
  return document.documentElement.getAttribute('data-theme') ?? '';
}

function readMap(): StoredMap {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const out: StoredMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[key] = clamp(value);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: StoredMap): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage full or unavailable */
  }
}

export function clamp(value: number): number {
  return Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, Math.round(value)));
}

export function getStoredOpacity(theme: string): number | null {
  return readMap()[theme] ?? null;
}

const CSS_DEFAULT_FALLBACK = 30;

export function getCssDefaultOpacity(): number {
  if (typeof document === 'undefined') {
    return CSS_DEFAULT_FALLBACK;
  }
  const root = document.documentElement;
  const previous = root.style.getPropertyValue(USER_VAR);
  if (previous) {
    root.style.removeProperty(USER_VAR);
  }
  const raw = getComputedStyle(root).getPropertyValue(EFFECTIVE_VAR).trim();
  if (previous) {
    root.style.setProperty(USER_VAR, previous);
  }
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : CSS_DEFAULT_FALLBACK;
}

export function getEffectiveOpacity(theme: string): number {
  return getStoredOpacity(theme) ?? getCssDefaultOpacity();
}

export function applyStoredOpacity(theme: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const stored = getStoredOpacity(theme);
  const root = document.documentElement;
  if (stored === null) {
    root.style.removeProperty(USER_VAR);
  } else {
    root.style.setProperty(USER_VAR, `${stored}%`);
  }
}

export function setStoredOpacity(theme: string, value: number): void {
  const map = readMap();
  map[theme] = clamp(value);
  writeMap(map);
  applyStoredOpacity(theme);
  emit();
}

export function clearStoredOpacity(theme: string): void {
  const map = readMap();
  delete map[theme];
  writeMap(map);
  applyStoredOpacity(theme);
  emit();
}

export function hasStoredOpacity(theme: string): boolean {
  return getStoredOpacity(theme) !== null;
}
