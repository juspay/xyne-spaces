import { execFile } from 'child_process';
import { promisify } from 'util';
import log from 'electron-log/main';

const execFileAsync = promisify(execFile);

/**
 * Identity of the local process on the other end of a loopback TCP connection.
 *
 * The agent-auth server listens on 127.0.0.1 and, until now, had no way to tell
 * WHICH local process opened a given connection — so any process could POST an
 * auth request pretending to be a trusted agent (Payatu #1/#2/#3). We resolve
 * the peer from the OS TCP table (client ephemeral port -> PID -> exe path) so
 * the consent dialog can name the real requester and tokens can be bound to the
 * requesting executable path.
 */
export interface PeerProcess {
  pid: number;
  /** Absolute path to the peer's executable, or null when it could not be resolved. */
  execPath: string | null;
  /** macOS code-signing verdict for execPath: true=valid, false=unsigned/invalid, null=unknown. */
  signed: boolean | null;
}

const EXEC_TIMEOUT_MS = 2000;

/**
 * Resolve the local process that owns `remotePort` — the client end of a
 * loopback connection to our server. `selfPid` (our own pid) is excluded so we
 * never mistake the server side of the socket for the client.
 *
 * Returns null when the peer cannot be determined; callers MUST treat null as
 * "unverified" rather than "trusted". Caveats (documented, accepted): PID reuse
 * and a TOCTOU window between connect and lookup — path binding on top of this
 * mitigates the single-process spoof but not a fully compromised host.
 */
export async function resolvePeerProcess(
  remotePort: number | undefined,
  selfPid: number,
): Promise<PeerProcess | null> {
  if (!remotePort || !Number.isInteger(remotePort) || remotePort <= 0) {
    return null;
  }

  try {
    let pid: number | null = null;
    if (process.platform === 'darwin') {
      pid = await pidFromPortMac(remotePort, selfPid);
    } else if (process.platform === 'win32') {
      pid = await pidFromPortWin(remotePort);
    } else {
      pid = await pidFromPortLinux(remotePort);
    }

    if (pid === null || pid === selfPid) {
      return null;
    }

    const execPath = await execPathFromPid(pid);
    const signed = execPath && process.platform === 'darwin' ? await isSignedMac(execPath) : null;

    return { pid, execPath, signed };
  } catch (error) {
    log.warn('[PeerProcess] Failed to resolve peer process:', error);
    return null;
  }
}

/**
 * Human-readable label for a consent dialog / log line, e.g.
 * "/usr/local/bin/python3 (unsigned)" or "unknown process".
 */
export function describePeer(peer: PeerProcess | null): string {
  if (!peer || !peer.execPath) return 'unknown process';
  if (peer.signed === false) return `${peer.execPath} (unsigned)`;
  return peer.execPath;
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

// lsof -F field output groups by process: a `p<pid>` line followed by per-fd
// `n<name>` lines (name = "127.0.0.1:<local>-><remote>"). The client is the
// process whose LOCAL port equals remotePort.
async function pidFromPortMac(remotePort: number, selfPid: number): Promise<number | null> {
  const { stdout } = await execFileAsync(
    'lsof',
    ['-nP', `-iTCP:${remotePort}`, '-sTCP:ESTABLISHED', '-FpPn'],
    { timeout: EXEC_TIMEOUT_MS },
  );

  let currentPid: number | null = null;
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;
    const tag = line[0];
    const val = line.slice(1);
    if (tag === 'p') {
      currentPid = Number.parseInt(val, 10);
    } else if (tag === 'n' && currentPid !== null && currentPid !== selfPid) {
      const m = val.match(/:(\d+)->/); // local port precedes "->"
      if (m && Number.parseInt(m[1], 10) === remotePort) {
        return currentPid;
      }
    }
  }
  return null;
}

async function isSignedMac(execPath: string): Promise<boolean | null> {
  try {
    // Exit 0 = valid signature; non-zero throws => unsigned/invalid.
    await execFileAsync('codesign', ['--verify', '--strict', execPath], { timeout: EXEC_TIMEOUT_MS });
    return true;
  } catch (error: any) {
    // A real verification failure is a spawn exit code; a missing binary etc. is unknown.
    if (typeof error?.code === 'number') return false;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

// The client socket's LocalPort is remotePort; Get-NetTCPConnection yields its
// OwningProcess (PID).
async function pidFromPortWin(remotePort: number): Promise<number | null> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-NetTCPConnection -LocalPort ${remotePort} -State Established -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`,
    ],
    { timeout: EXEC_TIMEOUT_MS },
  );
  const pid = Number.parseInt(stdout.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

// `ss` prints "users:(("proc",pid=1234,fd=5))" for the socket whose source
// (local) port is remotePort.
async function pidFromPortLinux(remotePort: number): Promise<number | null> {
  const { stdout } = await execFileAsync(
    'ss',
    ['-tnpH', 'state', 'established', 'sport', '=', `:${remotePort}`],
    { timeout: EXEC_TIMEOUT_MS },
  );
  const m = stdout.match(/pid=(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}

// ---------------------------------------------------------------------------
// PID -> executable path
// ---------------------------------------------------------------------------

async function execPathFromPid(pid: number): Promise<string | null> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='], {
        timeout: EXEC_TIMEOUT_MS,
      });
      const p = stdout.trim();
      return p.length > 0 ? p : null;
    }
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`,
        ],
        { timeout: EXEC_TIMEOUT_MS },
      );
      const p = stdout.trim();
      return p.length > 0 ? p : null;
    }
    // Linux
    const { stdout } = await execFileAsync('readlink', ['-f', `/proc/${pid}/exe`], {
      timeout: EXEC_TIMEOUT_MS,
    });
    const p = stdout.trim();
    return p.length > 0 ? p : null;
  } catch (error) {
    log.warn(`[PeerProcess] Failed to resolve exe path for pid ${pid}:`, error);
    return null;
  }
}
