#!/usr/bin/env node

/**
 * Generate Playwright-Style UI Report
 *
 * Matches the exact UI of Playwright's official HTML report:
 * - Collapsible nested steps (click to expand)
 * - Errors shown inline within the failed substep
 * - Clean, modern Playwright design
 * - Detailed step hierarchy
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get module name from environment variable (for parallel staggered runs)
const moduleName = process.env.MODULE_NAME || 'default';

// File paths - use module-specific paths when MODULE_NAME is set
const BLOB_DIR = path.join(process.cwd(), `reports/blob-report${moduleName !== 'default' ? '-' + moduleName : ''}`);
const ORCHESTRATOR_RESULTS = path.join(process.cwd(), `reports/orchestrator-results-${moduleName}.json`);
const OUTPUT_FILE = path.join(process.cwd(), `reports/detailed-step-report${moduleName !== 'default' ? '-' + moduleName : ''}.html`);
const MERGED_JSON = path.join(process.cwd(), `reports/merged-blob-report${moduleName !== 'default' ? '-' + moduleName : ''}.json`);

// Helper function to find the latest module-specific test results file
function findLatestTestResultsFile() {
  const reportsDir = path.join(process.cwd(), 'reports');
  if (moduleName !== 'default') {
    // For parallel runs, look for the latest test-results-{module}-*.json file
    const pattern = `test-results-${moduleName}-`;
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.startsWith(pattern) && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(reportsDir, f),
        mtime: fs.statSync(path.join(reportsDir, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      return files[0].path;
    }
  }
  // Fallback to default test-results.json
  return path.join(reportsDir, 'test-results.json');
}

console.log('📖 Generating Playwright-style UI report...');

// Check if blob report exists
const useBlobReport = fs.existsSync(BLOB_DIR);

if (!useBlobReport) {
  console.log('⚠️  Blob report not found, using test-results.json instead');
}

// Merge blob reports or use test-results.json
if (useBlobReport) {
  console.log('🔄 Merging blob reports...');
  try {
    execSync(`npx playwright merge-reports --reporter json ${BLOB_DIR}`, {
      stdio: ['pipe', fs.openSync(MERGED_JSON, 'w'), 'pipe'],
      cwd: process.cwd()
    });
    console.log('✓ Blob reports merged successfully');
  } catch (error) {
    console.log('   Falling back to test-results.json');
    const fallbackPath = findLatestTestResultsFile();
    if (fs.existsSync(fallbackPath)) {
      fs.copyFileSync(fallbackPath, MERGED_JSON);
      console.log(`✓ Using fallback test results: ${path.basename(fallbackPath)}`);
    } else {
      console.error('❌ No test results found');
      process.exit(1);
    }
  }
} else {
  const fallbackPath = findLatestTestResultsFile();
  if (fs.existsSync(fallbackPath)) {
    fs.copyFileSync(fallbackPath, MERGED_JSON);
    console.log(`✓ Using test results: ${path.basename(fallbackPath)}`);
  } else {
    console.error('❌ No test results found');
    process.exit(1);
  }
}

// Read data
const playwrightData = JSON.parse(fs.readFileSync(MERGED_JSON, 'utf-8'));
const orchestratorData = fs.existsSync(ORCHESTRATOR_RESULTS)
  ? JSON.parse(fs.readFileSync(ORCHESTRATOR_RESULTS, 'utf-8'))
  : {};

const orchestratorMap = new Map(Object.entries(orchestratorData));
console.log(`✓ Found ${orchestratorMap.size} orchestrated tests`);

// Extract tests
function extractTests(data) {
  const tests = [];

  function traverseSuites(suites) {
    for (const suite of suites) {
      if (suite.specs) {
        for (const spec of suite.specs) {
          // Skip the orchestrator summary test
          if (spec.title === '📊 Test Suite Summary') {
            continue;
          }

          for (const test of spec.tests) {
            const result = test.results[0];
            tests.push({
              title: spec.title,
              status: result.status,
              duration: result.duration,
              startTime: result.startTime,
              errors: result.errors || [],
              attachments: result.attachments || [],
              steps: result.steps || [],
              projectName: test.projectName,
              file: spec.file,
              line: spec.line,
            });
          }
        }
      }
      if (suite.suites) {
        traverseSuites(suite.suites);
      }
    }
  }

  traverseSuites(data.suites);
  return tests;
}

console.log('🔄 Extracting test data...');
const playwrightTests = extractTests(playwrightData);
console.log(`✓ Found ${playwrightTests.length} tests`);

// Merge with orchestrator
const mergedTests = playwrightTests.map(pwTest => {
  const orchData = orchestratorMap.get(pwTest.title);
  if (orchData) {
    return {
      ...pwTest,
      status: orchData.status,
      dependencies: orchData.dependencies || [],
      reason: orchData.reason,
      priority: orchData.priority,
      screenshotPath: orchData.screenshotPath ||
        (pwTest.error?.value?.screenshotPath) || // Extract from error value
        (pwTest.attachments?.find(a => a.name === 'screenshot')?.path), // Or from attachments
      attachments: orchData.attachments || pwTest.attachments,
    };
  }
  return {
    ...pwTest,
    screenshotPath: (pwTest.error?.value?.screenshotPath) ||
      (pwTest.attachments?.find(a => a.name === 'screenshot')?.path),
  };
});

// Embed screenshots
function imageToBase64(imagePath) {
  try {
    if (!imagePath || !fs.existsSync(imagePath)) return null;
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
    };
    const mimeType = mimeTypes[ext] || 'image/png';
    return `data:${mimeType};base64,${base64Image}`;
  } catch (error) {
    return null;
  }
}

console.log('📦 Embedding screenshots...');
mergedTests.forEach(test => {
  if (test.screenshotPath) {
    const base64 = imageToBase64(test.screenshotPath);
    if (base64) {
      test.screenshotBase64 = base64;
      console.log(`  ✓ Embedded screenshot for: ${test.title}`);
    }
  }
  if (test.attachments) {
    test.attachments = test.attachments.map(att => {
      if (att.path && att.contentType) {
        if (att.contentType.startsWith('image/')) {
          const base64 = imageToBase64(att.path);
          if (base64) {
            return { ...att, base64 };
          }
        } else if (att.contentType === 'text/plain' || att.contentType === 'application/json') {
          // Read text/JSON attachments
          try {
            if (fs.existsSync(att.path)) {
              const textContent = fs.readFileSync(att.path, 'utf-8');
              return { ...att, textContent };
            }
          } catch (err) {
            console.log(`  ⚠️  Could not read attachment: ${att.name}`);
          }
        }
      }
      return att;
    });
  }
});

// Calculate summary
const summary = {
  total: mergedTests.length,
  passed: mergedTests.filter(t => t.status === 'passed').length,
  failed: mergedTests.filter(t => t.status === 'failed').length,
  skipped: mergedTests.filter(t => t.status === 'skipped').length,
  totalSteps: mergedTests.reduce((sum, t) => sum + t.steps.length, 0),
};
summary.passRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;

console.log(`✓ Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`);

// Utility functions
function formatDuration(ms) {
  if (!ms) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString();
}

function escapeHtml(text) {
  if (!text) return '';

  // First, remove ANSI color codes (e.g., [2m, [22m, [31m, [39m, etc.)
  const withoutAnsi = String(text).replace(/\x1b\[\d+m/g, '');

  // Then escape HTML characters
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return withoutAnsi.replace(/[&<>"']/g, m => map[m]);
}

// Cache for source file contents
const sourceFileCache = new Map();

/**
 * Read source file and get code snippet with context
 * Returns array of {lineNumber, text, isCurrent} for lines around the target
 */
function getCodeSnippet(filePath, lineNumber) {
  try {
    // Try to resolve relative path from project root
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

    // Check cache first
    if (!sourceFileCache.has(fullPath)) {
      if (!fs.existsSync(fullPath)) {
        // Try without leading ../
        const altPath = filePath.replace(/^\.\.\//, '');
        const altFullPath = path.join(process.cwd(), altPath);
        if (fs.existsSync(altFullPath)) {
          const content = fs.readFileSync(altFullPath, 'utf-8');
          sourceFileCache.set(fullPath, content.split('\n'));
        } else {
          return null;
        }
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        sourceFileCache.set(fullPath, content.split('\n'));
      }
    }

    const lines = sourceFileCache.get(fullPath);
    if (!lines) return null;

    const lineIdx = lineNumber - 1; // Convert to 0-based index

    if (lineIdx < 0 || lineIdx >= lines.length) {
      return null;
    }

    // Get context: line before, current line, line after
    const contextLines = [];
    const startLine = Math.max(0, lineIdx - 1);
    const endLine = Math.min(lines.length - 1, lineIdx + 1);

    for (let i = startLine; i <= endLine; i++) {
      contextLines.push({
        lineNumber: i + 1,
        text: lines[i],
        isCurrent: i === lineIdx
      });
    }

    return contextLines;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return null;
  }
}

// Helper function to check if a step or any of its descendants has an error
function hasFailedDescendant(step) {
  if (!step) return false;

  // Check if current step has error
  if (step.error || (step.errors && step.errors.length > 0)) {
    return true;
  }

  // Recursively check children
  if (step.steps && step.steps.length > 0) {
    return step.steps.some(childStep => hasFailedDescendant(childStep));
  }

  return false;
}

// Render steps with Playwright-style collapsible UI
function renderSteps(steps, parentId = '', depth = 0) {
  if (!steps || steps.length === 0) return '';

  return steps.map((step, idx) => {
    const stepId = `${parentId}_step${idx}`;
    const hasChildren = step.steps && step.steps.length > 0;
    const hasError = step.error || (step.errors && step.errors.length > 0);

    // Properly extract error message - handle both object and string formats
    let errorMsg = '';
    if (step.error) {
      if (typeof step.error === 'object' && step.error.message) {
        errorMsg = step.error.message;
      } else if (typeof step.error === 'string') {
        errorMsg = step.error;
      }
    } else if (step.errors && step.errors.length > 0) {
      errorMsg = step.errors[0]?.message || '';
    }

    // Format location - handle both string and object formats, plus inline location in title
    let location = '';
    let displayTitle = step.title;
    let fullFilePath = '';
    let lineNumber = 0;

    // Check if location is embedded in title (format: "step title— file.ts:123")
    const inlineLocMatch = step.title.match(/^(.+)— (.+\.tsx?):(\d+)$/);
    if (inlineLocMatch) {
      displayTitle = inlineLocMatch[1].trim();
      const fileName = inlineLocMatch[2];
      lineNumber = parseInt(inlineLocMatch[3]);
      location = `${fileName}:${lineNumber}`;

      // Try to find full path
      if (fileName.includes('/')) {
        fullFilePath = fileName;
      } else {
        // Search common locations
        const commonPaths = [
          `src/framework/core/${fileName}`,
          `src/framework/pages/${fileName}`,
          `src/framework/utils/${fileName}`,
          `tests/functional/${fileName}`
        ];
        for (const p of commonPaths) {
          if (fs.existsSync(path.join(process.cwd(), p))) {
            fullFilePath = p;
            break;
          }
        }
      }
    }
    // Otherwise check for explicit location property
    else if (step.location) {
      if (typeof step.location === 'string') {
        const match = step.location.match(/(.+):(\d+)/);
        if (match) {
          fullFilePath = match[1];
          lineNumber = parseInt(match[2]);
          const fileName = fullFilePath.split('/').pop();
          location = `${fileName}:${lineNumber}`;
        } else {
          location = step.location;
        }
      } else if (typeof step.location === 'object') {
        fullFilePath = step.location.file || '';
        lineNumber = step.location.line || 0;
        const fileName = fullFilePath.split('/').pop();
        location = `${fileName}:${lineNumber}`;
      }
    }

    // Get code snippet if we have location info
    let codeSnippet = null;
    if (fullFilePath && lineNumber > 0) {
      codeSnippet = getCodeSnippet(fullFilePath, lineNumber);
    }

    const isExpanded = hasError || hasFailedDescendant(step);

    return `
      <div class="test-step ${hasError ? 'error' : ''} ${hasChildren ? 'has-children' : ''} ${isExpanded ? 'expanded' : ''}" style="padding-left: ${depth * 16}px;" data-step-id="${stepId}">
        <div class="step-header" onclick="toggleStep('${stepId}')">
          ${hasChildren ? '<span class="step-expand-icon">▶</span>' : '<span class="step-bullet"></span>'}
          <span class="step-icon ${hasError ? 'fail' : 'pass'}">
            ${hasError ? '✕' : '✓'}
          </span>
          <span class="step-title">${escapeHtml(displayTitle)}</span>
          ${location ? `<span class="step-location">${escapeHtml(location)}</span>` : ''}
          <span class="step-duration">${formatDuration(step.duration || 0)}</span>
        </div>

        ${codeSnippet ? `
          <div class="code-snippet" onclick="event.stopPropagation();">
            ${codeSnippet.map(line => `
              <div class="code-line ${line.isCurrent ? 'current-line' : ''}">
                <span class="line-number">${line.lineNumber}</span>
                <span class="line-text">${escapeHtml(line.text)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${hasError ? `
          <div class="step-error-detail">
            ${step.error && step.error.location ? `
              <div class="error-location-highlight" style="background: #fff5f5; padding: 8px 12px; margin-bottom: 8px; border-left: 3px solid #c0392b; border-radius: 3px;">
                <strong style="color: #c0392b;">Failed at:</strong>
                <code style="background: #f8d7da; padding: 2px 6px; border-radius: 3px; font-family: monospace;">
                  ${escapeHtml(step.error.location.file ? step.error.location.file.split('/').pop() : '')}:${step.error.location.line || ''}
                </code>
              </div>
            ` : ''}
            <div class="error-message">
              <span class="error-label">Error:</span> ${escapeHtml(errorMsg)}
            </div>
            ${step.error?.stack ? `
              <div class="error-stack">${escapeHtml(step.error.stack)}</div>
            ` : ''}
          </div>
        ` : ''}

        ${hasChildren ? `
          <div class="step-children" id="${stepId}_children" style="display: ${isExpanded ? 'block' : 'none'};">
            ${renderSteps(step.steps, stepId, depth + 1)}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// Generate HTML
console.log('🎨 Generating HTML report...');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --color-pass: #1e8449;
      --color-fail: #c0392b;
      --color-skip: #f39c12;
      --color-bg: #ffffff;
      --color-bg-alt: #f8f9fa;
      --color-border: #dee2e6;
      --color-text: #212529;
      --color-text-muted: #6c757d;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    body {
      font-family: var(--font-family);
      font-size: 14px;
      line-height: 1.6;
      color: var(--color-text);
      background: #f5f5f5;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    /* Header */
    .header {
      background: var(--color-bg);
      padding: 24px;
      border-radius: 4px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .header h1 {
      font-size: 24px;
      font-weight: 400;
      margin-bottom: 8px;
    }

    .header-meta {
      color: var(--color-text-muted);
      font-size: 13px;
    }

    /* Stats */
    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 20px;
    }

    .stat {
      background: var(--color-bg);
      padding: 16px 20px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      flex: 1;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 300;
      margin-bottom: 4px;
    }

    .stat.passed .stat-value { color: var(--color-pass); }
    .stat.failed .stat-value { color: var(--color-fail); }
    .stat.skipped .stat-value { color: var(--color-skip); }

    .stat-label {
      font-size: 12px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Filters */
    .filters {
      background: var(--color-bg);
      padding: 12px 16px;
      border-radius: 4px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      display: flex;
      gap: 12px;
    }

    .search {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--color-border);
      border-radius: 3px;
      font-size: 14px;
    }

    .filter-btn {
      padding: 8px 16px;
      border: 1px solid var(--color-border);
      background: var(--color-bg);
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    }

    .filter-btn:hover {
      background: var(--color-bg-alt);
    }

    .filter-btn.active {
      background: #007bff;
      color: white;
      border-color: #007bff;
    }

    /* Test List */
    .test-list {
      background: var(--color-bg);
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .test-item {
      border-bottom: 1px solid var(--color-border);
    }

    .test-item:last-child {
      border-bottom: none;
    }

    /* Test Header */
    .test-header {
      padding: 16px 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: background 0.15s;
    }

    .test-header:hover {
      background: var(--color-bg-alt);
    }

    .test-expand-icon {
      font-size: 10px;
      color: var(--color-text-muted);
      transition: transform 0.2s;
      display: inline-block;
      width: 12px;
    }

    .test-item.expanded .test-expand-icon {
      transform: rotate(90deg);
    }

    .test-status {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .test-status.passed { background: #d4edda; color: var(--color-pass); }
    .test-status.failed { background: #f8d7da; color: var(--color-fail); }
    .test-status.skipped { background: #fff3cd; color: var(--color-skip); }

    .test-title {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
    }

    .test-duration {
      color: var(--color-text-muted);
      font-size: 13px;
    }

    /* Test Body */
    .test-body {
      display: none;
      padding: 0 20px 20px 20px;
      background: var(--color-bg-alt);
    }

    .test-item.expanded .test-body {
      display: block;
    }

    /* Priority Badge */
    .priority-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-left: auto;
      margin-right: 12px;
    }

    .priority-badge.highest {
      background: #c0392b;
      color: white;
    }

    .priority-badge.high {
      background: #e67e22;
      color: white;
    }

    .priority-badge.medium {
      background: #f39c12;
      color: white;
    }

    .priority-badge.low {
      background: #95a5a6;
      color: white;
    }

    .section {
      margin-bottom: 16px;
    }

    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    /* Steps (Playwright style) */
    .steps-container {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 3px;
      overflow: hidden;
    }

    .test-step {
      border-bottom: 1px solid #f0f0f0;
      position: relative;
    }

    .test-step:last-child {
      border-bottom: none;
    }

    .step-header {
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: background 0.1s;
    }

    .test-step.has-children .step-header:hover {
      background: #f8f9fa;
    }

    .step-expand-icon {
      font-size: 8px;
      color: var(--color-text-muted);
      transition: transform 0.2s;
      display: inline-block;
      width: 10px;
    }

    .test-step.expanded .step-expand-icon {
      transform: rotate(90deg);
    }

    .step-bullet {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #ccc;
      display: inline-block;
    }

    .step-icon {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .step-icon.pass {
      background: #d4edda;
      color: var(--color-pass);
    }

    .step-icon.fail {
      background: #f8d7da;
      color: var(--color-fail);
    }

    .step-title {
      flex: 1;
      font-size: 13px;
      color: var(--color-text);
    }

    .step-location {
      font-size: 11px;
      color: var(--color-text-muted);
      font-family: 'Monaco', 'Menlo', monospace;
    }

    /* Code Snippet Styles */
    .code-snippet {
      margin: 8px 0 8px 40px;
      background: #f8f9fa;
      border-left: 3px solid #dee2e6;
      border-radius: 3px;
      padding: 8px 0;
      font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
      font-size: 12px;
      line-height: 1.5;
      overflow-x: auto;
    }

    .code-line {
      display: flex;
      padding: 2px 12px;
      white-space: pre;
    }

    .code-line.current-line {
      background: #fff3cd;
      border-left: 3px solid #ffc107;
      margin-left: -3px;
    }

    .code-line .line-number {
      color: #6c757d;
      min-width: 40px;
      text-align: right;
      margin-right: 16px;
      user-select: none;
      flex-shrink: 0;
    }

    .code-line.current-line .line-number {
      color: #856404;
      font-weight: 600;
    }

    .code-line .line-text {
      color: #212529;
      flex: 1;
      overflow-x: auto;
    }

    .code-line.current-line .line-text {
      color: #856404;
    }

    .step-duration {
      font-size: 11px;
      color: var(--color-text-muted);
    }

    .step-children {
      background: #fafafa;
    }

    /* Error Display (inline with step) */
    .step-error-detail {
      padding: 12px 12px 12px 46px;
      background: #fff5f5;
      border-left: 3px solid var(--color-fail);
      margin: 0 12px 8px 12px;
      border-radius: 3px;
    }

    .error-label {
      font-weight: 600;
      color: var(--color-fail);
    }

    .error-message {
      font-size: 13px;
      color: #721c24;
      margin-bottom: 8px;
      font-family: 'Monaco', 'Menlo', monospace;
    }

    .error-stack {
      font-size: 11px;
      color: #856404;
      font-family: 'Monaco', 'Menlo', monospace;
      white-space: pre-wrap;
      margin-top: 8px;
      opacity: 0.8;
    }

    /* Dependencies */
    .dependencies {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .dep-tag {
      padding: 4px 8px;
      background: white;
      border: 1px solid var(--color-border);
      border-radius: 3px;
      font-size: 12px;
    }

    /* Skip Reason */
    .skip-reason {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 12px;
      border-radius: 3px;
      font-size: 13px;
      color: #856404;
    }

    /* Screenshots */
    .screenshots {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }

    .screenshot {
      border: 1px solid var(--color-border);
      border-radius: 3px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.2s;
    }

    .screenshot:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    .screenshot img {
      width: 100%;
      height: 150px;
      object-fit: cover;
      display: block;
    }

    .screenshot-label {
      padding: 8px;
      font-size: 11px;
      color: var(--color-text-muted);
      background: white;
      text-align: center;
    }

    /* Modal */
    .modal {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.9);
      align-items: center;
      justify-content: center;
    }

    .modal.active {
      display: flex;
    }

    .modal-content {
      max-width: 95%;
      max-height: 95%;
      object-fit: contain;
    }

    .modal-close {
      position: absolute;
      top: 20px;
      right: 40px;
      color: white;
      font-size: 40px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Playwright Test Report</h1>
      <div class="header-meta">
        Generated ${formatTimestamp(new Date().toISOString())} |
        ${summary.total} tests |
        ${formatDuration(mergedTests.reduce((sum, t) => sum + (t.duration || 0), 0))} total
      </div>
    </div>

    <div class="stats">
      <div class="stat passed">
        <div class="stat-value">${summary.passed}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat failed">
        <div class="stat-value">${summary.failed}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat skipped">
        <div class="stat-value">${summary.skipped}</div>
        <div class="stat-label">Skipped</div>
      </div>
      <div class="stat">
        <div class="stat-value">${summary.passRate.toFixed(0)}%</div>
        <div class="stat-label">Pass Rate</div>
      </div>
    </div>

    <div class="filters">
      <input type="text" class="search" id="search" placeholder="Filter tests..." />
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="passed">Passed</button>
      <button class="filter-btn" data-filter="failed">Failed</button>
      <button class="filter-btn" data-filter="skipped">Skipped</button>
      <span style="margin: 0 8px; color: var(--color-text-muted);">|</span>
      <button class="filter-btn priority-filter" data-priority-filter="all">All Priorities</button>
      <button class="filter-btn priority-filter" data-priority-filter="highest">Highest</button>
      <button class="filter-btn priority-filter" data-priority-filter="high">High</button>
      <button class="filter-btn priority-filter" data-priority-filter="medium">Medium</button>
      <button class="filter-btn priority-filter" data-priority-filter="low">Low</button>
    </div>

    <div class="test-list">
      ${mergedTests.map((test, idx) => `
        <div class="test-item" data-status="${test.status}" data-name="${escapeHtml(test.title)}" data-priority="${test.priority || 'medium'}">
          <div class="test-header" onclick="toggleTest(${idx})">
            <span class="test-expand-icon">▶</span>
            <div class="test-status ${test.status}">
              ${test.status === 'passed' ? '✓' : test.status === 'failed' ? '✕' : '○'}
            </div>
            <div class="test-title">${escapeHtml(test.title)}</div>
            ${test.priority ? `<span class="priority-badge ${test.priority.toLowerCase()}">${test.priority}</span>` : ''}
            <div class="test-duration">${formatDuration(test.duration || 0)}</div>
          </div>

          <div class="test-body">
            ${test.dependencies && test.dependencies.length > 0 ? `
              <div class="section">
                <div class="section-title">Dependencies</div>
                <div class="dependencies">
                  ${test.dependencies.map(dep => `<div class="dep-tag">${escapeHtml(dep)}</div>`).join('')}
                </div>
              </div>
            ` : ''}

            ${test.reason ? `
              <div class="section">
                <div class="section-title">Skip Reason</div>
                <div class="skip-reason">${escapeHtml(test.reason)}</div>
              </div>
            ` : ''}

            ${test.screenshotBase64 || (test.attachments && test.attachments.some(a => a.base64)) ? `
              <div class="section">
                <div class="section-title">Screenshots</div>
                <div class="screenshots">
                  ${test.screenshotBase64 ? `
                    <div class="screenshot" onclick="openModal('img${idx}')">
                      <img id="img${idx}" src="${test.screenshotBase64}" alt="Screenshot" />
                      <div class="screenshot-label">Failure Screenshot</div>
                    </div>
                  ` : ''}
                  ${test.attachments ? test.attachments.filter(a => a.base64).map((att, aIdx) => `
                    <div class="screenshot" onclick="openModal('img${idx}_${aIdx}')">
                      <img id="img${idx}_${aIdx}" src="${att.base64}" alt="${escapeHtml(att.name)}" />
                      <div class="screenshot-label">${escapeHtml(att.name)}</div>
                    </div>
                  `).join('') : ''}
                </div>
              </div>
            ` : ''}

            ${test.steps && test.steps.length > 0 ? `
              <div class="section">
                <div class="section-title">Test Steps</div>
                <div class="steps-container">
                  ${renderSteps(test.steps, `test${idx}`)}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <div id="modal" class="modal" onclick="closeModal()">
    <span class="modal-close">&times;</span>
    <img class="modal-content" id="modalImg">
  </div>

  <script>
    function toggleTest(idx) {
      const items = document.querySelectorAll('.test-item');
      items[idx].classList.toggle('expanded');
    }

    function toggleStep(stepId) {
      const step = document.querySelector(\`[data-step-id="\${stepId}"]\`);
      const children = document.getElementById(\`\${stepId}_children\`);

      if (step && children) {
        step.classList.toggle('expanded');
        children.style.display = children.style.display === 'none' ? 'block' : 'none';
      }
    }

    function openModal(imgId) {
      event.stopPropagation();
      const modal = document.getElementById('modal');
      const modalImg = document.getElementById('modalImg');
      const img = document.getElementById(imgId);
      modal.classList.add('active');
      modalImg.src = img.src;
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('active');
    }

    // Filters
    const search = document.getElementById('search');
    const statusFilterBtns = document.querySelectorAll('.filter-btn:not(.priority-filter)');
    const priorityFilterBtns = document.querySelectorAll('.filter-btn.priority-filter');

    search.addEventListener('input', filter);

    // Status filter buttons
    statusFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        statusFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filter();
      });
    });

    // Priority filter buttons
    priorityFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        priorityFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filter();
      });
    });

    // Set default active priority filter
    document.querySelector('[data-priority-filter="all"]').classList.add('active');

    function filter() {
      const searchTerm = search.value.toLowerCase();
      const activeStatusFilter = document.querySelector('.filter-btn:not(.priority-filter).active')?.dataset.filter || 'all';
      const activePriorityFilter = document.querySelector('.filter-btn.priority-filter.active')?.dataset.priorityFilter || 'all';
      const items = document.querySelectorAll('.test-item');

      items.forEach(item => {
        const name = item.dataset.name.toLowerCase();
        const status = item.dataset.status;
        const priority = item.dataset.priority || 'medium';

        const matchesSearch = name.includes(searchTerm);
        const matchesStatus = activeStatusFilter === 'all' || status === activeStatusFilter;
        const matchesPriority = activePriorityFilter === 'all' || priority.toLowerCase() === activePriorityFilter.toLowerCase();

        item.style.display = matchesSearch && matchesStatus && matchesPriority ? '' : 'none';
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  </script>
</body>
</html>
`;

fs.writeFileSync(OUTPUT_FILE, html);

console.log('\n✅ Playwright-style UI Report Generated!');
console.log(`📄 Report: ${OUTPUT_FILE}`);
console.log(`\n📊 Summary:`);
console.log(`   Total: ${summary.total}`);
console.log(`   ✅ Passed: ${summary.passed}`);
console.log(`   ❌ Failed: ${summary.failed}`);
console.log(`   ⏭️  Skipped: ${summary.skipped}`);
console.log(`   📝 Steps: ${summary.totalSteps}`);

const shouldOpen = !process.argv.includes('--no-open');
if (shouldOpen) {
  try {
    const openCommand = process.platform === 'darwin' ? `open "${OUTPUT_FILE}"` :
                       process.platform === 'win32' ? `start "" "${OUTPUT_FILE}"` :
                       `xdg-open "${OUTPUT_FILE}"`;
    console.log('\n🌐 Opening report...');
    execSync(openCommand);
  } catch (error) {
    console.log(`   Please open manually: ${OUTPUT_FILE}`);
  }
}

process.exit(0);
