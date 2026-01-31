import { Page, Request, Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ApiValidationService } from './api-validation-service';
import { ApiValidationOptions, ApiValidationResult } from '../../types/api-validation.types';

export interface APICallRecord {
  'Status-Code': number;
  'Request-Method': string;
  'content_type': string | null;
  'X-Response-Id': string | null;
  'X-Web-Logintoken': string | null;
  'X-Device-Type': string | null;
  'X-Tenant-Id': string | null;
  'Date': string;
  'Request-Referer': string | null;
  'Request-Sentry-Trace': string | null;
  'X-feature': string | null;
  'User-Agent': string | null;
  'response_body'?: string;
}

export interface APIMonitorData {
  [url: string]: APICallRecord;
}

export class APIMonitor {
  private apiCalls: APIMonitorData = {};
  private page: Page;
  private outputDir: string;
  private testName: string;
  private isMonitoring: boolean = false;

  constructor(page: Page, testName: string, outputDir: string = 'reports/api-calls') {
    this.page = page;
    this.testName = testName;
    this.outputDir = outputDir;
    this.ensureOutputDirectory();
  }

  /**
   * Start monitoring API calls for the current test
   */
  async startMonitoring(testName: string): Promise<void> {
    this.testName = testName;
    this.apiCalls = {};
    this.isMonitoring = true;

    // Create module-specific marker file to indicate API monitoring is active
    const apiCallsDir = path.join(process.cwd(), 'reports', 'api-calls');
    const moduleName = process.env.MODULE_NAME || 'default';
    const markerFile = path.join(apiCallsDir, `.api-monitoring-active-${moduleName}`);

    try {
      // Ensure directory exists
      if (!fs.existsSync(apiCallsDir)) {
        fs.mkdirSync(apiCallsDir, { recursive: true });
      }

      // Create module-specific marker file
      fs.writeFileSync(markerFile, JSON.stringify({
        moduleName: moduleName,
        testSuite: testName,
        startTime: new Date().toISOString(),
        pid: process.pid
      }), 'utf-8');

    } catch (error) {
      console.warn(' Could not create API monitoring marker file:', error);
    }
    
    // Listen to all requests
    this.page.on('request', (request: Request) => {
      this.handleRequest(request);
    });

    // Listen to all responses
    this.page.on('response', async (response: Response) => {
      await this.handleResponse(response);
    });
    
    console.log(`API monitoring started for test: ${testName}`);
  }

  /**
   * Handle incoming requests
   */
  private handleRequest(request: Request): void {
    const url = request.url();
    
    // Initialize the API call record if it doesn't exist
    if (!this.apiCalls[url]) {
      this.apiCalls[url] = {
        'Status-Code': 0,
        'Request-Method': request.method(),
        'content_type': null,
        'X-Response-Id': null,
        'X-Web-Logintoken': null,
        'X-Device-Type': null,
        'X-Tenant-Id': null,
        'Date': new Date().toUTCString(),
        'Request-Referer': request.headers()['referer'] || null,
        'Request-Sentry-Trace': request.headers()['sentry-trace'] || null,
        'X-feature': request.headers()['x-feature'] || null,
        'User-Agent': request.headers()['user-agent'] || null,
      };
    }
  }

  /**
   * Handle incoming responses
   */
  private async handleResponse(response: Response): Promise<void> {
    const url = response.url();
    const request = response.request();
    const contentType = response.headers()['content-type'] || '';
    
    // Filter out HTML page requests
    if (contentType.includes('text/html')) {
      return; // Skip HTML responses entirely
    }
    
    try {
      // Determine if we should include response body
      let responseBody: string | undefined;
      let shouldIncludeBody = false;
      
      // Only include full response body for JSON APIs
      if (contentType.includes('application/json')) {
        shouldIncludeBody = true;
        try {
          const body = await response.body();
          responseBody = body.toString('utf-8');
          
          // Validate JSON format
          try {
            JSON.parse(responseBody);
          } catch {
            responseBody = "Invalid JSON format";
          }
        } catch (error) {
          responseBody = "Could not decode JSON response body";
        }
      } else {
        // For non-JSON content types, only log metadata (no response body)
        responseBody = `[${contentType}] - Body excluded to reduce log size`;
      }

      // Update or create the API call record
      const apiRecord: APICallRecord = {
        'Status-Code': response.status(),
        'Request-Method': request.method(),
        'content_type': contentType || null,
        'X-Response-Id': response.headers()['x-response-id'] || null,
        'X-Web-Logintoken': response.headers()['x-web-logintoken'] || null,
        'X-Device-Type': response.headers()['x-device-type'] || null,
        'X-Tenant-Id': response.headers()['x-tenant-id'] || null,
        'Date': new Date().toUTCString(),
        'Request-Referer': request.headers()['referer'] || null,
        'Request-Sentry-Trace': request.headers()['sentry-trace'] || null,
        'X-feature': response.headers()['x-feature'] || null,
        'User-Agent': request.headers()['user-agent'] || null,
      };

      // Only add response_body for JSON content
      if (shouldIncludeBody) {
        apiRecord.response_body = responseBody;
      }

      this.apiCalls[url] = apiRecord;

    } catch (error) {
      console.warn(`Failed to process response for ${url}:`, error);
      
      // Still record basic information even if body processing fails
      this.apiCalls[url] = {
        'Status-Code': response.status(),
        'Request-Method': request.method(),
        'content_type': contentType || null,
        'X-Response-Id': response.headers()['x-response-id'] || null,
        'X-Web-Logintoken': response.headers()['x-web-logintoken'] || null,
        'X-Device-Type': response.headers()['x-device-type'] || null,
        'X-Tenant-Id': response.headers()['x-tenant-id'] || null,
        'Date': new Date().toUTCString(),
        'Request-Referer': request.headers()['referer'] || null,
        'Request-Sentry-Trace': request.headers()['sentry-trace'] || null,
        'X-feature': response.headers()['x-feature'] || null,
        'User-Agent': request.headers()['user-agent'] || null,
        'response_body': "Could not decode response body"
      };
    }
  }

  /**
   * Get all captured API calls
   */
  getAPICalls(): APIMonitorData {
    return { ...this.apiCalls };
  }

  /**
   * Save API calls to JSON file
   */
  async saveToFile(filename?: string): Promise<string> {
    // Use consistent filename without timestamp to overwrite previous runs
    const cleanTestName = this.testName.replace(/[^a-zA-Z0-9]/g, '-');
    const defaultFilename = `api-calls-${cleanTestName}.json`;
    const finalFilename = filename || defaultFilename;
    const filePath = path.join(this.outputDir, finalFilename);

    try {
      const jsonData = JSON.stringify(this.apiCalls, null, 2);
      await fs.promises.writeFile(filePath, jsonData, 'utf-8');
      console.log(`API calls saved to: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error(`Failed to save API calls to file: ${error}`);
      throw error;
    }
  }

  /**
   * Get failed API calls (4xx and 5xx status codes)
   */
  getFailedAPICalls(): APIMonitorData {
    const failed: APIMonitorData = {};
    for (const [url, data] of Object.entries(this.apiCalls)) {
      if (data['Status-Code'] >= 400) {
        failed[url] = data;
      }
    }
    return failed;
  }

  /**
   * Get API calls by method
   */
  getAPICallsByMethod(method: string): APIMonitorData {
    const filtered: APIMonitorData = {};
    for (const [url, data] of Object.entries(this.apiCalls)) {
      if (data['Request-Method'].toLowerCase() === method.toLowerCase()) {
        filtered[url] = data;
      }
    }
    return filtered;
  }

  /**
   * Clear all captured API calls
   */
  clear(): void {
    this.apiCalls = {};
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    methods: Record<string, number>;
    statusCodes: Record<number, number>;
  } {
    const summary = {
      totalCalls: Object.keys(this.apiCalls).length,
      successfulCalls: 0,
      failedCalls: 0,
      methods: {} as Record<string, number>,
      statusCodes: {} as Record<number, number>
    };

    for (const data of Object.values(this.apiCalls)) {
      // Count by status
      if (data['Status-Code'] >= 200 && data['Status-Code'] < 400) {
        summary.successfulCalls++;
      } else {
        summary.failedCalls++;
      }

      // Count by method
      const method = data['Request-Method'];
      summary.methods[method] = (summary.methods[method] || 0) + 1;

      // Count by status code
      const statusCode = data['Status-Code'];
      summary.statusCodes[statusCode] = (summary.statusCodes[statusCode] || 0) + 1;
    }

    return summary;
  }

  /**
   * Ensure output directory exists
   */
  private ensureOutputDirectory(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Stop monitoring and save results
   */
  async stopMonitoring(): Promise<string> {
    console.log(`API monitoring stopped for test: ${this.testName}`);
    const summary = this.getSummary();
    console.log(`Captured ${summary.totalCalls} API calls (${summary.successfulCalls} successful, ${summary.failedCalls} failed)`);
    
    return await this.saveToFile();
  }

  /**
   * Validate a specific captured API call using the API validation service
   */
  async validateCapturedAPI(endpoint: string, validationOptions: ApiValidationOptions): Promise<ApiValidationResult[]> {
    const apiValidator = new ApiValidationService(this.page);
    return await apiValidator.validateCapturedAPI(endpoint, this.apiCalls, validationOptions);
  }

  /**
   * Validate multiple captured API calls
   */
  async validateMultipleAPIs(validations: Array<{ endpoint: string; options: ApiValidationOptions }>): Promise<Record<string, ApiValidationResult[]>> {
    const results: Record<string, ApiValidationResult[]> = {};
    const apiValidator = new ApiValidationService(this.page);

    for (const validation of validations) {
      results[validation.endpoint] = await apiValidator.validateCapturedAPI(
        validation.endpoint, 
        this.apiCalls, 
        validation.options
      );
    }

    return results;
  }

  /**
   * Get API call by endpoint pattern
   */
  getAPICallByEndpoint(endpointPattern: string): APICallRecord | null {
    const matchingEntry = Object.entries(this.apiCalls).find(([url]) => 
      url.includes(endpointPattern)
    );
    
    return matchingEntry ? matchingEntry[1] : null;
  }

  /**
   * Extract response data from captured API call
   */
  extractResponseData(endpoint: string): any | null {
    const apiCall = this.getAPICallByEndpoint(endpoint);
    if (!apiCall || !apiCall.response_body) {
      return null;
    }

    try {
      return JSON.parse(apiCall.response_body);
    } catch (error) {
      console.warn(`Failed to parse response body for ${endpoint}:`, error);
      return null;
    }
  }

  /**
   * Validate all captured API calls meet basic criteria
   */
  validateAllAPIs(options: { 
    allowedStatusCodes?: number[]; 
    requiredContentType?: string;
    maxResponseTime?: number;
  } = {}): ApiValidationResult[] {
    const results: ApiValidationResult[] = [];
    const { 
      allowedStatusCodes = [200, 201, 202, 204], 
      requiredContentType = 'application/json',
      maxResponseTime = 5000 
    } = options;

    for (const [url, apiCall] of Object.entries(this.apiCalls)) {
      // Validate status code
      if (!allowedStatusCodes.includes(apiCall['Status-Code'])) {
        results.push({
          success: false,
          message: `API ${url} returned unexpected status code: ${apiCall['Status-Code']}`,
          actualValue: apiCall['Status-Code'],
          expectedValue: allowedStatusCodes,
          details: { url, method: apiCall['Request-Method'] }
        });
      }

      // Validate content type
      if (requiredContentType && apiCall.content_type && !apiCall.content_type.includes(requiredContentType)) {
        results.push({
          success: false,
          message: `API ${url} returned unexpected content type: ${apiCall.content_type}`,
          actualValue: apiCall.content_type,
          expectedValue: requiredContentType,
          details: { url, method: apiCall['Request-Method'] }
        });
      }
    }

    // If no failures, add success result
    if (results.length === 0) {
      results.push({
        success: true,
        message: `All ${Object.keys(this.apiCalls).length} captured API calls passed validation`,
        details: { totalCalls: Object.keys(this.apiCalls).length }
      });
    }

    return results;
  }

  /**
   * Get validation summary for all captured APIs
   */
  getValidationSummary(): {
    totalAPIs: number;
    successfulAPIs: number;
    failedAPIs: number;
    apisByStatus: Record<number, string[]>;
    apisByContentType: Record<string, string[]>;
  } {
    const summary = {
      totalAPIs: Object.keys(this.apiCalls).length,
      successfulAPIs: 0,
      failedAPIs: 0,
      apisByStatus: {} as Record<number, string[]>,
      apisByContentType: {} as Record<string, string[]>
    };

    for (const [url, apiCall] of Object.entries(this.apiCalls)) {
      // Count success/failure
      if (apiCall['Status-Code'] >= 200 && apiCall['Status-Code'] < 400) {
        summary.successfulAPIs++;
      } else {
        summary.failedAPIs++;
      }

      // Group by status code
      const statusCode = apiCall['Status-Code'];
      if (!summary.apisByStatus[statusCode]) {
        summary.apisByStatus[statusCode] = [];
      }
      summary.apisByStatus[statusCode].push(url);

      // Group by content type
      const contentType = apiCall.content_type || 'unknown';
      if (!summary.apisByContentType[contentType]) {
        summary.apisByContentType[contentType] = [];
      }
      summary.apisByContentType[contentType].push(url);
    }

    return summary;
  }
}
