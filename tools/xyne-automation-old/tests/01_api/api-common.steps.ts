/**
 * Common API step definitions for all API tests.
 * These steps provide reusable building blocks for API testing scenarios.
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { AxiosError } from 'axios';
import { expect } from 'chai';

import { apiLogger } from '@/lib/logger';

import { HttpMethod } from '@/fixtures/cucumber.parameters';
import { CustomWorld } from '@/fixtures/cucumber.world';

// ============================================
// API Setup & Accessibility Steps
// ============================================

Given('the backend API is accessible', async function (this: CustomWorld) {
  expect(this.apiClient).to.not.be.undefined;
  apiLogger.info(`Backend URL: ${this.config.backend.baseUrl}`);
});

// ============================================
// HTTP Request Steps
// ============================================

/**
 * Generic HTTP request step without body (GET, DELETE)
 */
When(
  'I send a {httpMethod} request to {string}',
  async function (this: CustomWorld, method: HttpMethod, endpoint: string) {
    this.startTime = Date.now();
    try {
      this.response = await this.apiClient.request({
        method: method.toLowerCase(),
        url: endpoint,
      });
    } catch (err) {
      const error = err as AxiosError;
      this.response = error.response;
      if (!this.response) {
        throw new Error(
          `${method} request to ${endpoint} failed: ${error.message} (${error.code || 'No Code'})`
        );
      }
    }
  }
);

/**
 * Generic HTTP request step with body (POST, PUT, PATCH)
 */
When(
  'I send a {httpMethod} request to {string} with body:',
  async function (this: CustomWorld, method: HttpMethod, endpoint: string, docString: string) {
    this.startTime = Date.now();
    try {
      const body = JSON.parse(docString);
      this.response = await this.apiClient.request({
        method: method.toLowerCase(),
        url: endpoint,
        data: body,
      });
    } catch (err) {
      const error = err as AxiosError;
      this.response = error.response;
      if (!this.response) {
        throw new Error(
          `${method} request to ${endpoint} failed: ${error.message} (${error.code || 'No Code'})`
        );
      }
    }
  }
);

// ============================================
// Response Status Assertions
// ============================================

Then('the response status should be {int}', async function (this: CustomWorld, statusCode: number) {
  expect(this.response).to.not.be.undefined;
  expect(this.response!.status).to.equal(statusCode);
});

Then('the response should be successful', async function (this: CustomWorld) {
  expect(this.response).to.not.be.undefined;
  expect(this.response!.status).to.be.within(200, 299);
});

Then('the response should indicate a client error', async function (this: CustomWorld) {
  expect(this.response).to.not.be.undefined;
  expect(this.response!.status).to.be.within(400, 499);
});

Then('the response should indicate a server error', async function (this: CustomWorld) {
  expect(this.response).to.not.be.undefined;
  expect(this.response!.status).to.be.within(500, 599);
});

// ============================================
// Response Body Assertions
// ============================================

Then(
  'the response should contain property {string}',
  async function (this: CustomWorld, key: string) {
    expect(this.response).to.not.be.undefined;
    expect(this.response!.data).to.have.property(key);
  }
);

Then(
  'the response should contain a {string} field',
  async function (this: CustomWorld, key: string) {
    expect(this.response).to.not.be.undefined;
    expect(this.response!.data).to.have.property(key);
  }
);

Then(
  'the response property {string} should equal {string}',
  async function (this: CustomWorld, key: string, value: string) {
    expect(this.response).to.not.be.undefined;
    expect(String(this.response!.data[key])).to.equal(value);
  }
);

Then(
  'the response property {string} should equal {int}',
  async function (this: CustomWorld, key: string, value: number) {
    expect(this.response).to.not.be.undefined;
    expect(this.response!.data[key]).to.equal(value);
  }
);

Then('the response should be an array', async function (this: CustomWorld) {
  expect(this.response).to.not.be.undefined;
  expect(this.response!.data).to.be.an('array');
});

Then(
  'the response array should have length {int}',
  async function (this: CustomWorld, length: number) {
    expect(this.response).to.not.be.undefined;
    expect(this.response!.data).to.be.an('array').with.lengthOf(length);
  }
);

Then('the response array should not be empty', async function (this: CustomWorld) {
  expect(this.response).to.not.be.undefined;
  expect(this.response!.data).to.be.an('array').that.is.not.empty;
});

// ============================================
// Performance Assertions
// ============================================

Then(
  'the response time should be less than {int} milliseconds',
  function (this: CustomWorld, ms: number) {
    const startTime = this.startTime || Date.now();
    const duration = Date.now() - startTime;
    apiLogger.info(`Response time: ${duration}ms`);
    expect(duration).to.be.lessThan(ms);
  }
);

// ============================================
// Response Header Assertions
// ============================================

Then(
  'the response header {string} should exist',
  async function (this: CustomWorld, header: string) {
    expect(this.response).to.not.be.undefined;
    expect(this.response!.headers).to.have.property(header.toLowerCase());
  }
);

Then(
  'the response header {string} should contain {string}',
  async function (this: CustomWorld, header: string, value: string) {
    expect(this.response).to.not.be.undefined;
    expect(this.response!.headers[header.toLowerCase()]).to.include(value);
  }
);

Then('the response content-type should be JSON', async function (this: CustomWorld) {
  expect(this.response).to.not.be.undefined;
  expect(this.response!.headers['content-type']).to.include('application/json');
});
