#!/usr/bin/env node

/**
 * Generate comprehensive self-contained HTML report from orchestrator results
 * - Embeds images as base64 (no external dependencies)
 * - Shows test steps with code locations (like Playwright report)
 * - Completely portable single HTML file
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get module name from environment variable (for parallel staggered runs)
const moduleName = process.env.MODULE_NAME || 'default';

// File paths - use module-specific paths when MODULE_NAME is set
const RESULTS_FILE = path.join(process.cwd(), `reports/orchestrator-results-${moduleName}.json`);
const OUTPUT_FILE = path.join(process.cwd(), `reports/orchestrator-custom-report${moduleName !== 'default' ? '-' + moduleName : ''}.html`);

// Check if results file exists
if (!fs.existsSync(RESULTS_FILE)) {
  console.error('❌ Orchestrator results file not found:', RESULTS_FILE);
  console.error('   Run tests with orchestrator first');
  process.exit(1);
}

// Read results
const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
// Filter out the orchestrator summary test
const tests = Object.values(results).filter(test => test.testName !== '📊 Test Suite Summary');

// Calculate summary
const summary = {
  total: tests.length,
  passed: tests.filter(t => t.status === 'passed').length,
  failed: tests.filter(t => t.status === 'failed').length,
  skipped: tests.filter(t => t.status === 'skipped').length,
};
summary.passRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;

// Calculate total duration
const totalDuration = tests.reduce((sum, t) => sum + (t.duration || 0), 0);

// Format duration
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

// Format timestamp
function formatTimestamp(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString();
}

// Convert image to base64
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
    console.warn(`⚠️  Could not convert image to base64: ${imagePath}`, error.message);
    return null;
  }
}

// Process tests to embed images
console.log('📦 Processing tests and embedding images...');
tests.forEach(test => {
  // Embed screenshot
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
      if (att.contentType && att.contentType.startsWith('image/')) {
        const base64 = imageToBase64(att.path);
        if (base64) {
          console.log(`  ✓ Embedded ${att.name} for: ${test.testName}`);
          return { ...att, base64 };
        }
      }
      return att;
    });
  }
});

// Helper function to escape HTML
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

// Extract file name from location
function extractFileName(location) {
  if (!location) return '';
  const parts = location.split('/');
  return parts[parts.length - 1];
}

// Helper function to recursively render steps with indentation
function renderStepsWithIndent(steps, depth = 0) {
  if (!steps || steps.length === 0) return '';

  return steps.map((step, stepIndex) => {
    const hasSubsteps = step.steps && step.steps.length > 0;
    const indent = depth * 20;

    return `
      <div class="step-item ${step.error ? 'error' : ''}" style="margin-left: ${indent}px;">
        <div class="step-icon">${step.error ? '✕' : '✓'}</div>
        <div class="step-content">
          <div class="step-title">${escapeHtml(step.title)}</div>
          ${step.location ? `
            <div class="step-location">
               <span class="step-location-link">${escapeHtml(extractFileName(step.location))}</span>
            </div>
          ` : ''}
          ${step.error ? `
            <div class="step-error">${escapeHtml(step.error)}</div>
          ` : ''}
          ${hasSubsteps ? renderStepsWithIndent(step.steps, depth + 1) : ''}
        </div>
        ${step.category ? `<div class="step-category">${escapeHtml(step.category)}</div>` : ''}
        <div class="step-duration">${formatDuration(step.duration)}</div>
      </div>
    `;
  }).join('');
}

// Generate HTML
const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orchestrator Test Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f5f5f5;
      color: #333;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

    /* Header */
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    header h1 {
      font-size: 32px;
      margin-bottom: 10px;
      font-weight: 600;
    }
    header .subtitle {
      opacity: 0.9;
      font-size: 14px;
    }

    /* Summary Cards */
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: white;
      padding: 25px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      border-left: 4px solid;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .summary-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    }
    .summary-card h3 {
      font-size: 36px;
      margin-bottom: 8px;
      font-weight: 700;
    }
    .summary-card p {
      color: #666;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }
    .summary-card.total { border-left-color: #667eea; }
    .summary-card.total h3 { color: #667eea; }
    .summary-card.passed { border-left-color: #10b981; }
    .summary-card.passed h3 { color: #10b981; }
    .summary-card.failed { border-left-color: #ef4444; }
    .summary-card.failed h3 { color: #ef4444; }
    .summary-card.skipped { border-left-color: #f59e0b; }
    .summary-card.skipped h3 { color: #f59e0b; }
    .summary-card.duration { border-left-color: #8b5cf6; }
    .summary-card.duration h3 { color: #8b5cf6; font-size: 28px; }

    /* Controls */
    .controls {
      background: white;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      align-items: center;
    }
    .search-box {
      flex: 1;
      min-width: 250px;
      padding: 12px 16px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    .search-box:focus {
      outline: none;
      border-color: #667eea;
    }
    .filter-btn {
      padding: 12px 20px;
      border: 2px solid #e5e7eb;
      background: white;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .filter-btn:hover {
      border-color: #667eea;
      color: #667eea;
    }
    .filter-btn.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    .filter-btn.passed.active { background: #10b981; border-color: #10b981; }
    .filter-btn.failed.active { background: #ef4444; border-color: #ef4444; }
    .filter-btn.skipped.active { background: #f59e0b; border-color: #f59e0b; }

    /* Test List */
    .test-list {
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .test-item {
      border-bottom: 1px solid #f3f4f6;
      transition: background-color 0.2s;
    }
    .test-item:last-child { border-bottom: none; }
    .test-item:hover { background: #f9fafb; }

    .test-header {
      padding: 20px 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .test-status-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    .test-status-icon.passed { background: #d1fae5; color: #065f46; }
    .test-status-icon.failed { background: #fee2e2; color: #991b1b; }
    .test-status-icon.skipped { background: #fef3c7; color: #92400e; }

    .test-info {
      flex: 1;
      min-width: 0;
    }
    .test-name {
      font-size: 15px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 4px;
    }
    .test-meta {
      font-size: 13px;
      color: #6b7280;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    .priority-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .priority-highest { background: #fee2e2; color: #991b1b; }
    .priority-high { background: #fed7aa; color: #9a3412; }
    .priority-medium { background: #dbeafe; color: #1e40af; }
    .priority-low { background: #e5e7eb; color: #374151; }

    .test-duration {
      font-size: 14px;
      color: #6b7280;
      font-weight: 500;
      padding: 6px 12px;
      background: #f3f4f6;
      border-radius: 6px;
    }
    .expand-icon {
      font-size: 18px;
      color: #9ca3af;
      transition: transform 0.2s;
    }
    .test-item.expanded .expand-icon { transform: rotate(90deg); }

    /* Test Details */
    .test-details {
      display: none;
      padding: 0 24px 24px 24px;
      background: #f9fafb;
    }
    .test-item.expanded .test-details { display: block; }

    .detail-section {
      margin-bottom: 20px;
    }
    .detail-section:last-child { margin-bottom: 0; }
    .detail-title {
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Test Steps */
    .steps-list {
      background: white;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .step-item {
      padding: 12px 16px;
      border-bottom: 1px solid #f3f4f6;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: background 0.2s;
    }
    .step-item:last-child { border-bottom: none; }
    .step-item:hover { background: #f9fafb; }

    .step-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #10b981;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }
    .step-item.error .step-icon {
      background: #ef4444;
    }

    .step-content {
      flex: 1;
      min-width: 0;
    }
    .step-title {
      font-size: 13px;
      color: #111827;
      font-weight: 500;
      margin-bottom: 4px;
    }
    .step-location {
      font-size: 11px;
      color: #6b7280;
      font-family: 'Monaco', 'Menlo', monospace;
    }
    .step-location-link {
      color: #667eea;
      text-decoration: none;
    }
    .step-location-link:hover {
      text-decoration: underline;
    }
    .step-error {
      background: #fee2e2;
      color: #991b1b;
      padding: 8px;
      border-radius: 4px;
      font-size: 12px;
      margin-top: 8px;
      font-family: 'Monaco', 'Menlo', monospace;
    }

    .step-duration {
      font-size: 12px;
      color: #6b7280;
      background: #f3f4f6;
      padding: 4px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .step-category {
      font-size: 10px;
      color: #6b7280;
      background: #e5e7eb;
      padding: 2px 6px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .error-box {
      background: white;
      border: 2px solid #fee2e2;
      border-radius: 8px;
      padding: 16px;
      font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #991b1b;
      overflow-x: auto;
      max-height: 300px;
      overflow-y: auto;
    }
    .error-message {
      font-weight: 600;
      margin-bottom: 12px;
      color: #7f1d1d;
    }
    .error-stack {
      color: #dc2626;
      font-size: 12px;
      opacity: 0.9;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .error-location {
      background: #fef2f2;
      padding: 8px 12px;
      border-radius: 6px;
      margin-top: 12px;
      font-size: 12px;
    }

    .dependencies-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .dependency-tag {
      background: white;
      border: 2px solid #e5e7eb;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      color: #374151;
    }

    .attachments-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }
    .attachment-card {
      background: white;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      transition: border-color 0.2s;
      cursor: pointer;
    }
    .attachment-card:hover { border-color: #667eea; }
    .attachment-preview {
      width: 100%;
      height: 150px;
      object-fit: contain;
      background: #f3f4f6;
      cursor: pointer;
    }
    .attachment-info {
      padding: 12px;
    }
    .attachment-name {
      font-size: 12px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 4px;
    }

    .time-info {
      background: white;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      font-size: 13px;
    }
    .time-label {
      font-weight: 600;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .time-value {
      color: #111827;
    }

    .skip-reason {
      background: #fef3c7;
      border: 2px solid #fcd34d;
      border-radius: 8px;
      padding: 12px;
      font-size: 13px;
      color: #92400e;
    }

    /* Modal for full-size images */
    .modal {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0,0,0,0.9);
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
      color: #9ca3af;
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .empty-state-text {
      font-size: 16px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🎭 Test Orchestrator Report</h1>
      <p class="subtitle">
        Generated: ${formatTimestamp(new Date().toISOString())} |
        Pass Rate: ${summary.passRate.toFixed(1)}% |
        Total Duration: ${formatDuration(totalDuration)}
      </p>
    </header>

    <div class="summary">
      <div class="summary-card total">
        <h3>${summary.total}</h3>
        <p>Total Tests</p>
      </div>
      <div class="summary-card passed">
        <h3>${summary.passed}</h3>
        <p>Passed</p>
      </div>
      <div class="summary-card failed">
        <h3>${summary.failed}</h3>
        <p>Failed</p>
      </div>
      <div class="summary-card skipped">
        <h3>${summary.skipped}</h3>
        <p>Skipped</p>
      </div>
      <div class="summary-card duration">
        <h3>${formatDuration(totalDuration)}</h3>
        <p>Total Duration</p>
      </div>
    </div>

    <div class="controls">
      <input type="text" class="search-box" id="searchBox" placeholder=" Search tests..." />
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn passed" data-filter="passed"> Passed</button>
      <button class="filter-btn failed" data-filter="failed">❌ Failed</button>
      <button class="filter-btn skipped" data-filter="skipped">⏭️ Skipped</button>
    </div>

    <div class="test-list" id="testList">
      ${tests.map((test, index) => `
        <div class="test-item" data-status="${test.status}" data-test-name="${escapeHtml(test.testName)}">
          <div class="test-header" onclick="toggleTest(${index})">
            <div class="test-status-icon ${test.status}">
              ${test.status === 'passed' ? '✓' : test.status === 'failed' ? '✕' : '⊘'}
            </div>
            <div class="test-info">
              <div class="test-name">${escapeHtml(test.testName)}</div>
              <div class="test-meta">
                ${test.priority ? `<span class="priority-badge priority-${test.priority}">${test.priority}</span>` : ''}
                ${test.steps && test.steps.length > 0 ? `<span>📝 ${test.steps.length} steps</span>` : ''}
                ${test.dependencies && test.dependencies.length > 0
                  ? `<span>📎 ${test.dependencies.length} ${test.dependencies.length === 1 ? 'dependency' : 'dependencies'}</span>`
                  : ''}
                ${test.startTime ? `<span>🕐 ${formatTimestamp(test.startTime)}</span>` : ''}
              </div>
            </div>
            <div class="test-duration">${formatDuration(test.duration || 0)}</div>
            <div class="expand-icon">›</div>
          </div>

          <div class="test-details">
            ${test.steps && test.steps.length > 0 ? `
              <div class="detail-section">
                <div class="detail-title">📝 Test Steps</div>
                <div class="steps-list">
                  ${renderStepsWithIndent(test.steps, 0)}
                </div>
              </div>
            ` : ''}

            ${test.status === 'failed' && (test.error || test.errorDetails) ? `
              <div class="detail-section">
                <div class="detail-title">❌ Error Details</div>
                <div class="error-box">
                  ${test.errorDetails ? `
                    <div class="error-message">${escapeHtml(test.errorDetails.message || test.error)}</div>
                    ${test.errorDetails.location ? `
                      <div class="error-location">
                         ${escapeHtml(test.errorDetails.location.file)}:${test.errorDetails.location.line}:${test.errorDetails.location.column}
                      </div>
                    ` : ''}
                    ${test.errorDetails.stack ? `
                      <div class="error-stack">${escapeHtml(test.errorDetails.stack)}</div>
                    ` : ''}
                  ` : `
                    <div class="error-message">${escapeHtml(test.error)}</div>
                  `}
                </div>
              </div>
            ` : ''}

            ${test.status === 'skipped' && test.reason ? `
              <div class="detail-section">
                <div class="detail-title">⏭️ Skip Reason</div>
                <div class="skip-reason">${escapeHtml(test.reason)}</div>
              </div>
            ` : ''}

            ${test.dependencies && test.dependencies.length > 0 ? `
              <div class="detail-section">
                <div class="detail-title">🔗 Dependencies</div>
                <div class="dependencies-list">
                  ${test.dependencies.map(dep => `
                    <div class="dependency-tag">${escapeHtml(dep)}</div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            ${(test.attachments && test.attachments.length > 0) || test.screenshotBase64 ? `
              <div class="detail-section">
                <div class="detail-title">📎 Attachments</div>
                <div class="attachments-grid">
                  ${test.attachments && test.attachments.length > 0 ? test.attachments.map((attachment, attIndex) => `
                    <div class="attachment-card" onclick="openModal('test${index}_att${attIndex}')">
                      ${attachment.base64 ? `
                        <img id="test${index}_att${attIndex}"
                             src="${attachment.base64}"
                             alt="${escapeHtml(attachment.name)}"
                             class="attachment-preview" />
                      ` : `
                        <div class="attachment-preview" style="display: flex; align-items: center; justify-content: center; color: #6b7280;">
                          📄 ${escapeHtml(attachment.name)}
                        </div>
                      `}
                      <div class="attachment-info">
                        <div class="attachment-name">${escapeHtml(attachment.name)}</div>
                      </div>
                    </div>
                  `).join('') : ''}
                  ${test.screenshotBase64 && (!test.attachments || !test.attachments.some(a => a.name === 'screenshot')) ? `
                    <div class="attachment-card" onclick="openModal('test${index}_screenshot')">
                      <img id="test${index}_screenshot"
                           src="${test.screenshotBase64}"
                           alt="Failure Screenshot"
                           class="attachment-preview" />
                      <div class="attachment-info">
                        <div class="attachment-name">Failure Screenshot</div>
                      </div>
                    </div>
                  ` : ''}
                </div>
              </div>
            ` : ''}

            ${test.startTime || test.endTime ? `
              <div class="detail-section">
                <div class="detail-title">⏱️ Timing Information</div>
                <div class="time-info">
                  ${test.startTime ? `
                    <div>
                      <div class="time-label">Started</div>
                      <div class="time-value">${formatTimestamp(test.startTime)}</div>
                    </div>
                  ` : ''}
                  ${test.endTime ? `
                    <div>
                      <div class="time-label">Finished</div>
                      <div class="time-value">${formatTimestamp(test.endTime)}</div>
                    </div>
                  ` : ''}
                  <div>
                    <div class="time-label">Duration</div>
                    <div class="time-value">${formatDuration(test.duration || 0)}</div>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('\n')}
    </div>

    <div class="empty-state" id="emptyState" style="display: none;">
      <div class="empty-state-icon"></div>
      <div class="empty-state-text">No tests match your search or filter</div>
    </div>
  </div>

  <!-- Image Modal -->
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

    // Search functionality
    const searchBox = document.getElementById('searchBox');
    searchBox.addEventListener('input', filterTests);

    // Filter functionality
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterTests();
      });
    });

    function filterTests() {
      const searchTerm = searchBox.value.toLowerCase();
      const activeFilter = document.querySelector('.filter-btn.active').dataset.filter;
      const items = document.querySelectorAll('.test-item');
      let visibleCount = 0;

      items.forEach(item => {
        const testName = item.dataset.testName.toLowerCase();
        const status = item.dataset.status;

        const matchesSearch = testName.includes(searchTerm);
        const matchesFilter = activeFilter === 'all' || status === activeFilter;

        if (matchesSearch && matchesFilter) {
          item.style.display = '';
          visibleCount++;
        } else {
          item.style.display = 'none';
        }
      });

      // Show empty state if no tests visible
      document.getElementById('emptyState').style.display = visibleCount === 0 ? 'block' : 'none';
      document.getElementById('testList').style.display = visibleCount === 0 ? 'none' : 'block';
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    });
  </script>
</body>
</html>
`;

// Write HTML file
fs.writeFileSync(OUTPUT_FILE, html);

console.log('\n✅ Self-Contained Orchestrator HTML Report Generated!');
console.log(`📄 Report: ${OUTPUT_FILE}`);
console.log(`📦 All images embedded as base64 (no external dependencies)`);
console.log(`\n📊 Summary:`);
console.log(`   Total: ${summary.total}`);
console.log(`   ✅ Passed: ${summary.passed}`);
console.log(`   ❌ Failed: ${summary.failed}`);
console.log(`   ⏭️ Skipped: ${summary.skipped}`);
console.log(`   📈 Pass Rate: ${summary.passRate.toFixed(1)}%`);
console.log(`   ⏱️  Total Duration: ${formatDuration(totalDuration)}`);

// Auto-open the report in browser (skip if --no-open flag is present)
const shouldOpen = !process.argv.includes('--no-open');

if (shouldOpen) {
  try {
    const platform = process.platform;
    let openCommand;

    if (platform === 'darwin') {
      openCommand = `open "${OUTPUT_FILE}"`;
    } else if (platform === 'win32') {
      openCommand = `start "" "${OUTPUT_FILE}"`;
    } else {
      // Linux and others
      openCommand = `xdg-open "${OUTPUT_FILE}"`;
    }

    console.log('\n🌐 Opening report in browser...');
    execSync(openCommand);
    console.log(' Report opened successfully!\n');
  } catch (error) {
    console.warn('⚠️  Could not auto-open report. Please open manually:', OUTPUT_FILE);
    console.log(`   Command: open ${OUTPUT_FILE}\n`);
  }
} else {
  console.log('\n Report generation complete (auto-open skipped)\n');
}

// Exit with error code if any tests failed (only when run manually, not from reporter)
// When --no-open is present, it means we're being called from the reporter, so don't exit with error
if (shouldOpen) {
  process.exit(summary.failed > 0 ? 1 : 0);
} else {
  // Exit with success even if tests failed, since reporter will handle the exit code
  process.exit(0);
}
