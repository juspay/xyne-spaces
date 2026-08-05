const LOGO_LINES = [
  "██      ██   ██      ██   ██      ██   █████████",
  " ██    ██     ██    ██    ████    ██   ██       ",
  "  ██  ██       ██  ██     ██ ██   ██   ██       ",
  "    ██           ██       ██  ██  ██   ███████  ",
  "  ██  ██         ██       ██   ██ ██   ██       ",
  " ██    ██        ██       ██    ████   ██       ",
  "██      ██       ██       ██      ██   █████████",
];

const BRAND_RGB = [255, 79, 79];
const BRAND_FALLBACK_256 = 203;

const supportsTruecolor = () => {
  if (/truecolor|24bit/i.test(process.env.COLORTERM ?? "")) return true;
  const program = process.env.TERM_PROGRAM ?? "";
  if (/iTerm\.app|WezTerm|ghostty|vscode|Hyper|Tabby|WarpTerminal/i.test(program)) {
    return true;
  }
  return /kitty|alacritty|wezterm|ghostty|direct/i.test(process.env.TERM ?? "");
};

const brandColorSequence = () =>
  supportsTruecolor()
    ? `38;2;${BRAND_RGB.join(";")}`
    : `38;5;${BRAND_FALLBACK_256}`;

const ESC = "\u001B[";

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

let pinnedActive = false;
let exitHookInstalled = false;

const isInteractive = () => process.stdout.isTTY === true && !process.env.CI;

export function releaseXyneBanner() {
  if (!pinnedActive || !isInteractive()) {
    pinnedActive = false;
    return;
  }
  pinnedActive = false;
  process.stdout.write(`${ESC}r`);
  const rows = process.stdout.rows ?? 24;
  process.stdout.write(`${ESC}${rows};1H\n`);
}

export async function printXyneBanner(subtitle = "") {
  const stream = process.stdout;
  if (!isInteractive()) return;

  const tagline = subtitle ? `S P A C E S  ·  ${subtitle}` : "S P A C E S";
  const headerLines = LOGO_LINES.length + 2;

  stream.write(`${ESC}2J${ESC}H`);
  const color = brandColorSequence();
  for (const line of LOGO_LINES) {
    stream.write(`${ESC}${color}m  ${line}${ESC}0m\n`);
    await sleep(35);
  }
  stream.write(`\n${ESC}2m  ${tagline}${ESC}0m\n`);

  const rows = stream.rows ?? 0;
  const firstScrollRow = headerLines + 2;
  if (rows >= firstScrollRow + 8) {
    stream.write(`${ESC}${firstScrollRow};${rows}r`);
    stream.write(`${ESC}${firstScrollRow};1H`);
    pinnedActive = true;
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.on("exit", releaseXyneBanner);
    }
  } else {
    stream.write("\n");
  }
}
