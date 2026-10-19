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

/** A preset background; the list comes from `/calls/backgrounds` (Superposition-driven). */
export interface PresetBackground {
  id: string;
  label: string;
  url: string;
  thumbUrl: string;
}

export function isPresetBackground(value: unknown): value is PresetBackground {
  if (!value || typeof value !== 'object') return false;
  const { id, label, url, thumbUrl } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    typeof label === 'string' &&
    typeof url === 'string' &&
    typeof thumbUrl === 'string'
  );
}

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
const PRESETS_STORAGE_KEY = 'xyne.call.presetBackgrounds';
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

/** Last preset list fetched from the server (empty until the picker has loaded once). */
export function loadCachedPresetBackgrounds(): PresetBackground[] {
  const list = readJson<unknown[]>(PRESETS_STORAGE_KEY);
  return Array.isArray(list) ? list.filter(isPresetBackground) : [];
}

export function saveCachedPresetBackgrounds(list: PresetBackground[]): void {
  writeJson(PRESETS_STORAGE_KEY, list);
}

/**
 * The saved effect, re-validated against what still exists: a preset that was
 * removed or a deleted upload falls back to no effect rather than a broken image.
 */
export function loadBackgroundEffect(): BackgroundEffect {
  const saved = readJson<SavedBackgroundEffect>(EFFECT_STORAGE_KEY);
  if (!saved || typeof saved !== 'object') return NO_BACKGROUND_EFFECT;
  if (saved.mode === 'blur' && (saved.strength === 'light' || saved.strength === 'strong')) {
    return { mode: 'blur', strength: saved.strength };
  }
  if (saved.mode === 'image') {
    const image =
      loadCachedPresetBackgrounds().find(p => p.id === saved.id) ??
      loadCustomBackgrounds().find(c => c.id === saved.id);
    if (image) return { mode: 'image', id: image.id, url: image.url };
  }
  return NO_BACKGROUND_EFFECT;
}

/** Only the image id is stored; its URL is resolved on load, so hosting can change. */
type SavedBackgroundEffect =
  | Exclude<BackgroundEffect, { mode: 'image' }>
  | { mode: 'image'; id: string };

export function saveBackgroundEffect(effect: BackgroundEffect): void {
  writeJson(
    EFFECT_STORAGE_KEY,
    effect.mode === 'image' ? { mode: 'image', id: effect.id } : effect,
  );
}

const UPLOAD_MAX_WIDTH = 1280;
const UPLOAD_MAX_HEIGHT = 720;
const THUMB_MAX_WIDTH = 320;
const THUMB_MAX_HEIGHT = 180;

/** Draw an image file onto a canvas, downscaled to fit within the given box. */
async function drawScaled(
  file: File,
  maxWidth: number,
  maxHeight: number,
): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Downscale an uploaded image to at most 1280×720 and encode it as a JPEG data URL. */
export async function imageFileToBackgroundDataUrl(file: File): Promise<string> {
  const canvas = await drawScaled(file, UPLOAD_MAX_WIDTH, UPLOAD_MAX_HEIGHT);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** Full-size (≤1280×720) and thumbnail JPEGs of an image, for a preset upload. */
export async function imageFileToPresetJpegs(file: File): Promise<{ image: Blob; thumb: Blob }> {
  const [full, small] = await Promise.all([
    drawScaled(file, UPLOAD_MAX_WIDTH, UPLOAD_MAX_HEIGHT),
    drawScaled(file, THUMB_MAX_WIDTH, THUMB_MAX_HEIGHT),
  ]);
  const [image, thumb] = await Promise.all([canvasToJpeg(full, 0.85), canvasToJpeg(small, 0.8)]);
  return { image, thumb };
}
