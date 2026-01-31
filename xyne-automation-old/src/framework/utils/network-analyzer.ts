import { Request, Response } from '@playwright/test';
import { NetworkData, APICallData, PerformanceMetrics } from '../../types';

export class NetworkAnalyzer {
  private requests: Request[] = [];
  private responses: Response[] = [];
  private apiCalls: APICallData[] = [];
  private performanceMetrics: PerformanceMetrics = {
    totalRequests: 0,
    totalResponseTime: 0,
    averageResponseTime: 0,
    slowestRequest: { url: '', responseTime: 0 },
    fastestRequest: { url: '', responseTime: Number.MAX_VALUE },
    errorCount: 0,
    successCount: 0
  };

  /**
   * Add a request to the analyzer
   */
  addRequest(request: Request): void {
    this.requests.push(request);
    this.performanceMetrics.totalRequests++;
  }

  /**
   * Add a response to the analyzer
   */
  addResponse(response: Response): void {
    this.responses.push(response);
    
    const request = response.request();
    const responseTime = this.calculateResponseTime(request);
    
    // Update performance metrics
    this.performanceMetrics.totalResponseTime += responseTime;
    this.performanceMetrics.averageResponseTime = 
      this.performanceMetrics.totalResponseTime / this.responses.length;

    // Track slowest and fastest requests
    if (responseTime > this.performanceMetrics.slowestRequest.responseTime) {
      this.performanceMetrics.slowestRequest = {
        url: request.url(),
        responseTime
      };
    }

    if (responseTime < this.performanceMetrics.fastestRequest.responseTime) {
      this.performanceMetrics.fastestRequest = {
        url: request.url(),
        responseTime
      };
    }

    // Track success/error counts
    if (response.status() >= 200 && response.status() < 400) {
      this.performanceMetrics.successCount++;
    } else {
      this.performanceMetrics.errorCount++;
    }

    // Create API call data
    this.createAPICallData(request, response, responseTime);
  }

  /**
   * Calculate response time for a request
   */
  private calculateResponseTime(request: Request): number {
    const timing = request.timing();
    return timing.responseEnd - timing.requestStart;
  }

  /**
   * Create API call data from request and response
   */
  private createAPICallData(request: Request, response: Response, responseTime: number): void {
    const apiCall: APICallData = {
      url: request.url(),
      method: request.method(),
      status: response.status(),
      responseTime,
      requestHeaders: request.headers(),
      responseHeaders: response.headers(),
      requestBody: null, // Will be populated if available
      responseBody: null, // Will be populated if available
      timestamp: new Date().toISOString()
    };

    this.apiCalls.push(apiCall);
  }

  /**
   * Get all API calls
   */
  getAPICalls(): APICallData[] {
    return this.apiCalls;
  }

  /**
   * Get API calls filtered by URL pattern
   */
  getAPICallsByURL(urlPattern: string | RegExp): APICallData[] {
    if (typeof urlPattern === 'string') {
      return this.apiCalls.filter(call => call.url.includes(urlPattern));
    }
    return this.apiCalls.filter(call => urlPattern.test(call.url));
  }

  /**
   * Get API calls filtered by status code
   */
  getAPICallsByStatus(status: number): APICallData[] {
    return this.apiCalls.filter(call => call.status === status);
  }

  /**
   * Get failed API calls (4xx and 5xx status codes)
   */
  getFailedAPICalls(): APICallData[] {
    return this.apiCalls.filter(call => call.status >= 400);
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Get network data summary
   */
  getNetworkData(): NetworkData {
    return {
      requests: this.requests.length,
      responses: this.responses.length,
      apiCalls: this.apiCalls,
      performanceMetrics: this.performanceMetrics,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Analyze streaming responses (for LLM chat responses)
   */
  analyzeStreamingResponses(): APICallData[] {
    return this.apiCalls.filter(call => 
      call.responseHeaders['content-type']?.includes('text/stream') ||
      call.responseHeaders['content-type']?.includes('application/stream') ||
      call.url.includes('/stream') ||
      call.url.includes('/chat')
    );
  }

  /**
   * Get slow requests (above threshold)
   */
  getSlowRequests(thresholdMs: number = 2000): APICallData[] {
    return this.apiCalls.filter(call => call.responseTime > thresholdMs);
  }

  /**
   * Export network data to JSON
   */
  exportToJSON(): string {
    return JSON.stringify(this.getNetworkData(), null, 2);
  }

  /**
   * Reset analyzer data
   */
  reset(): void {
    this.requests = [];
    this.responses = [];
    this.apiCalls = [];
    this.performanceMetrics = {
      totalRequests: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      slowestRequest: { url: '', responseTime: 0 },
      fastestRequest: { url: '', responseTime: Number.MAX_VALUE },
      errorCount: 0,
      successCount: 0
    };
  }

  /**
   * Generate network analysis report
   */
  generateReport(): string {
    const metrics = this.getPerformanceMetrics();
    const failedCalls = this.getFailedAPICalls();
    const slowCalls = this.getSlowRequests();

    return `
Network Analysis Report
======================
Total Requests: ${metrics.totalRequests}
Success Rate: ${((metrics.successCount / metrics.totalRequests) * 100).toFixed(2)}%
Average Response Time: ${metrics.averageResponseTime.toFixed(2)}ms
Slowest Request: ${metrics.slowestRequest.url} (${metrics.slowestRequest.responseTime.toFixed(2)}ms)
Fastest Request: ${metrics.fastestRequest.url} (${metrics.fastestRequest.responseTime.toFixed(2)}ms)

Failed Requests (${failedCalls.length}):
${failedCalls.map(call => `- ${call.method} ${call.url} (${call.status})`).join('\n')}

Slow Requests (${slowCalls.length}):
${slowCalls.map(call => `- ${call.method} ${call.url} (${call.responseTime.toFixed(2)}ms)`).join('\n')}
    `.trim();
  }
}
