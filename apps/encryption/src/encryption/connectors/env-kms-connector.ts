import crypto from 'crypto';
import type { KmsContext, KmsProvider } from '@/encryption/kms';

export class EnvKmsConnector implements KmsProvider {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex: string) {
    this.masterKey = Buffer.from(masterKeyHex.trim(), 'hex');
    if (this.masterKey.length !== 32) {
      throw new Error('EnvKmsConnector: master key must be 32 bytes (64 hex chars)');
    }
  }

  async wrapKey(plaintextKey: Buffer, _keyRef: string, _context?: KmsContext): Promise<Buffer> {
    const cipher = crypto.createCipheriv('aes256-wrap', this.masterKey, Buffer.alloc(8, 0xa6));
    return Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
  }

  async unwrapKey(wrappedKey: Buffer, _keyRef: string, _context?: KmsContext): Promise<Buffer> {
    const decipher = crypto.createDecipheriv('aes256-wrap', this.masterKey, Buffer.alloc(8, 0xa6));
    return Buffer.concat([decipher.update(wrappedKey), decipher.final()]);
  }
}
