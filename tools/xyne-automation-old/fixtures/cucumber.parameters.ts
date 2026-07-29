import { defineParameterType } from '@cucumber/cucumber';

import { BrowserType } from '@/config';

import { ResponseFormat } from '@/fixtures/cucumber.types';

/**
 * Custom Cucumber parameter types for cleaner feature files and early validation.
 */

// Browser type parameter - validates chromium, firefox, webkit
defineParameterType({
  name: 'browserType',
  regexp: /chromium|firefox|webkit/,
  transformer: (browser: string) => browser as BrowserType,
});

// Viewport parameter - validates WIDTHxHEIGHT format (e.g., 1920x1080)
defineParameterType({
  name: 'viewport',
  regexp: /\d+x\d+/,
  transformer: (viewport: string) => viewport,
});

// HTTP method parameter - validates GET, POST, PUT, PATCH, DELETE
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
defineParameterType({
  name: 'httpMethod',
  regexp: /GET|POST|PUT|PATCH|DELETE/,
  transformer: (method: string) => method as HttpMethod,
});

// Response format parameter - validates string, json, array
defineParameterType({
  name: 'responseFormat',
  regexp: /string|json|array/,
  transformer: (format: string) => format.toLowerCase() as ResponseFormat,
});

// User field parameter - validates email or name
export type UserField = 'email' | 'name';
defineParameterType({
  name: 'userField',
  regexp: /email|name/,
  transformer: (field: string) => field as UserField,
});
