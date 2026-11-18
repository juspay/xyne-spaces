// electron-builder beforePack hook: one extra step for Windows builds, compiling the transit key
// helper (native/transit-key/windows-key.c → transit-key.exe), whichever build command started
// the build. macOS helpers are still built by the build:mac scripts.
const { execFileSync } = require('child_process');
const path = require('path');

const HELPER_DIR = path.join(__dirname, '..', 'native', 'transit-key');

// mingw-w64 cross-compiles on macOS/Linux (brew install mingw-w64); on Windows, MSYS2/w64devkit
// gcc builds natively. One x64 binary serves the arm64 build too: Windows 11 on Arm runs x64.
const COMPILERS =
  process.platform === 'win32' ? ['x86_64-w64-mingw32-gcc', 'gcc'] : ['x86_64-w64-mingw32-gcc'];

function findCompiler() {
  for (const compiler of COMPILERS) {
    try {
      execFileSync(compiler, ['--version'], { stdio: 'ignore' });
      return compiler;
    } catch {
      // Not installed; try the next one.
    }
  }
  // Fail the build rather than ship an app that silently falls back to a memory key.
  throw new Error(
    'transit-key.exe needs a Windows C compiler: install mingw-w64 (macOS: brew install ' +
      'mingw-w64) or, on Windows, MSYS2/w64devkit gcc.'
  );
}

function buildWindowsTransitKey() {
  const compiler = findCompiler();
  execFileSync(
    compiler,
    [
      '-O2',
      '-s',
      '-Wall',
      '-Wextra',
      '-static-libgcc',
      '-o',
      path.join(HELPER_DIR, 'transit-key.exe'),
      path.join(HELPER_DIR, 'windows-key.c'),
      '-lncrypt',
      '-lcrypt32',
    ],
    { stdio: 'inherit' }
  );
}

exports.default = async function beforePack(context) {
  if (context.electronPlatformName === 'win32') buildWindowsTransitKey();
};
