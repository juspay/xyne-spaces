import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isGeneratedInitialsPicture } from '@/src/ui/avatar/avatar.picture';

describe('isGeneratedInitialsPicture', () => {
  it('spots pictures that only draw initials', () => {
    assert.equal(isGeneratedInitialsPicture('https://ui-avatars.com/api/?name=Arjun%20Rao'), true);
    assert.equal(isGeneratedInitialsPicture('https://cdn.ui-avatars.com/api/x'), true);
  });

  it('keeps real photos and empty values', () => {
    assert.equal(isGeneratedInitialsPicture('https://lh3.googleusercontent.com/a/photo'), false);
    assert.equal(isGeneratedInitialsPicture('https://evil.com/?u=ui-avatars.com'), false);
    assert.equal(isGeneratedInitialsPicture(null), false);
    assert.equal(isGeneratedInitialsPicture(undefined), false);
  });
});
