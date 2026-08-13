import {
  nativeTheme,
  systemPreferences,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
} from 'electron';
import Store from 'electron-store';
import log from 'electron-log/main';
import {
  applyLiquidGlassClarityKnobs,
  attachLiquidGlass,
  isLiquidGlassAvailable,
  LIQUID_GLASS_VARIANT_BY_APPEARANCE,
  setLiquidGlassVariant,
} from './liquid-glass';

/**
 * Derived from `setVibrancy`, NOT from the constructor option, on purpose: the
 * constructor's `vibrancy?:` union still carries the long-deprecated
 * `'appearance-based'`, which `setVibrancy()` no longer accepts. Taking the
 * narrower runtime type makes it a compile error to put the dead value in the
 * map below, and keeps the construction-time and runtime materials in the same
 * vocabulary.
 */
type VibrancyMaterial = NonNullable<Parameters<BrowserWindow['setVibrancy']>[0]>;

const MACOS_VIBRANCY_MATERIAL: VibrancyMaterial = 'fullscreen-ui';

const VIBRANCY_MATERIAL_BY_APPEARANCE: Record<'light' | 'dark', VibrancyMaterial> = {
  light: 'fullscreen-ui',
  dark: 'fullscreen-ui',
};

/**
 * What we last handed to setVibrancy, so repeat syncs don't churn the view.
 * `null` means "no material currently applied" — either because the user turned
 * glass off, or because the window was created without one.
 */
let appliedVibrancyMaterial: VibrancyMaterial | null = MACOS_VIBRANCY_MATERIAL;

/**
 * Mica/Acrylic require Windows 11 22H2. 22621 is the 22H2 build number; every
 * Windows 11 release from 22H2 onwards has a build >= this. Windows 10 tops out
 * at 19045, so this check also excludes it.
 */
const WINDOWS_MIN_MATERIAL_BUILD = 22621;

/**
 * `mica` (not `acrylic`): Mica is the material Microsoft designates for
 * long-lived app backgrounds. Acrylic is a genuine live blur but is documented
 * for transient surfaces, and lags visibly behind during window drag/resize —
 * this app drag-resizes panels constantly, so that trade is a bad one here.
 */
const WINDOWS_BACKGROUND_MATERIAL: NonNullable<
  BrowserWindowConstructorOptions['backgroundMaterial']
> = 'mica';

/**
 * Two independent facts, deliberately kept apart:
 *
 *   glassSupported — CAN this machine draw a material? Platform + OS build +
 *                    "Reduce transparency". Fixed for the process lifetime.
 *   glass enabled  — DOES the user want it? A persisted preference, toggled
 *                    from Preferences -> Appearance.
 *
 * Conflating them is what makes a settings toggle impossible: "unsupported"
 * must hide the control entirely, whereas "supported but switched off" must
 * show it unchecked. `isGlassActive()` is the AND of the two and stays the
 * single thing the renderer keys off.
 */
let glassSupported = false;
let resolved = false;

export type GlassTier = 'liquid' | 'vibrancy' | 'mica' | 'none';

let glassTier: GlassTier = 'none';

export function getGlassTier(): GlassTier {
  return glassTier;
}

/** Same persistence primitive the claw-overlay toggle uses. */
const glassStore = new Store({ name: 'glass' });
const ENABLED_KEY = 'enabled';

/**
 * Windows build number from `10.0.22621`-style version strings. Returns null
 * when the shape is unrecognised, which is treated as "not supported".
 */
function getWindowsBuildNumber(): number | null {
  try {
    const parts = process.getSystemVersion().split('.');
    const build = Number(parts[2]);
    return Number.isFinite(build) ? build : null;
  } catch (error) {
    log.warn('[Glass] Could not read system version', error);
    return null;
  }
}

export type OsReleaseBand =
  | 'macos_26_plus'
  | 'macos_15'
  | 'macos_14'
  | 'macos_pre_14'
  | 'win11_22h2_plus'
  | 'win11_pre_22h2'
  | 'win10_or_older'
  | 'win_unknown'
  | 'linux'
  | 'unknown';

const WINDOWS_MIN_WIN11_BUILD = 22000;

function getMacOsMajorVersion(): number | null {
  try {
    const major = Number(process.getSystemVersion().split('.')[0]);
    return Number.isFinite(major) ? major : null;
  } catch (error) {
    log.warn('[Glass] Could not read system version', error);
    return null;
  }
}

export function getOsReleaseBand(): OsReleaseBand {
  if (process.platform === 'darwin') {
    const major = getMacOsMajorVersion();
    if (major === null) {
      return 'unknown';
    }
    if (major >= 26) {
      return 'macos_26_plus';
    }
    if (major === 15) {
      return 'macos_15';
    }
    if (major === 14) {
      return 'macos_14';
    }
    return 'macos_pre_14';
  }

  if (process.platform === 'win32') {
    const build = getWindowsBuildNumber();
    if (build === null) {
      return 'win_unknown';
    }
    if (build >= WINDOWS_MIN_MATERIAL_BUILD) {
      return 'win11_22h2_plus';
    }
    if (build >= WINDOWS_MIN_WIN11_BUILD) {
      return 'win11_pre_22h2';
    }
    return 'win10_or_older';
  }

  if (process.platform === 'linux') {
    return 'linux';
  }

  return 'unknown';
}

/**
 * BrowserWindow options for the glass feature, or `{}` when this machine cannot
 * do it — in which case the window is byte-for-byte what it was before this
 * feature existed.
 *
 * ── Why the window is made translucent even when glass is switched OFF ──────
 * Electron decides the window's background colour ONCE, at construction
 * (`native_window.cc` InitFromOptions):
 *
 *     SkColor background_color = SK_ColorWHITE;
 *     if (options.Get(kBackgroundColor, &color)) { ...parse... }
 *     else if (IsTranslucent()) { background_color = SK_ColorTRANSPARENT; }
 *
 * `IsTranslucent()` is true only when `vibrancy` (macOS) or `backgroundMaterial`
 * (Windows) is present in the constructor options. So a window built with the
 * preference OFF got an OPAQUE white background — and `BrowserWindow::
 * SetBackgroundColor` pushes that colour to the contentView layer, the
 * WebContents AND WebContentsPreferences. Calling `setVibrancy()` later then
 * inserted a real NSVisualEffectView with an opaque white page sitting on top
 * of it, so behind-window blending had nothing to show: the wallpaper vanished
 * and a flat background appeared. That was the reported bug, and it only bit
 * when the app LAUNCHED disabled.
 *
 * Fix: whenever the machine supports glass, construct the window translucent
 * regardless of the preference, and let the material itself be the thing that
 * comes and goes. `#00000000` is deliberately chosen because it is the one
 * value that is unambiguous under both readings of an 8-digit hex colour —
 * Electron documents `#AARRGGBB` while `ParseCSSColor` follows CSS's
 * `#RRGGBBAA`, and all-zeros is fully transparent black either way. It also
 * produces the exact same SkColor that Electron sets itself on the
 * glass-enabled path, which is already proven to work on real hardware.
 *
 * No transparent flash at launch: the window is created `show: false` and only
 * revealed on `ready-to-show` (see manager.ts), and the pre-dashboard
 * `loading.html` paints an opaque background of its own.
 *
 * Must be called exactly once, before `new BrowserWindow`.
 */
export function resolveGlassWindowOptions(): BrowserWindowConstructorOptions {
  resolved = true;
  glassSupported = detectGlassSupport();

  if (!glassSupported) {
    glassTier = 'none';
    return {};
  }

  if (process.platform === 'darwin' && isLiquidGlassAvailable()) {
    glassTier = 'liquid';
    log.info('[Glass] tier: liquid (NSGlassEffectView via electron-liquid-glass)');
    return { backgroundColor: '#00000000', transparent: true };
  }

  glassTier = process.platform === 'darwin' ? 'vibrancy' : 'mica';

  // Translucent-capable from the start, so toggling the material on later has
  // something to blend against. See the note above.
  const base: BrowserWindowConstructorOptions = { backgroundColor: '#00000000' };

  // Honour the saved preference at CONSTRUCTION time, not after first paint —
  // otherwise a user who turned glass off gets a frame of vibrancy on every
  // launch before the renderer can ask us to remove it. The wallpaper is what
  // paints this window opaque while the material is off.
  if (!isGlassEnabled()) {
    log.info('[Glass] supported but disabled by user preference — translucent, no material');
    // No NSVisualEffectView exists yet; say so, or the appearance-sync guard
    // would later skip a setVibrancy() it actually needs to make.
    appliedVibrancyMaterial = null;
    return base;
  }

  if (process.platform === 'darwin') {
    log.info('[Glass] macOS vibrancy enabled', { material: MACOS_VIBRANCY_MATERIAL });
    return {
      ...base,
      vibrancy: MACOS_VIBRANCY_MATERIAL,
      // `followWindow` lets the material go inert whenever the window loses
      // focus, which in an always-open workspace app reads as a rendering bug.
      visualEffectState: 'active',
    };
  }

  log.info('[Glass] Windows background material enabled', {
    material: WINDOWS_BACKGROUND_MATERIAL,
  });
  return { ...base, backgroundMaterial: WINDOWS_BACKGROUND_MATERIAL };
}

export function applyGlassToWindow(win: BrowserWindow): void {
  if (glassTier !== 'liquid' || !isGlassEnabled() || win.isDestroyed()) {
    return;
  }
  if (!attachLiquidGlass(win)) {
    glassTier = 'vibrancy';
    const material = VIBRANCY_MATERIAL_BY_APPEARANCE[currentAppearance()];
    win.setVibrancy(material);
    appliedVibrancyMaterial = material;
    log.warn('[Glass] liquid attach failed; recovered to vibrancy at runtime', { material });
    return;
  }
  win.setWindowButtonVisibility(true);
  setLiquidGlassVariant(LIQUID_GLASS_VARIANT_BY_APPEARANCE[currentAppearance()]);
  applyLiquidGlassClarityKnobs();
}

/** Platform / OS-setting capability only — says nothing about the user's choice. */
function detectGlassSupport(): boolean {
  if (process.platform === 'darwin') {
    // Users turn "Reduce transparency" on for motion sensitivity, low vision and
    // battery. Honour it by shipping the opaque wallpaper build instead — and
    // hide the toggle, since it is not the user's choice to make here.
    if (systemPreferences.accessibilityDisplayShouldReduceTransparency) {
      log.info('[Glass] macOS "Reduce transparency" is on — glass unsupported');
      return false;
    }
    return true;
  }

  if (process.platform === 'win32') {
    const build = getWindowsBuildNumber();
    if (build === null || build < WINDOWS_MIN_MATERIAL_BUILD) {
      log.info('[Glass] Windows build too old for a background material', {
        build,
        required: WINDOWS_MIN_MATERIAL_BUILD,
      });
      return false;
    }
    return true;
  }

  // Linux: no portable window-blur API. Blur is a compositor feature (KWin,
  // picom) with no way for an app to request it, and Wayland offers nothing.
  // The wallpaper fallback IS the shipped design here.
  log.info('[Glass] No window material on this platform', { platform: process.platform });
  return false;
}

/** Whether this machine can draw a material at all. Drives showing the toggle. */
export function isGlassSupported(): boolean {
  return resolved && glassSupported;
}

/** The persisted user preference. Off until the user opts in. */
export function isGlassEnabled(): boolean {
  return glassStore.get(ENABLED_KEY, false) === true;
}

/**
 * Turn the material on or off on a LIVE window and persist the choice.
 *
 * Both platforms support this without recreating the window — verified against
 * the Electron 33.4.11 sources: `NativeWindowMac::SetVibrancy` mutates an
 * existing NSVisualEffectView (and removes it entirely for a null type), and
 * `NativeWindowViews::SetBackgroundMaterial` calls DwmSetWindowAttribute on the
 * live HWND.
 */
export function setGlassEnabled(win: BrowserWindow, enabled: boolean): void {
  glassStore.set(ENABLED_KEY, enabled);
  log.info('[Glass] enabled set to', { enabled, supported: glassSupported });

  if (!glassSupported || win.isDestroyed()) {
    return;
  }

  if (glassTier === 'liquid') {
    if (enabled) {
      applyGlassToWindow(win);
    }
    return;
  }

  if (process.platform === 'darwin') {
    if (enabled) {
      const material = VIBRANCY_MATERIAL_BY_APPEARANCE[currentAppearance()];
      win.setVibrancy(material);
      appliedVibrancyMaterial = material;
    } else {
      // null tears the NSVisualEffectView out of the hierarchy.
      win.setVibrancy(null);
      // Forget what was applied so re-enabling re-applies rather than
      // short-circuiting on the "already this material" guard.
      appliedVibrancyMaterial = null;
    }
  } else if (process.platform === 'win32') {
    win.setBackgroundMaterial(enabled ? WINDOWS_BACKGROUND_MATERIAL : 'none');
  }
}

/** The appearance the material should use right now, from the synced themeSource. */
function currentAppearance(): 'light' | 'dark' {
  return nativeTheme.themeSource === 'dark' ? 'dark' : 'light';
}

/**
 * Keep the OS material's appearance in step with the app's theme.
 *
 * NSVisualEffectView derives its tint from the window's NSAppearance, NOT from
 * the app's CSS theme. So with macOS in Dark Mode and the app on a light theme
 * (classic / summer_breeze), the material renders as a dark plate under light
 * chrome — the sidebars look dingy and grey next to the white content card,
 * and the reverse happens for midnight under Light Mode. `themeSource` is the
 * only lever Electron exposes for this, and it flips the whole app's
 * NSAppearance, which is what the material follows.
 *
 * Safe with respect to the renderer: this dashboard runs Tailwind with
 * `darkMode: ['class']` and uses no `prefers-color-scheme` queries, so
 * changing the OS colour scheme cannot flip any `dark:` utility. It only moves
 * native chrome (menus, form controls), which the themes already style.
 *
 * No-op unless the window actually has a material — on Linux / Windows 10 /
 * "Reduce transparency" there is nothing to keep in step, and silently
 * repainting the user's native menus would be a gratuitous side effect.
 */
export function applyGlassAppearance(win: BrowserWindow, appearance: 'light' | 'dark'): void {
  if (!isGlassActive() || win.isDestroyed()) {
    return;
  }

  if (nativeTheme.themeSource !== appearance) {
    log.info('[Glass] syncing native appearance to app theme', { appearance });
    nativeTheme.themeSource = appearance;
  }

  // Second, independent lever — see VIBRANCY_MATERIAL_BY_APPEARANCE. Applied
  // separately from themeSource because the two can disagree: themeSource may
  // already be correct while the material still needs swapping (e.g. the first
  // sync after launch, when themeSource happens to match the system already).
  if (process.platform !== 'darwin') {
    return;
  }

  if (glassTier === 'liquid') {
    setLiquidGlassVariant(LIQUID_GLASS_VARIANT_BY_APPEARANCE[appearance]);
    return;
  }

  const material = VIBRANCY_MATERIAL_BY_APPEARANCE[appearance];
  if (material === appliedVibrancyMaterial) {
    return;
  }
  log.info('[Glass] switching vibrancy material', { appearance, material });
  win.setVibrancy(material);
  appliedVibrancyMaterial = material;
}

/**
 * Whether a material is live on the main window right now: this machine can do
 * it AND the user has it switched on. This is the single signal the renderer
 * keys off — it drives the wallpaper and `html[data-glass]`.
 */
export function isGlassActive(): boolean {
  if (!resolved) {
    log.warn('[Glass] isGlassActive() queried before the main window was created');
    return false;
  }
  return glassSupported && isGlassEnabled();
}
