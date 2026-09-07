import path from 'path';
import { app, type BrowserWindow } from 'electron';
import log from 'electron-log/main';

/**
 * macOS 26 Liquid Glass backdrop, via our own native addon in
 * `native/glass/glass.mm`.
 *
 * ── Why our own addon rather than a package ────────────────────────────────
 * The published wrappers drive NSGlassEffectView through PRIVATE underscore
 * selectors (`_variant`, `_scrimState`, `_subduedState`) which can vanish in
 * any macOS point release, and they apply the tint only at attach time. This
 * addon uses the four public, documented properties instead — `style`,
 * `cornerRadius`, `tintColor`, `contentView` — all of which AppKit lets us
 * reconfigure on a live view. `style` is the same Regular / Clear choice macOS
 * offers in System Settings > Appearance > Liquid Glass, which is the only knob
 * that actually matters here.
 *
 * Electron exposes no Liquid Glass API of its own: the maintainer PR that would
 * have added `win.setGlassEffect()` (electron/electron#50415) was closed
 * unmerged in June 2026 with nothing to replace it, so a native addon remains
 * the only route.
 */

export const LIQUID_GLASS_STYLES = {
  /** Honours System Settings > Appearance > Liquid Glass — reads as "Tinted". */
  regular: 0,
  /** Forces the "Clear" look and ignores that system preference. */
  clear: 1,
} as const;

export type LiquidGlassStyle = (typeof LIQUID_GLASS_STYLES)[keyof typeof LIQUID_GLASS_STYLES];

/* ═══════════════ LIQUID GLASS CONTROL PANEL — edit, then restart ═══════════════
 * These are developer knobs, not user settings. Style and tint were briefly
 * exposed in Preferences and taken back out: Regular is the only look we want
 * to ship, and a tint on top of the material made it muddier rather than
 * richer. Preferences keeps just the on/off toggle and the wallpaper slider.
 *
 * style          regular(0) follows the system Clear/Tinted preference;
 *                clear(1) forces Clear. NSGlassEffectViewStyle has exactly
 *                these two cases — AppKit coerces anything else to regular.
 *                Deliberately NOT keyed off light/dark: NSGlassEffectView takes
 *                its lightness from the window's NSAppearance, which
 *                `applyGlassAppearance` already keeps in step with the theme.
 * tintColor      '#RRGGBB' or '#RRGGBBAA' | null = no tint. RGBA, matching CSS.
 *                (Electron's own docs for the API it never shipped used
 *                #AARRGGBB — do not copy values across.)
 * cornerRadius   px. 0 = let AppKit's hiddenInset mask round it.
 * CSS scrim      the other half of the look: apps/dashboard/src/global.css
 *                --wallpaper-opacity-default (liquid tier 0%, others 30%) and
 *                the Preferences > Wallpaper slider.              clearer: 0%
 * All three are applied when the backdrop is attached, so a change needs a
 * restart to take effect.
 * ════════════════════════════════════════════════════════════════════════════ */

const LIQUID_GLASS_STYLE: LiquidGlassStyle = LIQUID_GLASS_STYLES.regular;
const LIQUID_GLASS_CORNER_RADIUS = 0;
const LIQUID_GLASS_TINT_COLOR: string | null = null;

interface GlassAddon {
  isSupported(): boolean;
  attach(
    handle: Buffer,
    options: { style?: number; cornerRadius?: number; tintColor?: string },
  ): number;
  detach(id: number): void;
}

let moduleLoadAttempted = false;
let addon: GlassAddon | null = null;
let availability: boolean | null = null;
let viewId: number | null = null;

/** Mirrors MeetingDetector.getBinaryPath — same asarUnpack layout. */
function addonPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'glass', 'glass.node');
  }
  return path.join(app.getAppPath(), 'native', 'glass', 'glass.node');
}

function loadAddon(): GlassAddon | null {
  if (moduleLoadAttempted) {
    return addon;
  }
  moduleLoadAttempted = true;

  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    addon = require(addonPath()) as GlassAddon;
    log.info('[LiquidGlass] native addon loaded');
  } catch (error) {
    // Not fatal: the caller drops to the vibrancy tier, which is what shipped
    // before Liquid Glass existed.
    log.info('[LiquidGlass] addon unavailable; falling back to vibrancy', {
      reason: error instanceof Error ? error.message : String(error),
    });
    addon = null;
  }

  return addon;
}

export function isLiquidGlassAvailable(): boolean {
  if (availability !== null) {
    return availability;
  }

  const mod = loadAddon();
  if (!mod) {
    availability = false;
    return availability;
  }

  try {
    // True only where AppKit actually has the class, i.e. macOS 26+.
    availability = mod.isSupported() === true;
    log.info('[LiquidGlass] capability probe', { available: availability });
  } catch (error) {
    log.warn('[LiquidGlass] capability probe threw; falling back to vibrancy', {
      reason: error instanceof Error ? error.message : String(error),
    });
    availability = false;
  }

  return availability;
}

export function hasLiquidGlassView(): boolean {
  return viewId !== null;
}

export function attachLiquidGlass(win: BrowserWindow): boolean {
  if (viewId !== null) {
    return true;
  }
  if (!isLiquidGlassAvailable() || win.isDestroyed() || !addon) {
    return false;
  }

  try {
    const id = addon.attach(win.getNativeWindowHandle(), {
      style: LIQUID_GLASS_STYLE,
      cornerRadius: LIQUID_GLASS_CORNER_RADIUS,
      ...(LIQUID_GLASS_TINT_COLOR ? { tintColor: LIQUID_GLASS_TINT_COLOR } : {}),
    });
    if (typeof id !== 'number' || id < 0) {
      log.warn('[LiquidGlass] attach returned no usable id; falling back to vibrancy', { id });
      return false;
    }
    viewId = id;
    log.info('[LiquidGlass] backdrop attached', { viewId });
    return true;
  } catch (error) {
    log.warn('[LiquidGlass] attach threw; falling back to vibrancy', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function detachLiquidGlass(): void {
  if (viewId === null || !addon) {
    return;
  }
  try {
    addon.detach(viewId);
    log.info('[LiquidGlass] backdrop detached', { viewId });
  } catch (error) {
    log.warn('[LiquidGlass] detach threw', {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    viewId = null;
  }
}
