/**
 * Enhanced Reporter for Priority and Dependency Information
 * Adds priority and dependency metadata to test reports
 */

import { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { dependencyManager } from './dependency-manager';
import { PriorityExecutionStats, TestPriority, TestMetadata } from '@/types';
import { slackNotifier, SlackNotificationData, SlackNotificationResult } from '../utils/slack-notifier';
import { configManager } from './config-manager';
import { testRunDbService } from '../utils/test-run-db-service';
import { pdfReportService } from '../utils/pdf-report-service';
import fs from 'fs';
import path from 'path';

export default class EnhancedReporter implements Reporter {
  private stats: PriorityExecutionStats | null = null;
  private testResults = new Map<string, { result: TestResult; metadata?: TestMetadata; testCase: TestCase }>();

  onBegin() {
    console.log(' Enhanced Reporter: Starting test execution with priority and dependency tracking');
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const testName = test.title;

    // Exclude the orchestrator summary test from reports
    if (testName === ' Test Suite Summary') {
      return;
    }

    const metadata = dependencyManager.getTestMetadata(testName);

    // Store the actual Playwright test result
    this.testResults.set(testName, { result, metadata, testCase: test });
    
    if (metadata) {
      // Add priority and dependency info to test annotations
      if (metadata.priority) {
        test.annotations.push({
          type: 'priority',
          description: `Priority: ${metadata.priority.toUpperCase()}`
        });
      }
      
      if (metadata.dependsOn && metadata.dependsOn.length > 0) {
        test.annotations.push({
          type: 'dependencies',
          description: `Depends on: ${metadata.dependsOn.join(', ')}`
        });
      }
      
      if (metadata.tags && metadata.tags.length > 0) {
        test.annotations.push({
          type: 'tags',
          description: `Tags: ${metadata.tags.join(', ')}`
        });
      }
    }

    // Check if test was skipped due to dependencies
    const executionResult = dependencyManager.getExecutionResults().get(testName);
    if (executionResult && executionResult.status === 'skipped' && executionResult.reason) {
      test.annotations.push({
        type: 'skip-reason',
        description: executionResult.reason
      });
      
      // Also add to test result
      result.status = 'skipped';
      if (!result.errors) {
        result.errors = [];
      }
      result.errors.push({
        message: executionResult.reason,
        location: undefined,
        stack: undefined
      });
    }
  }

  async onEnd(result: FullResult) {
    // Get stats from dependency manager
    this.stats = dependencyManager.getExecutionStats();
    
    // If no tests were tracked by dependency manager, build stats from Playwright results
    if (this.stats.highest.total === 0 && this.stats.high.total === 0 && 
        this.stats.medium.total === 0 && this.stats.low.total === 0) {
      this.stats = this.buildStatsFromPlaywrightResults(result);
    }
    
    this.generateEnhancedReport();

    console.log('\n Enhanced Reporter: Test execution completed');
    console.log('📈 Priority and Dependency Statistics:');
    console.log(`   Highest Priority: ${this.stats.highest.total} tests (${this.stats.highest.passed} passed, ${this.stats.highest.failed} failed, ${this.stats.highest.skipped} skipped)`);
    console.log(`   High Priority: ${this.stats.high.total} tests (${this.stats.high.passed} passed, ${this.stats.high.failed} failed, ${this.stats.high.skipped} skipped)`);
    console.log(`   Medium Priority: ${this.stats.medium.total} tests (${this.stats.medium.passed} passed, ${this.stats.medium.failed} failed, ${this.stats.medium.skipped} skipped)`);
    console.log(`   Low Priority: ${this.stats.low.total} tests (${this.stats.low.passed} passed, ${this.stats.low.failed} failed, ${this.stats.low.skipped} skipped)`);
    console.log(`   Total Dependency Skips: ${this.stats.totalDependencySkips}`);
    console.log(`   Tests with Dependencies: ${this.stats.dependencyChains}`);

    // Generate orchestrator HTML report before sending Slack notification
    await this.generateOrchestratorReport();

    // Send Slack notification
    await this.sendSlackNotification();

    // Print custom report location
    this.printCustomReportInfo();
  }

  /**
   * Print information about how to open custom reports
   */
  private printCustomReportInfo(): void {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                   CUSTOM ORCHESTRATOR REPORT GENERATED                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

    // Use module-specific paths if MODULE_NAME is set (for parallel runs)
    const moduleName = process.env.MODULE_NAME || 'default';
    const reports = [];

    // Check for detailed step report (module-specific or default)
    const detailedStepReport = path.join('reports', `detailed-step-report${moduleName !== 'default' ? '-' + moduleName : ''}.html`);
    if (fs.existsSync(detailedStepReport)) {
      reports.push({
        name: 'Detailed Step Report (Recommended)',
        file: detailedStepReport,
        command: `open ${detailedStepReport}`
      });
    }

    // Check for Playwright-style orchestrator report (module-specific or default)
    const playwrightStyleReport = path.join('reports', `orchestrator-playwright-report${moduleName !== 'default' ? '-' + moduleName : ''}.html`);
    if (fs.existsSync(playwrightStyleReport)) {
      reports.push({
        name: 'Playwright-Style Orchestrator Report',
        file: playwrightStyleReport,
        command: `open ${playwrightStyleReport}`
      });
    }

    // Check for basic orchestrator report (module-specific or default)
    const basicReport = path.join('reports', `orchestrator-custom-report${moduleName !== 'default' ? '-' + moduleName : ''}.html`);
    if (fs.existsSync(basicReport)) {
      reports.push({
        name: 'Basic Orchestrator Report',
        file: basicReport,
        command: `open ${basicReport}`
      });
    }

    if (reports.length > 0) {
      console.log('\n');
      console.log(' To open the CUSTOM ORCHESTRATOR REPORT with detailed steps, run:');
      console.log('');
      console.log(`   ${reports[0].command}`);
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } else {
      console.log('\n️  No custom orchestrator reports found in reports/ directory\n');
    }
  }

  /**
   * Build priority stats from orchestrator results (accurate test status)
   */
  private buildStatsFromOrchestratorResults(tests: any[]): PriorityExecutionStats {
    const stats: PriorityExecutionStats = {
      highest: { total: 0, passed: 0, failed: 0, skipped: 0 },
      high: { total: 0, passed: 0, failed: 0, skipped: 0 },
      medium: { total: 0, passed: 0, failed: 0, skipped: 0 },
      low: { total: 0, passed: 0, failed: 0, skipped: 0 },
      totalDependencySkips: 0,
      dependencyChains: 0
    };

    for (const test of tests) {
      const priority: TestPriority = test.priority || 'medium';
      const priorityStats = stats[priority];

      priorityStats.total++;

      // Use orchestrator's accurate test status
      switch (test.status) {
        case 'passed':
          priorityStats.passed++;
          break;
        case 'failed':
          priorityStats.failed++;
          break;
        case 'skipped':
          priorityStats.skipped++;
          if (test.reason?.includes('dependency') || test.reason?.includes('Dependencies')) {
            stats.totalDependencySkips++;
          }
          break;
      }
    }

    // Count dependency chains
    stats.dependencyChains = tests.filter(t => t.dependencies && t.dependencies.length > 0).length;

    return stats;
  }

  private buildStatsFromPlaywrightResults(result: FullResult): PriorityExecutionStats {
    const stats: PriorityExecutionStats = {
      highest: { total: 0, passed: 0, failed: 0, skipped: 0 },
      high: { total: 0, passed: 0, failed: 0, skipped: 0 },
      medium: { total: 0, passed: 0, failed: 0, skipped: 0 },
      low: { total: 0, passed: 0, failed: 0, skipped: 0 },
      totalDependencySkips: 0,
      dependencyChains: 0
    };

    // Use actual Playwright test results
    for (const [testName, testData] of this.testResults) {
      const metadata = testData.metadata;
      const playwrightResult = testData.result;
      
      const priority: TestPriority = metadata?.priority || 'medium';
      const priorityStats = stats[priority];
      
      priorityStats.total++;
      
      // Use Playwright's actual test status
      switch (playwrightResult.status) {
        case 'passed':
          priorityStats.passed++;
          break;
        case 'failed':
          priorityStats.failed++;
          break;
        case 'skipped':
          priorityStats.skipped++;
          // Check if it was skipped due to dependencies
          const executionResult = dependencyManager.getExecutionResults().get(testName);
          if (executionResult?.reason?.includes('Dependency failed')) {
            stats.totalDependencySkips++;
          }
          break;
        case 'timedOut':
          priorityStats.failed++; // Treat timeout as failure
          break;
      }
    }

    // Also include tests that were registered but never executed (skipped by dependency system)
    const allTests = dependencyManager.getAllTests();
    const executionResults = dependencyManager.getExecutionResults();
    
    for (const [testName, metadata] of allTests) {
      // If test was registered but not executed by Playwright
      if (!this.testResults.has(testName)) {
        const priority: TestPriority = metadata.priority || 'medium';
        const priorityStats = stats[priority];
        
        priorityStats.total++;
        priorityStats.skipped++;
        
        // Check if it was skipped due to dependencies
        const executionResult = executionResults.get(testName);
        if (executionResult?.reason?.includes('Dependency failed')) {
          stats.totalDependencySkips++;
        }
      }
    }

    // Count dependency chains
    const dependencyGraph = dependencyManager.getDependencyGraph();
    if (dependencyGraph) {
      stats.dependencyChains = Array.from(dependencyGraph.nodes.values())
        .filter(node => node.dependencies.length > 0).length;
    }

    return stats;
  }

  private generateEnhancedReport() {
    if (!this.stats) return;

    const reportData = {
      timestamp: new Date().toISOString(),
      priorityStats: this.stats,
      dependencyGraph: this.serializeDependencyGraph(),
      executionResults: this.serializeExecutionResults(),
      summary: this.generateSummary()
    };

    // Ensure reports directory exists
    const reportsDir = 'reports';
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Get module name for unique file naming
    const moduleName = this.determineModuleName();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Write enhanced report with module-specific name
    const reportPath = path.join(reportsDir, `priority-dependency-report-${moduleName}-${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));

    // Generate HTML summary with module-specific name
    this.generateHtmlSummary(reportData, moduleName, timestamp);

    console.log(` Enhanced report saved: ${reportPath}`);
    console.log(` HTML summary saved: ${path.join(reportsDir, `priority-dependency-summary-${moduleName}-${timestamp}.html`)}`);
  }

  private serializeDependencyGraph() {
    const graph = dependencyManager.getDependencyGraph();
    if (!graph) return null;

    return {
      executionOrder: graph.executionOrder,
      hasCycles: graph.hasCycles,
      cycles: graph.cycles,
      nodes: Array.from(graph.nodes.entries()).map(([name, node]) => ({
        testName: name,
        priority: node.priority,
        dependencies: node.dependencies,
        dependents: node.dependents,
        status: node.status
      }))
    };
  }

  private serializeExecutionResults() {
    const results = dependencyManager.getExecutionResults();
    return Array.from(results.entries()).map(([name, result]) => ({
      testName: name,
      status: result.status,
      duration: result.duration,
      priority: result.priority,
      dependencies: result.dependencies,
      reason: result.reason,
      error: result.error
    }));
  }

  private generateSummary() {
    if (!this.stats) return {};

    const totalTests = this.stats.highest.total + this.stats.high.total + 
                      this.stats.medium.total + this.stats.low.total;
    const totalPassed = this.stats.highest.passed + this.stats.high.passed + 
                       this.stats.medium.passed + this.stats.low.passed;
    const totalFailed = this.stats.highest.failed + this.stats.high.failed + 
                       this.stats.medium.failed + this.stats.low.failed;
    const totalSkipped = this.stats.highest.skipped + this.stats.high.skipped + 
                        this.stats.medium.skipped + this.stats.low.skipped;

    return {
      totalTests,
      totalPassed,
      totalFailed,
      totalSkipped,
      dependencySkips: this.stats.totalDependencySkips,
      dependencyChains: this.stats.dependencyChains,
      passRate: totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0
    };
  }

  /**
   * Generate orchestrator HTML report
   */
  private async generateOrchestratorReport(): Promise<void> {
    // Use module-specific paths if MODULE_NAME is set (for parallel runs)
    const moduleName = process.env.MODULE_NAME || 'default';
    const orchestratorResultsPath = path.join('reports', `orchestrator-results-${moduleName}.json`);
    const playwrightResultsPath = path.join('reports', 'test-results.json');

    // Only generate if orchestrator results exist
    if (!fs.existsSync(orchestratorResultsPath)) {
      console.log('️  Orchestrator results not found, skipping custom report generation');
      return;
    }

    try {
      console.log(' Generating detailed step report...');
      const { execSync } = require('child_process');

      // Check if blob report exists (contains detailed steps)
      // Use module-specific blob path for parallel runs
      const blobReportPath = path.join('reports', `blob-report${moduleName !== 'default' ? '-' + moduleName : ''}`);

      if (fs.existsSync(blobReportPath)) {
        // Generate Playwright-style UI report with collapsible steps
        execSync('node scripts/generate-playwright-ui-report.js --no-open', {
          stdio: 'inherit',
          cwd: process.cwd(),
          env: { ...process.env, MODULE_NAME: moduleName }
        });
        console.log(' Playwright-style UI report generated');
      } else if (fs.existsSync(playwrightResultsPath)) {
        // Fallback to enhanced Playwright-style report
        execSync('node scripts/generate-playwright-style-orchestrator-report.js --no-open', {
          stdio: 'inherit',
          cwd: process.cwd(),
          env: { ...process.env, MODULE_NAME: moduleName }
        });
        console.log(' Enhanced Playwright-style orchestrator report generated');
      } else {
        console.log('️  No detailed test data found, falling back to basic report');
        // Fallback to basic orchestrator report
        execSync('node scripts/generate-orchestrator-report.js --no-open', {
          stdio: 'inherit',
          cwd: process.cwd(),
          env: { ...process.env, MODULE_NAME: moduleName }
        });
        console.log(' Basic orchestrator report generated');
      }
    } catch (error) {
      console.error(' Error generating orchestrator report:', error);
      console.log('️  Continuing with Slack notification using available data');
    }
  }

  /**
   * Send Slack notification with test execution results
   */
  private async sendSlackNotification(): Promise<void> {
    if (!this.stats) return;

    try {
      const config = configManager.getConfig();

      // Check if orchestrator results exist and use them instead
      // Use module-specific paths if MODULE_NAME is set (for parallel runs)
      const envModuleName = process.env.MODULE_NAME || 'default';
      const orchestratorResultsPath = path.join('reports', `orchestrator-results-${envModuleName}.json`);
      let summary = this.generateSummary();
      const displayModuleName = this.determineModuleName();

      // Prefer detailed step report, then Playwright-style, then basic report
      // Use module-specific names for parallel runs
      let htmlReportPath = path.join('reports', `detailed-step-report${envModuleName !== 'default' ? '-' + envModuleName : ''}.html`);
      if (!fs.existsSync(htmlReportPath)) {
        htmlReportPath = path.join('reports', `orchestrator-playwright-report${envModuleName !== 'default' ? '-' + envModuleName : ''}.html`);
      }
      if (!fs.existsSync(htmlReportPath)) {
        htmlReportPath = path.join('reports', `orchestrator-custom-report${envModuleName !== 'default' ? '-' + envModuleName : ''}.html`);
      }

      if (fs.existsSync(orchestratorResultsPath)) {
        console.log(' Using orchestrator results for Slack notification (accurate test status)');
        const orchestratorResults = JSON.parse(fs.readFileSync(orchestratorResultsPath, 'utf-8'));
        const tests = Object.values(orchestratorResults) as any[];

        // Calculate summary from orchestrator results (accurate status)
        summary = {
          totalTests: tests.length,
          totalPassed: tests.filter(t => t.status === 'passed').length,
          totalFailed: tests.filter(t => t.status === 'failed').length,
          totalSkipped: tests.filter(t => t.status === 'skipped').length,
          dependencySkips: tests.filter(t => t.status === 'skipped' && t.reason?.includes('dependency')).length,
          dependencyChains: this.stats.dependencyChains,
          passRate: 0
        };
        summary.passRate = summary.totalTests > 0 ? Math.round((summary.totalPassed / summary.totalTests) * 100) : 0;

        // Calculate priority stats from orchestrator results (accurate status)
        this.stats = this.buildStatsFromOrchestratorResults(tests);

        console.log(' Orchestrator summary:', summary);
        console.log(' Orchestrator priority stats:', this.stats);
      } else {
        console.log('️  Orchestrator results not found, using Playwright results');
        // Fall back to Playwright's default HTML report if orchestrator report doesn't exist
        htmlReportPath = path.join('reports', 'html-report', 'index.html');
      }

      // Look for the dynamic HTML report directory created by the script
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      let playwrightHtmlReportPath = path.join('reports', `html-report-${envModuleName}-${timestamp}`, 'index.html');

      let finalHtmlReportPath: string | undefined;

      // First try to find the dynamic HTML report directory
      const reportsDir = 'reports';
      let htmlReportDir: string | undefined;

      if (fs.existsSync(reportsDir)) {
        const reportDirs = fs.readdirSync(reportsDir).filter(dir =>
          dir.startsWith(`html-report-${envModuleName}-`) &&
          fs.statSync(path.join(reportsDir, dir)).isDirectory()
        );
        
        if (reportDirs.length > 0) {
          // Use the most recent directory (last in alphabetical order due to timestamp)
          htmlReportDir = reportDirs.sort().pop();
          playwrightHtmlReportPath = path.join(reportsDir, htmlReportDir!, 'index.html');
        }
      }
      
      // Priority 1: Try custom orchestrator report if it exists
      if (fs.existsSync(htmlReportPath)) {
        console.log(' Using custom orchestrator HTML report (no zipping)');
        finalHtmlReportPath = htmlReportPath;
      }
      // Priority 2: Try dynamic HTML report directory with module-specific naming
      else if (htmlReportDir && fs.existsSync(playwrightHtmlReportPath)) {
        console.log(' Using module-specific HTML report (no zipping)');
        finalHtmlReportPath = playwrightHtmlReportPath;
      }
      // Priority 3: Fallback to default Playwright HTML report
      else {
        const fallbackPlaywrightPath = path.join('reports', 'html-report', 'index.html');
        if (fs.existsSync(fallbackPlaywrightPath)) {
          console.log(' Using default Playwright HTML report (no zipping)');
          finalHtmlReportPath = fallbackPlaywrightPath;
        }
      }

      const slackData: SlackNotificationData = {
        totalTests: summary.totalTests || 0,
        totalPassed: summary.totalPassed || 0,
        totalFailed: summary.totalFailed || 0,
        totalSkipped: summary.totalSkipped || 0,
        executionTime: new Date().toISOString(),
        testEnvUrl: config.baseUrl || 'https://xyne.juspay.net',
        scriptRunBy: process.env.SCRIPT_RUN_BY || process.env.USER || process.env.USERNAME || 'Unknown User',
        moduleName: displayModuleName,  // Use the determined module name for display
        htmlReportPath: finalHtmlReportPath,
        priorityStats: {
          highest: this.stats.highest,
          high: this.stats.high,
          medium: this.stats.medium,
          low: this.stats.low
        }
      };

      const slackResult = await slackNotifier.sendTestCompletionNotification(slackData);

      // Store test results in database after Slack notification
      await this.storeTestResultsInDatabase(slackData, slackResult);
    } catch (error) {
      console.error(' Error sending Slack notification:', error);
    }
  }

  /**
   * Store test results in database
   */
  private async storeTestResultsInDatabase(slackData: SlackNotificationData, slackResult: SlackNotificationResult): Promise<void> {
    try {
      if (!this.stats) {
        console.log(' No stats available for database storage');
        return;
      }

      console.log('💾 Attempting to store test results in database...');

      // Get actual Slack message URL if available, otherwise fallback to generic message
      const slackReportLink = slackResult.success && slackResult.messageUrl ?
        slackResult.messageUrl :
        (slackData.htmlReportPath ? `Slack notification sent for ${slackData.moduleName}` : undefined);

      // Store module-level results in database (xyne_test_module table)
      await this.storeModuleLevelResults(slackData, slackReportLink);

    } catch (error) {
      // Database storage is non-critical, so we log but don't throw
      console.warn('️ Database storage encountered an issue:', error);
    }
  }

  /**
   * Store module-level test results in test_modules table
   */
  private async storeModuleLevelResults(slackData: SlackNotificationData, slackReportLink?: string): Promise<void> {
    try {
      const cronRunId = process.env.CRON_RUN_ID;

      // Only save to test_modules table if this is a cron run
      if (!cronRunId) {
        console.log('️  Skipping test_modules table (not a cron run)');
        return;
      }

      // Check if database operations should be performed
      const shouldPerform = await testRunDbService.shouldPerformDbOperations();
      if (!shouldPerform) {
        return;
      }

      console.log('💾 Saving module results to test_modules table...');

      // Load orchestrator results to get accurate test status
      const moduleName = slackData.moduleName || 'unknown-module';
      const orchestratorResultsPath = path.join('reports', `orchestrator-results-${moduleName}.json`);
      let orchestratorResultsMap: Map<string, any> = new Map();

      if (fs.existsSync(orchestratorResultsPath)) {
        try {
          console.log(' Loading orchestrator results for accurate test status...');
          const orchestratorResults = JSON.parse(fs.readFileSync(orchestratorResultsPath, 'utf-8'));

          // Create map of test name -> orchestrator result
          for (const [testName, result] of Object.entries(orchestratorResults)) {
            orchestratorResultsMap.set(testName, result);
          }

          console.log(` Loaded ${orchestratorResultsMap.size} orchestrator results`);
        } catch (error) {
          console.warn('️ Failed to load orchestrator results, falling back to Playwright results:', error);
        }
      } else {
        console.log('️ Orchestrator results not found, using Playwright results');
      }

      // Build detailed test data array from test results
      const tests = [];
      for (const [testName, testData] of this.testResults) {
        const { result, metadata } = testData;

        // Get orchestrator result if available (contains accurate status after dependency chain enforcement)
        const orchestratorResult = orchestratorResultsMap.get(testName);

        tests.push({
          name: testName,
          status: orchestratorResult?.status || result.status, // Use orchestrator status (accurate) or fallback to Playwright
          priority: metadata?.priority || 'medium',
          duration_ms: orchestratorResult?.duration || result.duration,
          started_at: result.startTime ? new Date(result.startTime).toISOString() : new Date().toISOString(),
          completed_at: new Date().toISOString(),
          error_message: orchestratorResult?.error || result.errors?.[0]?.message || undefined,
          error_stack: result.errors?.[0]?.stack || undefined,
          skip_reason: orchestratorResult?.reason || (result.status === 'skipped' ? (result.errors?.[0]?.message || 'Skipped') : undefined)
        });
      }

      // Save to test_modules table
      await testRunDbService.saveModuleResults({
        cronRunId,
        moduleName: slackData.moduleName || 'unknown-module',
        runData: { tests },
        startedAt: new Date().toISOString(), // TODO: Track actual start time
        completedAt: new Date().toISOString(),
        slackReportLink: slackReportLink || undefined
      });

      console.log(' Module results saved to test_modules table');
    } catch (error) {
      console.warn('️ Failed to save module-level results:', error);
    }
  }

  /**
   * Determine module name from test results or environment
   */
  private determineModuleName(): string {
    // Check environment variable first (highest priority)
    const envModuleName = process.env.MODULE_NAME;
    if (envModuleName && envModuleName !== 'default') {
      return envModuleName;
    }

    // Try to extract from process.argv (Playwright test file argument)
    // Playwright often passes the test file as an argument
    const testFileArg = process.argv.find(arg => arg.includes('.spec.ts') || arg.includes('.test.ts'));
    if (testFileArg) {
      const moduleName = this.extractModuleNameFromPath(testFileArg);
      if (moduleName) {
        return moduleName;
      }
    }

    // Extract module name from test file paths in test results
    // For a file like "tests/functional/agent-module.spec.ts", return "agent-module"
    for (const [testName, testData] of this.testResults) {
      const testCase = testData.testCase;

      // Get the test file path from the test case location
      if (testCase.location?.file) {
        const moduleName = this.extractModuleNameFromPath(testCase.location.file);
        if (moduleName) {
          return moduleName;
        }
      }

      // Fallback: try to get file path from test result attachments
      const testResult = testData.result;
      if (testResult.attachments && testResult.attachments.length > 0) {
        for (const attachment of testResult.attachments) {
          if (attachment.path) {
            const moduleName = this.extractModuleNameFromPath(attachment.path);
            if (moduleName) {
              return moduleName;
            }
          }
        }
      }
    }

    // If MODULE_NAME is 'default', try to get the actual test file name
    if (envModuleName === 'default') {
      // Look for any .spec.ts file in process arguments
      for (const arg of process.argv) {
        if (arg.includes('.spec.ts') || arg.includes('.test.ts')) {
          const moduleName = this.extractModuleNameFromPath(arg);
          if (moduleName) {
            return moduleName;
          }
        }
      }
    }

    // Final fallback - return 'default' instead of 'Xyne' for clarity
    return envModuleName || 'XYNE';
  }

  /**
   * Extract module name from file path
   * For "tests/functional/agent-module.spec.ts" returns "agent-module"
   */
  private extractModuleNameFromPath(filePath: string): string | null {
    if (!filePath) return null;
    
    // Get the filename from the path
    const fileName = path.basename(filePath);
    
    // Remove .spec.ts, .test.ts, .spec.js, .test.js extensions
    const moduleNameMatch = fileName.match(/^(.+)\.(?:spec|test)\.[jt]s$/);
    if (moduleNameMatch) {
      return moduleNameMatch[1];
    }
    
    return null;
  }

  private generateHtmlSummary(reportData: any, moduleName: string, timestamp: string) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Priority & Dependency Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff; }
        .stat-card.highest { border-left-color: #dc3545; }
        .stat-card.high { border-left-color: #fd7e14; }
        .stat-card.medium { border-left-color: #ffc107; }
        .stat-card.low { border-left-color: #28a745; }
        .stat-title { font-weight: bold; font-size: 1.1em; margin-bottom: 10px; }
        .stat-value { font-size: 2em; font-weight: bold; color: #333; }
        .stat-details { margin-top: 10px; font-size: 0.9em; color: #666; }
        .dependency-graph { margin-top: 30px; }
        .execution-order { background: #e9ecef; padding: 15px; border-radius: 4px; margin: 10px 0; }
        .test-list { margin-top: 20px; }
        .test-item { background: #f8f9fa; margin: 5px 0; padding: 10px; border-radius: 4px; border-left: 3px solid #ccc; }
        .test-item.passed { border-left-color: #28a745; }
        .test-item.failed { border-left-color: #dc3545; }
        .test-item.skipped { border-left-color: #ffc107; }
        .test-name { font-weight: bold; }
        .test-meta { font-size: 0.9em; color: #666; margin-top: 5px; }
        .priority-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; }
        .priority-highest { background: #dc3545; color: white; }
        .priority-high { background: #fd7e14; color: white; }
        .priority-medium { background: #ffc107; color: black; }
        .priority-low { background: #28a745; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1> Priority & Dependency Test Report</h1>
            <p>Generated on ${new Date(reportData.timestamp).toLocaleString()}</p>
        </div>

        <div class="stats-grid">
            <div class="stat-card highest">
                <div class="stat-title"> Highest Priority</div>
                <div class="stat-value">${reportData.priorityStats.highest.total}</div>
                <div class="stat-details">
                     ${reportData.priorityStats.highest.passed} passed<br>
                     ${reportData.priorityStats.highest.failed} failed<br>
                    ⏭ ${reportData.priorityStats.highest.skipped} skipped
                </div>
            </div>
            
            <div class="stat-card high">
                <div class="stat-title">🟠 High Priority</div>
                <div class="stat-value">${reportData.priorityStats.high.total}</div>
                <div class="stat-details">
                     ${reportData.priorityStats.high.passed} passed<br>
                     ${reportData.priorityStats.high.failed} failed<br>
                    ⏭ ${reportData.priorityStats.high.skipped} skipped
                </div>
            </div>
            
            <div class="stat-card medium">
                <div class="stat-title"> Medium Priority</div>
                <div class="stat-value">${reportData.priorityStats.medium.total}</div>
                <div class="stat-details">
                     ${reportData.priorityStats.medium.passed} passed<br>
                     ${reportData.priorityStats.medium.failed} failed<br>
                    ⏭ ${reportData.priorityStats.medium.skipped} skipped
                </div>
            </div>
            
            <div class="stat-card low">
                <div class="stat-title"> Low Priority</div>
                <div class="stat-value">${reportData.priorityStats.low.total}</div>
                <div class="stat-details">
                     ${reportData.priorityStats.low.passed} passed<br>
                     ${reportData.priorityStats.low.failed} failed<br>
                    ⏭ ${reportData.priorityStats.low.skipped} skipped
                </div>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-title"> Overall Summary</div>
                <div class="stat-value">${reportData.summary.passRate}%</div>
                <div class="stat-details">
                    Pass rate<br>
                    ${reportData.summary.totalPassed}/${reportData.summary.totalTests} tests passed
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-title"> Dependencies</div>
                <div class="stat-value">${reportData.priorityStats.dependencyChains}</div>
                <div class="stat-details">
                    Tests with dependencies<br>
                    ${reportData.priorityStats.totalDependencySkips} dependency skips
                </div>
            </div>
        </div>

        ${reportData.dependencyGraph ? `
        <div class="dependency-graph">
            <h2> Execution Order</h2>
            <div class="execution-order">
                <strong>Tests executed in this order:</strong><br>
                ${reportData.dependencyGraph.executionOrder.join(' → ')}
            </div>
        </div>
        ` : ''}

        <div class="test-list">
            <h2> Test Results</h2>
            ${reportData.executionResults.map((test: any) => `
                <div class="test-item ${test.status}">
                    <div class="test-name">${test.testName}</div>
                    <div class="test-meta">
                        <span class="priority-badge priority-${test.priority || 'medium'}">${(test.priority || 'medium').toUpperCase()}</span>
                        Status: ${test.status.toUpperCase()}
                        ${test.duration ? ` | Duration: ${test.duration}ms` : ''}
                        ${test.dependencies && test.dependencies.length > 0 ? ` | Depends on: ${test.dependencies.join(', ')}` : ''}
                        ${test.reason ? ` | Reason: ${test.reason}` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`;

    const htmlPath = path.join('reports', `priority-dependency-summary-${moduleName}-${timestamp}.html`);
    fs.writeFileSync(htmlPath, html);
  }
}
