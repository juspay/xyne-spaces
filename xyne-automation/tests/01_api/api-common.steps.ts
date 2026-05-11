import assert from 'node:assert/strict';
import { Step } from 'gauge-ts';
import { testContext } from '@/tests/shared/runtime/test-context';
import { ensureApiRequestContext } from '@/tests/shared/support/browser-manager';
import {
  assertValidStatusCode,
  assertValidUrlPath,
} from '@/tests/shared/support/literal-validation';

export default class ApiHealthSteps {
  // ===========================================
  // SETUP
  // ===========================================

  @Step('ensuring backend API is accessible')
  public async backendApiIsAccessible(): Promise<void> {
    const apiRequestContext = await ensureApiRequestContext();
    testContext.apiRequestContext = apiRequestContext;
  }

  // ===========================================
  // ACTION
  // ===========================================

  @Step('sending GET request to <urlPath>')
  public async sendGetRequest(urlPath: string): Promise<void> {
    assertValidUrlPath(urlPath);

    const apiRequestContext = await ensureApiRequestContext();
    testContext.lastResponse = await apiRequestContext.get(urlPath);
  }

  // ===========================================
  // ASSERTION
  // ===========================================

  @Step('verifying response status is <statusCode>')
  public async assertResponseStatus(statusCode: string): Promise<void> {
    assertValidStatusCode(statusCode);

    const response = testContext.lastResponse;
    assert.ok(response, 'Expected an API response to be available');
    assert.equal(response.status(), Number.parseInt(statusCode, 10));
  }

  @Step('verifying response content-type is JSON')
  public async assertJsonResponse(): Promise<void> {
    const response = testContext.lastResponse;
    assert.ok(response, 'Expected an API response to be available');

    const contentType = response.headers()['content-type'] || '';
    assert.match(contentType, /application\/json/i);
  }

  @Step('verifying response property <propertyName> equals <value>')
  public async assertResponseProperty(propertyName: string, value: string): Promise<void> {
    const response = testContext.lastResponse;
    assert.ok(response, 'Expected an API response to be available');

    const body = await response.json().catch(() => null);
    assert.ok(body && typeof body === 'object', 'Expected response body to be an object');

    const responseRecord = body as Record<string, unknown>;
    assert.equal(String(responseRecord[propertyName]), String(value));
  }

  @Step('verifying response contains property <propertyName>')
  public async assertResponseHasProperty(propertyName: string): Promise<void> {
    const response = testContext.lastResponse;
    assert.ok(response, 'Expected an API response to be available');

    const body = await response.json().catch(() => null);
    assert.ok(body && typeof body === 'object', 'Expected response body to be an object');

    const responseRecord = body as Record<string, unknown>;
    assert.ok(
      propertyName in responseRecord,
      `Expected response to contain property "${propertyName}"`
    );
  }
}
