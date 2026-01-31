/**
 * Test Release Server for OTA Update Development
 * 
 * Mimics the production release server structure at airborne.juspay.in
 * 
 * Usage:
 *   npm run test-release-server        # Start the server
 *   npm run test-release-server:publish # Publish new version from dashboard build
 * 
 * Endpoints:
 *   GET /                    - Release config JSON (same structure as production)
 *   GET /download/:filename  - Download UI bundle ZIP
 *   POST /publish            - Publish new version (for development)
 */

import express, { Request, Response } from 'express';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createWriteStream, readdirSync, rmSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import archiver from 'archiver';

const PORT = 3456;
const DATA_DIR = path.join(__dirname, '..', 'test-release-data');
const BUNDLES_DIR = path.join(DATA_DIR, 'bundles');
const CONFIG_PATH = path.join(DATA_DIR, 'release-config.json');

// Ensure directories exist
function ensureDirectories(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(BUNDLES_DIR)) {
    mkdirSync(BUNDLES_DIR, { recursive: true });
  }
}

// Calculate SHA256 checksum
function calculateChecksum(filePath: string): string {
  const fileBuffer = readFileSync(filePath);
  return createHash('sha256').update(fileBuffer).digest('hex');
}

// Generate a unique version ID
function generateVersionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// Create release config structure
interface ReleaseConfig {
  version: string;
  config: {
    boot_timeout: number;
    release_config_timeout: number;
    version: string;
    properties: Record<string, unknown>;
  };
  package: {
    name: string;
    version: string;
    index: {
      file_path: string;
      url: string;
      checksum: string;
    };
    properties: Record<string, unknown>;
    resources: unknown[];
  };
}

function createReleaseConfig(bundleFileName: string, checksum: string, version: string): ReleaseConfig {
  return {
    version: '1.0.0',
    config: {
      boot_timeout: 30000,
      release_config_timeout: 5000,
      version: generateVersionId(),
      properties: {},
    },
    package: {
      name: 'xyne-spaces-ui',
      version: version,
      index: {
        file_path: bundleFileName,
        url: `http://localhost:${PORT}/download/${bundleFileName}`,
        checksum: checksum,
      },
      properties: {
        publishedAt: new Date().toISOString(),
      },
      resources: [],
    },
  };
}

// Get current release config or null
function getCurrentConfig(): ReleaseConfig | null {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  return null;
}

// Save release config
function saveConfig(config: ReleaseConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Create ZIP from dashboard build
async function createBundleZip(sourcePath: string, version: string): Promise<{ fileName: string; checksum: string }> {
  const fileName = `ui-bundle-${version}.zip`;
  const zipPath = path.join(BUNDLES_DIR, fileName);
  
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      const checksum = calculateChecksum(zipPath);
      console.log(`✅ Bundle created: ${fileName} (${archive.pointer()} bytes)`);
      console.log(`   Checksum: ${checksum}`);
      resolve({ fileName, checksum });
    });
    
    archive.on('error', reject);
    archive.pipe(output);
    
    // Add all files from source directory
    archive.directory(sourcePath, false);
    archive.finalize();
  });
}

// Clean old bundles (keep last 5)
function cleanOldBundles(): void {
  const files = readdirSync(BUNDLES_DIR)
    .filter(f => f.endsWith('.zip'))
    .map(f => ({
      name: f,
      time: statSync(path.join(BUNDLES_DIR, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);
  
  // Remove all but last 5
  files.slice(5).forEach(f => {
    rmSync(path.join(BUNDLES_DIR, f.name));
    console.log(`🗑️  Removed old bundle: ${f.name}`);
  });
}

// Express app
const app = express();
app.use(express.json());

// CORS for electron app
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// GET / - Release config (same as production endpoint)
app.get('/', (_req: Request, res: Response) => {
  const config = getCurrentConfig();
  if (!config) {
    res.status(404).json({ error: 'No release published yet. Run: npm run test-release-server:publish' });
    return;
  }
  console.log(`📤 Serving release config: v${config.package.version}`);
  res.json(config);
});

// GET /download/:filename - Download bundle ZIP
app.get('/download/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = path.join(BUNDLES_DIR, filename);
  
  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'Bundle not found' });
    return;
  }
  
  const stats = statSync(filePath);
  console.log(`📥 Serving bundle: ${filename} (${stats.size} bytes)`);
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  
  createReadStream(filePath).pipe(res);
});

// GET /releases/dashboard.zip - Serve the latest bundle (matches devConfig.UI_ZIP_URL)
app.get('/releases/dashboard.zip', (_req: Request, res: Response) => {
  const config = getCurrentConfig();
  if (!config) {
    res.status(404).json({ error: 'No release published yet. Run: npm run test-release-server:publish' });
    return;
  }
  
  const filePath = path.join(BUNDLES_DIR, config.package.index.file_path);
  
  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'Bundle file not found' });
    return;
  }
  
  const stats = statSync(filePath);
  console.log(`📥 Serving latest bundle as dashboard.zip: ${config.package.index.file_path} (${stats.size} bytes)`);
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Content-Disposition', 'attachment; filename="dashboard.zip"');
  
  createReadStream(filePath).pipe(res);
});

// POST /publish - Publish new version from dashboard/dist
app.post('/publish', async (req: Request, res: Response) => {
  try {
    const { version } = req.body as { version?: string };
    const dashboardDistPath = path.join(__dirname, '..', '..', 'dashboard', 'dist');
    
    if (!existsSync(dashboardDistPath)) {
      res.status(400).json({ 
        error: 'Dashboard build not found. Run: cd dashboard && npm run build' 
      });
      return;
    }
    
    const indexPath = path.join(dashboardDistPath, 'index.html');
    if (!existsSync(indexPath)) {
      res.status(400).json({ error: 'Invalid dashboard build: index.html not found' });
      return;
    }
    
    // Generate version if not provided
    const newVersion = version || `1.0.${Date.now() % 10000}`;
    
    console.log(`\n🚀 Publishing new version: ${newVersion}`);
    console.log(`   Source: ${dashboardDistPath}`);
    
    // Create ZIP bundle
    const { fileName, checksum } = await createBundleZip(dashboardDistPath, newVersion);
    
    // Create and save release config
    const config = createReleaseConfig(fileName, checksum, newVersion);
    saveConfig(config);
    
    // Clean old bundles
    cleanOldBundles();
    
    console.log(`✅ Published successfully!\n`);
    
    res.json({
      success: true,
      version: newVersion,
      checksum,
      downloadUrl: config.package.index.url,
    });
  } catch (error) {
    console.error('❌ Publish failed:', error);
    res.status(500).json({ error: String(error) });
  }
});

// GET /status - Server status and current version
app.get('/status', (_req: Request, res: Response) => {
  const config = getCurrentConfig();
  const bundles = existsSync(BUNDLES_DIR) 
    ? readdirSync(BUNDLES_DIR).filter(f => f.endsWith('.zip'))
    : [];
  
  res.json({
    status: 'running',
    currentVersion: config?.package.version || null,
    bundleCount: bundles.length,
    bundles,
  });
});

// Start server or run CLI command
async function main(): Promise<void> {
  ensureDirectories();
  
  const args = process.argv.slice(2);
  
  if (args.includes('--publish') || args.includes('-p')) {
    // CLI publish mode
    const dashboardDistPath = path.join(__dirname, '..', '..', 'dashboard', 'dist');
    
    if (!existsSync(dashboardDistPath)) {
      console.error('❌ Dashboard build not found. Run: cd dashboard && npm run build');
      process.exit(1);
    }
    
    const versionArg = args.find(a => a.startsWith('--version='));
    const version = versionArg?.split('=')[1] || `1.0.${Date.now() % 10000}`;
    
    console.log(`\n🚀 Publishing new version: ${version}`);
    const { fileName, checksum } = await createBundleZip(dashboardDistPath, version);
    const config = createReleaseConfig(fileName, checksum, version);
    saveConfig(config);
    cleanOldBundles();
    
    console.log(`\n✅ Published! Test server URL: http://localhost:${PORT}`);
    console.log(`   Release config: http://localhost:${PORT}/`);
    console.log(`   Download: ${config.package.index.url}\n`);
    process.exit(0);
  }
  
  // Start server
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           🧪 Test Release Server for OTA Updates           ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Server running at: http://localhost:${PORT}                 ║
║                                                            ║
║  Endpoints:                                                ║
║    GET  /           - Release config JSON                  ║
║    GET  /download/* - Download bundle ZIP                  ║
║    POST /publish    - Publish new version                  ║
║    GET  /status     - Server status                        ║
║                                                            ║
║  Quick publish:                                            ║
║    curl -X POST http://localhost:${PORT}/publish             ║
║                                                            ║
║  Or use CLI:                                               ║
║    npm run test-release-server:publish                     ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
    
    const config = getCurrentConfig();
    if (config) {
      console.log(`📦 Current published version: ${config.package.version}`);
    } else {
      console.log('⚠️  No version published yet. Run: npm run test-release-server:publish');
    }
    console.log('');
  });
}

main().catch(console.error);
