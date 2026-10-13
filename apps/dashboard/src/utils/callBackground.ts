import type { BackgroundEffectOptions } from './backgroundEffects';

/**
 * Background effect applied to the local camera feed in calls (web only).
 * `image` carries the resolved URL so the processor never needs a lookup.
 */
export type BackgroundEffect =
  | { mode: 'none' }
  | { mode: 'blur'; strength: BlurStrength }
  | { mode: 'image'; id: string; url: string };

export type BlurStrength = 'light' | 'strong';

export const NO_BACKGROUND_EFFECT: BackgroundEffect = { mode: 'none' };

export interface PresetBackground {
  id: string;
  label: string;
  url: string;
  thumbUrl: string;
}

const preset = (id: string, label: string): PresetBackground => ({
  id,
  label,
  url: `/call-backgrounds/${id}.jpg`,
  thumbUrl: `/call-backgrounds/${id}-thumb.jpg`,
});

export const PRESET_BACKGROUNDS: PresetBackground[] = [
  preset('xyne-booth', 'Xyne'),
  preset('office', 'Office'),
  preset('lounge', 'Lounge'),
  preset('living-room', 'Living room'),
  preset('mountains', 'Mountains'),
  preset('forest', 'Forest'),
  preset('beach', 'Beach'),
  preset('night-sky', 'Night sky'),
];

export function isSameEffect(a: BackgroundEffect, b: BackgroundEffect): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'blur' && b.mode === 'blur') return a.strength === b.strength;
  if (a.mode === 'image' && b.mode === 'image') return a.id === b.id;
  return true;
}

/** Options for the camera processor (utils/backgroundEffects). */
export function toEffectOptions(effect: BackgroundEffect): BackgroundEffectOptions {
  switch (effect.mode) {
    case 'none':
      return { mode: 'disabled' };
    case 'blur':
      return { mode: 'blur', blurStrength: effect.strength };
    case 'image':
      return { mode: 'image', imageUrl: effect.url };
  }
}

// ---------------------------------------------------------------------------
// Persistence (per browser). Storage can throw or be empty (private mode,
// blocked site data), so every access is guarded and falls back to defaults.
// ---------------------------------------------------------------------------

const EFFECT_STORAGE_KEY = 'xyne.call.backgroundEffect';
const CUSTOM_STORAGE_KEY = 'xyne.call.customBackgrounds';
/** Uploaded backgrounds kept per browser; oldest is dropped beyond this. */
export const MAX_CUSTOM_BACKGROUNDS = 3;

export interface CustomBackground {
  id: string;
  /** JPEG data URL, downscaled on upload so it fits comfortably in localStorage. */
  url: string;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadCustomBackgrounds(): CustomBackground[] {
  const list = readJson<CustomBackground[]>(CUSTOM_STORAGE_KEY);
  return Array.isArray(list)
    ? list.filter(b => typeof b?.id === 'string' && typeof b?.url === 'string')
    : [];
}

/** Returns false when storage is full or unavailable. */
export function saveCustomBackgrounds(list: CustomBackground[]): boolean {
  return writeJson(CUSTOM_STORAGE_KEY, list.slice(0, MAX_CUSTOM_BACKGROUNDS));
}

/**
 * The saved effect, re-validated against what still exists: a preset that was
 * removed or a deleted upload falls back to no effect rather than a broken image.
 */
export function loadBackgroundEffect(): BackgroundEffect {
  const saved = readJson<BackgroundEffect>(EFFECT_STORAGE_KEY);
  if (!saved || typeof saved !== 'object') return NO_BACKGROUND_EFFECT;
  if (saved.mode === 'blur' && (saved.strength === 'light' || saved.strength === 'strong')) {
    return { mode: 'blur', strength: saved.strength };
  }
  if (saved.mode === 'image') {
    const image =
      PRESET_BACKGROUNDS.find(p => p.id === saved.id) ??
      loadCustomBackgrounds().find(c => c.id === saved.id);
    if (image) return { mode: 'image', id: image.id, url: image.url };
  }
  return NO_BACKGROUND_EFFECT;
}

export function saveBackgroundEffect(effect: BackgroundEffect): void {
  writeJson(EFFECT_STORAGE_KEY, effect);
}

const UPLOAD_MAX_WIDTH = 1280;
const UPLOAD_MAX_HEIGHT = 720;

/** Downscale an uploaded image to at most 1280×720 and encode it as a JPEG data URL. */
export async function imageFileToBackgroundDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, UPLOAD_MAX_WIDTH / bitmap.width, UPLOAD_MAX_HEIGHT / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    bitmap.close();
  }
}
