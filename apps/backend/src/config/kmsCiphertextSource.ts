export function readCiphertexts(
  env: NodeJS.ProcessEnv,
  listedKeys: readonly string[]
): Array<readonly [key: string, ciphertext: string]> {
  return listedKeys.flatMap((key) => {
    const ciphertext = env[key];
    return ciphertext ? [[key, ciphertext] as const] : [];
  });
}
