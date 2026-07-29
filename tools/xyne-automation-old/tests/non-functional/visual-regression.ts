import fs from 'fs';
import path from 'path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { closeLogger, createLogger } from '@/lib/logger';

const logger = createLogger('VisualRegression');

const BASELINE_DIR = path.join(process.cwd(), 'data', 'visual-regression-assets');
const REPORT_ROOT_DIR = path.join(process.cwd(), 'report');

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'missing' | 'new';
  diffPixels?: number;
  message?: string;
}

const getLatestReportDir = (): string | null => {
  if (!fs.existsSync(REPORT_ROOT_DIR)) return null;

  const dirs = fs
    .readdirSync(REPORT_ROOT_DIR)
    .filter((f) => fs.statSync(path.join(REPORT_ROOT_DIR, f)).isDirectory())
    .sort()
    .reverse();

  return dirs.length > 0 ? path.join(REPORT_ROOT_DIR, dirs[0]) : null;
};

const extractTestName = (filename: string): string | null => {
  const match = filename.match(/^visual_regression_(.+?)_(passed|failed)(?:_\d+)?\.png$/);
  return match ? match[1] : null;
};

const ensureDir = (dir: string): void => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Minimal 5x7 bitmap font for specific characters
const FONT: Record<string, number[]> = {
  // Uppercase
  A: [0x70, 0x88, 0xf8, 0x88, 0x88],
  B: [0xf0, 0x88, 0xf0, 0x88, 0xf0],
  C: [0x70, 0x88, 0x80, 0x88, 0x70],
  D: [0xf0, 0x88, 0x88, 0x88, 0xf0],
  E: [0xf8, 0x80, 0xf0, 0x80, 0xf8],
  F: [0xf8, 0x80, 0xf0, 0x80, 0x80],
  G: [0x70, 0x88, 0x80, 0x98, 0x78],
  H: [0x88, 0x88, 0xf8, 0x88, 0x88],
  I: [0x70, 0x20, 0x20, 0x20, 0x70],
  J: [0x08, 0x08, 0x08, 0x88, 0x70],
  K: [0x88, 0x90, 0xe0, 0x90, 0x88],
  L: [0x80, 0x80, 0x80, 0x80, 0xf8],
  M: [0x88, 0xd8, 0xa8, 0x88, 0x88],
  N: [0x88, 0xc8, 0xa8, 0x98, 0x88],
  O: [0x70, 0x88, 0x88, 0x88, 0x70],
  P: [0xf0, 0x88, 0xf0, 0x80, 0x80],
  Q: [0x70, 0x88, 0x88, 0xa8, 0x70],
  R: [0xf0, 0x88, 0xf0, 0x90, 0x88],
  S: [0x70, 0x80, 0x70, 0x08, 0x70],
  T: [0xf8, 0x20, 0x20, 0x20, 0x20],
  U: [0x88, 0x88, 0x88, 0x88, 0x70],
  V: [0x88, 0x88, 0x88, 0x50, 0x20],
  W: [0x88, 0x88, 0xa8, 0xd8, 0x88],
  X: [0x88, 0x50, 0x20, 0x50, 0x88],
  Y: [0x88, 0x88, 0x50, 0x20, 0x20],
  Z: [0xf8, 0x10, 0x20, 0x40, 0xf8],

  // Lowercase
  a: [0x00, 0x70, 0x88, 0x88, 0x78],
  b: [0x80, 0x80, 0xb0, 0xc8, 0x88],
  c: [0x00, 0x70, 0x80, 0x80, 0x70],
  d: [0x08, 0x08, 0x68, 0x98, 0x68],
  e: [0x00, 0x70, 0xf8, 0x80, 0x70],
  f: [0x30, 0x40, 0xe0, 0x40, 0x40],
  g: [0x00, 0x78, 0x88, 0x78, 0x08, 0x70],
  h: [0x80, 0x80, 0xb0, 0xc8, 0x88],
  i: [0x20, 0x00, 0x60, 0x20, 0x70],
  j: [0x08, 0x00, 0x08, 0x08, 0x08, 0x70],
  k: [0x80, 0x80, 0x90, 0xe0, 0x90],
  l: [0x60, 0x20, 0x20, 0x20, 0x70],
  m: [0x00, 0xd0, 0xa8, 0xa8, 0xa8],
  n: [0x00, 0xb0, 0xc8, 0x88, 0x88],
  o: [0x00, 0x70, 0x88, 0x88, 0x70],
  p: [0x00, 0xb0, 0xc8, 0x80, 0x80],
  q: [0x00, 0x68, 0x98, 0x08, 0x08],
  r: [0x00, 0xb0, 0xc0, 0x80, 0x80],
  s: [0x00, 0x70, 0x80, 0x10, 0xe0],
  t: [0x40, 0xe0, 0x40, 0x40, 0x30],
  u: [0x00, 0x88, 0x88, 0x88, 0x70],
  v: [0x00, 0x88, 0x88, 0x50, 0x20],
  w: [0x00, 0x88, 0xa8, 0xa8, 0x50],
  x: [0x00, 0x88, 0x50, 0x50, 0x88],
  y: [0x00, 0x88, 0x88, 0x78, 0x08, 0x70],
  z: [0x00, 0xf8, 0x10, 0x20, 0xf8],

  // Extra
  '-': [0x00, 0x00, 0x70, 0x00, 0x00],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '.': [0x00, 0x00, 0x00, 0x60, 0x60],
  ':': [0x00, 0x60, 0x00, 0x60, 0x00],
  '(': [0x20, 0x40, 0x40, 0x40, 0x20],
  ')': [0x40, 0x20, 0x20, 0x20, 0x40],
};

const drawText = (png: PNG, text: string, x: number, y: number, color = [255, 0, 0], scale = 2) => {
  let cursorX = x;

  for (const char of text) {
    const bitmap = FONT[char] || FONT[' ']; // Default to space if char unknown
    if (bitmap) {
      for (let r = 0; r < bitmap.length; r++) {
        const row = bitmap[r];
        for (let c = 0; c < 8; c++) {
          if ((row >> (7 - c)) & 1) {
            // Draw scaled pixel
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                const px = cursorX + c * scale + dx;
                const py = y + r * scale + dy;
                if (px < png.width && py < png.height) {
                  const idx = (png.width * py + px) << 2;
                  png.data[idx] = color[0];
                  png.data[idx + 1] = color[1];
                  png.data[idx + 2] = color[2];
                  png.data[idx + 3] = 255;
                }
              }
            }
          }
        }
      }
      cursorX += 6 * scale; // Advance cursor
    } else {
      cursorX += 4 * scale; // Space for unknown chars
    }
  }
};

const createCombinedImage = (
  width: number,
  height: number,
  baseline?: PNG,
  actual?: PNG,
  diff?: PNG
): PNG => {
  const combined = new PNG({ width: width * 2, height: height * 2 });

  // 1st quarter: Top Left - Original (Baseline)
  if (baseline) {
    const baselinePng = new PNG({ width, height });
    baselinePng.data = baseline.data;
    baselinePng.bitblt(combined, 0, 0, width, height, 0, 0);
    drawText(combined, 'Original', 10, 10, [255, 0, 0], 4);
  }

  // 2nd quarter: Top Right - Diff
  if (diff) {
    diff.bitblt(combined, 0, 0, width, height, width, 0);
    drawText(combined, 'Diff', width + 10, 10, [255, 0, 0], 4);
  }

  // 3rd quarter: Bottom Left - Actual
  if (actual) {
    const actualPng = new PNG({ width, height });
    actualPng.data = actual.data;
    actualPng.bitblt(combined, 0, 0, width, height, 0, height);
    drawText(combined, 'Actual', 10, height + 10, [255, 0, 0], 4);
  }

  // 4th quarter: Bottom Right - Legend with white background
  const legendX = width + 20;
  const legendY = height + 20;
  const legendScale = 3;
  const lineHeight = 10 * legendScale + 10;

  // Draw white background for legend area
  for (let y = height; y < height * 2; y++) {
    for (let x = width; x < width * 2; x++) {
      const idx = (combined.width * y + x) << 2;
      combined.data[idx] = 255; // R
      combined.data[idx + 1] = 255; // G
      combined.data[idx + 2] = 255; // B
      combined.data[idx + 3] = 255; // A
    }
  }

  // Section 1: Image Variations
  drawText(combined, 'Image Variations:', legendX, legendY, [0, 0, 0], legendScale);

  drawText(combined, 'Original', legendX, legendY + lineHeight * 1.1, [255, 0, 0], legendScale);
  drawText(
    combined,
    '  - Current Deployment Screenshot',
    legendX,
    legendY + lineHeight * 1.7,
    [0, 0, 0],
    legendScale
  );

  drawText(combined, 'Actual', legendX, legendY + lineHeight * 2.6, [255, 0, 0], legendScale);
  drawText(
    combined,
    '  - Current branch screenshot',
    legendX,
    legendY + lineHeight * 3.2,
    [0, 0, 0],
    legendScale
  );

  drawText(combined, 'Diff', legendX, legendY + lineHeight * 4.1, [255, 0, 0], legendScale);
  drawText(
    combined,
    '  - Pixel Difference',
    legendX,
    legendY + lineHeight * 4.7,
    [0, 0, 0],
    legendScale
  );

  // Section 2: Color Variations (with extra spacing)
  drawText(
    combined,
    'Color Variations (In Diff):',
    legendX,
    legendY + lineHeight * 6.8,
    [0, 0, 0],
    legendScale
  );

  drawText(combined, 'Orange', legendX, legendY + lineHeight * 7.9, [255, 165, 0], legendScale);
  drawText(
    combined,
    '  - Missing elements',
    legendX,
    legendY + lineHeight * 8.5,
    [0, 0, 0],
    legendScale
  );
  drawText(
    combined,
    '  - Lighter pixels',
    legendX,
    legendY + lineHeight * 9.1,
    [0, 0, 0],
    legendScale
  );

  drawText(combined, 'Blue', legendX, legendY + lineHeight * 10.0, [0, 0, 255], legendScale);
  drawText(
    combined,
    '  - New elements',
    legendX,
    legendY + lineHeight * 10.6,
    [0, 0, 0],
    legendScale
  );
  drawText(
    combined,
    '  - Darker pixels',
    legendX,
    legendY + lineHeight * 11.2,
    [0, 0, 0],
    legendScale
  );

  return combined;
};

const compareImages = (baselinePath: string, currentPath: string, diffPath: string): number => {
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const current = PNG.sync.read(fs.readFileSync(currentPath));

  const { width, height } = baseline;

  if (current.width !== width || current.height !== height) {
    throw new Error(
      `Image dimensions mismatch: baseline ${width}x${height} vs current ${current.width}x${current.height}`
    );
  }

  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
    threshold: 0.1,
  });

  if (numDiffPixels > 0) {
    // Color-code changes: Orange (removed), Blue (added)
    for (let i = 0; i < diff.data.length; i += 4) {
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) {
        const baselineBrightness =
          baseline.data[i] * 0.299 + baseline.data[i + 1] * 0.587 + baseline.data[i + 2] * 0.114;
        const currentBrightness =
          current.data[i] * 0.299 + current.data[i + 1] * 0.587 + current.data[i + 2] * 0.114;

        if (baselineBrightness > currentBrightness) {
          diff.data[i] = 0;
          diff.data[i + 1] = 0;
          diff.data[i + 2] = 255;
        } else if (currentBrightness > baselineBrightness) {
          diff.data[i] = 255;
          diff.data[i + 1] = 165;
          diff.data[i + 2] = 0;
        }
      }
    }

    const combined = createCombinedImage(width, height, baseline, current, diff);
    fs.writeFileSync(diffPath, PNG.sync.write(combined));
  }

  return numDiffPixels;
};

const printSummary = (results: TestResult[], baselineCount: number, currentCount: number): void => {
  const passed = results.filter((r) => r.status === 'passed');
  const failed = results.filter((r) => r.status === 'failed');
  const missing = results.filter((r) => r.status === 'missing');
  const newTests = results.filter((r) => r.status === 'new');
  const processable = baselineCount;

  logger.info('');
  logger.info('='.repeat(80));
  logger.info('VISUAL REGRESSION TEST SUMMARY');
  logger.info('='.repeat(80));
  logger.info('');
  logger.info('Dataset Summary:');
  logger.info(`  Screenshots found in assets        : ${baselineCount}`);
  logger.info(`  Screenshots taken during test      : ${currentCount}`);
  logger.info(`  Images not found in test           : ${missing.length}`);
  logger.info(`  Images found extra in test         : ${newTests.length}`);
  logger.info('');
  logger.info('Test Summary:');
  logger.info(`  Processable                        : ${processable}`);
  logger.info(`  Passed                             : ${passed.length}`);
  logger.info(`  Failed                             : ${failed.length}`);
  logger.info('='.repeat(80));

  if (failed.length > 0) {
    logger.info('');
    logger.info('FAILED TESTS (Visual Differences):');
    failed.forEach((r) => {
      logger.error(`  ✗ ${r.name} - ${r.diffPixels} pixels different`);
    });
  }

  if (missing.length > 0) {
    logger.info('');
    logger.info('MISSING IN TEST (Expected but not found):');
    missing.forEach((r) => {
      logger.error(`  ⚠ ${r.name}`);
    });
  }

  if (newTests.length > 0) {
    logger.info('');
    logger.info('EXTRA IN TEST (No baseline exists):');
    newTests.forEach((r) => {
      logger.error(`  + ${r.name}`);
    });
  }

  logger.info('='.repeat(80));
};

const main = async (): Promise<void> => {
  logger.info('Starting Visual Regression Test...');
  logger.info('');

  if (!fs.existsSync(BASELINE_DIR)) {
    logger.error(`Baseline directory not found: ${BASELINE_DIR}`);
    await closeLogger();
    process.exit(1);
  }

  const latestReportDir = getLatestReportDir();
  if (!latestReportDir) {
    logger.error('No report directory found in: ' + REPORT_ROOT_DIR);
    await closeLogger();
    process.exit(1);
  }

  logger.info(`Baseline Directory: ${BASELINE_DIR}`);
  logger.info(`Latest Report: ${latestReportDir}`);
  logger.info('');

  const screenshotsDir = path.join(latestReportDir, 'visual-regression-screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    logger.error(`Screenshots directory not found: ${screenshotsDir}`);
    await closeLogger();
    process.exit(1);
  }

  const failureDir = path.join(latestReportDir, 'visual-regression-failures');
  if (fs.existsSync(failureDir)) {
    fs.rmSync(failureDir, { recursive: true, force: true });
  }
  ensureDir(failureDir);

  const baselineFiles = fs
    .readdirSync(BASELINE_DIR)
    .filter((f) => f.endsWith('.png') && extractTestName(f) !== null);

  const currentFiles = fs
    .readdirSync(screenshotsDir)
    .filter((f) => f.endsWith('.png') && extractTestName(f) !== null);

  logger.info(`Found ${baselineFiles.length} baseline images`);
  logger.info(`Found ${currentFiles.length} current screenshots`);
  logger.info('');

  const baselineMap = new Map<string, string>();
  baselineFiles.forEach((f) => {
    const name = extractTestName(f);
    if (name) baselineMap.set(name, f);
  });

  const currentMap = new Map<string, string>();
  currentFiles.forEach((f) => {
    const name = extractTestName(f);
    if (name) currentMap.set(name, f);
  });

  const results: TestResult[] = [];
  let testNumber = 0;
  const totalTests = baselineMap.size + (currentMap.size - baselineMap.size);

  logger.info(`Running ${totalTests} comparisons...`);
  logger.info('');

  for (const [name, baselineFile] of baselineMap) {
    testNumber++;

    if (!currentMap.has(name)) {
      logger.error(`[${testNumber}/${totalTests}] ⚠ MISSING - ${name}`);
      results.push({
        name,
        status: 'missing',
        message: 'Screenshot not found in current report',
      });

      const baseline = PNG.sync.read(fs.readFileSync(path.join(BASELINE_DIR, baselineFile)));
      const combined = createCombinedImage(
        baseline.width,
        baseline.height,
        baseline,
        undefined,
        undefined
      );
      fs.writeFileSync(path.join(failureDir, `missing_${baselineFile}`), PNG.sync.write(combined));
      continue;
    }

    const currentFile = currentMap.get(name)!;
    const baselinePath = path.join(BASELINE_DIR, baselineFile);
    const currentPath = path.join(screenshotsDir, currentFile);
    const diffPath = path.join(failureDir, `diff_${name}.png`);

    try {
      const diffPixels = compareImages(baselinePath, currentPath, diffPath);

      if (diffPixels > 0) {
        logger.error(`[${testNumber}/${totalTests}] ✗ FAILED - ${name} (${diffPixels} pixels)`);
        results.push({
          name,
          status: 'failed',
          diffPixels,
        });
      } else {
        logger.info(`[${testNumber}/${totalTests}] ✓ PASSED - ${name}`);
        results.push({
          name,
          status: 'passed',
        });
      }
    } catch (error) {
      logger.error(`[${testNumber}/${totalTests}] ✗ ERROR - ${name}: ${(error as Error).message}`);
      results.push({
        name,
        status: 'failed',
        message: (error as Error).message,
      });
    }
  }

  for (const [name, currentFile] of currentMap) {
    if (!baselineMap.has(name)) {
      testNumber++;
      logger.error(`[${testNumber}/${totalTests}] + EXTRA - ${name} (no baseline)`);

      results.push({
        name,
        status: 'new',
        message: 'No baseline image exists',
      });

      const current = PNG.sync.read(fs.readFileSync(path.join(screenshotsDir, currentFile)));
      const combined = createCombinedImage(
        current.width,
        current.height,
        undefined,
        current,
        undefined
      );
      fs.writeFileSync(path.join(failureDir, `new_${currentFile}`), PNG.sync.write(combined));
    }
  }

  printSummary(results, baselineMap.size, currentMap.size);

  const hasFailures =
    results.some((r) => r.status === 'failed') ||
    results.some((r) => r.status === 'missing') ||
    results.some((r) => r.status === 'new');

  if (hasFailures) {
    logger.info('');
    logger.error(`Visual Regression Test FAILED - Check ${failureDir} for details`);
    await closeLogger();
    process.exit(1);
  } else {
    logger.info('');
    logger.success('All Visual Regression Tests PASSED!');
    await closeLogger();
    process.exit(0);
  }
};

main().catch(async (err) => {
  logger.error(err);
  await closeLogger();
  process.exit(1);
});
