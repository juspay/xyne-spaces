import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as net from 'net';
import * as tar from 'tar';
import { spawn, ChildProcess } from 'child_process';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import log from 'electron-log/main';
import { config } from '../app/config';
import { Logger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';

export interface CodeServerStatus {
    isRunning: boolean;
    isDownloading: boolean;
    port: number | null;
    url: string | null;
    pid: number | null;
    binaryInstalled: boolean;
    error: string | null;
}

interface StoredState {
    port: number | null;
    pid: number | null;
}

class CodeServerService {
    private process: ChildProcess | null = null;
    private currentPort: number | null = null;
    private isDownloading: boolean = false;
    private downloadProgress: number = 0;
    private lastError: string | null = null;
    private stateFilePath: string;
    private restartAttempts: number = 0;
    private maxRestartAttempts: number = 5;
    private restartBackoffMs: number = 1000;
    private activeSessions: Set<string> = new Set();

    constructor() {
        this.stateFilePath = path.join(this.getDataDir(), 'state.json');
    }

    /**
     * Get the user data directory for code-server
     */
    private getDataDir(): string {
        return path.join(app.getPath('userData'), config.codeServer.dataDir);
    }

    /**
     * Get the directory where the binary is stored
     */
    private getBinaryDir(): string {
        return path.join(app.getPath('userData'), config.codeServer.binaryDir);
    }

    /**
     * Get the path to the code-server executable
     */
    private getBinaryPath(): string {
        const binaryDir = this.getBinaryDir();
        const version = config.codeServer.version;
        const platform = process.platform;
        const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

        let folderName: string;
        let binaryName: string;

        if (platform === 'win32') {
            folderName = `code-server-${version}-windows-${arch}`;
            binaryName = 'code-server.exe';
        } else if (platform === 'darwin') {
            folderName = `code-server-${version}-macos-${arch}`;
            binaryName = 'code-server';
        } else {
            folderName = `code-server-${version}-linux-${arch}`;
            binaryName = 'code-server';
        }

        return path.join(binaryDir, folderName, 'bin', binaryName);
    }

    /**
     * Get the download URL for the appropriate platform binary
     */
    private getDownloadUrl(): string {
        const version = config.codeServer.version;
        const platform = process.platform;
        const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

        let fileName: string;

        if (platform === 'win32') {
            fileName = `code-server-${version}-windows-${arch}.zip`;
        } else if (platform === 'darwin') {
            fileName = `code-server-${version}-macos-${arch}.tar.gz`;
        } else {
            fileName = `code-server-${version}-linux-${arch}.tar.gz`;
        }

        return `https://github.com/coder/code-server/releases/download/v${version}/${fileName}`;
    }

    /**
     * Check if the binary is installed and executable
     */
    public isBinaryInstalled(): boolean {
        const binaryPath = this.getBinaryPath();
        try {
            fs.accessSync(binaryPath, fs.constants.X_OK);
            Logger.debug(ElectronEvent.CODE_SERVER_BINARY_CHECK, { installed: true, binaryPath }, 'CodeServer');
            return true;
        } catch {
            Logger.debug(ElectronEvent.CODE_SERVER_BINARY_CHECK, { installed: false, binaryPath }, 'CodeServer');
            return false;
        }
    }

    /**
     * Download and extract the code-server binary
     */
    public async downloadBinary(): Promise<void> {
        if (this.isDownloading) {
            throw new Error('Download already in progress');
        }

        this.isDownloading = true;
        this.downloadProgress = 0;
        this.lastError = null;

        const binaryDir = this.getBinaryDir();
        const downloadUrl = this.getDownloadUrl();
        const isZip = downloadUrl.endsWith('.zip');
        const tempFile = path.join(binaryDir, isZip ? 'temp.zip' : 'temp.tar.gz');

        Logger.info(ElectronEvent.CODE_SERVER_DOWNLOAD_START, { downloadUrl }, 'CodeServer');

        try {
            // Ensure binary directory exists
            fs.mkdirSync(binaryDir, { recursive: true });

            // Download the file
            await this.downloadFile(downloadUrl, tempFile);

            log.info('[CodeServer] Download complete, extracting...');

            // Extract based on file type
            if (isZip) {
                await this.extractZip(tempFile, binaryDir);
            } else {
                await this.extractTarGz(tempFile, binaryDir);
            }

            // Clean up temp file
            fs.unlinkSync(tempFile);

            // Ensure binary is executable (Unix only)
            if (process.platform !== 'win32') {
                const binaryPath = this.getBinaryPath();
                fs.chmodSync(binaryPath, 0o755);
            }

            Logger.info(ElectronEvent.CODE_SERVER_DOWNLOAD_COMPLETE, {}, 'CodeServer');
        } catch (error) {
            this.lastError = `Download failed: ${error instanceof Error ? error.message : String(error)}`;
            Logger.logError(ElectronEvent.CODE_SERVER_DOWNLOAD_FAILED, error, {}, 'CodeServer');
            throw error;
        } finally {
            this.isDownloading = false;
        }
    }

    /**
     * Download a file with redirect support
     */
    private downloadFile(url: string, dest: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);

            const request = (urlString: string) => {
                const protocol = urlString.startsWith('https') ? https : http;

                protocol.get(urlString, (response) => {
                    // Handle redirects
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        const redirectUrl = response.headers.location;
                        if (redirectUrl) {
                            log.info(`[CodeServer] Redirecting to: ${redirectUrl}`);
                            request(redirectUrl);
                            return;
                        }
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`Download failed with status: ${response.statusCode}`));
                        return;
                    }

                    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                    let downloadedSize = 0;

                    response.on('data', (chunk: Buffer) => {
                        downloadedSize += chunk.length;
                        if (totalSize > 0) {
                            this.downloadProgress = Math.round((downloadedSize / totalSize) * 100);
                        }
                    });

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }).on('error', (err) => {
                    fs.unlink(dest, () => { }); // Delete partial file
                    reject(err);
                });
            };

            request(url);
        });
    }

    /**
     * Extract a tar.gz file
     */
    private async extractTarGz(tarPath: string, destDir: string): Promise<void> {
        const readStream = fs.createReadStream(tarPath);
        const gunzip = createGunzip();
        const extract = tar.extract({ cwd: destDir });

        await pipeline(readStream, gunzip, extract);
    }

    /**
     * Extract a zip file (Windows)
     */
    private async extractZip(zipPath: string, destDir: string): Promise<void> {
        // Use built-in unzip on Windows via PowerShell
        return new Promise((resolve, reject) => {
            const unzip = spawn('powershell', [
                '-Command',
                `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`
            ]);

            unzip.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Unzip failed with code ${code}`));
                }
            });

            unzip.on('error', reject);
        });
    }

    /**
     * Check if a port is available
     */
    private isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();

            server.once('error', () => {
                resolve(false);
            });

            server.once('listening', () => {
                server.close();
                resolve(true);
            });

            server.listen(port);
        });
    }

    /**
     * Find an available port in the configured range
     */
    private async findAvailablePort(): Promise<number> {
        const { portRangeStart, portRangeEnd } = config.codeServer;

        for (let port = portRangeStart; port <= portRangeEnd; port++) {
            if (await this.isPortAvailable(port)) {
                Logger.info(ElectronEvent.CODE_SERVER_PORT_ALLOCATED, { port }, 'CodeServer');
                return port;
            }
        }

        Logger.error(ElectronEvent.CODE_SERVER_ERROR, { error: `No available ports in range ${portRangeStart}-${portRangeEnd}` }, 'CodeServer');
        throw new Error(`No available ports in range ${portRangeStart}-${portRangeEnd}`);
    }

    /**
     * Load stored state from file
     */
    private loadState(): StoredState {
        try {
            if (fs.existsSync(this.stateFilePath)) {
                const data = fs.readFileSync(this.stateFilePath, 'utf-8');
                return JSON.parse(data);
            }
        } catch (error) {
            log.warn('[CodeServer] Failed to load state:', error);
        }
        return { port: null, pid: null };
    }

    /**
     * Save state to file
     */
    private saveState(state: StoredState): void {
        try {
            const dir = path.dirname(this.stateFilePath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2));
        } catch (error) {
            log.warn('[CodeServer] Failed to save state:', error);
        }
    }

    /**
     * Check if a process with given PID is running
     */
    private isProcessRunning(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Start the code-server process
     */
    public async startCodeServer(): Promise<string> {
        this.lastError = null;

        // Check if already running
        if (this.process && this.currentPort) {
            const url = `http://127.0.0.1:${this.currentPort}`;
            log.info(`[CodeServer] Already running at ${url}`);
            return url;
        }

        // Check stored state for existing process
        const storedState = this.loadState();
        if (storedState.pid && storedState.port) {
            if (this.isProcessRunning(storedState.pid)) {
                this.currentPort = storedState.port;
                const url = `http://127.0.0.1:${storedState.port}`;
                log.info(`[CodeServer] Found existing process at ${url}`);
                return url;
            }
        }

        // Ensure binary is installed
        if (!this.isBinaryInstalled()) {
            log.info('[CodeServer] Binary not found, downloading...');
            await this.downloadBinary();
        }

        // Find available port
        let port: number;
        try {
            // Try stored port first
            if (storedState.port && await this.isPortAvailable(storedState.port)) {
                port = storedState.port;
            } else {
                port = await this.findAvailablePort();
            }
        } catch (error) {
            this.lastError = `Port allocation failed: ${error instanceof Error ? error.message : String(error)}`;
            throw new Error(this.lastError);
        }

        // Start the process
        const binaryPath = this.getBinaryPath();
        const dataDir = this.getDataDir();

        // Ensure data directory exists
        fs.mkdirSync(dataDir, { recursive: true });

        const args = [
            '--bind-addr', `127.0.0.1:${port}`,
            '--disable-workspace-trust',
        ];

        // Use local VS Code settings or isolated settings
        if (config.codeServer.useLocalSettings) {
            // Use system VS Code settings and extensions
            const homeDir = app.getPath('home');
            const platform = process.platform;

            // VS Code extensions directory
            const extensionsDir = path.join(homeDir, '.vscode', 'extensions');
            args.push('--extensions-dir', extensionsDir);

            // VS Code user data directory (varies by platform)
            let userDataDir: string;
            if (platform === 'darwin') {
                userDataDir = path.join(homeDir, 'Library', 'Application Support', 'Code');
            } else if (platform === 'win32') {
                userDataDir = path.join(app.getPath('appData'), 'Code');
            } else {
                userDataDir = path.join(homeDir, '.config', 'Code');
            }
            args.push('--user-data-dir', userDataDir);

            log.info(`[CodeServer] Using local VS Code settings from: ${userDataDir}`);
        } else {
            // Use isolated settings
            args.push('--user-data-dir', path.join(dataDir, 'user-data'));
            args.push('--extensions-dir', path.join(dataDir, 'extensions'));
        }

        // Add auth configuration
        if (config.codeServer.authType === 'none') {
            args.push('--auth', 'none');
        }

        log.info(`[CodeServer] Starting process: ${binaryPath} ${args.join(' ')}`);
        Logger.info(ElectronEvent.CODE_SERVER_PROCESS_SPAWN, { binaryPath, port, args: args.join(' ') }, 'CodeServer');

        this.process = spawn(binaryPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });

        this.currentPort = port;

        // Save state
        this.saveState({ port, pid: this.process.pid || null });

        // Handle process output
        this.process.stdout?.on('data', (data: Buffer) => {
            log.info(`[CodeServer] stdout: ${data.toString()}`);
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            log.warn(`[CodeServer] stderr: ${data.toString()}`);
        });

        // Handle process exit
        this.process.on('exit', (code, signal) => {
            Logger.info(ElectronEvent.CODE_SERVER_PROCESS_EXIT, { code, signal }, 'CodeServer');
            this.process = null;

            // Auto-restart logic with backoff
            if (code !== 0 && this.restartAttempts < this.maxRestartAttempts) {
                this.restartAttempts++;
                const backoff = this.restartBackoffMs * Math.pow(2, this.restartAttempts - 1);
                Logger.info(ElectronEvent.CODE_SERVER_RESTART, { attempt: this.restartAttempts, maxAttempts: this.maxRestartAttempts, backoffMs: backoff }, 'CodeServer');

                setTimeout(() => {
                    this.startCodeServer().catch((err) => {
                        Logger.logError(ElectronEvent.CODE_SERVER_ERROR, err, { context: 'restart_failed' }, 'CodeServer');
                    });
                }, backoff);
            }
        });

        this.process.on('error', (err) => {
            Logger.logError(ElectronEvent.CODE_SERVER_ERROR, err, {}, 'CodeServer');
            this.lastError = `Process error: ${err.message}`;
        });

        // Reset restart counter on successful start
        this.restartAttempts = 0;

        // Wait for server to be ready
        await this.waitForServerReady(port);

        const url = `http://127.0.0.1:${port}`;
        Logger.info(ElectronEvent.CODE_SERVER_READY, { url, port, pid: this.process?.pid }, 'CodeServer');
        log.info(`[CodeServer] Running at ${url}`);
        return url;
    }

    /**
     * Wait for the server to be ready to accept connections
     */
    private waitForServerReady(port: number, maxWait: number = 30000): Promise<void> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const check = () => {
                if (Date.now() - startTime > maxWait) {
                    reject(new Error('Server startup timeout'));
                    return;
                }

                const req = http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
                    if (res.statusCode === 200) {
                        resolve();
                    } else {
                        setTimeout(check, 500);
                    }
                });

                req.on('error', () => {
                    setTimeout(check, 500);
                });

                req.end();
            };

            setTimeout(check, 1000); // Initial delay before first check
        });
    }

    /**
     * Stop the code-server process
     */
    public async stopCodeServer(): Promise<void> {
        if (this.process) {
            Logger.info(ElectronEvent.CODE_SERVER_STOP, {}, 'CodeServer');

            // Try graceful shutdown first
            this.process.kill('SIGTERM');

            // Wait for process to exit
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    if (this.process) {
                        log.warn('[CodeServer] Force killing process...');
                        Logger.warn(ElectronEvent.CODE_SERVER_FORCE_KILL, { pid: this.process.pid }, 'CodeServer');
                        this.process.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);

                if (this.process) {
                    this.process.once('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                } else {
                    clearTimeout(timeout);
                    resolve();
                }
            });

            this.process = null;
            this.currentPort = null;
            this.saveState({ port: null, pid: null });

            Logger.info(ElectronEvent.CODE_SERVER_STOPPED, {}, 'CodeServer');
        }

        // Clear all active sessions
        this.clearActiveSessions();

        // Also check for orphaned processes from stored state
        const storedState = this.loadState();
        if (storedState.pid && this.isProcessRunning(storedState.pid)) {
            try {
                process.kill(storedState.pid, 'SIGTERM');
                log.info(`[CodeServer] Killed orphaned process ${storedState.pid}`);
            } catch (error) {
                log.warn('[CodeServer] Failed to kill orphaned process:', error);
            }
        }
    }

    /**
     * Restart the code-server process
     */
    public async restartCodeServer(): Promise<string> {
        await this.stopCodeServer();
        return await this.startCodeServer();
    }

    /**
     * Get the current server URL
     */
    public getServerUrl(): string | null {
        if (this.currentPort) {
            return `http://127.0.0.1:${this.currentPort}`;
        }
        
        const storedState = this.loadState();
        if (storedState.port && storedState.pid && this.isProcessRunning(storedState.pid)) {
            this.currentPort = storedState.port;
            return `http://127.0.0.1:${storedState.port}`;
        }
        
        return null;
    }

    /**
     * Get the current status
     */
    public getStatus(): CodeServerStatus {
        const storedState = this.loadState();
        const isRunning = this.process !== null ||
            (storedState.pid !== null && this.isProcessRunning(storedState.pid));

        return {
            isRunning,
            isDownloading: this.isDownloading,
            port: this.currentPort || storedState.port,
            url: this.getServerUrl(),
            pid: this.process?.pid || storedState.pid,
            binaryInstalled: this.isBinaryInstalled(),
            error: this.lastError,
        };
    }

    /**
     * Get download progress (0-100)
     */
    public getDownloadProgress(): number {
        return this.downloadProgress;
    }

    // ==================== Git Workspace Management ====================

    /**
     * Get the workspaces directory where git clones are stored
     */
    public getWorkspacesDir(): string {
        return path.join(app.getPath('userData'), 'workspaces');
    }

    /**
     * Get workspace path for a specific execution
     */
    public getWorkspacePath(executionId: string): string {
        return path.join(this.getWorkspacesDir(), `exec_${executionId}`);
    }

    /**
     * Check if workspace exists for an execution
     */
    public workspaceExists(executionId: string): boolean {
        const workspacePath = this.getWorkspacePath(executionId);
        return fs.existsSync(path.join(workspacePath, '.git'));
    }

    /**
     * Clone a branch to workspace directory or pull if already exists
     */
    public async cloneOrPullBranch(
        repoUrl: string,
        branch: string,
        commitHash: string | undefined,
        executionId: string
    ): Promise<{ success: boolean; workspacePath: string; error?: string }> {
        const workspacePath = this.getWorkspacePath(executionId);

        try {
            // Ensure workspaces directory exists
            fs.mkdirSync(this.getWorkspacesDir(), { recursive: true });

            if (this.workspaceExists(executionId)) {
                // Workspace exists, pull updates
                log.info(`[CodeServer] Workspace exists for ${executionId}, pulling updates...`);
                Logger.info(ElectronEvent.CODE_SERVER_GIT_PULL_START, { executionId, workspacePath, branch }, 'CodeServer');
                await this.gitPull(workspacePath, branch);
                Logger.info(ElectronEvent.CODE_SERVER_GIT_PULL_SUCCESS, { executionId, workspacePath, branch }, 'CodeServer');
            } else {
                // Clone the repository
                log.info(`[CodeServer] Cloning ${repoUrl} branch ${branch} for ${executionId}...`);
                Logger.info(ElectronEvent.CODE_SERVER_GIT_CLONE_START, { repoUrl, branch, executionId, workspacePath }, 'CodeServer');
                await this.gitClone(repoUrl, branch, workspacePath);
                Logger.info(ElectronEvent.CODE_SERVER_GIT_CLONE_SUCCESS, { repoUrl, branch, executionId, workspacePath }, 'CodeServer');
            }

            if (commitHash && !branch) {
                log.info(`[CodeServer] Checking out commit ${commitHash} (no branch provided)...`);
                await this.gitCheckout(workspacePath, commitHash);
            } else if (branch) {
                log.info(`[CodeServer] Staying on branch: ${branch}`);
            }

            log.info(`[CodeServer] Workspace ready at ${workspacePath}`);
            // Track active session
            this.activeSessions.add(workspacePath);
            Logger.info(ElectronEvent.CODE_SERVER_SESSION_REGISTER, { workspacePath, totalSessions: this.activeSessions.size }, 'CodeServer');
            log.info(`[CodeServer] Registered session: ${workspacePath}. Total: ${this.activeSessions.size}`);
            return { success: true, workspacePath };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            Logger.logError(ElectronEvent.CODE_SERVER_GIT_CLONE_FAILED, error, { repoUrl, branch, executionId, workspacePath }, 'CodeServer');
            log.error(`[CodeServer] Git operation failed: ${errorMessage}`);
            return { success: false, workspacePath, error: errorMessage };
        }
    }

    /**
     * Clone a git repository
     */
    private gitClone(repoUrl: string, branch: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const args = ['clone', '--branch', branch, '--single-branch', '--depth', '50', repoUrl, destPath];
            log.info(`[CodeServer] Running: git ${args.join(' ')}`);

            const gitProcess = spawn('git', args, {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderr = '';

            gitProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
                log.info(`[CodeServer] git clone: ${data.toString().trim()}`);
            });

            gitProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`git clone failed with code ${code}: ${stderr}`));
                }
            });

            gitProcess.on('error', (err) => {
                reject(new Error(`Failed to spawn git: ${err.message}`));
            });
        });
    }

    /**
     * Pull latest changes in a git repository
     */
    private gitPull(repoPath: string, branch: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // First fetch, then reset to origin/branch to handle force pushes
            const fetchArgs = ['fetch', 'origin', branch];
            log.info(`[CodeServer] Running: git ${fetchArgs.join(' ')} in ${repoPath}`);

            const fetchProcess = spawn('git', fetchArgs, {
                cwd: repoPath,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderr = '';

            fetchProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            fetchProcess.on('close', (fetchCode) => {
                if (fetchCode !== 0) {
                    reject(new Error(`git fetch failed with code ${fetchCode}: ${stderr}`));
                    return;
                }

                // Reset to origin/branch
                const resetArgs = ['reset', '--hard', `origin/${branch}`];
                log.info(`[CodeServer] Running: git ${resetArgs.join(' ')} in ${repoPath}`);

                const resetProcess = spawn('git', resetArgs, {
                    cwd: repoPath,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                let resetStderr = '';

                resetProcess.stderr?.on('data', (data: Buffer) => {
                    resetStderr += data.toString();
                });

                resetProcess.on('close', (resetCode) => {
                    if (resetCode === 0) {
                        resolve();
                    } else {
                        reject(new Error(`git reset failed with code ${resetCode}: ${resetStderr}`));
                    }
                });

                resetProcess.on('error', (err) => {
                    reject(new Error(`Failed to spawn git reset: ${err.message}`));
                });
            });

            fetchProcess.on('error', (err) => {
                reject(new Error(`Failed to spawn git fetch: ${err.message}`));
            });
        });
    }

    /**
     * Checkout a specific commit
     */
    private gitCheckout(repoPath: string, commitHash: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const args = ['checkout', commitHash];
            log.info(`[CodeServer] Running: git ${args.join(' ')} in ${repoPath}`);

            const gitProcess = spawn('git', args, {
                cwd: repoPath,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderr = '';

            gitProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            gitProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`git checkout failed with code ${code}: ${stderr}`));
                }
            });

            gitProcess.on('error', (err) => {
                reject(new Error(`Failed to spawn git checkout: ${err.message}`));
            });
        });
    }

    /**
     * Get the URL to open code-server with a specific folder
     */
    public getUrlWithFolder(folderPath: string): string | null {
        const baseUrl = this.getServerUrl();
        if (!baseUrl) return null;

        // code-server uses query param to open a folder
        return `${baseUrl}/?folder=${encodeURIComponent(folderPath)}`;
    }

    /**
     * Delete a workspace
     */
    public async deleteWorkspace(executionId: string): Promise<void> {
        const workspacePath = this.getWorkspacePath(executionId);
        if (fs.existsSync(workspacePath)) {
            log.info(`[CodeServer] Deleting workspace: ${workspacePath}`);
            Logger.info(ElectronEvent.CODE_SERVER_WORKSPACE_DELETE, { executionId, workspacePath }, 'CodeServer');
            fs.rmSync(workspacePath, { recursive: true, force: true });
        }
    }

    /**
     * List all workspaces
     */
    public listWorkspaces(): string[] {
        const workspacesDir = this.getWorkspacesDir();
        if (!fs.existsSync(workspacesDir)) return [];

        return fs.readdirSync(workspacesDir)
            .filter(name => name.startsWith('exec_'))
            .map(name => name.replace('exec_', ''));
    }

    /**
     * Clean old workspaces (keep only last N)
     */
    public async cleanOldWorkspaces(keepCount: number = 10): Promise<void> {
        const workspacesDir = this.getWorkspacesDir();
        if (!fs.existsSync(workspacesDir)) return;

        const workspaces = fs.readdirSync(workspacesDir)
            .filter(name => name.startsWith('exec_'))
            .map(name => ({
                name,
                path: path.join(workspacesDir, name),
                mtime: fs.statSync(path.join(workspacesDir, name)).mtime,
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        // Delete workspaces beyond keepCount
        for (let i = keepCount; i < workspaces.length; i++) {
            log.info(`[CodeServer] Cleaning old workspace: ${workspaces[i].name}`);
            Logger.info(ElectronEvent.CODE_SERVER_WORKSPACE_CLEAN, { workspaceName: workspaces[i].name, workspacePath: workspaces[i].path }, 'CodeServer');
            fs.rmSync(workspaces[i].path, { recursive: true, force: true });
        }
    }

    // ==================== Xyne-Spaces Folder Management ====================

    /**
     * Get the xyne-spaces directory where all repos are stored
     */
    public getXyneSpacesDir(): string {
        return path.join(app.getPath('userData'), config.codeServer.xyneSpacesDir);
    }

    /**
     * Get the path for a specific repo in xyne-spaces folder
     */
    public getRepoPath(repoName: string): string {
        return path.join(this.getXyneSpacesDir(), repoName);
    }

    /**
     * Check if a repo exists in xyne-spaces folder
     */
    public repoExists(repoName: string): boolean {
        const repoPath = this.getRepoPath(repoName);
        return fs.existsSync(path.join(repoPath, '.git'));
    }

    /**
     * Extract repo name from URL
     */
    public extractRepoNameFromUrl(repoUrl: string): string {
        // Handle both SSH and HTTPS URLs
        // ssh://git@github.com/example-org/xyne-spaces.git
        // https://bitbucket.example.com/scm/xyne/xyne-spaces.git
        const match = repoUrl.match(/\/([^/]+?)(?:\.git)?$/);
        return match ? match[1] : 'repo';
    }

    /**
     * List all repos in xyne-spaces folder
     */
    public listRepos(): string[] {
        const xyneSpacesDir = this.getXyneSpacesDir();
        if (!fs.existsSync(xyneSpacesDir)) return [];

        return fs.readdirSync(xyneSpacesDir)
            .filter(name => {
                const repoPath = path.join(xyneSpacesDir, name);
                return fs.statSync(repoPath).isDirectory() &&
                    fs.existsSync(path.join(repoPath, '.git'));
            });
    }

    /**
     * Check if repo has uncommitted changes
     */
    public async getRepoStatus(repoPath: string): Promise<{
        hasUncommittedChanges: boolean;
        branch: string;
        error?: string;
    }> {
        return new Promise((resolve) => {
            // Check for uncommitted changes using git status
            const statusProcess = spawn('git', ['status', '--porcelain'], {
                cwd: repoPath,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            statusProcess.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            statusProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            statusProcess.on('close', (code) => {
                if (code !== 0) {
                    resolve({ hasUncommittedChanges: false, branch: '', error: stderr });
                    return;
                }

                // Get current branch
                const branchProcess = spawn('git', ['branch', '--show-current'], {
                    cwd: repoPath,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                let branchName = '';
                branchProcess.stdout?.on('data', (data: Buffer) => {
                    branchName += data.toString().trim();
                });

                branchProcess.on('close', () => {
                    resolve({
                        hasUncommittedChanges: stdout.trim().length > 0,
                        branch: branchName,
                    });
                });
            });
        });
    }

    /**
     * Stage all changes and stash them with a message
     */
    public async stashChanges(repoPath: string): Promise<{ success: boolean; hadChanges: boolean; error?: string }> {
        return new Promise((resolve) => {
            // First check if there are changes to stash
            const statusCheck = spawn('git', ['status', '--porcelain'], {
                cwd: repoPath,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let statusOutput = '';
            statusCheck.stdout?.on('data', (data: Buffer) => {
                statusOutput += data.toString();
            });

            statusCheck.on('close', (statusCode) => {
                if (statusCode !== 0 || statusOutput.trim().length === 0) {
                    // No changes to stash
                    Logger.debug(ElectronEvent.CODE_SERVER_GIT_STASH, { repoPath, hadChanges: false }, 'CodeServer');
                    resolve({ success: true, hadChanges: false });
                    return;
                }

                // Stage all changes first
                const addProcess = spawn('git', ['add', '-A'], {
                    cwd: repoPath,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                addProcess.on('close', (addCode) => {
                    if (addCode !== 0) {
                        resolve({ success: false, hadChanges: true, error: 'Failed to stage changes' });
                        return;
                    }

                    // Stash changes with message
                    const timestamp = new Date().toISOString();
                    const stashProcess = spawn('git', ['stash', 'push', '-m', `Xyne auto-stash: ${timestamp}`], {
                        cwd: repoPath,
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });

                    let stashStderr = '';
                    stashProcess.stderr?.on('data', (data: Buffer) => {
                        stashStderr += data.toString();
                    });

                    stashProcess.on('close', (stashCode) => {
                        if (stashCode === 0) {
                            log.info(`[CodeServer] Stashed changes in ${repoPath}`);
                            Logger.info(ElectronEvent.CODE_SERVER_GIT_STASH, { repoPath, hadChanges: true, success: true }, 'CodeServer');
                            resolve({ success: true, hadChanges: true });
                        } else {
                            Logger.error(ElectronEvent.CODE_SERVER_GIT_STASH, { repoPath, hadChanges: true, success: false, error: stashStderr }, 'CodeServer');
                            resolve({ success: false, hadChanges: true, error: stashStderr });
                        }
                    });
                });
            });
        });
    }

    /**
     * Checkout a branch, creating it from baseBranch if it doesn't exist.
     * Prioritizes remote branch since Edit implies the branch exists on remote.
     */
    public async checkoutBranch(
        repoPath: string,
        branchName: string,
        baseBranch?: string
    ): Promise<{ success: boolean; created: boolean; error?: string }> {
        return new Promise((resolve) => {
            Logger.info(ElectronEvent.CODE_SERVER_GIT_CHECKOUT_START, { repoPath, branchName, baseBranch }, 'CodeServer');
            log.info(`[CodeServer] Fetching all branches from origin...`);
            const fetchProcess = spawn('git', ['fetch', 'origin', '--prune'], {
                cwd: repoPath,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let fetchStderr = '';
            fetchProcess.stderr?.on('data', (data: Buffer) => {
                fetchStderr += data.toString();
            });

            fetchProcess.on('close', (fetchCode) => {
                if (fetchCode !== 0) {
                    log.warn(`[CodeServer] Fetch failed: ${fetchStderr.trim()} (might be offline)`);
                } else {
                    log.info(`[CodeServer] Successfully fetched from origin`);
                }

                // Try local branch first to preserve any local commits
                log.info(`[CodeServer] Trying to checkout local branch: ${branchName}`);
                const checkoutProcess = spawn('git', ['checkout', branchName], {
                    cwd: repoPath,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                let checkoutStderr = '';
                checkoutProcess.stderr?.on('data', (data: Buffer) => {
                    checkoutStderr += data.toString();
                });

                checkoutProcess.on('close', (checkoutCode) => {
                    if (checkoutCode === 0) {
                        log.info(`[CodeServer] Checked out existing local branch: ${branchName}`);
                        Logger.info(ElectronEvent.CODE_SERVER_GIT_CHECKOUT_SUCCESS, { repoPath, branchName, source: 'local' }, 'CodeServer');
                        resolve({ success: true, created: false });
                        return;
                    }

                    log.info(`[CodeServer] Local branch not found: ${checkoutStderr.trim()}, trying remote`);
                    
                    const remoteCheckoutProcess = spawn('git', ['checkout', '-b', branchName, `origin/${branchName}`], {
                        cwd: repoPath,
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });

                    let remoteStderr = '';
                    remoteCheckoutProcess.stderr?.on('data', (data: Buffer) => {
                        remoteStderr += data.toString();
                    });

                    remoteCheckoutProcess.on('close', (remoteCode) => {
                        if (remoteCode === 0) {
                            log.info(`[CodeServer] Checked out branch from remote: ${branchName}`);
                            Logger.info(ElectronEvent.CODE_SERVER_GIT_CHECKOUT_SUCCESS, { repoPath, branchName, source: 'remote' }, 'CodeServer');
                            resolve({ success: true, created: false });
                            return;
                        }

                        log.info(`[CodeServer] Remote checkout also failed: ${remoteStderr.trim()}`);

                        if (!baseBranch) {
                            Logger.error(ElectronEvent.CODE_SERVER_GIT_CHECKOUT_FAILED, { repoPath, branchName, error: 'No base branch provided' }, 'CodeServer');
                            resolve({ success: false, created: false, error: `Branch ${branchName} doesn't exist locally or on remote, and no base branch provided` });
                            return;
                        }

                        // First checkout base branch
                        log.info(`[CodeServer] Branch not found anywhere, checking out base branch: ${baseBranch}`);
                        const baseCheckoutProcess = spawn('git', ['checkout', baseBranch], {
                            cwd: repoPath,
                            stdio: ['ignore', 'pipe', 'pipe'],
                        });

                        let baseStderr = '';
                        baseCheckoutProcess.stderr?.on('data', (data: Buffer) => {
                            baseStderr += data.toString();
                        });

                        baseCheckoutProcess.on('close', (baseCode) => {
                            if (baseCode !== 0) {
                                resolve({ success: false, created: false, error: `Failed to checkout base branch: ${baseStderr}` });
                                return;
                            }

                            // Pull latest from base branch
                            log.info(`[CodeServer] Pulling latest from ${baseBranch}`);
                            const pullProcess = spawn('git', ['pull', 'origin', baseBranch], {
                                cwd: repoPath,
                                stdio: ['ignore', 'pipe', 'pipe'],
                            });

                            pullProcess.on('close', (pullCode) => {
                                // Create new branch (don't fail if pull fails - might be offline)
                                if (pullCode !== 0) {
                                    log.warn(`[CodeServer] Pull failed (might be offline), continuing with local state`);
                                }

                                log.info(`[CodeServer] Creating new branch: ${branchName}`);
                                const createProcess = spawn('git', ['checkout', '-b', branchName], {
                                    cwd: repoPath,
                                    stdio: ['ignore', 'pipe', 'pipe'],
                                });

                                let createStderr = '';
                                createProcess.stderr?.on('data', (data: Buffer) => {
                                    createStderr += data.toString();
                                });

                                createProcess.on('close', (createCode) => {
                                    if (createCode === 0) {
                                        log.info(`[CodeServer] Created and checked out branch: ${branchName}`);
                                        Logger.info(ElectronEvent.CODE_SERVER_GIT_BRANCH_CREATE, { repoPath, branchName, baseBranch }, 'CodeServer');
                                        resolve({ success: true, created: true });
                                    } else {
                                        Logger.error(ElectronEvent.CODE_SERVER_GIT_CHECKOUT_FAILED, { repoPath, branchName, error: createStderr }, 'CodeServer');
                                        resolve({ success: false, created: false, error: createStderr });
                                    }
                                });
                            });
                        });
                    });
                });
            });
        });
    }

    /**
     * Clone a repo to xyne-spaces folder if it doesn't exist
     */
    public async cloneRepoToXyneSpaces(repoUrl: string): Promise<{ success: boolean; repoPath: string; error?: string }> {
        const repoName = this.extractRepoNameFromUrl(repoUrl);
        const repoPath = this.getRepoPath(repoName);

        // Ensure xyne-spaces directory exists
        fs.mkdirSync(this.getXyneSpacesDir(), { recursive: true });

        if (this.repoExists(repoName)) {
            log.info(`[CodeServer] Repo already exists: ${repoPath}`);
            Logger.debug(ElectronEvent.CODE_SERVER_GIT_CLONE_START, { repoUrl, repoPath, alreadyExists: true }, 'CodeServer');
            return { success: true, repoPath };
        }

        Logger.info(ElectronEvent.CODE_SERVER_GIT_CLONE_START, { repoUrl, repoPath, repoName }, 'CodeServer');
        log.info(`[CodeServer] Cloning repo ${repoUrl} to ${repoPath}`);

        return new Promise((resolve) => {
            const cloneProcess = spawn('git', ['clone', repoUrl, repoPath], {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderr = '';
            cloneProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
                log.info(`[CodeServer] git clone: ${data.toString().trim()}`);
            });

            cloneProcess.on('close', (code) => {
                if (code === 0) {
                    log.info(`[CodeServer] Successfully cloned ${repoName}`);
                    Logger.info(ElectronEvent.CODE_SERVER_GIT_CLONE_SUCCESS, { repoUrl, repoPath, repoName }, 'CodeServer');
                    resolve({ success: true, repoPath });
                } else {
                    Logger.error(ElectronEvent.CODE_SERVER_GIT_CLONE_FAILED, { repoUrl, repoPath, repoName, error: stderr }, 'CodeServer');
                    resolve({ success: false, repoPath, error: stderr });
                }
            });

            cloneProcess.on('error', (err) => {
                Logger.logError(ElectronEvent.CODE_SERVER_GIT_CLONE_FAILED, err, { repoUrl, repoPath, repoName }, 'CodeServer');
                resolve({ success: false, repoPath, error: err.message });
            });
        });
    }

    /**
     * Full flow: Prepare workspace for a ticket
     * 1. Clone repo if not exists
     * 2. Stash any uncommitted changes  
     * 3. Checkout ticket branch (create from base if needed)
     */
    public async prepareWorkspaceForTicket(
        repoUrl: string,
        baseBranch: string,
        ticketBranchName: string
    ): Promise<{
        success: boolean;
        workspacePath: string;
        stashedChanges: boolean;
        error?: string;
    }> {
        Logger.info(ElectronEvent.CODE_SERVER_WORKSPACE_PREPARE_START, { repoUrl, baseBranch, ticketBranchName }, 'CodeServer');
        
        if (!repoUrl || repoUrl.trim() === '') {
            log.warn(`[CodeServer] Attempted to edit a local doc (no repo URL) - branch: ${ticketBranchName}`);
            Logger.warn(ElectronEvent.CODE_SERVER_WORKSPACE_PREPARE_FAILED, { ticketBranchName, error: 'No repo URL' }, 'CodeServer');
            return { 
                success: false, 
                workspacePath: '', 
                stashedChanges: false, 
                error: 'Local documents cannot be edited. They are not associated with a git repository.' 
            };
        }

        const repoName = this.extractRepoNameFromUrl(repoUrl);
        const repoPath = this.getRepoPath(repoName);

        log.info(`[CodeServer] Preparing workspace for ticket branch: ${ticketBranchName}`);

        // Step 1: Clone if not exists
        const cloneResult = await this.cloneRepoToXyneSpaces(repoUrl);
        if (!cloneResult.success) {
            return { success: false, workspacePath: repoPath, stashedChanges: false, error: cloneResult.error };
        }

        // Step 2: Check current branch
        const statusResult = await this.getRepoStatus(repoPath);
        if (statusResult.error) {
            return { success: false, workspacePath: repoPath, stashedChanges: false, error: statusResult.error };
        }

        const currentBranch = statusResult.branch;
        log.info(`[CodeServer] Current branch: ${currentBranch}, Target branch: ${ticketBranchName}`);

        // If already on the target branch, skip stashing and checkout to avoid losing changes
        if (currentBranch === ticketBranchName) {
            log.info(`[CodeServer] Already on target branch ${ticketBranchName}, skipping stash and checkout`);
            // Track active session
            this.activeSessions.add(repoPath);
            log.info(`[CodeServer] Registered session: ${repoPath}. Total: ${this.activeSessions.size}`);
            return {
                success: true,
                workspacePath: repoPath,
                stashedChanges: false
            };
        }

        // Step 3: Stash any uncommitted changes (only if switching branches)
        const stashResult = await this.stashChanges(repoPath);
        if (!stashResult.success) {
            return { success: false, workspacePath: repoPath, stashedChanges: false, error: stashResult.error };
        }

        // Step 4: Checkout ticket branch
        const checkoutResult = await this.checkoutBranch(repoPath, ticketBranchName, baseBranch);
        if (!checkoutResult.success) {
            Logger.error(ElectronEvent.CODE_SERVER_WORKSPACE_PREPARE_FAILED, { repoPath, ticketBranchName, error: checkoutResult.error }, 'CodeServer');
            return { success: false, workspacePath: repoPath, stashedChanges: stashResult.hadChanges, error: checkoutResult.error };
        }

        log.info(`[CodeServer] Workspace ready at ${repoPath} on branch ${ticketBranchName}`);
        // Track active session
        this.activeSessions.add(repoPath);
        Logger.info(ElectronEvent.CODE_SERVER_WORKSPACE_PREPARE_SUCCESS, { repoPath, ticketBranchName, stashedChanges: stashResult.hadChanges, totalSessions: this.activeSessions.size }, 'CodeServer');
        log.info(`[CodeServer] Registered session: ${repoPath}. Total: ${this.activeSessions.size}`);
        return {
            success: true,
            workspacePath: repoPath,
            stashedChanges: stashResult.hadChanges
        };
    }

    /**
     * Check if there are any active VS Code sessions
     */
    public hasActiveSessions(): boolean {
        return this.activeSessions.size > 0;
    }

    /**
     * Get the number of active sessions
     */
    public getActiveSessionCount(): number {
        return this.activeSessions.size;
    }

    /**
     * Clear all active sessions (used when stopping code-server)
     */
    public clearActiveSessions(): void {
        const count = this.activeSessions.size;
        this.activeSessions.clear();
        Logger.info(ElectronEvent.CODE_SERVER_SESSION_CLEAR, { clearedCount: count }, 'CodeServer');
        log.info(`[CodeServer] Cleared ${count} active sessions`);
    }
}

// Export singleton instance
export const codeServerService = new CodeServerService();


