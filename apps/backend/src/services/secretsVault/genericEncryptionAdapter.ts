import type { EncryptionAdapter } from '@xyne/secrets-vault';
import { getEncryptionProvider } from '@/services/encryption/provider';

export const genericEncryptionAdapter: EncryptionAdapter = {
  async encrypt(plaintext: string): Promise<string> {
    const provider = getEncryptionProvider();
    const [encrypted] = await provider.encryptBatch([
      { value: plaintext, entityId: 'secrets-vault', entityType: 'SecretVersion' },
    ]);
    return encrypted;
  },

  async decrypt(packed: string): Promise<string> {
    const provider = getEncryptionProvider();
    const [decrypted] = await provider.decryptBatch([packed]);
    return decrypted;
  },
};
