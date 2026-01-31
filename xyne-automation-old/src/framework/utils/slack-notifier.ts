/**
 * Slack Notifier Utility
 * Sends test execution notifications to Slack channels
 */

import { WebClient } from '@slack/web-api';
import { PriorityExecutionStats } from '@/types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

export interface SlackNotificationData {
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  executionTime: string;
  testEnvUrl: string;
  scriptRunBy: string;
  moduleName?: string;
  htmlReportPath?: string;
  apiCallsPath?: string;
  priorityStats?: {
    highest: { total: number; passed: number; failed: number; skipped: number };
    high: { total: number; passed: number; failed: number; skipped: number };
    medium: { total: number; passed: number; failed: number; skipped: number };
    low: { total: number; passed: number; failed: number; skipped: number };
  };
}

export interface SlackNotificationResult {
  success: boolean;
  messageUrl?: string;
  threadTs?: string;
  channelId?: string;
  error?: string;
}

export class SlackNotifier {
  private client: WebClient | null = null;
  private channelId: string;
  private isEnabled: boolean;

  constructor() {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_ID || 'xyne-automation';
    
    this.isEnabled = !!botToken;
    this.channelId = channelId;
    
    if (this.isEnabled && botToken) {
      this.client = new WebClient(botToken);
    } else {
      console.log('️  Slack notifications disabled: SLACK_BOT_TOKEN not found in environment');
    }
  }

  /**
   * Send test execution completion notification to Slack
   */
  async sendTestCompletionNotification(data: SlackNotificationData): Promise<SlackNotificationResult> {
    if (!this.isEnabled || !this.client) {
      console.log('📱 Slack notification skipped: Not configured');
      return { success: false, error: 'Slack not configured' };
    }

    try {
      const message = this.formatTestCompletionMessage(data);
      
      const result = await this.client.chat.postMessage({
        channel: this.channelId,
        text: message.text,
        attachments: message.attachments,
        mrkdwn: true // Enable markdown formatting for attachments
      });

      if (result.ok && result.ts && result.channel) {
        console.log(' Slack notification sent successfully');
        
        // Generate the Slack message URL
        const messageUrl = await this.generateSlackMessageUrl(result.channel, result.ts);
        
        // Send thread reply with priority breakdown if available
        if (data.priorityStats && result.ts) {
          await this.sendPriorityBreakdownThread(result.ts, data);
        }
        
        // Upload HTML report as thread reply if available
        if (data.htmlReportPath && result.ts) {
          await this.uploadHtmlReportFile(result.ts, data.htmlReportPath);
        }
        
        // Upload API calls JSON file if available
        if (data.apiCallsPath && result.ts) {
          await this.uploadAPICallsFile(result.ts, data.apiCallsPath);
        } else if (result.ts) {
          // Auto-discover and upload API calls files
          await this.uploadLatestAPICallsFiles(result.ts);
        }

        return {
          success: true,
          messageUrl: messageUrl,
          threadTs: result.ts,
          channelId: result.channel
        };
      } else {
        console.error(' Failed to send Slack notification:', result.error);
        return { success: false, error: result.error || 'Unknown error' };
      }
    } catch (error: any) {
      // Handle specific Slack API errors
      if (error.code === 'slack_webapi_platform_error' && error.data?.error === 'account_inactive') {
        console.log('️  Slack notification skipped: Account inactive. Please update SLACK_BOT_TOKEN in .env file.');
        this.isEnabled = false; // Disable further attempts
        return { success: false, error: 'Account inactive' };
      }
      console.error(' Error sending Slack notification:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Generate Slack message URL from channel and timestamp
   */
  private async generateSlackMessageUrl(channelId: string, messageTs: string): Promise<string> {
    // Convert timestamp to Slack's URL format (remove decimal point)
    const urlTimestamp = messageTs.replace('.', '');
    
    // Use Juspay team domain directly since we know it
    const teamDomain = 'juspay';
    return `https://${teamDomain}.slack.com/archives/${channelId}/p${urlTimestamp}`;
  }

  /**
   * Upload HTML report file as a thread reply
   */
  private async uploadHtmlReportFile(threadTs: string, htmlReportPath: string): Promise<void> {
    if (!this.client) return;

    try {
      // Check if file exists
      if (!fs.existsSync(htmlReportPath)) {
        console.warn(`️ HTML report file not found: ${htmlReportPath}`);
        return;
      }

      const fileName = path.basename(htmlReportPath);
      const fileTitle = `Test Execution Report - ${fileName}`;
      
      const result = await this.client.files.uploadV2({
        channels: this.channelId,
        file: fs.createReadStream(htmlReportPath),
        filename: fileName,
        title: fileTitle,
        thread_ts: threadTs,
        initial_comment: '*Detailed HTML Test Report*\n\nThis report includes:\n• Detailed test results with screenshots\n• Performance metrics and timing\n• Error details and stack traces\n• Interactive test timeline'
      });

      if (result.ok) {
        console.log(' HTML report file uploaded successfully');
      } else {
        console.error(' Failed to upload HTML report file:', result.error);
      }
    } catch (error) {
      console.error(' Error uploading HTML report file:', error);
    }
  }

  /**
   * Format the test completion message with rich Slack attachments
   */
  private formatTestCompletionMessage(data: SlackNotificationData): { text: string; attachments: any[] } {
    const currentDate = new Date();
    const formattedDate = this.formatDateTime(currentDate);
    const moduleName = data.moduleName || 'Xyne';
    
    // Determine colors and emojis based on test results
    const colors = this.getStatusColors();
    const emojis = this.getStatusEmojis();
    
    // Determine overall status and color
    const overallColor = data.totalFailed > 0 ? colors.failed : 
                        (data.totalSkipped > 0 ? colors.skipped : colors.passed);
    const overallEmoji = data.totalFailed > 0 ? emojis.alert : 
                        (data.totalSkipped > 0 ? emojis.alert : emojis.passed);
    
    const mainText = `${overallEmoji} *Test Suite Execution Completed* ${overallEmoji}\nXYNE\nAutomation report for ${moduleName}`;
    
    const pretext = `:calendar: *DATE/TIME*: ${formattedDate}\n\n\`\`\`\nSCRIPT RUN BY: ${data.scriptRunBy}\nTEST ENV URL: ${data.testEnvUrl}\n\`\`\``;
    
    return {
      text: mainText,
      attachments: [
        {
          fallback: `Test Suite Execution Completed - ${data.totalPassed}/${data.totalTests} tests passed`,
          color: overallColor,
          pretext: pretext,
          fields: [
            {
              title: "",
              value: `*Test Cases Run* : ${data.totalTests}`,
              short: false
            },
            {
              title: "",
              value: `*Test Cases Failed* : ${data.totalFailed}`,
              short: false
            },
            {
              title: "",
              value: `*Test Cases Passed* : ${data.totalPassed}`,
              short: false
            },
            {
              title: "",
              value: `*Test Cases Skipped* : ${data.totalSkipped}`,
              short: false
            }
          ],
          footer: `:robot_face: Automation Notification Bot`
        }
      ]
    };
  }

  /**
   * Get status colors for Slack attachments
   */
  private getStatusColors() {
    return {
      passed: '#36a64f',  // Green
      failed: '#e01e5a',  // Red
      skipped: '#f7a700'  // Yellow
    };
  }

  /**
   * Get status emojis
   */
  private getStatusEmojis() {
    return {
      alert: ':alerting:',
      passed: ':qa-passed:',
      repeat: ':repeat:'
    };
  }

  /**
   * Upload API calls files to Slack as thread reply
   */
  private async uploadAPICallsFiles(threadTs?: string): Promise<void> {
    const apiCallsDir = path.join(process.cwd(), 'reports', 'api-calls');

    if (!fs.existsSync(apiCallsDir)) {
      console.log(' No API calls directory found');
      return;
    }

    // Check for module-specific marker file indicating API monitoring was used in this test run
    const moduleName = process.env.MODULE_NAME || 'default';
    const apiMarkerFile = path.join(apiCallsDir, `.api-monitoring-active-${moduleName}`);

    if (!fs.existsSync(apiMarkerFile)) {
      console.log(' No API monitoring marker found - test suite does not use API monitoring');
      return;
    }

    // Get all API call files (no time filtering - rely on marker file)
    // Filter to exclude marker files and already-consolidated files
    const apiCallsFiles = fs.readdirSync(apiCallsDir)
      .filter(file =>
        file.endsWith('.json') &&
        !file.startsWith('consolidated-') &&
        !file.startsWith('.api-monitoring-active')
      )
      .sort();

    if (apiCallsFiles.length === 0) {
      console.log(' No API calls JSON files found');
      return;
    }

    console.log(` Found ${apiCallsFiles.length} API calls files, consolidating and uploading...`);

    // Consolidate all API calls into a single object
    const consolidatedAPICalls: Record<string, any> = {};
    let totalCalls = 0;
    let successfulCalls = 0;
    let failedCalls = 0;

    for (const file of apiCallsFiles) {
      console.log(` Processing: ${file}`);
      const filePath = path.join(apiCallsDir, file);
      
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const apiCalls = JSON.parse(fileContent);
        
        // Merge API calls (later files will overwrite earlier ones for same URLs)
        Object.assign(consolidatedAPICalls, apiCalls);
        
      } catch (error) {
        console.error(` Error processing ${file}: ${error}`);
      }
    }

    // Count totals from consolidated data
    for (const [url, callData] of Object.entries(consolidatedAPICalls)) {
      totalCalls++;
      const statusCode = (callData as any)['Status-Code'];
      if (statusCode >= 200 && statusCode < 400) {
        successfulCalls++;
      } else {
        failedCalls++;
      }
    }

    console.log(` Consolidated ${totalCalls} total API calls (${successfulCalls} successful, ${failedCalls} failed)`);

    // Save module-specific consolidated file
    const consolidatedFileName = `consolidated-api-calls-${moduleName}.json`;
    const consolidatedFilePath = path.join(apiCallsDir, consolidatedFileName);

    try {
      fs.writeFileSync(consolidatedFilePath, JSON.stringify(consolidatedAPICalls, null, 2));

      // Upload the consolidated file as thread reply
      await this.uploadFile(
        consolidatedFilePath,
        consolidatedFileName,
        ` API Calls Summary: ${totalCalls} total calls (${successfulCalls} successful, ${failedCalls} failed)`,
        threadTs
      );

      console.log(` Consolidated ${apiCallsFiles.length} API calls files into single upload`);

      // Clean up module-specific marker file after successful upload
      try {
        fs.unlinkSync(apiMarkerFile);
      } catch (error) {
        console.warn('️ Could not remove API monitoring marker file:', error);
      }

    } catch (error) {
      console.error(` Error creating consolidated file: ${error}`);
    }
  }

  /**
   * Test the Slack connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.isEnabled || !this.client) {
      console.log(' Slack not configured');
      return false;
    }

    try {
      const result = await this.client.auth.test();
      if (result.ok) {
        console.log(' Slack connection successful');
        console.log(`   Bot User: ${result.user}`);
        console.log(`   Team: ${result.team}`);
        return true;
      } else {
        console.error(' Slack connection failed:', result.error);
        return false;
      }
    } catch (error) {
      console.error(' Error testing Slack connection:', error);
      return false;
    }
  }

  /**
   * Upload API calls JSON file as a thread reply
   */
  private async uploadAPICallsFile(threadTs: string, apiCallsPath: string): Promise<void> {
    if (!this.client) return;

    try {
      // Check if file exists
      if (!fs.existsSync(apiCallsPath)) {
        console.warn(`️ API calls file not found: ${apiCallsPath}`);
        return;
      }

      const fileName = path.basename(apiCallsPath);
      const fileTitle = `API Calls Report - ${fileName}`;
      
      const result = await this.client.files.uploadV2({
        channels: this.channelId,
        file: fs.createReadStream(apiCallsPath),
        filename: fileName,
        title: fileTitle,
        thread_ts: threadTs,
        initial_comment: '* API Calls Report*\n\nThis JSON file contains:\n• All API calls made during test execution\n• Request/Response details with status codes\n• Headers and response payloads\n• Timestamps and performance metrics\n\n*Usage:* Download and open in a JSON viewer or text editor for detailed analysis.'
      });

      if (result.ok) {
        console.log(' API calls file uploaded successfully');
      } else {
        console.error(' Failed to upload API calls file:', result.error);
      }
    } catch (error) {
      console.error(' Error uploading API calls file:', error);
    }
  }

  /**
   * Auto-discover and upload consolidated API calls
   */
  private async uploadLatestAPICallsFiles(threadTs: string): Promise<void> {
    if (!this.client) return;

    try {
      // Use the new uploadAPICallsFiles method which has proper filtering
      await this.uploadAPICallsFiles(threadTs);

    } catch (error) {
      console.error(' Error consolidating and uploading API calls files:', error);
    }
  }

  /**
   * Consolidate multiple API calls files into a single object
   */
  private async consolidateAPICallsFiles(files: Array<{name: string, path: string, stats: any}>): Promise<any> {
    const consolidatedData: any = {};
    let totalCalls = 0;
    let successfulCalls = 0;
    let failedCalls = 0;

    for (const file of files) {
      try {
        const fileContent = fs.readFileSync(file.path, 'utf-8');
        const apiData = JSON.parse(fileContent);
        
        console.log(` Processing: ${file.name}`);
        
        // Merge API calls (avoid duplicates by using URL as key)
        for (const [url, callData] of Object.entries(apiData)) {
          // Create a unique key to handle potential duplicates
          let uniqueKey = url;
          let counter = 1;
          
          while (consolidatedData[uniqueKey]) {
            uniqueKey = `${url}#${counter}`;
            counter++;
          }
          
          consolidatedData[uniqueKey] = callData;
          totalCalls++;
          
          // Count success/failure
          const statusCode = (callData as any)['Status-Code'];
          if (statusCode >= 200 && statusCode < 400) {
            successfulCalls++;
          } else {
            failedCalls++;
          }
        }
        
      } catch (error) {
        console.warn(`️ Failed to process file ${file.path}: ${error}`);
      }
    }

    console.log(` Consolidated ${totalCalls} total API calls (${successfulCalls} successful, ${failedCalls} failed)`);
    
    return consolidatedData;
  }

  /**
   * Clean up old API call files, keeping only files from the current test run
   */
  private async cleanupOldAPICallFiles(apiCallsDir: string): Promise<void> {
    try {
      const currentTime = Date.now();
      const maxAge = 10 * 60 * 1000; // 10 minutes in milliseconds (increased from 5)
      
      const files = fs.readdirSync(apiCallsDir)
        .filter(file => file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(apiCallsDir, file),
          stats: fs.statSync(path.join(apiCallsDir, file))
        }));

      let deletedCount = 0;
      
      for (const file of files) {
        const fileAge = currentTime - file.stats.mtime.getTime();
        
        // Delete files older than 10 minutes (from previous test runs)
        // Skip consolidated files as they are created during upload process
        if (fileAge > maxAge && !file.name.startsWith('consolidated-')) {
          try {
            fs.unlinkSync(file.path);
            deletedCount++;
            console.log(`🗑  Deleted old API call file: ${file.name}`);
          } catch (error) {
            console.warn(`️ Failed to delete old file ${file.name}: ${error}`);
          }
        }
      }
      
      if (deletedCount > 0) {
        console.log(` Cleaned up ${deletedCount} old API call files`);
      }
      
    } catch (error) {
      console.warn(`️ Error during API calls cleanup: ${error}`);
    }
  }

  /**
   * Send priority breakdown as a thread reply
   */
  private async sendPriorityBreakdownThread(threadTs: string, data: SlackNotificationData): Promise<void> {
    if (!this.client || !data.priorityStats) return;

    try {
      const priorityMessage = this.formatPriorityBreakdown(data.priorityStats);
      
      const result = await this.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: threadTs,
        text: priorityMessage,
        mrkdwn: true
      });

      if (result.ok) {
        console.log(' Priority breakdown thread sent successfully');
      } else {
        console.error(' Failed to send priority breakdown thread:', result.error);
      }
    } catch (error) {
      console.error(' Error sending priority breakdown thread:', error);
    }
  }

  /**
   * Format priority breakdown message
   */
  private formatPriorityBreakdown(priorityStats: any): string {
    const formatPriorityLine = (priority: string, stats: any) => {
      const total = stats.total;
      const passed = stats.passed;
      const failed = stats.failed;
      const skipped = stats.skipped;
      
      if (total === 0) return null;
      
      const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
      const emoji = failed > 0 ? '' : (skipped > 0 ? '🟡' : '🟢');
      
      return `${emoji} *${priority.toUpperCase()}*: ${passed}/${total} passed (${passRate}%) | Failed: ${failed} | Skipped: ${skipped}`;
    };

    const lines = [
      ' *Test Priority Breakdown*',
      '',
      formatPriorityLine('highest', priorityStats.highest),
      formatPriorityLine('high', priorityStats.high),
      formatPriorityLine('medium', priorityStats.medium),
      formatPriorityLine('low', priorityStats.low)
    ].filter(line => line !== null);

    return lines.join('\n');
  }

  /**
   * Format date and time for display
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  }

  /**
   * Upload a file to Slack
   */
  private async uploadFile(filePath: string, fileName: string, comment: string, threadTs?: string): Promise<void> {
    if (!this.client) return;

    try {
      const uploadOptions: any = {
        channels: this.channelId,
        file: fs.createReadStream(filePath),
        filename: fileName,
        title: fileName,
        initial_comment: comment
      };

      // Add thread_ts if provided
      if (threadTs) {
        uploadOptions.thread_ts = threadTs;
      }

      const result = await this.client.files.uploadV2(uploadOptions);

      if (result.ok) {
        console.log(` ${fileName} uploaded successfully`);
      } else {
        console.error(` Failed to upload ${fileName}:`, result.error);
      }
    } catch (error) {
      console.error(` Error uploading ${fileName}:`, error);
    }
  }

  /**
   * Check if Slack notifications are enabled
   */
  isSlackEnabled(): boolean {
    return this.isEnabled;
  }
}

// Export singleton instance
export const slackNotifier = new SlackNotifier();
