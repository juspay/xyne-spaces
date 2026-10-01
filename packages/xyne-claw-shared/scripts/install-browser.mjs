import { execFileSync } from 'node:child_process';

// The explicit Playwright CLI does not honor its npm-install skip flag.
// Nix supplies immutable browsers, so never ask the CLI to write into that store.
const skip = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
if (skip && skip !== '0' && skip !== 'false') {
  console.log('Using supplied Playwright browsers; skipping browser download.');
} else {
  execFileSync(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium'], {
    stdio: 'inherit',
  });
}
