import { Page } from '@playwright/test';
import { 
  ApiRequestConfig, 
  ApiResponse, 
  ApiValidationOptions, 
  ApiValidationResult, 
  LoginCredentials, 
  AuthTokenResponse, 
  NestedJsonConfig,
  ProxyConfig,
  RequestOptions,
  ApiCallSummary
} from '../../types/api-validation.types';

export class ApiValidationService {
  private page?: Page;
  private defaultTimeout: number = 30000;
  private defaultHost: string;
  private authToken?: string;
  private logger: Console;

  constructor(page?: Page, defaultHost?: string) {
    this.page = page;
    this.defaultHost = defaultHost || process.env.ENVIRON_URL || '';
    this.logger = console;
  }

  /**
   * Main method to fetch API response - mirrors cmp_fetching_api_response from Python
   */
  async fetchApiResponse<T = any>(config: ApiRequestConfig): Promise<ApiResponse<T> | [ApiResponse<T>, number]> {
    const {
      payload,
      headers = {},
      host,
      endpoint = '/api/ec/v1/validate/token',
      method = 'POST',
      responseContentType = 'application/json',
      isResponseReturnedInRows = false,
      checkStatusCode = false,
      timeout = this.defaultTimeout
    } = config;

    // Construct API URL
    const apiRequestUrl = host ? `${host}${endpoint}` : `${this.defaultHost}${endpoint}`;
    
    // Setup proxy configuration
    const proxyConfig = this.getProxyConfig();
    
    // Prepare request options
    const requestOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      signal: AbortSignal.timeout(timeout)
    };

    // Add body for POST, PUT, DELETE requests
    if (method !== 'GET' && payload) {
      requestOptions.body = JSON.stringify(payload);
    }

    try {
      this.logger.info(`Making ${method} request to: ${apiRequestUrl}`);
      
      const startTime = Date.now();
      const response = await fetch(apiRequestUrl, requestOptions);
      const responseTime = Date.now() - startTime;

      // Validate content type if specified
      if (responseContentType) {
        const actualContentType = response.headers.get('Content-Type') || '';
        if (!actualContentType.includes(responseContentType)) {
          this.logger.warn(`Unexpected response Content-Type: ${actualContentType}`);
        }
      }

      // Parse response data
      let responseData: T;
      const responseText = await response.text();

      if (isResponseReturnedInRows) {
        // Handle line-by-line JSON responses
        const jsonObjects = responseText.split('\n').filter(line => line.trim());
        const correctedResponse = '[' + jsonObjects.join(',') + ']';
        responseData = JSON.parse(correctedResponse);
      } else {
        responseData = responseText ? JSON.parse(responseText) : null;
      }

      const apiResponse: ApiResponse<T> = {
        data: responseData,
        status: response.status,
        statusText: response.statusText,
        headers: this.headersToObject(response.headers),
        url: apiRequestUrl,
        method,
        timestamp: new Date().toISOString()
      };

      this.logger.info(`API Response: ${response.status} ${response.statusText} (${responseTime}ms)`);

      if (checkStatusCode) {
        return [apiResponse, response.status];
      }
      
      return apiResponse;

    } catch (error) {
      this.logger.error(`API request failed: ${error}`);
      throw new Error(`API request to ${apiRequestUrl} failed: ${error}`);
    }
  }

  /**
   * Fetch key value from API response - mirrors cmp_fetch_key_value_from_api_response
   */
  fetchKeyValueFromResponse<T = any>(response: any, responseKey: string): T | null {
    if (response == null) {
      this.logger.error('Response not found.');
      throw new Error('Response value is null but expected value is not equal to null');
    }

    if (responseKey in response) {
      return response[responseKey];
    } else {
      this.logger.info('Key not found in the response data.');
      return null;
    }
  }

  /**
   * Fetch key value from nested JSON - mirrors cmp_fetch_key_value_from_nested_json
   */
  fetchKeyValueFromNestedJson(config: NestedJsonConfig): any {
    const { response, key1, key2, isAssertExpectedValue = true, expectedKey2Value = '' } = config;
    
    const responseDict = response;
    const key1Value = responseDict[key1];
    const jsonValueOfKey1 = JSON.parse(key1Value);
    const key2Value = jsonValueOfKey1[key2];

    if (isAssertExpectedValue) {
      if (key2Value !== expectedKey2Value) {
        throw new Error(`Actual value of key ${key2Value} doesn't match with Expected Value ${expectedKey2Value}.`);
      }
    }

    return key2Value;
  }

  /**
   * Login and get token - mirrors cmp_login_token
   */
  async loginToken(credentials: LoginCredentials): Promise<string> {
    const { username, password, token = '', host = "https://sandbox.portal.juspay.in" } = credentials;
    
    const payload = {
      username,
      password,
      token
    };

    const headers = { 'Content-Type': 'application/json' };
    const endpoint = host.includes("euler") ? '/api/ec/v1/admin/login' : '/api/ec/v1/login';

    const [response, statusCode] = await this.fetchApiResponse({
      payload,
      headers,
      host,
      endpoint,
      checkStatusCode: true
    }) as [ApiResponse, number];

    if (statusCode === 200) {
      const token = this.fetchKeyValueFromResponse(response.data, 'token');
      if (token) {
        this.authToken = token;
        return token;
      }
      throw new Error('Token not found in response');
    } else {
      throw new Error(`API call failed with status code ${statusCode}`);
    }
  }

  /**
   * Validate API response with multiple criteria
   */
  async validateResponse(response: ApiResponse, options: ApiValidationOptions): Promise<ApiValidationResult[]> {
    const results: ApiValidationResult[] = [];

    // Validate status code
    if (options.expectedStatusCode !== undefined) {
      const result = this.validateStatusCode(response, options.expectedStatusCode);
      results.push(result);
    }

    // Validate content type
    if (options.expectedContentType) {
      const result = this.validateContentType(response, options.expectedContentType);
      results.push(result);
    }

    // Validate required keys
    if (options.requiredKeys && options.requiredKeys.length > 0) {
      const result = this.validateRequiredKeys(response, options.requiredKeys);
      results.push(result);
    }

    // Validate forbidden keys
    if (options.forbiddenKeys && options.forbiddenKeys.length > 0) {
      const result = this.validateForbiddenKeys(response, options.forbiddenKeys);
      results.push(result);
    }

    // Run custom validations
    if (options.customValidations && options.customValidations.length > 0) {
      for (const validation of options.customValidations) {
        const result = validation(response);
        if (typeof result === 'string') {
          results.push({
            success: false,
            message: result,
            details: 'Custom validation failed'
          });
        } else if (!result) {
          results.push({
            success: false,
            message: 'Custom validation failed',
            details: 'Custom validation returned false'
          });
        }
      }
    }

    return results;
  }

  /**
   * Validate status code
   */
  private validateStatusCode(response: ApiResponse, expectedStatusCode: number): ApiValidationResult {
    const success = response.status === expectedStatusCode;
    return {
      success,
      message: success 
        ? `Status code validation passed: ${response.status}` 
        : `Status code validation failed: expected ${expectedStatusCode}, got ${response.status}`,
      actualValue: response.status,
      expectedValue: expectedStatusCode
    };
  }

  /**
   * Validate content type
   */
  private validateContentType(response: ApiResponse, expectedContentType: string): ApiValidationResult {
    const actualContentType = response.headers['content-type'] || response.headers['Content-Type'] || '';
    const success = actualContentType.includes(expectedContentType);
    return {
      success,
      message: success 
        ? `Content type validation passed: ${actualContentType}` 
        : `Content type validation failed: expected ${expectedContentType}, got ${actualContentType}`,
      actualValue: actualContentType,
      expectedValue: expectedContentType
    };
  }

  /**
   * Validate required keys exist in response
   */
  private validateRequiredKeys(response: ApiResponse, requiredKeys: string[]): ApiValidationResult {
    const missingKeys: string[] = [];
    const responseData = response.data;

    // Check if responseData is an object (not null, not an array, not a primitive)
    if (!responseData || typeof responseData !== 'object' || Array.isArray(responseData)) {
      return {
        success: false,
        message: `Cannot validate required keys: response data is not an object (got ${typeof responseData})`,
        details: { 
          missingKeys: requiredKeys, 
          requiredKeys,
          actualDataType: typeof responseData,
          actualData: responseData
        }
      };
    }

    for (const key of requiredKeys) {
      if (!(key in responseData)) {
        missingKeys.push(key);
      }
    }

    const success = missingKeys.length === 0;
    return {
      success,
      message: success 
        ? `All required keys found: ${requiredKeys.join(', ')}` 
        : `Missing required keys: ${missingKeys.join(', ')}`,
      details: { missingKeys, requiredKeys }
    };
  }

  /**
   * Validate forbidden keys don't exist in response
   */
  private validateForbiddenKeys(response: ApiResponse, forbiddenKeys: string[]): ApiValidationResult {
    const foundForbiddenKeys: string[] = [];
    const responseData = response.data;

    // Check if responseData is an object (not null, not an array, not a primitive)
    if (!responseData || typeof responseData !== 'object' || Array.isArray(responseData)) {
      return {
        success: true, // If it's not an object, there can't be any forbidden keys
        message: `Cannot check forbidden keys: response data is not an object (got ${typeof responseData})`,
        details: { 
          foundForbiddenKeys: [], 
          forbiddenKeys,
          actualDataType: typeof responseData,
          actualData: responseData
        }
      };
    }

    for (const key of forbiddenKeys) {
      if (key in responseData) {
        foundForbiddenKeys.push(key);
      }
    }

    const success = foundForbiddenKeys.length === 0;
    return {
      success,
      message: success 
        ? `No forbidden keys found` 
        : `Found forbidden keys: ${foundForbiddenKeys.join(', ')}`,
      details: { foundForbiddenKeys, forbiddenKeys }
    };
  }

  /**
   * Extract value using dot notation (e.g., "data.user.name")
   */
  extractNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Set authentication token for subsequent requests
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Get authentication token
   */
  getAuthToken(): string | undefined {
    return this.authToken;
  }

  /**
   * Get proxy configuration based on environment
   */
  private getProxyConfig(): ProxyConfig | null {
    const proxy = process.env.PROXY;
    const userName = process.env.USER_NAME;

    if (userName && ['cronServer', 'apiServer'].includes(userName) && proxy) {
      return {
        http: proxy,
        https: proxy
      };
    }
    return null;
  }

  /**
   * Convert Headers object to plain object (original implementation)
   */
  private headersToObjectOriginal(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  /**
   * Create a fluent API builder for requests
   */
  request(endpoint: string): ApiRequestBuilder {
    return new ApiRequestBuilder(this, endpoint);
  }

  /**
   * Validate captured API calls from browser automation
   */
  async validateCapturedAPI(endpoint: string, capturedCalls: any, validationOptions: ApiValidationOptions): Promise<ApiValidationResult[]> {
    const matchingCall = Object.entries(capturedCalls).find(([url]) => url.includes(endpoint));
    
    if (!matchingCall) {
      return [{
        success: false,
        message: `No captured API call found for endpoint: ${endpoint}`,
        details: { availableEndpoints: Object.keys(capturedCalls) }
      }];
    }

    const [url, callData] = matchingCall;
    const mockResponse: ApiResponse = {
      data: (callData as any).response_body ? JSON.parse((callData as any).response_body) : {},
      status: (callData as any)['Status-Code'],
      statusText: '',
      headers: {},
      url,
      method: (callData as any)['Request-Method'],
      timestamp: (callData as any).Date
    };

    return this.validateResponse(mockResponse, validationOptions);
  }

  /**
   * Wait for a specific API response during browser automation - mirrors cmp_driver_api_response
   */
  async waitForApiResponse(
    apiEndpoint: string,
    options: {
      timeout?: number;
      responseInStr?: boolean;
      afterTimestamp?: number;
      validationOptions?: ApiValidationOptions;
    } = {}
  ): Promise<{ data: any; statusCode: number; validationResults?: ApiValidationResult[] }> {
    if (!this.page) {
      throw new Error('Page instance is required for browser API monitoring');
    }

    const { 
      timeout = 60000, 
      responseInStr = false, 
      afterTimestamp = null,
      validationOptions 
    } = options;

    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      // Get all network requests from the page
      const requests = await this.page.evaluate(() => {
        // This will be populated by Playwright's network interception
        return (window as any).__networkRequests || [];
      });

      // Check if we can access requests through Playwright's context
      try {
        const context = this.page.context();
        const pages = context.pages();
        
        for (const page of pages) {
          // Access the page's request history if available
          const pageRequests = (page as any)._requests || [];
          
          for (const request of pageRequests) {
            if (request.response && apiEndpoint && request.url().includes(apiEndpoint)) {
              // Only consider requests after the given timestamp
              if (afterTimestamp && request.timing().startTime <= afterTimestamp) {
                continue;
              }

              try {
                const response = request.response();
                const statusCode = response.status();
                const contentType = response.headers()['content-type'] || '';
                
                let responseData: any;
                
                if (contentType.includes('application/json')) {
                  const responseText = await response.text();
                  responseData = responseInStr ? responseText : JSON.parse(responseText);
                } else {
                  responseData = await response.text();
                }

                this.logger.info(`Found API response for ${apiEndpoint} (Status ${statusCode})`);

                // Validate the response if validation options provided
                let validationResults: ApiValidationResult[] | undefined;
                if (validationOptions) {
                  const apiResponse: ApiResponse = {
                    data: responseData,
                    status: statusCode,
                    statusText: response.statusText(),
                    headers: this.headersToObject(response.headers()),
                    url: request.url(),
                    method: request.method(),
                    timestamp: new Date().toISOString()
                  };
                  
                  validationResults = await this.validateResponse(apiResponse, validationOptions);
                }

                return { 
                  data: responseData, 
                  statusCode,
                  validationResults 
                };
              } catch (error) {
                this.logger.warn(`Error processing response for ${apiEndpoint}:`, error);
              }
            }
          }
        }
      } catch (error) {
        // Fallback method - continue checking
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.logger.info(`No matching API response found for endpoint: ${apiEndpoint} within ${timeout}ms`);
    return { data: null, statusCode: 0 };
  }

  /**
   * Wait for API response using Playwright's network interception
   */
  async waitForApiResponseWithInterception(
    apiEndpoint: string,
    options: {
      timeout?: number;
      responseInStr?: boolean;
      validationOptions?: ApiValidationOptions;
    } = {}
  ): Promise<{ data: any; statusCode: number; validationResults?: ApiValidationResult[] }> {
    if (!this.page) {
      throw new Error('Page instance is required for browser API monitoring');
    }

    const { timeout = 60000, responseInStr = false, validationOptions } = options;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.page!.off('response', responseHandler);

        // Capture screenshot on timeout (async but ensure it completes before rejection)
        const captureScreenshotAndReject = async () => {
          let screenshotPath: string | undefined;
          try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            screenshotPath = `reports/screenshots/api-timeout-${apiEndpoint.replace(/\//g, '-')}-${timestamp}.png`;
            await this.page!.screenshot({
              path: screenshotPath,
              fullPage: true
            });
            this.logger.info(` Screenshot captured on timeout at: ${screenshotPath}`);
          } catch (screenshotError) {
            this.logger.error(`Failed to capture screenshot on timeout: ${screenshotError}`);
            screenshotPath = undefined;
          } finally {
            // Always reject after screenshot attempt (success or failure)
            const error: any = new Error(`Timeout waiting for API response: ${apiEndpoint}`);
            if (screenshotPath) {
              error.screenshotPath = screenshotPath;
            }
            reject(error);
          }
        };

        // Execute screenshot capture and rejection
        captureScreenshotAndReject();
      }, timeout);

      const responseHandler = async (response: any) => {
        try {
          if (response.url().includes(apiEndpoint)) {
            clearTimeout(timeoutId);
            this.page!.off('response', responseHandler);

            const statusCode = response.status();
            const contentType = response.headers()['content-type'] || '';
            
            let responseData: any;
            
            if (contentType.includes('application/json')) {
              const responseText = await response.text();
              responseData = responseInStr ? responseText : JSON.parse(responseText);
            } else {
              responseData = await response.text();
            }

            this.logger.info(`API response received for ${apiEndpoint} (Status ${statusCode})`);

            // Validate the response if validation options provided
            let validationResults: ApiValidationResult[] | undefined;
            if (validationOptions) {
              const apiResponse: ApiResponse = {
                data: responseData,
                status: statusCode,
                statusText: response.statusText(),
                headers: this.headersToObject(response.headers()),
                url: response.url(),
                method: response.request().method(),
                timestamp: new Date().toISOString()
              };
              
              validationResults = await this.validateResponse(apiResponse, validationOptions);
            }

            resolve({ 
              data: responseData, 
              statusCode,
              validationResults 
            });
          }
        } catch (error) {
          clearTimeout(timeoutId);
          this.page!.off('response', responseHandler);

          // Capture screenshot on error (async but ensure it completes before rejection)
          const captureScreenshotAndReject = async () => {
            let screenshotPath: string | undefined;
            try {
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              screenshotPath = `reports/screenshots/api-error-${apiEndpoint.replace(/\//g, '-')}-${timestamp}.png`;
              await this.page!.screenshot({
                path: screenshotPath,
                fullPage: true
              });
              this.logger.info(` Screenshot captured on error at: ${screenshotPath}`);
            } catch (screenshotError) {
              this.logger.error(`Failed to capture screenshot on error: ${screenshotError}`);
              screenshotPath = undefined;
            } finally {
              // Always reject after screenshot attempt (success or failure)
              // Attach screenshot path to error if available
              if (screenshotPath && error instanceof Error) {
                (error as any).screenshotPath = screenshotPath;
              }
              reject(error);
            }
          };

          // Execute screenshot capture and rejection
          captureScreenshotAndReject();
        }
      };

      this.page!.on('response', responseHandler);
    });
  }

  /**
   * Wait for multiple API responses
   */
  async waitForMultipleApiResponses(
    endpoints: Array<{
      endpoint: string;
      validationOptions?: ApiValidationOptions;
    }>,
    options: {
      timeout?: number;
      waitForAll?: boolean;
    } = {}
  ): Promise<Record<string, { data: any; statusCode: number; validationResults?: ApiValidationResult[] }>> {
    const { timeout = 60000, waitForAll = true } = options;
    const results: Record<string, any> = {};
    
    if (waitForAll) {
      // Wait for all endpoints
      const promises = endpoints.map(async ({ endpoint, validationOptions }) => {
        const result = await this.waitForApiResponseWithInterception(endpoint, {
          timeout,
          validationOptions
        });
        results[endpoint] = result;
      });
      
      await Promise.all(promises);
    } else {
      // Wait for any endpoint (first one to respond)
      const promises = endpoints.map(async ({ endpoint, validationOptions }) => {
        const result = await this.waitForApiResponseWithInterception(endpoint, {
          timeout,
          validationOptions
        });
        results[endpoint] = result;
        return { endpoint, result };
      });
      
      const firstResult = await Promise.race(promises);
      results[firstResult.endpoint] = firstResult.result;
    }
    
    return results;
  }

  /**
   * Helper method to convert Headers to plain object (for Playwright compatibility)
   */
  private headersToObject(headers: any): Record<string, string> {
    if (typeof headers.forEach === 'function') {
      // Headers object
      const obj: Record<string, string> = {};
      headers.forEach((value: string, key: string) => {
        obj[key] = value;
      });
      return obj;
    } else if (typeof headers === 'object') {
      // Plain object
      return headers;
    }
    return {};
  }
}

/**
 * Fluent API builder for constructing requests
 */
export class ApiRequestBuilder {
  private config: ApiRequestConfig = {};
  private service: ApiValidationService;

  constructor(service: ApiValidationService, endpoint: string) {
    this.service = service;
    this.config.endpoint = endpoint;
  }

  method(method: 'GET' | 'POST' | 'PUT' | 'DELETE'): this {
    this.config.method = method;
    return this;
  }

  headers(headers: Record<string, string>): this {
    this.config.headers = { ...this.config.headers, ...headers };
    return this;
  }

  payload(payload: any): this {
    this.config.payload = payload;
    return this;
  }

  host(host: string): this {
    this.config.host = host;
    return this;
  }

  timeout(timeout: number): this {
    this.config.timeout = timeout;
    return this;
  }

  contentType(contentType: string): this {
    this.config.responseContentType = contentType;
    return this;
  }

  async execute<T = any>(): Promise<ApiResponse<T>> {
    return this.service.fetchApiResponse<T>(this.config) as Promise<ApiResponse<T>>;
  }

  async executeWithStatus<T = any>(): Promise<[ApiResponse<T>, number]> {
    this.config.checkStatusCode = true;
    return this.service.fetchApiResponse<T>(this.config) as Promise<[ApiResponse<T>, number]>;
  }
}
