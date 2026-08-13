import type { BrowserWindow } from 'electron';
import log from 'electron-log/main';

export const LIQUID_GLASS_VARIANTS = {
  regular: 0,
  clear: 1,
  dock: 2,
  appIcons: 3,
  widgets: 4,
  text: 5,
  avplayer: 6,
  facetime: 7,
  controlCenter: 8,
  notificationCenter: 9,
  monogram: 10,
  bubbles: 11,
  identity: 12,
  focusBorder: 13,
  focusPlatter: 14,
  keyboard: 15,
  sidebar: 16,
  abuttedSidebar: 17,
  inspector: 18,
  control: 19,
  loupe: 20,
  slider: 21,
  camera: 22,
  cartouchePopover: 23,
} as const;

export type LiquidGlassVariant = (typeof LIQUID_GLASS_VARIANTS)[keyof typeof LIQUID_GLASS_VARIANTS];

/* ═══════════════ LIQUID GLASS CONTROL PANEL — edit, then restart ═══════════════
 * opaque         false = real glass | true = opaque NSColor windowBackgroundColor
 *                NSBox behind the glass, nothing shows through.  clearer: false
 * variant        0-23, see LIQUID_GLASS_VARIANTS.                 clearer: clear(1)
 * tintColor      '#RRGGBBAA' (NOT AARRGGBB — the README is wrong; see
 *                ColorFromHexNSString) | null = no tint at all.   clearer: null
 * nativeScrim    null = OS default | 0 = off | 1 = on.            clearer: 0 or null
 * subdued        null = OS default | 0 = off | 1 = on (dimmer).   clearer: 0 or null
 * cornerRadius   px. 0 = let AppKit's hiddenInset mask round it.
 * CSS scrim      other half of the tint: apps/dashboard/src/global.css
 *                --glass-scrim-default (liquid tier 0%, others 30%) and the
 *                Preferences > Background tint slider.            clearer: 0%
 * Live on theme change: variant, nativeScrim, subdued.
 * Restart required: opaque, tintColor, cornerRadius.
 * ════════════════════════════════════════════════════════════════════════════ */

export const LIQUID_GLASS_VARIANT_BY_APPEARANCE: Record<'light' | 'dark', LiquidGlassVariant> = {
  light: LIQUID_GLASS_VARIANTS.clear,
  dark: LIQUID_GLASS_VARIANTS.clear,
};

const LIQUID_GLASS_OPAQUE = false;
const LIQUID_GLASS_NATIVE_SCRIM: 0 | 1 | null = null;
const LIQUID_GLASS_SUBDUED: 0 | 1 | null = null;
const LIQUID_GLASS_CORNER_RADIUS = 0;
const LIQUID_GLASS_TINT_COLOR: string | null = null;

interface LiquidGlassModule {
  isMacOS?: () => boolean;
  isGlassSupported?: () => boolean;
  addView?: (
    handle: Buffer,
    options?: { cornerRadius?: number; tintColor?: string; opaque?: boolean },
  ) => number;
  unstable_setVariant?: (id: number, variant: number) => void;
  unstable_setScrim?: (id: number, scrim: number) => void;
  unstable_setSubdued?: (id: number, subdued: number) => void;
}

let moduleLoadAttempted = false;
let liquidGlass: LiquidGlassModule | null = null;
let availability: boolean | null = null;
let viewId: number | null = null;

function loadModule(): LiquidGlassModule | null {
  if (moduleLoadAttempted) {
    return liquidGlass;
  }
  moduleLoadAttempted = true;

  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const required: unknown = require('electron-liquid-glass');
    const resolved =
      required && typeof required === 'object' && 'default' in required
        ? (required as { default: unknown }).default
        : required;
    if (!resolved || typeof resolved !== 'object') {
      log.warn('[LiquidGlass] module resolved to a non-object; falling back to vibrancy');
      return null;
    }
    liquidGlass = resolved as LiquidGlassModule;
    log.info('[LiquidGlass] native module loaded');
  } catch (error) {
    log.info('[LiquidGlass] module unavailable; falling back to vibrancy', {
      reason: error instanceof Error ? error.message : String(error),
    });
    liquidGlass = null;
  }

  return liquidGlass;
}

export function isLiquidGlassAvailable(): boolean {
  if (availability !== null) {
    return availability;
  }

  const mod = loadModule();
  if (!mod) {
    availability = false;
    return availability;
  }

  try {
    const onMac = typeof mod.isMacOS === 'function' ? mod.isMacOS() : process.platform === 'darwin';
    const supported = typeof mod.isGlassSupported === 'function' ? mod.isGlassSupported() : false;
    availability = onMac === true && supported === true && typeof mod.addView === 'function';
    log.info('[LiquidGlass] capability probe', { onMac, supported, available: availability });
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
  if (!isLiquidGlassAvailable() || win.isDestroyed()) {
    return false;
  }

  const mod = liquidGlass;
  if (!mod?.addView) {
    return false;
  }

  try {
    const handle = win.getNativeWindowHandle();
    const id = mod.addView(handle, {
      cornerRadius: LIQUID_GLASS_CORNER_RADIUS,
      opaque: LIQUID_GLASS_OPAQUE,
      ...(LIQUID_GLASS_TINT_COLOR ? { tintColor: LIQUID_GLASS_TINT_COLOR } : {}),
    });
    if (typeof id !== 'number' || id < 0) {
      log.warn('[LiquidGlass] addView returned no usable id; falling back to vibrancy', { id });
      return false;
    }
    viewId = id;
    log.info('[LiquidGlass] backdrop attached', { viewId });
    return true;
  } catch (error) {
    log.warn('[LiquidGlass] addView threw; falling back to vibrancy', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function setLiquidGlassVariant(variant: LiquidGlassVariant): void {
  if (viewId === null || !liquidGlass?.unstable_setVariant) {
    return;
  }
  try {
    liquidGlass.unstable_setVariant(viewId, variant);
    log.info('[LiquidGlass] variant applied', { variant });
  } catch (error) {
    log.warn('[LiquidGlass] setVariant threw', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export function applyLiquidGlassClarityKnobs(): void {
  if (viewId === null) {
    return;
  }
  if (LIQUID_GLASS_NATIVE_SCRIM !== null && liquidGlass?.unstable_setScrim) {
    try {
      liquidGlass.unstable_setScrim(viewId, LIQUID_GLASS_NATIVE_SCRIM);
      log.info('[LiquidGlass] native scrim applied', { scrim: LIQUID_GLASS_NATIVE_SCRIM });
    } catch (error) {
      log.warn('[LiquidGlass] setScrim threw', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (LIQUID_GLASS_SUBDUED !== null && liquidGlass?.unstable_setSubdued) {
    try {
      liquidGlass.unstable_setSubdued(viewId, LIQUID_GLASS_SUBDUED);
      log.info('[LiquidGlass] subdued applied', { subdued: LIQUID_GLASS_SUBDUED });
    } catch (error) {
      log.warn('[LiquidGlass] setSubdued threw', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
