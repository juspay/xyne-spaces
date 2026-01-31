/**
 * Core type definitions for Xyne automation framework
 */

export interface TestConfig {
  baseUrl: string;
  apiBaseUrl: string;
  browser: 'chromium' | 'firefox' | 'webkit' | {
    type: 'chromium' | 'firefox' | 'webkit';
    sharedMode?: boolean;
    sharedScope?: 'file' | 'suite' | 'global';
    autoSequential?: boolean;
  };
  headless: boolean;
  viewport: {
    width: number;
    height: number;
  };
  timeout: {
    action: number;
    navigation: number;
    test: number;
  };
  llm: {
    openaiApiKey?: string;
    model: string;
    similarityThreshold: number;
  };
  performance: {
    maxResponseTime: number;
    maxErrorRate: number;
  };
  reporting: {
    screenshotOnFailure: boolean;
    videoRecording: boolean;
    harRecording: boolean;
  };
}

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: string;
  resourceType: string;
  isNavigationRequest: boolean;
}

export interface NetworkResponse {
  id: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timestamp: string;
  ok: boolean;
  body?: string;
  fromServiceWorker: boolean;
}

export interface APICallData {
  url: string;
  method: string;
  status: number;
  responseTime: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  timestamp: string;
}

export interface NetworkData {
  requests: number;
  responses: number;
  apiCalls: APICallData[];
  performanceMetrics: PerformanceMetrics;
  timestamp: string;
}

export interface WebSocketData {
  url: string;
  timestamp: string;
  messages: WebSocketMessage[];
}

export interface WebSocketMessage {
  data: string;
  timestamp: string;
  type: 'sent' | 'received';
}

export interface FailedRequest {
  url: string;
  method: string;
  failureText: string;
  timestamp: string;
}

export interface PerformanceMetrics {
  totalRequests: number;
  totalResponseTime: number;
  averageResponseTime: number;
  slowestRequest: {
    url: string;
    responseTime: number;
  };
  fastestRequest: {
    url: string;
    responseTime: number;
  };
  errorCount: number;
  successCount: number;
}

export interface LLMEvaluationResult {
  overallScore: number;
  semanticSimilarity?: {
    score: number;
    feedback: string;
    details: Record<string, any>;
  };
  factualAccuracy?: {
    score: number;
    feedback: string;
    details: Record<string, any>;
  };
  citationAccuracy?: {
    score: number;
    feedback: string;
    details: Record<string, any>;
  };
  businessContext?: {
    score: number;
    feedback: string;
    details: Record<string, any>;
  };
  safetyCheck?: {
    score: number;
    feedback: string;
    details: Record<string, any>;
  };
}

export interface Citation {
  url: string;
  title: string;
  snippet?: string;
  relevance?: number;
}

export interface TestScenario {
  query: string;
  type: 'factual' | 'code' | 'analytical' | 'conversational';
  expectedKeywords: string[];
  minResponseLength?: number;
  maxResponseTime?: number;
}

export interface LoginPageElements {
  pageLoaded: boolean;
  pageTitle: string;
  loginHeading: string | null;
  subtitle: string | null;
  enterpriseHeading: string | null;
  enterpriseSubtitle: string | null;
  googleButtonVisible: boolean;
  googleButtonEnabled: boolean;
  loginContainerVisible: boolean;
  hasErrors: boolean;
  errorMessage: string | null;
  isLoading: boolean;
  currentUrl: string;
}

export interface ChatResponse {
  content: string;
  timestamp: string;
  duration: number;
  chunks?: string[];
  citations?: Citation[];
  metadata?: Record<string, any>;
}

export interface TestResult {
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  screenshots?: string[];
  networkData?: NetworkData;
  llmEvaluation?: LLMEvaluationResult;
  performanceMetrics?: PerformanceMetrics;
}

export interface ReportData {
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  tests: TestResult[];
  environment: {
    browser: string;
    viewport: string;
    baseUrl: string;
    timestamp: string;
  };
  networkAnalysis?: {
    totalRequests: number;
    apiCalls: number;
    failedRequests: number;
    averageResponseTime: number;
    performanceIssues: string[];
  };
}

export type EvaluatorType = 
  | 'semantic_similarity' 
  | 'factual_accuracy' 
  | 'citation_accuracy' 
  | 'business_context' 
  | 'safety_check';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}

// Test Priority and Dependency Management Types
export type TestPriority = 'highest' | 'high' | 'medium' | 'low';

export interface TestMetadata {
  priority?: TestPriority;
  dependsOn?: string[]; // Array of test names this test depends on
  tags?: string[];
  timeout?: number;
  description?: string;
}

export interface TestExecutionResult {
  testName: string;
  fullTitle: string; // Complete test path including describe blocks
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  reason?: string; // For skipped tests: "dependency failed: login test"
  dependents?: string[]; // Tests that depend on this one
  duration?: number;
  error?: string;
  priority?: TestPriority;
  dependencies?: string[];
  screenshotPath?: string; // Path to screenshot for failed tests (used by orchestrator reporter)

  // Additional details for comprehensive reporting (like Playwright HTML report)
  startTime?: string; // ISO timestamp when test started
  endTime?: string; // ISO timestamp when test ended
  retries?: number; // Number of times test was retried

  // Enhanced step structure with nested substeps support
  steps?: Array<{
    title: string;
    duration: number;
    error?: string;
    category?: string;
    location?: string;
    startTime?: string;
    errorStack?: string;
    steps?: Array<any>; // Nested substeps (recursive structure)
  }>;

  // Attachments from Playwright (screenshots, videos, traces)
  attachments?: Array<{
    name: string;
    path?: string;
    body?: Buffer;
    contentType: string;
  }>;

  // Error details
  errorDetails?: {
    message: string;
    stack?: string;
    location?: {
      file: string;
      line: number;
      column: number;
    };
  };

  // Additional Playwright testInfo fields
  errors?: Array<{
    message?: string;
    stack?: string;
    value?: string;
  }>;
  annotations?: Array<{
    type: string;
    description?: string;
  }>;
  tags?: string[];
  retry?: number;
  parallelIndex?: number;
  workerIndex?: number;
  stdout?: string[];
  stderr?: string[];
}

export interface DependencyNode {
  testName: string;
  fullTitle: string;
  priority: TestPriority;
  dependencies: string[];
  dependents: string[];
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'timedOut';
  metadata?: TestMetadata;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  executionOrder: string[];
  hasCycles: boolean;
  cycles?: string[][];
}

export interface TestSkipInfo {
  skip: boolean;
  reason?: string;
  failedDependency?: string;
}

export interface PriorityExecutionStats {
  highest: { total: number; passed: number; failed: number; skipped: number };
  high: { total: number; passed: number; failed: number; skipped: number };
  medium: { total: number; passed: number; failed: number; skipped: number };
  low: { total: number; passed: number; failed: number; skipped: number };
  totalDependencySkips: number;
  dependencyChains: number;
}
