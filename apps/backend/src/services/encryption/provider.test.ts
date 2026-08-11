import {
  getEncryptionProvider,
} from './provider';

describe('EncryptionProvider', () => {
  it('fails explicitly when invoked', async () => {
    await expect(getEncryptionProvider().getPublicConfig())
      .rejects.toThrow('Encryption provider does not support "getPublicConfig"');
    await expect(getEncryptionProvider().encryptBatch([]))
      .rejects.toThrow('Encryption provider does not support "encryptBatch"');
    await expect(getEncryptionProvider().decryptRequest({}, 'session-id'))
      .rejects.toThrow('Encryption provider does not support "decryptRequest"');
  });
});
