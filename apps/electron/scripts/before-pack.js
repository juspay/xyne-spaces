// electron-builder beforePack hook: builds the transit key helper for the platform and architecture
// being packed, whichever build command started the build, then checks the binary is there and is
// for that architecture. A build without it, or with one for another machine, would ship an app
// whose transit key silently drops to a lesser tier, so any problem fails the build.
//
// macOS: native/transit-key/secure-enclave.swift → transit-key (universal: the mac targets are
// universal, and electron-builder packs the x64 and arm64 halves separately before merging them).
// Windows: native/transit-key/windows-key.c → transit-key.exe, native for each architecture: x64
// emulation is slower, and Windows 10 on Arm cannot run x64 at all.
//
// Each platform's build config lists only its own helper, so a leftover binary for the other
// platform from a local build is never packed.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Arch } = require('electron-builder');

const HELPER_DIR = path.join(__dirname, '..', 'native', 'transit-key');
const MAC_HELPER = path.join(HELPER_DIR, 'transit-key');
const WINDOWS_HELPER = path.join(HELPER_DIR, 'transit-key.exe');

/** The universal helper must hold both slices. */
const MAC_ARCHS = ['x86_64', 'arm64'];

/** PE machine types (IMAGE_FILE_MACHINE_*). */
const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64 };

/**
 * Compilers for each Windows architecture. mingw-w64 cross-compiles x64 on macOS/Linux (brew
 * install mingw-w64); llvm-mingw cross-compiles arm64 (and x64). On Windows, MSYS2/w64devkit gcc
 * builds natively for the machine's own architecture.
 */
function windowsCompilers(arch) {
  const native = process.platform === 'win32' && process.arch === arch ? ['gcc', 'clang'] : [];
  if (arch === 'x64') return ['x86_64-w64-mingw32-gcc', 'x86_64-w64-mingw32-clang', ...native];
  if (arch === 'arm64') return ['aarch64-w64-mingw32-clang', 'aarch64-w64-mingw32-gcc', ...native];
  throw new Error(`transit-key.exe: no build for Windows ${arch}`);
}

const COMPILER_HELP = {
  x64:
    'install mingw-w64 (macOS: brew install mingw-w64) or llvm-mingw; on Windows x64, ' +
    'MSYS2/w64devkit gcc.',
  arm64:
    'install llvm-mingw (https://github.com/mstorsjo/llvm-mingw), which provides ' +
    'aarch64-w64-mingw32-clang; on Windows on Arm, MSYS2 clangarm64.',
};

function findCompiler(arch) {
  for (const compiler of windowsCompilers(arch)) {
    try {
      execFileSync(compiler, ['--version'], { stdio: 'ignore' });
      return compiler;
    } catch {
      // Not installed; try the next one.
    }
  }
  throw new Error(`transit-key.exe for Windows ${arch} needs a C compiler: ${COMPILER_HELP[arch]}`);
}

function buildWindowsTransitKey(arch) {
  const compiler = findCompiler(arch);
  // libgcc is linked statically where the compiler is GNU's; llvm-mingw's clang uses compiler-rt,
  // which it links statically already.
  const runtime = /gcc$/.test(compiler) && arch === 'x64' ? ['-static-libgcc'] : [];
  fs.rmSync(WINDOWS_HELPER, { force: true });
  execFileSync(
    compiler,
    [
      '-O2',
      '-s',
      '-Wall',
      '-Wextra',
      ...runtime,
      '-o',
      WINDOWS_HELPER,
      path.join(HELPER_DIR, 'windows-key.c'),
      '-lncrypt',
      '-lcrypt32',
    ],
    { stdio: 'inherit' }
  );
}

// The universal app's halves are packed one after the other; the helper is built once per build.
let macHelperBuilt = false;

function buildMacTransitKey() {
  if (macHelperBuilt) return;
  if (process.platform !== 'darwin') {
    throw new Error(
      'transit-key (Secure Enclave) builds only on macOS: package the mac app on a Mac.'
    );
  }
  fs.rmSync(MAC_HELPER, { force: true });
  execFileSync('bash', [path.join(HELPER_DIR, 'build.sh')], { stdio: 'inherit' });
  macHelperBuilt = true;
}

function assertMacHelper() {
  if (!fs.existsSync(MAC_HELPER)) throw new Error(`transit-key was not built: ${MAC_HELPER}`);
  let archs;
  try {
    archs = execFileSync('lipo', ['-archs', MAC_HELPER], { encoding: 'utf8', stdio: 'pipe' })
      .trim()
      .split(/\s+/);
  } catch {
    throw new Error(`transit-key is not a macOS binary: ${MAC_HELPER}`);
  }
  const missing = MAC_ARCHS.filter((arch) => !archs.includes(arch));
  if (missing.length > 0) {
    throw new Error(`transit-key lacks ${missing.join(', ')} (has ${archs.join(', ')})`);
  }
}

/** The machine type in a PE file's COFF header, or null when it is not a PE file. */
function peMachine(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 0x40 || bytes.toString('latin1', 0, 2) !== 'MZ') return null;
  const header = bytes.readUInt32LE(0x3c);
  if (bytes.length < header + 6 || bytes.toString('latin1', header, header + 4) !== 'PE\0\0') {
    return null;
  }
  return bytes.readUInt16LE(header + 4);
}

function assertWindowsHelper(arch) {
  if (!fs.existsSync(WINDOWS_HELPER)) {
    throw new Error(`transit-key.exe was not built: ${WINDOWS_HELPER}`);
  }
  const machine = peMachine(WINDOWS_HELPER);
  if (machine !== PE_MACHINE[arch]) {
    const found = machine === null ? 'not a PE file' : `machine 0x${machine.toString(16)}`;
    throw new Error(`transit-key.exe is not a Windows ${arch} binary (${found})`);
  }
}

exports.default = async function beforePack(context) {
  const arch = Arch[context.arch];
  if (context.electronPlatformName === 'darwin') {
    buildMacTransitKey();
    assertMacHelper();
  } else if (context.electronPlatformName === 'win32') {
    buildWindowsTransitKey(arch);
    assertWindowsHelper(arch);
  }
};
