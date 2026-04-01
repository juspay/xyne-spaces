import { BaseAuthenticator } from '../../core/baseAuthenticator';
import type { AuthResult } from '../../core/types';

export class GoogleMailAuthenticator extends BaseAuthenticator {
  async authenticate(
    _rawBody: string,
    _headers: Record<string, string | string[]>,
    _secret: string,
    _sourceName: string
  ): Promise<AuthResult> {
    return { authenticated: true };
  }
}
