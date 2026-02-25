import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app, session, net } from 'electron';
import log from 'electron-log/main';
import archiver from 'archiver';
import { getMainWindow } from '../window/manager';
import { Logger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';

const PORT_FILE_NAME = 'docs-publish-port';

interface PublishRequest {
    outputPath: string;
    projectPath?: string;
    repoName?: string;
    branchName?: string;
    /** Doc display title (e.g. file base name for markdown publish). When provided, used instead of _quarto.yml/dir name. */
    title?: string;
    /** Channel ID to publish to, or null for Personal/private docs */
    channelId: string | null;
    /** If true, replace existing doc without prompting. If false and doc exists in different channel, return conflict. */
    forceReplace?: boolean;
}

interface ExistingDocInfo {
    id: string;
    userRepo: string;
    channelId: string | null;
    title: string;
}

interface PublishServerStatus {
    isRunning: boolean;
    port: number | null;
}

const HEALTH_CHECK_INTERVAL_MS = 30000;

class DocsPublishService {
    private server: http.Server | null = null;
    private currentPort: number | null = null;
    private backendUrl: string = '';
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private isRestarting: boolean = false;

    /**
     * Get the fixed output directory for Quarto docs
     */
    getQuartoOutputDir(): string {
        return path.join(app.getPath('userData'), 'quarto-output');
    }

    private async getGitInfo(projectPath: string): Promise<{ repoName: string; branchName: string; remoteUrl: string } | null> {
        try {
            const { execSync } = require('child_process');
            
            let remoteUrl: string;
            try {
                remoteUrl = execSync('git remote get-url origin', { cwd: projectPath, encoding: 'utf-8' }).trim();
            } catch {
                log.warn('[DocsPublish] No git remote found');
                return null;
            }

            let repoName: string;
            
            let match = remoteUrl.match(/:([^/]+\/[^/.]+)(?:\.git)?$/);
            if (match) {
                repoName = match[1];
            } else {
                match = remoteUrl.match(/\/([^/]+\/[^/.]+?)(?:\.git)?$/);
                if (match) {
                    repoName = match[1];
                } else {
                    repoName = path.basename(projectPath);
                }
            }

            const branchName = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath, encoding: 'utf-8' }).trim();

            log.info(`[DocsPublish] Git info: repo=${repoName}, branch=${branchName}, remoteUrl=${remoteUrl}`);
            return { repoName, branchName, remoteUrl };
        } catch (error) {
            log.error('[DocsPublish] Failed to get git info:', error);
            return null;
        }
    }

    private async checkExistingDoc(userRepo: string): Promise<ExistingDocInfo | null> {
        if (!this.backendUrl) return null;

        try {
            const cookies = await session.defaultSession.cookies.get({ url: this.backendUrl });
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            const url = `${this.backendUrl}/api/docs/check/${userRepo}`;
            log.info(`[DocsPublish] Checking existing doc at: ${url}`);

            return new Promise((resolve) => {
                const request = net.request({ method: 'GET', url });
                request.setHeader('Cookie', cookieString);

                let responseData = '';
                request.on('response', (response) => {
                    response.on('data', (chunk) => { responseData += chunk.toString(); });
                    response.on('end', () => {
                        try {
                            const result = JSON.parse(responseData);
                            resolve(result.exists ? result.doc : null);
                        } catch {
                            resolve(null);
                        }
                    });
                });
                request.on('error', () => resolve(null));
                request.end();
            });
        } catch (error) {
            log.error('[DocsPublish] Failed to check existing doc:', error);
            return null;
        }
    }

    private async fetchChannels(): Promise<Array<{ id: string; name: string }>> {
        if (!this.backendUrl) {
            log.warn('[DocsPublish] No backend URL configured');
            return [];
        }

        try {
            const cookies = await session.defaultSession.cookies.get({ url: this.backendUrl });
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            const url = `${this.backendUrl}/api/channels/publish-targets`;
            log.info(`[DocsPublish] Fetching channels from ${url}`);

            return new Promise((resolve) => {
                const request = net.request({ method: 'GET', url });
                request.setHeader('Cookie', cookieString);

                let responseData = '';
                request.on('response', (response) => {
                    log.info(`[DocsPublish] Channels API response status: ${response.statusCode}`);
                    response.on('data', (chunk) => { responseData += chunk.toString(); });
                    response.on('end', () => {
                        try {
                            const result = JSON.parse(responseData);
                            const channels = result.channels || [];
                            log.info(`[DocsPublish] Parsed ${channels.length} channels from response`);
                            resolve(channels);
                        } catch (e) {
                            log.error('[DocsPublish] Failed to parse channels response:', responseData.substring(0, 200));
                            resolve([]);
                        }
                    });
                });
                request.on('error', (err) => {
                    log.error('[DocsPublish] Channels API request error:', err);
                    resolve([]);
                });
                request.end();
            });
        } catch (error) {
            log.error('[DocsPublish] Failed to fetch channels:', error);
            return [];
        }
    }

    /**
     * Set the backend URL
     */
    setBackendUrl(url: string): void {
        this.backendUrl = url;
    }

    /**
     * Clear the Quarto output directory
     */
    async clearOutputDir(): Promise<void> {
        const outputDir = this.getQuartoOutputDir();

        try {
            if (fs.existsSync(outputDir)) {
                // Remove all files and directories recursively
                fs.rmSync(outputDir, { recursive: true, force: true });
                Logger.info(ElectronEvent.DOCS_PUBLISH_CLEAR_OUTPUT_DIR, { outputDir }, 'DocsPublish');
                log.info(`[DocsPublish] Cleared output directory: ${outputDir}`);
            }
            // Recreate the directory
            fs.mkdirSync(outputDir, { recursive: true });
        } catch (error) {
            Logger.logError(ElectronEvent.DOCS_PUBLISH_CLEAR_OUTPUT_DIR, error, { outputDir }, 'DocsPublish');
            log.error('[DocsPublish] Failed to clear output directory:', error);
            throw error;
        }
    }

    /**
     * Create a zip file from the output directory
     */
    async createZip(outputPath: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];

            const archive = archiver('zip', {
                zlib: { level: 9 },
            });

            archive.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });

            archive.on('end', () => {
                resolve(Buffer.concat(chunks));
            });

            archive.on('error', (err) => {
                reject(err);
            });

            // Add all files from the output directory
            archive.directory(outputPath, false);
            archive.finalize();
        });
    }

    /**
     * Find the actual content directory containing HTML files
     * Quarto may output to a subdirectory like _book, _site, docs, etc.
     * 
     * IMPORTANT: If root has index.html, use root - it likely has sibling directories
     * (like site_libs/) that are needed for the HTML to render correctly.
     */
    private findActualContentDir(outputPath: string): string {
        // FIRST: Check if root has index.html - this is the main entry point
        // and indicates the root should be used (preserving site_libs/, styles.css, etc.)
        const rootIndexPath = path.join(outputPath, 'index.html');
        if (fs.existsSync(rootIndexPath)) {
            log.info(`[DocsPublish] Using root directory with index.html: ${outputPath}`);
            return outputPath;
        }

        // Common Quarto output subdirectories - only check if no index.html at root
        const quartoSubdirs = ['_book', '_site', 'docs', 'site', 'public', 'output'];

        // Check known Quarto subdirectories
        for (const subdir of quartoSubdirs) {
            const subdirPath = path.join(outputPath, subdir);
            if (fs.existsSync(subdirPath) && this.directoryHasHtmlFiles(subdirPath)) {
                log.info(`[DocsPublish] Found Quarto output in subdirectory: ${subdirPath}`);
                return subdirPath;
            }
        }

        // Check any other subdirectory for HTML files
        try {
            const entries = fs.readdirSync(outputPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const subdirPath = path.join(outputPath, entry.name);
                    if (this.directoryHasHtmlFiles(subdirPath)) {
                        log.info(`[DocsPublish] Found HTML files in subdirectory: ${subdirPath}`);
                        return subdirPath;
                    }
                }
            }
        } catch (error) {
            log.warn(`[DocsPublish] Error scanning directories: ${error}`);
        }

        // Last resort: use root if it has any HTML
        if (this.directoryHasHtmlFiles(outputPath)) {
            log.warn(`[DocsPublish] No index.html found, using root with other HTML: ${outputPath}`);
            return outputPath;
        }

        log.warn(`[DocsPublish] No HTML files found anywhere, using original path: ${outputPath}`);
        return outputPath;
    }

    /**
     * Check if a directory has HTML files
     */
    private directoryHasHtmlFiles(dirPath: string): boolean {
        try {
            const entries = fs.readdirSync(dirPath);
            return entries.some(entry => entry.endsWith('.html'));
        } catch {
            return false;
        }
    }

    /**
     * Find the main entry HTML file in a directory
     * Priority: index.html > any .html file
     */
    private findEntryFile(dirPath: string): string {
        try {
            const entries = fs.readdirSync(dirPath);

            // Priority order for entry files
            const entryFilePriority = ['index.html', 'main.html', 'home.html'];

            for (const entryFile of entryFilePriority) {
                if (entries.includes(entryFile)) {
                    return entryFile;
                }
            }

            // Find any HTML file
            const htmlFile = entries.find(entry => entry.endsWith('.html'));
            if (htmlFile) {
                log.info(`[DocsPublish] Using entry file: ${htmlFile}`);
                return htmlFile;
            }

            return 'index.html'; // Fallback
        } catch {
            return 'index.html';
        }
    }

    private getDocsTitle(projectDir: string): string {
        try {
            const quartoYml = path.join(projectDir, '_quarto.yml');
            const quartoYaml = path.join(projectDir, '_quarto.yaml');

            let configPath = null;
            if (fs.existsSync(quartoYml)) {
                configPath = quartoYml;
            } else if (fs.existsSync(quartoYaml)) {
                configPath = quartoYaml;
            }

            if (configPath) {
                const content = fs.readFileSync(configPath, 'utf-8');
                log.info(`[DocsPublish] Reading _quarto.yml from: ${configPath}`);
                
                const lines = content.split('\n');
                let inBookOrWebsite = false;
                
                for (const line of lines) {
                    if (/^(book|website)\s*:/.test(line)) {
                        inBookOrWebsite = true;
                        continue;
                    }
                    
                    if (inBookOrWebsite && /^[a-z]/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
                        inBookOrWebsite = false;
                    }
                    
                    if (inBookOrWebsite) {
                        const indentedTitleMatch = line.match(/^\s+title\s*:\s*["']?(.+?)["']?\s*$/);
                        if (indentedTitleMatch && indentedTitleMatch[1]) {
                            const title = indentedTitleMatch[1].trim();
                            log.info(`[DocsPublish] Found nested title: ${title}`);
                            return title;
                        }
                    }
                }
                
                for (const line of lines) {
                    const topLevelMatch = line.match(/^title\s*:\s*["']?(.+?)["']?\s*$/);
                    if (topLevelMatch && topLevelMatch[1]) {
                        const title = topLevelMatch[1].trim();
                        log.info(`[DocsPublish] Found top-level title: ${title}`);
                        return title;
                    }
                }
            } else {
                log.warn(`[DocsPublish] No _quarto.yml found in: ${projectDir}`);
            }

            log.info(`[DocsPublish] No title found, using directory name: ${path.basename(projectDir)}`);
            return path.basename(projectDir);
        } catch (error) {
            log.error(`[DocsPublish] Error reading _quarto.yml:`, error);
            return path.basename(projectDir);
        }
    }

    async uploadToBackend(
        zipBuffer: Buffer,
        title: string,
        entryFile: string,
        userRepo: string,
        branchName: string,
        repoUrl: string,
        channelId: string | null,
        docType: string = 'docs'
    ): Promise<{ success: boolean; docsUrl?: string; error?: string }> {
        if (!this.backendUrl) {
            Logger.warn(ElectronEvent.DOCS_PUBLISH_UPLOAD_FAILED, { error: 'Backend URL not configured' }, 'DocsPublish');
            return { success: false, error: 'Backend URL not configured' };
        }

        Logger.info(ElectronEvent.DOCS_PUBLISH_UPLOAD_START, { title, userRepo, branchName, channelId, docType, zipSize: zipBuffer.length }, 'DocsPublish');

        try {
            // Get cookies from Electron session
            const cookies = await session.defaultSession.cookies.get({ url: this.backendUrl });
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            if (!cookieString || cookies.length === 0) {
                Logger.warn(ElectronEvent.DOCS_PUBLISH_UPLOAD_FAILED, { error: 'Not authenticated' }, 'DocsPublish');
                return { success: false, error: 'Not authenticated - no session cookies found' };
            }

            log.info(`[DocsPublish] Found ${cookies.length} cookies for backend`);

            // Build multipart form data manually for net.request
            const boundary = `----FormBoundary${Date.now().toString(16)}`;
            const CRLF = '\r\n';
            
            // Build form body parts
            const parts: Buffer[] = [];
            
            // Add docs file part
            parts.push(Buffer.from(
                `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="docs"; filename="docs.zip"${CRLF}` +
                `Content-Type: application/zip${CRLF}${CRLF}`
            ));
            parts.push(zipBuffer);
            parts.push(Buffer.from(CRLF));
            
            // Combined repo/branch as userRepo
            parts.push(Buffer.from(
                `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="userRepo"${CRLF}${CRLF}` +
                `${userRepo}${CRLF}`
            ));

            // Add branchName for editing capability
            parts.push(Buffer.from(
                `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="branchName"${CRLF}${CRLF}` +
                `${branchName}${CRLF}`
            ));

            // Add repoUrl for editing capability
            if (repoUrl) {
                parts.push(Buffer.from(
                    `--${boundary}${CRLF}` +
                    `Content-Disposition: form-data; name="repoUrl"${CRLF}${CRLF}` +
                    `${repoUrl}${CRLF}`
                ));
            }

            if (channelId) {
                parts.push(Buffer.from(
                    `--${boundary}${CRLF}` +
                    `Content-Disposition: form-data; name="channelId"${CRLF}${CRLF}` +
                    `${channelId}${CRLF}`
                ));
            }
            
            // Add title part
            parts.push(Buffer.from(
                `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="title"${CRLF}${CRLF}` +
                `${title}${CRLF}`
            ));
            
            // Add entryFile part
            parts.push(Buffer.from(
                `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="entryFile"${CRLF}${CRLF}` +
                `${entryFile}${CRLF}`
            ));

            parts.push(Buffer.from(
                `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="docType"${CRLF}${CRLF}` +
                `${docType}${CRLF}`
            ));
            
            // Add closing boundary
            parts.push(Buffer.from(`--${boundary}--${CRLF}`));
            
            const formBody = Buffer.concat(parts);

            const url = `${this.backendUrl}/api/docs/publish`;

            return new Promise((resolve) => {
                log.info(`[DocsPublish] Uploading to: ${url} (userRepo: ${userRepo}, channel: ${channelId})`);
                log.info(`[DocsPublish] Form body size: ${formBody.length} bytes`);

                const request = net.request({
                    method: 'POST',
                    url: url,
                });

                request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
                request.setHeader('Cookie', cookieString);

                let responseData = '';

                request.on('response', (response) => {
                    log.info(`[DocsPublish] Response status: ${response.statusCode}`);
                    
                    response.on('data', (chunk) => {
                        responseData += chunk.toString();
                    });

                    response.on('end', () => {
                        try {
                            const jsonResponse = JSON.parse(responseData);
                            if (response.statusCode === 200 && jsonResponse.success) {
                                Logger.info(ElectronEvent.DOCS_PUBLISH_UPLOAD_SUCCESS, { docsUrl: jsonResponse.docsUrl, userRepo, title }, 'DocsPublish');
                                resolve({ success: true, docsUrl: jsonResponse.docsUrl });
                            } else {
                                Logger.warn(ElectronEvent.DOCS_PUBLISH_UPLOAD_FAILED, { statusCode: response.statusCode, error: jsonResponse.error, userRepo }, 'DocsPublish');
                                resolve({ success: false, error: jsonResponse.error || `Upload failed with status ${response.statusCode}` });
                            }
                        } catch {
                            Logger.error(ElectronEvent.DOCS_PUBLISH_UPLOAD_FAILED, { error: 'Invalid response from server', responseData: responseData.substring(0, 200) }, 'DocsPublish');
                            log.error('[DocsPublish] Failed to parse response:', responseData);
                            resolve({ success: false, error: 'Invalid response from server' });
                        }
                    });
                });

                request.on('error', (error) => {
                    Logger.logError(ElectronEvent.DOCS_PUBLISH_UPLOAD_FAILED, error, { userRepo, title }, 'DocsPublish');
                    log.error('[DocsPublish] Request error:', error);
                    resolve({ success: false, error: error.message });
                });

                request.write(formBody);
                request.end();
            });
        } catch (error) {
            Logger.logError(ElectronEvent.DOCS_PUBLISH_UPLOAD_FAILED, error, { userRepo, title }, 'DocsPublish');
            log.error('[DocsPublish] Upload failed:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Upload failed' };
        }
    }

    /**
     * Start the local HTTP server for receiving publish requests
     */
    async startServer(): Promise<number> {
        if (this.server && this.currentPort) {
            return this.currentPort;
        }

        // Try ports 8842-9852
        for (let port = 8842; port <= 9852; port++) {
            try {
                await this.tryStartOnPort(port);
                this.currentPort = port;
                log.info(`[DocsPublish] Server started on port ${port}`);
                
                await this.writePortFile(port);
                this.startHealthCheck();
                
                return port;
            } catch {
                continue;
            }
        }

        throw new Error('No available ports for docs publish server');
    }

    private startHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            try {
                if (!this.server || !this.server.listening) {
                    log.warn('[DocsPublish] Server not running, attempting restart...');
                    await this.restartServer();
                } else {
                    log.debug(`[DocsPublish] Health check OK - server listening on port ${this.currentPort}`);
                }
            } catch (error) {
                log.error('[DocsPublish] Health check error:', error);
            }
        }, HEALTH_CHECK_INTERVAL_MS);

        log.info('[DocsPublish] Health check started');
    }

    private stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            log.info('[DocsPublish] Health check stopped');
        }
    }

    private async restartServer(): Promise<void> {
        if (this.isRestarting) {
            log.debug('[DocsPublish] Restart already in progress, skipping...');
            return;
        }

        this.isRestarting = true;
        Logger.info(ElectronEvent.DOCS_PUBLISH_SERVER_RESTART, {}, 'DocsPublish');
        try {
            this.server = null;
            this.currentPort = null;
            await this.removePortFile();

            const port = await this.startServer();
            log.info(`[DocsPublish] Server restarted successfully on port ${port}`);
        } catch (error) {
            Logger.logError(ElectronEvent.DOCS_PUBLISH_SERVER_START_FAILED, error, { context: 'restart' }, 'DocsPublish');
            log.error('[DocsPublish] Failed to restart server:', error);
        } finally {
            this.isRestarting = false;
        }
    }

    private async writePortFile(port: number): Promise<void> {
        const portFilePath = path.join(app.getPath('userData'), PORT_FILE_NAME);
        const tempFilePath = `${portFilePath}.tmp`;
        
        try {
            await fs.promises.writeFile(tempFilePath, port.toString(), 'utf-8');
            
            await fs.promises.rename(tempFilePath, portFilePath);
            
            log.info(`[DocsPublish] Wrote port ${port} to ${portFilePath}`);
        } catch (error) {
            log.error('[DocsPublish] Failed to write port file:', error);
            try {
                await fs.promises.unlink(tempFilePath);
            } catch {
            }
        }
    }

    private async removePortFile(): Promise<void> {
        try {
            const portFilePath = path.join(app.getPath('userData'), PORT_FILE_NAME);
            await fs.promises.unlink(portFilePath);
            log.info('[DocsPublish] Removed port file');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                log.error('[DocsPublish] Failed to remove port file:', error);
            }
        }
    }

    /**
     * Try to start server on a specific port
     */
    private tryStartOnPort(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                log.info(`[DocsPublish] Received request: ${req.method} ${req.url}`);
                
                // Set CORS headers
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                // Parse URL for GET requests with query params
                const parsedUrl = new URL(req.url || '', `http://127.0.0.1:${port}`);
                const pathname = parsedUrl.pathname;
                log.info(`[DocsPublish] Parsed pathname: ${pathname}, query: ${parsedUrl.search}`);

                if (req.method === 'POST' && pathname === '/api/publish') {
                    await this.handlePublishRequest(req, res);
                } else if (req.method === 'POST' && pathname === '/api/open-ticket-thread') {
                    await this.handleOpenTicketThreadRequest(req, res);
                } else if (req.method === 'GET' && pathname === '/api/share-targets') {
                    await this.handleGetShareTargets(req, res, parsedUrl);
                } else if (req.method === 'POST' && pathname === '/api/share') {
                    await this.handleShareDoc(req, res);
                } else if (req.method === 'GET' && pathname.startsWith('/api/docs/check/')) {
                    await this.handleCheckExistingDoc(req, res, pathname);
                } else if (req.method === 'GET' && pathname === '/api/ping') {
                    res.writeHead(200, { 
                        'Content-Type': 'application/json',
                        'X-Content-Type-Options': 'nosniff'
                    });
                    res.end(JSON.stringify({ success: true, app: 'xyne-spaces-electron', timestamp: Date.now() }));
                } else {
                    log.warn(`[DocsPublish] Unknown request: ${req.method} ${pathname}`);
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Not found' }));
                }
            });

            server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    reject(new Error('Port in use'));
                } else {
                    reject(err);
                }
            });

            server.listen(port, '127.0.0.1', () => {
                this.server = server;
                resolve();
            });
        });
    }

    private async handlePublishRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const request: PublishRequest = JSON.parse(body);
                const { outputPath, projectPath } = request;

                if (!outputPath || !fs.existsSync(outputPath)) {
                    Logger.warn(ElectronEvent.DOCS_PUBLISH_REQUEST_RECEIVED, { error: 'Invalid output path', outputPath }, 'DocsPublish');
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Invalid output path' }));
                    return;
                }

                Logger.info(ElectronEvent.DOCS_PUBLISH_REQUEST_RECEIVED, { outputPath, projectPath: projectPath || 'not provided' }, 'DocsPublish');
                log.info(`[DocsPublish] Received publish request for: ${outputPath}`);
                log.info(`[DocsPublish] Project path: ${projectPath || 'not provided'}`);

                const gitInfoPath = projectPath || path.dirname(outputPath);
                let gitInfo = request.repoName && request.branchName 
                    ? { repoName: request.repoName, branchName: request.branchName, remoteUrl: '' }
                    : await this.getGitInfo(gitInfoPath);

                if (!gitInfo) {
                    const username = os.userInfo().username || 'local';
                    const normalizedPath = gitInfoPath.replace(/[\/\\]/g, '-').replace(/^-+|-+$/g, '');
                    gitInfo = {
                        repoName: username,
                        branchName: normalizedPath,
                        remoteUrl: '',
                    };
                    log.info(`[DocsPublish] No git repo found, using username/localpath: ${gitInfo.repoName}/${gitInfo.branchName}`);
                }

                const { repoName, branchName, remoteUrl } = gitInfo;
                // Combine repo and branch into userRepo format
                const userRepo = `${repoName}/${branchName}`;
                Logger.info(ElectronEvent.DOCS_PUBLISH_GIT_INFO, { userRepo, repoName, branchName, remoteUrl: remoteUrl || 'none' }, 'DocsPublish');
                log.info(`[DocsPublish] Git info: ${userRepo}`);

                const existingDoc = await this.checkExistingDoc(userRepo);
                if (existingDoc) {
                    Logger.info(ElectronEvent.DOCS_PUBLISH_EXISTING_DOC_CHECK, { userRepo, existingChannelId: existingDoc.channelId, existingTitle: existingDoc.title }, 'DocsPublish');
                    log.info(`[DocsPublish] Existing doc found in channel: ${existingDoc.channelId}`);
                    
                    if (!request.forceReplace && existingDoc.channelId !== request.channelId) {
                        Logger.info(ElectronEvent.DOCS_PUBLISH_CONFLICT, { userRepo, existingChannelId: existingDoc.channelId, requestedChannelId: request.channelId }, 'DocsPublish');
                        log.info('[DocsPublish] Returning conflict - doc exists in different channel');
                        res.writeHead(409);
                        res.end(JSON.stringify({
                            success: false,
                            error: 'conflict',
                            existingDoc: {
                                channelId: existingDoc.channelId,
                                title: existingDoc.title
                            }
                        }));
                        return;
                    }
                }

                const channelId: string | null = request.channelId;
                log.info(`[DocsPublish] Publishing to channel: ${channelId || 'Personal'}`);


                const actualContentDir = this.findActualContentDir(outputPath);
                log.info(`[DocsPublish] Actual content directory: ${actualContentDir}`);

                const entryFileName = this.findEntryFile(actualContentDir);
                let entryFile = entryFileName;
                if (actualContentDir !== outputPath) {
                    const relativePath = path.relative(outputPath, actualContentDir);
                    entryFile = path.join(relativePath, entryFileName).replace(/\\/g, '/');
                    log.info(`[DocsPublish] Entry file (with subdirectory): ${entryFile}`);
                } else {
                    log.info(`[DocsPublish] Entry file: ${entryFile}`);
                }

                // Use title from request (e.g. markdown file name) when provided; otherwise from _quarto.yml or dir name
                const title = request.title?.trim() || this.getDocsTitle(gitInfoPath);
                log.info(`[DocsPublish] Publishing docs: ${title}`);

                const docType = this.detectDocType(outputPath);
                log.info(`[DocsPublish] Detected doc type: ${docType}`);

                Logger.info(ElectronEvent.DOCS_PUBLISH_ZIP_CREATE_START, { outputPath, title, docType }, 'DocsPublish');
                log.info('[DocsPublish] Creating zip from root output directory...');
                const zipBuffer = await this.createZip(outputPath);
                Logger.info(ElectronEvent.DOCS_PUBLISH_ZIP_CREATE_COMPLETE, { zipSize: zipBuffer.length, title }, 'DocsPublish');
                log.info(`[DocsPublish] Created zip: ${zipBuffer.length} bytes`);

                log.info('[DocsPublish] Uploading to backend...');
                const result = await this.uploadToBackend(
                    zipBuffer,
                    title,
                    entryFile,
                    userRepo,
                    branchName,
                    remoteUrl,
                    channelId,
                    docType
                );

                if (result.success) {
                    log.info(`[DocsPublish] Docs published successfully: ${result.docsUrl}`);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, docsUrl: result.docsUrl }));
                } else {
                    log.error(`[DocsPublish] Publish failed: ${result.error}`);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: result.error }));
                }
            } catch (error) {
                log.error('[DocsPublish] Error handling publish request:', error);
                res.writeHead(500);
                res.end(JSON.stringify({
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                }));
            }
        });
    }

    private detectDocType(outputPath: string): string {
        if (fs.existsSync(path.join(outputPath, '_book'))) {
            return 'book';
        }
        const indexPath = path.join(outputPath, 'index.html');
        if (fs.existsSync(indexPath)) {
            try {
                const content = fs.readFileSync(indexPath, 'utf-8').slice(0, 5000);
                if (content.includes('revealjs') || content.includes('reveal.js')) {
                    return 'slides';
                }
            } catch { /* ignore */ }
        }
        if (fs.existsSync(path.join(outputPath, '_site'))) {
            return 'website';
        }
        return 'docs';
    }

    /**
     * Stop the server
     */
    async stopServer(): Promise<void> {
        this.stopHealthCheck();
        
        if (this.server) {
            await this.removePortFile();
            
            return new Promise((resolve) => {
                this.server?.close(() => {
                    this.server = null;
                    this.currentPort = null;
                    log.info('[DocsPublish] Server stopped');
                    resolve();
                });
            });
        }
    }

    /**
     * Handle open ticket thread request from VS Code extension
     */
    private async handleOpenTicketThreadRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const request = JSON.parse(body) as { ticketId?: string };
                const { ticketId } = request;

                if (!ticketId) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Missing ticketId' }));
                    return;
                }

                Logger.info(ElectronEvent.DOCS_PUBLISH_OPEN_TICKET_THREAD, { ticketId }, 'DocsPublish');
                log.info(`[DocsPublish] Opening ticket thread for: ${ticketId}`);

                // Send IPC message to the main window to open the thread
                const mainWindow = getMainWindow();
                if (mainWindow) {
                    mainWindow.webContents.send('navigate-to-ticket-thread', { ticketId });
                    
                    // Bring window to focus
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.focus();
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true }));
                } else {
                    log.warn('[DocsPublish] No main window available');
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'No main window available' }));
                }
            } catch (error) {
                log.error('[DocsPublish] Failed to parse open ticket thread request:', error);
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: 'Invalid request body' }));
            }
        });
    }

    private async handleGetShareTargets(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        parsedUrl: URL
    ): Promise<void> {
        if (!this.backendUrl) {
            Logger.warn(ElectronEvent.DOCS_PUBLISH_SHARE_TARGETS_REQUEST, { error: 'Backend URL not configured' }, 'DocsPublish');
            log.warn('[DocsPublish] Backend URL not configured for share-targets request');
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, targets: [], error: 'Backend URL not configured', code: 'BACKEND_NOT_CONFIGURED' }));
            return;
        }

        Logger.info(ElectronEvent.DOCS_PUBLISH_SHARE_TARGETS_REQUEST, { channelId: parsedUrl.searchParams.get('channelId') }, 'DocsPublish');

        try {
            const cookies = await session.defaultSession.cookies.get({ url: this.backendUrl });
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            const channelId = parsedUrl.searchParams.get('channelId');
            let url = `${this.backendUrl}/api/docs/share-targets`;
            if (channelId) {
                url += `?channelId=${encodeURIComponent(channelId)}`;
            }

            const request = net.request({ method: 'GET', url });
            request.setHeader('Cookie', cookieString);

            let responseData = '';
            request.on('response', (response) => {
                response.on('data', (chunk) => { responseData += chunk.toString(); });
                response.on('end', () => {
                    res.writeHead(response.statusCode || 200, { 'Content-Type': 'application/json' });
                    res.end(responseData);
                });
            });
            request.on('error', (err) => {
                log.error('[DocsPublish] Share targets request error:', err);
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, targets: [], error: err.message, code: 'BACKEND_ERROR' }));
            });
            request.end();
        } catch (error) {
            log.error('[DocsPublish] Failed to get share targets:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, targets: [], error: 'Failed to get share targets', code: 'INTERNAL_ERROR' }));
        }
    }

    private async handleShareDoc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            if (!this.backendUrl) {
                Logger.warn(ElectronEvent.DOCS_PUBLISH_SHARE_DOC_REQUEST, { error: 'Backend URL not configured' }, 'DocsPublish');
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: 'Backend URL not configured' }));
                return;
            }

            Logger.info(ElectronEvent.DOCS_PUBLISH_SHARE_DOC_REQUEST, {}, 'DocsPublish');

            try {
                const cookies = await session.defaultSession.cookies.get({ url: this.backendUrl });
                const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                const url = `${this.backendUrl}/api/docs/share`;

                const request = net.request({ method: 'POST', url });
                request.setHeader('Cookie', cookieString);
                request.setHeader('Content-Type', 'application/json');

                let responseData = '';
                request.on('response', (response) => {
                    response.on('data', (chunk) => { responseData += chunk.toString(); });
                    response.on('end', () => {
                        res.writeHead(response.statusCode || 200, { 'Content-Type': 'application/json' });
                        res.end(responseData);
                    });
                });
                request.on('error', (err) => {
                    log.error('[DocsPublish] Share doc request error:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: err.message }));
                });
                request.write(body);
                request.end();
            } catch (error) {
                log.error('[DocsPublish] Failed to share doc:', error);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: 'Failed to share doc' }));
            }
        });
    }

    private async handleCheckExistingDoc(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
        if (!this.backendUrl) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ exists: false, error: 'Backend URL not configured' }));
            return;
        }

        try {
            const userRepo = pathname.replace('/api/docs/check/', '');
            log.info(`[DocsPublish] Checking existing doc for: ${userRepo}`);

            const cookies = await session.defaultSession.cookies.get({ url: this.backendUrl });
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            const url = `${this.backendUrl}/api/docs/check/${userRepo}`;

            const request = net.request({ method: 'GET', url });
            request.setHeader('Cookie', cookieString);

            let responseData = '';
            request.on('response', (response) => {
                response.on('data', (chunk) => { responseData += chunk.toString(); });
                response.on('end', () => {
                    log.info(`[DocsPublish] Check existing doc response: ${responseData.substring(0, 200)}`);
                    res.writeHead(response.statusCode || 200, { 'Content-Type': 'application/json' });
                    res.end(responseData);
                });
            });
            request.on('error', (err) => {
                log.error('[DocsPublish] Check existing doc request error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ exists: false, error: err.message }));
            });
            request.end();
        } catch (error) {
            log.error('[DocsPublish] Failed to check existing doc:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ exists: false, error: 'Failed to check existing doc' }));
        }
    }

    getPort(): number | null {
        return this.currentPort;
    }

    getStatus(): PublishServerStatus {
        return {
            isRunning: this.server !== null,
            port: this.currentPort,
        };
    }
}

export const docsPublishService = new DocsPublishService();
