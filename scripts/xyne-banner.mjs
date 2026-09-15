import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WORDMARK = [
  " ████▄     ▄████  ███         ████ ▄███ ▄▄▄██████▄▄     ▄▄███████▄▄",
  "  ▀████▄ ▄████▀   ███         ████ ████████▀▀▀▀████▄  ▄████▀▀▀▀▀▀███▄",
  "    ▀███████▀     ████      ▄█████ ████▀        ████ ████         ████",
  "      █████       ▀███████████████ ████         ████ █████████████████",
  "    ▄███████▄        ▀▀▀▀▀▀▀  ████ ████         ████ ████",
  "  ▄███▀   ▀███▄   ██▄▄▄▄▄▄▄▄█████  ████         ████  ▀████▄▄▄▄▄▄▄▄██",
  " ███▀       ▀███▄ ▀██████████▀▀    ▀███         ▀███    ▀▀█████████▀▀",
];

const WORDMARK_COMPACT = [
  " ███▄    ▄██▀ ███       ███ ███▄▄▄██████▄    ▄██████▄▄",
  "  ▀███▄▄███▀  ███       ███ █████▀▀▀▀▀███▄ ▄██▀▀▀▀▀▀███",
  "    ▀████▀    ▀███▄▄▄▄▄████ ███▀       ███▄███▄▄▄▄▄▄▄███",
  "    █████▄     ▀▀█████▀▀███ ███        ███████▀▀▀▀▀▀▀▀▀▀",
  "  ▄██▀ ▀███▄  ▄▄▄▄▄▄▄▄▄▄██▀ ███        ███ ███▄▄▄  ▄▄▄▄",
  "▄███▀    ▀███ ▀█████████▀   ███        ██▀  ▀▀████████▀",
];

const BRAND_RGB = [255, 79, 79];
const GRADIENT_STOPS = [
  [198, 34, 44],
  [255, 79, 79],
  [255, 143, 92],
];
const HIGHLIGHT_RGB = [255, 205, 170];
const EMBER_RGB = [46, 14, 16];

const MARGIN = 2;
const FRAME_MS = 22;
const REVEAL_MS = 460;
const RULE_DELAY = 90;
const SHIMMER_DELAY = 330;
const SHIMMER_MS = 320;
const TAGLINE_DELAY = 400;
const TYPE_MS = 13;
const FEATHER = 4;
const GHOST_LEAD = 5;
const ROW_SKEW = 4.2;
const SHIMMER_WIDTH = 8;
const SHIMMER_STRENGTH = 0.7;
const IDLE_STRENGTH = 0.3;
const IDLE_SWEEP_MS = 1100;
const IDLE_GAP_MS = 6000;
const IDLE_FRAME_MS = 70;

const ESC = "\u001B[";
const SAVE_CURSOR = "\u001B7";
const RESTORE_CURSOR = "\u001B8";

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const now = () => Number(process.hrtime.bigint() / 1000000n);

let pinnedActive = false;
let exitHookInstalled = false;
let cursorHidden = false;
let animating = false;
let idleTimer = null;

const isInteractive = () =>
  process.stdout.isTTY === true &&
  !process.env.CI &&
  (process.env.TERM ?? "") !== "dumb";

const supportsTruecolor = () => {
  if (/truecolor|24bit/i.test(process.env.COLORTERM ?? "")) return true;
  const program = process.env.TERM_PROGRAM ?? "";
  if (/iTerm\.app|WezTerm|ghostty|vscode|Hyper|Tabby|WarpTerminal/i.test(program)) {
    return true;
  }
  return /kitty|alacritty|wezterm|ghostty|direct/i.test(process.env.TERM ?? "");
};

const colorMode = () => {
  if ("NO_COLOR" in process.env) return "none";
  if (/^(0|false|none)$/i.test(process.env.FORCE_COLOR ?? "")) return "none";
  return supportsTruecolor() ? "truecolor" : "256";
};

const bannerSetting = () => (process.env.XYNE_BANNER ?? "").toLowerCase();

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const easeOutCubic = (value) => 1 - (1 - value) ** 3;
const easeOutQuad = (value) => 1 - (1 - value) ** 2;
const easeInOutSine = (value) => 0.5 - Math.cos(Math.PI * clamp01(value)) / 2;

const mix = (from, to, amount) => [
  Math.round(from[0] + (to[0] - from[0]) * amount),
  Math.round(from[1] + (to[1] - from[1]) * amount),
  Math.round(from[2] + (to[2] - from[2]) * amount),
];

const gradientAt = (position) => {
  const scaled = clamp01(position) * (GRADIENT_STOPS.length - 1);
  const index = Math.min(GRADIENT_STOPS.length - 2, Math.floor(scaled));
  return mix(GRADIENT_STOPS[index], GRADIENT_STOPS[index + 1], scaled - index);
};

const rgbTo256 = ([red, green, blue]) => {
  const channel = (value) => Math.round((Math.min(255, Math.max(0, value)) / 255) * 5);
  return 16 + 36 * channel(red) + 6 * channel(green) + channel(blue);
};

const colorCache = new Map();

const quantize = (value) => Math.min(255, Math.round(value / 16) * 16);

const colorFor = (mode, [red, green, blue]) => {
  if (mode === "none") return "";
  const rgb = [quantize(red), quantize(green), quantize(blue)];
  const key = `${mode}:${rgb[0]},${rgb[1]},${rgb[2]}`;
  let cached = colorCache.get(key);
  if (cached === undefined) {
    cached =
      mode === "truecolor"
        ? `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
        : `${ESC}38;5;${rgbTo256(rgb)}m`;
    colorCache.set(key, cached);
  }
  return cached;
};

const reset = (mode) => (mode === "none" ? "" : `${ESC}0m`);
const dim = (mode) => (mode === "none" ? "" : `${ESC}2m`);

const hideCursor = (stream) => {
  if (cursorHidden) return;
  cursorHidden = true;
  stream.write(`${ESC}?25l`);
};

const showCursor = (stream) => {
  if (!cursorHidden) return;
  cursorHidden = false;
  stream.write(`${ESC}?25h`);
};

const write = (stream, text) =>
  new Promise((resolvePromise) => {
    if (stream.write(text)) resolvePromise();
    else stream.once("drain", resolvePromise);
  });

const WORDMARK_WIDTH = Math.max(...WORDMARK.map((line) => line.length));

const makeArt = (lines) => {
  const width = Math.max(...lines.map((line) => line.length));
  return {
    lines,
    width,
    maxThreshold: width - 1 + (lines.length - 1) * ROW_SKEW,
  };
};

const threshold = (column, row) => column + row * ROW_SKEW;

function renderLogoRows(art, mode, progress, shimmer, strength) {
  const span = art.maxThreshold + FEATHER + GHOST_LEAD;
  const front = easeOutQuad(progress) * span - GHOST_LEAD;
  const rows = [];

  for (let row = 0; row < art.lines.length; row += 1) {
    const line = art.lines[row];
    let output = " ".repeat(MARGIN);
    let activeColor = "";

    for (let column = 0; column < line.length; column += 1) {
      const character = line[column];
      const distance = front - threshold(column, row);
      if (character === " " || distance < -GHOST_LEAD) {
        output += " ";
        continue;
      }

      const tone = gradientAt(threshold(column, row) / art.maxThreshold);
      let rgb;
      if (distance < 0) {
        rgb = mix(EMBER_RGB, tone, clamp01(1 + distance / GHOST_LEAD) ** 2);
      } else {
        rgb = mix(tone, HIGHLIGHT_RGB, clamp01(1 - distance / FEATHER) * 0.55);
      }

      if (shimmer !== null && distance >= 0) {
        const band = 1 - Math.abs(threshold(column, row) - shimmer) / SHIMMER_WIDTH;
        if (band > 0) rgb = mix(rgb, HIGHLIGHT_RGB, band * band * strength);
      }

      const code = colorFor(mode, rgb);
      if (code !== activeColor) {
        output += code;
        activeColor = code;
      }
      output += character;
    }
    rows.push(output + reset(mode));
  }
  return rows;
}

function renderRule(art, mode, amount) {
  const width = Math.round(art.width * easeOutCubic(clamp01(amount)));
  let output = " ".repeat(MARGIN);
  let activeColor = "";
  for (let column = 0; column < width; column += 1) {
    const rgb = mix(EMBER_RGB, gradientAt(column / (art.width - 1)), 0.55);
    const code = colorFor(mode, rgb);
    if (code !== activeColor) {
      output += code;
      activeColor = code;
    }
    output += "─";
  }
  return output + reset(mode);
}

function renderTagline(mode, tagline, revealed) {
  const caret = revealed < tagline.length ? `${colorFor(mode, BRAND_RGB)}▌` : "";
  return `${" ".repeat(MARGIN)}${dim(mode)}${tagline.slice(0, revealed)}${reset(mode)}${caret}${reset(mode)}`;
}

function composeFrame(art, mode, tagline, elapsed) {
  const revealProgress = clamp01(elapsed / REVEAL_MS);
  const shimmerProgress = clamp01((elapsed - SHIMMER_DELAY) / SHIMMER_MS);
  const shimmer =
    shimmerProgress > 0 && shimmerProgress < 1
      ? -SHIMMER_WIDTH + shimmerProgress * (art.maxThreshold + SHIMMER_WIDTH * 2)
      : null;
  const typed = Math.max(0, Math.min(tagline.length, Math.floor((elapsed - TAGLINE_DELAY) / TYPE_MS)));

  return [
    ...renderLogoRows(art, mode, revealProgress, shimmer, SHIMMER_STRENGTH),
    renderRule(art, mode, (elapsed - RULE_DELAY) / (REVEAL_MS - RULE_DELAY)),
    typed > 0 ? renderTagline(mode, tagline, typed) : "",
  ];
}

const totalDuration = (tagline) =>
  Math.max(REVEAL_MS, SHIMMER_DELAY + SHIMMER_MS, TAGLINE_DELAY + tagline.length * TYPE_MS);

async function paint(stream, frame, previous, originRow, originColumn, keepCursor = false) {
  let output = "";
  for (let index = 0; index < frame.length; index += 1) {
    if (frame[index] === previous[index]) continue;
    output += `${ESC}${originRow + index};${originColumn}H`;
    output += originColumn === 1 ? `${ESC}2K${frame[index]}` : frame[index];
    previous[index] = frame[index];
  }
  if (!output) return;
  await write(stream, keepCursor ? `${SAVE_CURSOR}${output}${RESTORE_CURSOR}` : output);
}

function startIdleGlint(stream, art, mode, previous) {
  const cycle = IDLE_SWEEP_MS + IDLE_GAP_MS;
  const started = now();
  let painting = false;

  const schedule = (delay) => {
    idleTimer = setTimeout(tick, delay);
    idleTimer.unref?.();
  };

  const tick = async () => {
    idleTimer = null;
    if (!pinnedActive || painting) return;
    const phase = (now() - started) % cycle;
    if (phase >= IDLE_SWEEP_MS) {
      schedule(cycle - phase);
      return;
    }
    const position =
      -SHIMMER_WIDTH +
      easeInOutSine(phase / IDLE_SWEEP_MS) * (art.maxThreshold + SHIMMER_WIDTH * 2);
    painting = true;
    try {
      await paint(
        stream,
        renderLogoRows(art, mode, 1, position, IDLE_STRENGTH),
        previous,
        1,
        1,
        true,
      );
    } finally {
      painting = false;
    }
    if (pinnedActive) schedule(IDLE_FRAME_MS);
  };

  schedule(IDLE_GAP_MS);
}

export function releaseXyneBanner() {
  const stream = process.stdout;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  showCursor(stream);
  if (!pinnedActive || !isInteractive()) {
    pinnedActive = false;
    return;
  }
  pinnedActive = false;
  stream.write(`${ESC}r`);
  const rows = stream.rows ?? 24;
  stream.write(`${ESC}${rows};1H\n`);
}

export async function printXyneBanner(subtitle = "") {
  const stream = process.stdout;
  if (!isInteractive() || animating) return;
  if (/^(off|0|false)$/.test(bannerSetting())) return;

  const tagline = subtitle ? `S P A C E S  ·  ${subtitle}` : "S P A C E S";
  const mode = colorMode();
  const columns = stream.columns ?? 80;

  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on("exit", releaseXyneBanner);
  }

  stream.write(`${ESC}2J${ESC}H`);

  if (columns < WORDMARK_COMPACT[0].length + MARGIN * 2) {
    stream.write(
      `${colorFor(mode, BRAND_RGB)}${" ".repeat(MARGIN)}XYNE${reset(mode)} ${dim(mode)}${tagline}${reset(mode)}\n\n`,
    );
    return;
  }

  const wide = columns >= WORDMARK_WIDTH + MARGIN * 2;
  const art = makeArt(wide ? WORDMARK : WORDMARK_COMPACT);
  const headerLines = art.lines.length + 2;
  const previous = new Array(headerLines).fill(null);

  const bail = () => {
    showCursor(stream);
    stream.write(`${ESC}${headerLines + 1};1H\n`);
    process.exit(130);
  };

  const animationStart = now();
  animating = true;
  hideCursor(stream);
  process.once("SIGINT", bail);
  process.once("SIGTERM", bail);
  try {
    if (/^(plain|static)$/.test(bannerSetting())) {
      await paint(
        stream,
        composeFrame(art, mode, tagline, Number.MAX_SAFE_INTEGER),
        previous,
        1,
        1,
      );
    } else {
      const duration = totalDuration(tagline);
      for (;;) {
        const elapsed = now() - animationStart;
        await paint(
          stream,
          composeFrame(art, mode, tagline, Math.min(elapsed, duration)),
          previous,
          1,
          1,
        );
        if (elapsed >= duration) break;
        await sleep(FRAME_MS);
      }
    }
  } finally {
    process.off("SIGINT", bail);
    process.off("SIGTERM", bail);
    showCursor(stream);
    animating = false;
  }

  const rows = stream.rows ?? 0;
  const firstScrollRow = headerLines + 2;
  if (rows >= firstScrollRow + 8) {
    stream.write(`${ESC}${firstScrollRow};${rows}r`);
    stream.write(`${ESC}${firstScrollRow};1H`);
    pinnedActive = true;
    if (!/^(plain|static)$/.test(bannerSetting())) {
      startIdleGlint(stream, art, mode, previous);
    }
  } else {
    stream.write(`${ESC}${headerLines + 1};1H\n`);
  }
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  await printXyneBanner(process.argv[2] ?? "dev processes");
  releaseXyneBanner();
}
