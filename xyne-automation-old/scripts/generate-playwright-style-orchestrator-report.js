#!/usr/bin/env node

/**
 * Generate Playwright-style HTML report enhanced with Orchestrator data
 *
 * This script:
 * 1. Reads Playwright's test-results.json for detailed step information
 * 2. Reads orchestrator-results.json for dependency and orchestration data
 * 3. Merges both datasets
 * 4. Generates a beautiful HTML report that looks like Playwright's official report
 *    but includes orchestrator-specific features (dependencies, skip reasons, etc.)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get module name from environment variable (for parallel staggered runs)
const moduleName = process.env.MODULE_NAME || 'default';

// File paths - use module-specific paths when MODULE_NAME is set
const PLAYWRIGHT_RESULTS = path.join(process.cwd(), 'reports/test-results.json');
const ORCHESTRATOR_RESULTS = path.join(process.cwd(), `reports/orchestrator-results-${moduleName}.json`);
const OUTPUT_FILE = path.join(process.cwd(), `reports/orchestrator-playwright-report${moduleName !== 'default' ? '-' + moduleName : ''}.html`);

// Check if required files exist
if (!fs.existsSync(PLAYWRIGHT_RESULTS)) {
  console.error('❌ Playwright results file not found:', PLAYWRIGHT_RESULTS);
  process.exit(1);
}

if (!fs.existsSync(ORCHESTRATOR_RESULTS)) {
  console.error('❌ Orchestrator results file not found:', ORCHESTRATOR_RESULTS);
  process.exit(1);
}

// Read data files
console.log('📖 Reading test results...');
const playwrightData = JSON.parse(fs.readFileSync(PLAYWRIGHT_RESULTS, 'utf-8'));
const orchestratorData = JSON.parse(fs.readFileSync(ORCHESTRATOR_RESULTS, 'utf-8'));

// Convert orchestrator data to a map for easy lookup
const orchestratorMap = new Map(Object.entries(orchestratorData));

console.log(`✓ Found ${orchestratorMap.size} orchestrated tests`);

/**
 * Extract tests from Playwright's nested structure
 */
function extractPlaywrightTests(playwrightData) {
  const tests = [];

  function traverseSuites(suites) {
    for (const suite of suites) {
      // Process specs in this suite
      if (suite.specs) {
        for (const spec of suite.specs) {
          // Skip the orchestrator summary test
          if (spec.title === '📊 Test Suite Summary') {
            continue;
          }

          for (const test of spec.tests) {
            const result = test.results[0]; // Get first result (we don't retry in orchestrator mode)

            tests.push({
              title: spec.title,
              status: result.status,
              duration: result.duration,
              startTime: result.startTime,
              errors: result.errors || [],
              attachments: result.attachments || [],
              stdout: result.stdout || [],
              stderr: result.stderr || [],
              steps: result.steps || [],
              annotations: test.annotations || [],
              projectName: test.projectName,
              file: spec.file,
              line: spec.line,
            });
          }
        }
      }

      // Recursively process nested suites
      if (suite.suites) {
        traverseSuites(suite.suites);
      }
    }
  }

  traverseSuites(playwrightData.suites);
  return tests;
}

/**
 * Merge Playwright test data with orchestrator data
 */
function mergeTestData(playwrightTests, orchestratorMap) {
  const merged = [];

  for (const pwTest of playwrightTests) {
    const orchData = orchestratorMap.get(pwTest.title);

    if (orchData) {
      // Merge data - orchestrator data takes precedence for status
      merged.push({
        // Basic info
        testName: pwTest.title,
        status: orchData.status, // Use orchestrator status (fixed by orchestrator-reporter)
        duration: orchData.duration || pwTest.duration,
        startTime: orchData.startTime || pwTest.startTime,
        endTime: orchData.endTime,

        // Playwright data
        steps: pwTest.steps,
        errors: pwTest.errors,
        attachments: pwTest.attachments,
        stdout: pwTest.stdout,
        stderr: pwTest.stderr,
        projectName: pwTest.projectName,
        file: pwTest.file,
        line: pwTest.line,
        annotations: pwTest.annotations,

        // Orchestrator data
        dependencies: orchData.dependencies || [],
        reason: orchData.reason, // Skip reason
        error: orchData.error,
        errorDetails: orchData.errorDetails,
        priority: orchData.priority,
        tags: orchData.tags,
        description: orchData.description,
        screenshotPath: orchData.screenshotPath ||
          (pwTest.errors?.[0]?.value?.screenshotPath) || // Extract from error value
          (pwTest.attachments?.find(a => a.name === 'screenshot')?.path), // Or from attachments
      });
    } else {
      // Test not in orchestrator (shouldn't happen, but handle it)
      merged.push({
        testName: pwTest.title,
        status: pwTest.status,
        duration: pwTest.duration,
        startTime: pwTest.startTime,
        steps: pwTest.steps,
        errors: pwTest.errors,
        attachments: pwTest.attachments,
        stdout: pwTest.stdout,
        stderr: pwTest.stderr,
        projectName: pwTest.projectName,
        file: pwTest.file,
        line: pwTest.line,
        annotations: pwTest.annotations,
        dependencies: [],
        screenshotPath: (pwTest.errors?.[0]?.value?.screenshotPath) ||
          (pwTest.attachments?.find(a => a.name === 'screenshot')?.path),
      });
    }
  }

  return merged;
}

console.log('🔄 Extracting Playwright test data...');
const playwrightTests = extractPlaywrightTests(playwrightData);
console.log(`✓ Found ${playwrightTests.length} tests in Playwright results`);

console.log('🔗 Merging with orchestrator data...');
const mergedTests = mergeTestData(playwrightTests, orchestratorMap);

// Calculate summary
const summary = {
  total: mergedTests.length,
  passed: mergedTests.filter(t => t.status === 'passed').length,
  failed: mergedTests.filter(t => t.status === 'failed').length,
  skipped: mergedTests.filter(t => t.status === 'skipped').length,
};
summary.passRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;

const totalDuration = mergedTests.reduce((sum, t) => sum + (t.duration || 0), 0);

console.log(`✓ Merged ${mergedTests.length} tests`);
console.log(`  Passed: ${summary.passed}, Failed: ${summary.failed}, Skipped: ${summary.skipped}`);

// Utility functions
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString();
}

function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function imageToBase64(imagePath) {
  try {
    if (!imagePath || !fs.existsSync(imagePath)) {
      return null;
    }
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const mimeType = mimeTypes[ext] || 'image/png';
    return `data:${mimeType};base64,${base64Image}`;
  } catch (error) {
    console.warn(`⚠️  Could not convert image: ${imagePath}`);
    return null;
  }
}

// Process attachments and embed images
console.log('📦 Processing attachments and screenshots...');
mergedTests.forEach(test => {
  // Embed screenshot if exists
  if (test.screenshotPath) {
    const base64 = imageToBase64(test.screenshotPath);
    if (base64) {
      test.screenshotBase64 = base64;
      console.log(`  ✓ Embedded screenshot for: ${test.testName}`);
    }
  }

  // Embed attachment images
  if (test.attachments && test.attachments.length > 0) {
    test.attachments = test.attachments.map(att => {
      // Handle both path and body properties
      const attPath = att.path;
      if (attPath && att.contentType && att.contentType.startsWith('image/')) {
        const base64 = imageToBase64(attPath);
        if (base64) {
          console.log(`  ✓ Embedded ${att.name} for: ${test.testName}`);
          return { ...att, base64 };
        }
      }
      return att;
    });
  }
});

/**
 * Render test steps recursively with proper indentation
 * Playwright steps can be nested
 */
function renderSteps(steps, depth = 0) {
  if (!steps || steps.length === 0) return '';

  return steps.map(step => {
    const indent = depth * 20;
    const hasSubsteps = step.steps && step.steps.length > 0;
    const hasError = step.error || (step.errors && step.errors.length > 0);

    // Extract location info
    const location = step.location ? `${step.location.file}:${step.location.line}` : '';

    return `
      <div class="step-item ${hasError ? 'error' : ''}" style="margin-left: ${indent}px;">
        <div class="step-icon">${hasError ? '✕' : '✓'}</div>
        <div class="step-content">
          <div class="step-title">${escapeHtml(step.title)}</div>
          ${location ? `
            <div class="step-location">
              📍 <span class="step-location-link">${escapeHtml(location)}</span>
            </div>
          ` : ''}
          ${hasError ? `
            <div class="step-error">${escapeHtml(step.error || step.errors[0]?.message || 'Unknown error')}</div>
          ` : ''}
          ${step.count && step.count > 1 ? `
            <div class="step-count">×${step.count}</div>
          ` : ''}
        </div>
        <div class="step-duration">${formatDuration(step.duration || 0)}</div>
        ${hasSubsteps ? renderSteps(step.steps, depth + 1) : ''}
      </div>
    `;
  }).join('');
}

/**
 * Generate the HTML report
 * Using Playwright's design language with orchestrator enhancements
 */
console.log('🎨 Generating HTML report...');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Report - Playwright + Orchestrator</title>
  <style>
    /* Playwright-inspired Design System */
    :root {
      --color-pass: #10b981;
      --color-fail: #ef4444;
      --color-skip: #f59e0b;
      --color-primary: #2563eb;
      --color-bg: #ffffff;
      --color-bg-secondary: #f9fafb;
      --color-border: #e5e7eb;
      --color-text: #111827;
      --color-text-secondary: #6b7280;
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      --border-radius: 8px;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Helvetica Neue', sans-serif;
      background: var(--color-bg-secondary);
      color: var(--color-text);
      line-height: 1.5;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }

    /* Header - Playwright style */
    .header {
      background: var(--color-bg);
      border-radius: var(--border-radius);
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: var(--shadow-sm);
      border-left: 4px solid var(--color-primary);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-meta {
      color: var(--color-text-secondary);
      font-size: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 12px;
    }

    .header-meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Stats Cards - Playwright style */
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--color-bg);
      border-radius: var(--border-radius);
      padding: 24px;
      box-shadow: var(--shadow-sm);
      border-left: 3px solid;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    .stat-card.total { border-left-color: var(--color-primary); }
    .stat-card.passed { border-left-color: var(--color-pass); }
    .stat-card.failed { border-left-color: var(--color-fail); }
    .stat-card.skipped { border-left-color: var(--color-skip); }

    .stat-value {
      font-size: 36px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .stat-card.total .stat-value { color: var(--color-primary); }
    .stat-card.passed .stat-value { color: var(--color-pass); }
    .stat-card.failed .stat-value { color: var(--color-fail); }
    .stat-card.skipped .stat-value { color: var(--color-skip); }

    .stat-label {
      color: var(--color-text-secondary);
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Filters - Playwright style */
    .filters {
      background: var(--color-bg);
      border-radius: var(--border-radius);
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .search-input {
      flex: 1;
      min-width: 250px;
      padding: 10px 14px;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      font-size: 14px;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    .filter-btn {
      padding: 10px 18px;
      border: 1px solid var(--color-border);
      background: var(--color-bg);
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .filter-btn:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .filter-btn.active {
      background: var(--color-primary);
      color: white;
      border-color: var(--color-primary);
    }

    .filter-btn.passed.active {
      background: var(--color-pass);
      border-color: var(--color-pass);
    }

    .filter-btn.failed.active {
      background: var(--color-fail);
      border-color: var(--color-fail);
    }

    .filter-btn.skipped.active {
      background: var(--color-skip);
      border-color: var(--color-skip);
    }

    /* Test List - Playwright style */
    .test-list {
      background: var(--color-bg);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }

    .test-item {
      border-bottom: 1px solid var(--color-border);
      transition: background-color 0.2s;
    }

    .test-item:last-child {
      border-bottom: none;
    }

    .test-item:hover {
      background: var(--color-bg-secondary);
    }

    /* Test Header */
    .test-header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      user-select: none;
    }

    .status-badge {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .status-badge.passed {
      background: #d1fae5;
      color: #065f46;
    }

    .status-badge.failed {
      background: #fee2e2;
      color: #991b1b;
    }

    .status-badge.skipped {
      background: #fef3c7;
      color: #92400e;
    }

    .test-info {
      flex: 1;
      min-width: 0;
    }

    .test-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 4px;
    }

    .test-meta {
      font-size: 12px;
      color: var(--color-text-secondary);
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .test-duration {
      font-size: 13px;
      color: var(--color-text-secondary);
      font-weight: 500;
      padding: 4px 10px;
      background: var(--color-bg-secondary);
      border-radius: 4px;
    }

    .expand-icon {
      font-size: 16px;
      color: var(--color-text-secondary);
      transition: transform 0.2s;
    }

    .test-item.expanded .expand-icon {
      transform: rotate(90deg);
    }

    /* Test Details */
    .test-details {
      display: none;
      padding: 0 20px 20px 20px;
      background: var(--color-bg-secondary);
    }

    .test-item.expanded .test-details {
      display: block;
    }

    .detail-section {
      margin-bottom: 16px;
    }

    .detail-section:last-child {
      margin-bottom: 0;
    }

    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    /* Steps - Playwright style */
    .steps-container {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      overflow: hidden;
    }

    .step-item {
      padding: 10px 14px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: flex-start;
      gap: 10px;
      transition: background 0.2s;
    }

    .step-item:last-child {
      border-bottom: none;
    }

    .step-item:hover {
      background: var(--color-bg-secondary);
    }

    .step-icon {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--color-pass);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .step-item.error .step-icon {
      background: var(--color-fail);
    }

    .step-content {
      flex: 1;
      min-width: 0;
    }

    .step-title {
      font-size: 13px;
      color: var(--color-text);
      margin-bottom: 4px;
    }

    .step-location {
      font-size: 11px;
      color: var(--color-text-secondary);
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    }

    .step-location-link {
      color: var(--color-primary);
    }

    .step-error {
      background: #fee2e2;
      color: #991b1b;
      padding: 8px;
      border-radius: 4px;
      font-size: 12px;
      margin-top: 6px;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    }

    .step-duration {
      font-size: 11px;
      color: var(--color-text-secondary);
      background: var(--color-bg-secondary);
      padding: 3px 7px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .step-count {
      font-size: 11px;
      color: var(--color-text-secondary);
      background: var(--color-bg-secondary);
      padding: 3px 7px;
      border-radius: 3px;
      display: inline-block;
      margin-top: 4px;
    }

    /* Error Box */
    .error-container {
      background: #fee2e2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 12px;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 12px;
      color: #991b1b;
      overflow-x: auto;
    }

    .error-message {
      font-weight: 600;
      margin-bottom: 8px;
    }

    .error-stack {
      color: #dc2626;
      opacity: 0.9;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Skip Reason */
    .skip-reason {
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 6px;
      padding: 12px;
      font-size: 13px;
      color: #92400e;
    }

    /* Dependencies */
    .dependencies-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .dependency-tag {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--color-text);
    }

    /* Priority Badge */
    .priority-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .priority-highest { background: #fee2e2; color: #991b1b; }
    .priority-high { background: #fed7aa; color: #9a3412; }
    .priority-medium { background: #dbeafe; color: #1e40af; }
    .priority-low { background: #e5e7eb; color: #374151; }

    /* Attachments */
    .attachments-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }

    .attachment-card {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      overflow: hidden;
      cursor: pointer;
      transition: border-color 0.2s;
    }

    .attachment-card:hover {
      border-color: var(--color-primary);
    }

    .attachment-preview {
      width: 100%;
      height: 150px;
      object-fit: contain;
      background: var(--color-bg-secondary);
    }

    .attachment-info {
      padding: 10px;
    }

    .attachment-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text);
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
      background-color: rgba(0, 0, 0, 0.9);
      align-items: center;
      justify-content: center;
    }

    .modal.active {
      display: flex;
    }

    .modal-content {
      max-width: 90%;
      max-height: 90%;
      object-fit: contain;
    }

    .modal-close {
      position: absolute;
      top: 20px;
      right: 40px;
      color: white;
      font-size: 40px;
      font-weight: bold;
      cursor: pointer;
    }

    .modal-close:hover {
      color: #ccc;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--color-text-secondary);
    }

    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }

    .empty-text {
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>
        <span>🎭</span>
        <span>Test Report</span>
      </h1>
      <div class="header-meta">
        <div class="header-meta-item">
          <span>📅</span>
          <span>${formatTimestamp(new Date().toISOString())}</span>
        </div>
        <div class="header-meta-item">
          <span>✓</span>
          <span>Pass Rate: ${summary.passRate.toFixed(1)}%</span>
        </div>
        <div class="header-meta-item">
          <span>⏱️</span>
          <span>Total: ${formatDuration(totalDuration)}</span>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats">
      <div class="stat-card total">
        <div class="stat-value">${summary.total}</div>
        <div class="stat-label">Total Tests</div>
      </div>
      <div class="stat-card passed">
        <div class="stat-value">${summary.passed}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card failed">
        <div class="stat-value">${summary.failed}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card skipped">
        <div class="stat-value">${summary.skipped}</div>
        <div class="stat-label">Skipped</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters">
      <input type="text" class="search-input" id="searchInput" placeholder=" Search tests..." />
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn passed" data-filter="passed">✓ Passed</button>
      <button class="filter-btn failed" data-filter="failed">✕ Failed</button>
      <button class="filter-btn skipped" data-filter="skipped">⊘ Skipped</button>
    </div>

    <!-- Test List -->
    <div class="test-list" id="testList">
      ${mergedTests.map((test, index) => `
        <div class="test-item" data-status="${test.status}" data-name="${escapeHtml(test.testName)}">
          <div class="test-header" onclick="toggleTest(${index})">
            <div class="status-badge ${test.status}">
              ${test.status === 'passed' ? '✓' : test.status === 'failed' ? '✕' : '⊘'}
            </div>
            <div class="test-info">
              <div class="test-title">${escapeHtml(test.testName)}</div>
              <div class="test-meta">
                ${test.projectName ? `<span>🖥️ ${test.projectName}</span>` : ''}
                ${test.priority ? `<span class="priority-badge priority-${test.priority}">${test.priority}</span>` : ''}
                ${test.steps && test.steps.length > 0 ? `<span>📝 ${test.steps.length} steps</span>` : ''}
                ${test.dependencies && test.dependencies.length > 0 ? `<span>🔗 ${test.dependencies.length} ${test.dependencies.length === 1 ? 'dependency' : 'dependencies'}</span>` : ''}
              </div>
            </div>
            <div class="test-duration">${formatDuration(test.duration || 0)}</div>
            <div class="expand-icon">›</div>
          </div>

          <div class="test-details">
            ${test.steps && test.steps.length > 0 ? `
              <div class="detail-section">
                <div class="section-title">Test Steps</div>
                <div class="steps-container">
                  ${renderSteps(test.steps)}
                </div>
              </div>
            ` : ''}

            ${test.status === 'failed' && (test.errors.length > 0 || test.error) ? `
              <div class="detail-section">
                <div class="section-title">Error Details</div>
                <div class="error-container">
                  <div class="error-message">${escapeHtml(test.error || test.errors[0]?.message || 'Unknown error')}</div>
                  ${test.errors[0]?.stack ? `
                    <div class="error-stack">${escapeHtml(test.errors[0].stack)}</div>
                  ` : ''}
                </div>
              </div>
            ` : ''}

            ${test.status === 'skipped' && test.reason ? `
              <div class="detail-section">
                <div class="section-title">Skip Reason</div>
                <div class="skip-reason">${escapeHtml(test.reason)}</div>
              </div>
            ` : ''}

            ${test.dependencies && test.dependencies.length > 0 ? `
              <div class="detail-section">
                <div class="section-title">Dependencies</div>
                <div class="dependencies-list">
                  ${test.dependencies.map(dep => `
                    <div class="dependency-tag">${escapeHtml(dep)}</div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            ${test.attachments && test.attachments.length > 0 || test.screenshotBase64 ? `
              <div class="detail-section">
                <div class="section-title">Attachments</div>
                <div class="attachments-grid">
                  ${test.attachments.map((att, attIdx) => {
                    if (att.base64) {
                      return `
                        <div class="attachment-card" onclick="openModal('test${index}_att${attIdx}')">
                          <img id="test${index}_att${attIdx}" src="${att.base64}" alt="${escapeHtml(att.name)}" class="attachment-preview" />
                          <div class="attachment-info">
                            <div class="attachment-name">${escapeHtml(att.name)}</div>
                          </div>
                        </div>
                      `;
                    }
                    return '';
                  }).join('')}
                  ${test.screenshotBase64 ? `
                    <div class="attachment-card" onclick="openModal('test${index}_screenshot')">
                      <img id="test${index}_screenshot" src="${test.screenshotBase64}" alt="Screenshot" class="attachment-preview" />
                      <div class="attachment-info">
                        <div class="attachment-name">Screenshot</div>
                      </div>
                    </div>
                  ` : ''}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="empty-state" id="emptyState" style="display: none;">
      <div class="empty-icon"></div>
      <div class="empty-text">No tests match your search or filter</div>
    </div>
  </div>

  <!-- Modal -->
  <div id="imageModal" class="modal" onclick="closeModal()">
    <span class="modal-close">&times;</span>
    <img class="modal-content" id="modalImage">
  </div>

  <script>
    function toggleTest(index) {
      const items = document.querySelectorAll('.test-item');
      items[index].classList.toggle('expanded');
    }

    function openModal(imageId) {
      event.stopPropagation();
      const img = document.getElementById(imageId);
      const modal = document.getElementById('imageModal');
      const modalImg = document.getElementById('modalImage');
      modal.classList.add('active');
      modalImg.src = img.src;
    }

    function closeModal() {
      document.getElementById('imageModal').classList.remove('active');
    }

    // Search and filter
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', filterTests);

    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterTests();
      });
    });

    function filterTests() {
      const searchTerm = searchInput.value.toLowerCase();
      const activeFilter = document.querySelector('.filter-btn.active').dataset.filter;
      const items = document.querySelectorAll('.test-item');
      let visibleCount = 0;

      items.forEach(item => {
        const name = item.dataset.name.toLowerCase();
        const status = item.dataset.status;

        const matchesSearch = name.includes(searchTerm);
        const matchesFilter = activeFilter === 'all' || status === activeFilter;

        if (matchesSearch && matchesFilter) {
          item.style.display = '';
          visibleCount++;
        } else {
          item.style.display = 'none';
        }
      });

      document.getElementById('emptyState').style.display = visibleCount === 0 ? 'block' : 'none';
      document.getElementById('testList').style.display = visibleCount === 0 ? 'none' : 'block';
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  </script>
</body>
</html>
`;

// Write the HTML file
fs.writeFileSync(OUTPUT_FILE, html);

console.log('\n Playwright-style Orchestrator Report Generated!');
console.log(`📄 Report: ${OUTPUT_FILE}`);
console.log(`\n📊 Summary:`);
console.log(`   Total: ${summary.total}`);
console.log(`    Passed: ${summary.passed}`);
console.log(`   ❌ Failed: ${summary.failed}`);
console.log(`   ⏭️ Skipped: ${summary.skipped}`);
console.log(`   📈 Pass Rate: ${summary.passRate.toFixed(1)}%`);
console.log(`   ⏱️  Duration: ${formatDuration(totalDuration)}`);

// Auto-open the report
const shouldOpen = !process.argv.includes('--no-open');
if (shouldOpen) {
  try {
    const openCommand = process.platform === 'darwin' ? `open "${OUTPUT_FILE}"` :
                       process.platform === 'win32' ? `start "" "${OUTPUT_FILE}"` :
                       `xdg-open "${OUTPUT_FILE}"`;

    console.log('\n🌐 Opening report in browser...');
    execSync(openCommand);
    console.log(' Report opened successfully!\n');
  } catch (error) {
    console.warn('⚠️  Could not auto-open report');
    console.log(`   Please open manually: ${OUTPUT_FILE}\n`);
  }
}

process.exit(0);
