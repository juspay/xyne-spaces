import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MtlsHealthResult } from '@/src/services/MtlsApiService';
import {
  isLikelyNetworkErrorFromUnknown,
  isLikelyOfflineOrTransientNetworkError,
  shouldKeepSessionDespiteMtlsHealthFailure,
} from '@/src/utils/networkConnectivityErrors';

describe('isLikelyOfflineOrTransientNetworkError', () => {
  it('returns false for empty or blank input', () => {
    assert.equal(isLikelyOfflineOrTransientNetworkError(undefined), false);
    assert.equal(isLikelyOfflineOrTransientNetworkError(''), false);
    assert.equal(isLikelyOfflineOrTransientNetworkError('   '), false);
  });

  it('recognises common transport / DNS / timeout errors', () => {
    assert.equal(isLikelyOfflineOrTransientNetworkError('Network request failed'), true);
    assert.equal(isLikelyOfflineOrTransientNetworkError('connection timed out'), true);
    assert.equal(isLikelyOfflineOrTransientNetworkError('ECONNREFUSED'), true);
    assert.equal(isLikelyOfflineOrTransientNetworkError('Unable to resolve host "api"'), true);
  });

  it('does not treat auth / session errors as network errors', () => {
    assert.equal(isLikelyOfflineOrTransientNetworkError('401 unauthorized'), false);
    assert.equal(isLikelyOfflineOrTransientNetworkError('invalid session'), false);
  });

  it('treats a pure certificate error as non-transient', () => {
    assert.equal(isLikelyOfflineOrTransientNetworkError('client certificate invalid'), false);
  });

  it('still reports transient when a network failure co-occurs with a certificate mention', () => {
    assert.equal(
      isLikelyOfflineOrTransientNetworkError('certificate: network request failed'),
      true,
    );
  });
});

describe('isLikelyNetworkErrorFromUnknown', () => {
  it('reads the message off an Error instance', () => {
    assert.equal(isLikelyNetworkErrorFromUnknown(new Error('network request failed')), true);
  });

  it('stringifies non-Error values', () => {
    assert.equal(isLikelyNetworkErrorFromUnknown('timeout'), true);
    assert.equal(isLikelyNetworkErrorFromUnknown(401), false);
    assert.equal(isLikelyNetworkErrorFromUnknown({}), false);
  });
});

describe('shouldKeepSessionDespiteMtlsHealthFailure', () => {
  const health = (partial: Partial<MtlsHealthResult>): MtlsHealthResult => ({
    isHealthy: false,
    ...partial,
  });

  it('does not keep the session when health is missing or healthy', () => {
    assert.equal(shouldKeepSessionDespiteMtlsHealthFailure(undefined), false);
    assert.equal(shouldKeepSessionDespiteMtlsHealthFailure(health({ isHealthy: true })), false);
  });

  it('does not keep the session on a certificate error or unavailable native client', () => {
    assert.equal(
      shouldKeepSessionDespiteMtlsHealthFailure(health({ isCertificateError: true })),
      false,
    );
    assert.equal(
      shouldKeepSessionDespiteMtlsHealthFailure(health({ reason: 'NATIVE_CLIENT_UNAVAILABLE' })),
      false,
    );
  });

  it('keeps the session for connectivity-style failures', () => {
    assert.equal(shouldKeepSessionDespiteMtlsHealthFailure(health({ statusCode: 0 })), true);
    assert.equal(shouldKeepSessionDespiteMtlsHealthFailure(health({ statusCode: 408 })), true);
    assert.equal(
      shouldKeepSessionDespiteMtlsHealthFailure(
        health({ reason: 'REQUEST_FAILED', errorMessage: 'network request failed' }),
      ),
      true,
    );
    assert.equal(
      shouldKeepSessionDespiteMtlsHealthFailure(health({ errorMessage: 'connection timed out' })),
      true,
    );
  });

  it('does not keep the session for a non-network failure with an auth-style message', () => {
    assert.equal(
      shouldKeepSessionDespiteMtlsHealthFailure(
        health({ statusCode: 401, errorMessage: 'unauthorized' }),
      ),
      false,
    );
  });
});
