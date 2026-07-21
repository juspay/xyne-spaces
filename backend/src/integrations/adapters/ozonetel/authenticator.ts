import { BaseAuthenticator } from '../../core/baseAuthenticator';
import { AuthResult } from '../../core/types';

interface OzonetelCredentials {
  webhookSecret?: string;
}

export class OzonetelAuthenticator extends BaseAuthenticator {
  async authenticate(
    _rawBody: string,
    _headers: Record<string, string | string[]>,
    secret: string,
    sourceName: string,
  ): Promise<AuthResult> {
    const credentials = JSON.parse(secret) as OzonetelCredentials;
    const webhookSecret = credentials.webhookSecret?.trim();

    if (!webhookSecret) {
      return { authenticated: false };
    }

    return {
      authenticated: sourceName.startsWith('ozonetel-') && sourceName.endsWith(`-${webhookSecret}`),
    };
  }
}
