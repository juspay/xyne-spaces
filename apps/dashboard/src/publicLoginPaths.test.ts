import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLocalDevAuthBootstrapPath,
  isPublicLoginPath,
  PUBLIC_LOGIN_PATHS,
} from './publicLoginPaths.ts';

describe('public login paths', () => {
  it('treats /auth and /onboarding as public login walls', () => {
    assert.deepEqual([...PUBLIC_LOGIN_PATHS], ['/auth', '/onboarding']);
    assert.equal(isPublicLoginPath('/auth'), true);
    assert.equal(isPublicLoginPath('/onboarding'), true);
    assert.equal(isPublicLoginPath('/'), false);
    assert.equal(isPublicLoginPath('/ws_1/onboarding'), false);
  });

  it('never auto-bootstraps local auth on the public walls', () => {
    assert.equal(isLocalDevAuthBootstrapPath('/auth', true), false);
    assert.equal(isLocalDevAuthBootstrapPath('/onboarding', true), false);
    assert.equal(isLocalDevAuthBootstrapPath('/', true), true);
    assert.equal(isLocalDevAuthBootstrapPath('/', false), false);
  });
});
