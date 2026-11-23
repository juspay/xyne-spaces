// Transit key helper for Windows: an ECDH P-256 key held by Windows CNG, in the TPM (Microsoft
// Platform Crypto Provider) or, as a fallback, the Microsoft Software Key Storage Provider. The
// key is created on first use under the name the app passes (one per app flavor), per Windows
// user, not exportable and without any UI, and Windows keeps it: the app writes nothing to disk.
// Counterpart of secure-enclave.swift.
//
//   transit-key.exe agree  tpm|software <name>   stdin: base64 server point (65-byte P-256)
//                                                → {"secret": b64 (32 B), "publicKey": b64}
//   transit-key.exe delete tpm|software <name>   → {"deleted": "true"}
//
// Key material comes on stdin, never argv (visible to other processes): the arguments are only
// the command, the provider and the key name, none of them secret. Each command prints one JSON
// line; a failure prints {"error": "...", "status": "0x..."} and exits with what kind of failure
// it was, so the app replaces a key only when the key itself is bad:
//
//   1  anything else (busy, locked out, not ready after resume, a bad input): the key is kept
//   2  the key is bad (NTE_BAD_KEY, NTE_BAD_KEY_STATE, a public key of the wrong shape)
//   3  this provider cannot be used here (no TPM, no P-256 key agreement)

#include <windows.h>
#include <bcrypt.h>
#include <ncrypt.h>
#include <wincrypt.h>
#include <stdio.h>
#include <string.h>

#ifndef BCRYPT_KDF_RAW_SECRET
#define BCRYPT_KDF_RAW_SECRET L"TRUNCATE"
#endif
#ifndef NTE_DEVICE_NOT_FOUND
#define NTE_DEVICE_NOT_FOUND ((SECURITY_STATUS)0x80090035L)
#endif

#define EXIT_OTHER 1
#define EXIT_BROKEN_KEY 2
#define EXIT_UNSUPPORTED 3

#define MAX_KEY_NAME 64
#define COORD_LEN 32
#define POINT_LEN (1 + 2 * COORD_LEN)
#define ECC_BLOB_LEN (sizeof(BCRYPT_ECCKEY_BLOB) + 2 * COORD_LEN)
#define USAGE "usage: transit-key.exe agree|delete tpm|software <key name>"

/** The key's name, one per app flavor: XyneTransitKey, XyneTransitKey-sandbox, ... */
static WCHAR key_name[MAX_KEY_NAME + 1];

static int fail(const char *message) {
  printf("{\"error\":\"%s\"}\n", message);
  return EXIT_OTHER;
}

static int fail_status(const char *message, SECURITY_STATUS status, int code) {
  printf("{\"error\":\"%s (0x%08lX)\",\"status\":\"0x%08lX\"}\n", message,
         (unsigned long)status, (unsigned long)status);
  return code;
}

/** Opening the provider: only a provider that is not there, or cannot work here, is final. */
static int provider_exit_code(SECURITY_STATUS status) {
  switch (status) {
    case NTE_PROV_DLL_NOT_FOUND:
    case NTE_DEVICE_NOT_FOUND:
    case NTE_NOT_SUPPORTED:
    case NTE_BAD_PROVIDER:
      return EXIT_UNSUPPORTED;
    default:
      return EXIT_OTHER;
  }
}

/** A failure on the key: bad only for the key's own bad states, never a busy or locked TPM. */
static int key_exit_code(SECURITY_STATUS status) {
  switch (status) {
    case NTE_BAD_KEY:
    case NTE_BAD_KEY_STATE:
      return EXIT_BROKEN_KEY;
    case NTE_NOT_SUPPORTED:
      return EXIT_UNSUPPORTED;
    default:
      return EXIT_OTHER;
  }
}

static LPCWSTR provider_name(const char *which) {
  if (strcmp(which, "tpm") == 0) return L"Microsoft Platform Crypto Provider";
  if (strcmp(which, "software") == 0) return L"Microsoft Software Key Storage Provider";
  return NULL;
}

/** Letters, digits and '-' only, at most 64: always a plain key name, nothing else. */
static int set_key_name(const char *name) {
  size_t length = strlen(name);
  if (length == 0 || length > MAX_KEY_NAME) return -1;
  for (size_t i = 0; i < length; i++) {
    char c = name[i];
    int allowed = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                  c == '-';
    if (!allowed) return -1;
    key_name[i] = (WCHAR)c;
  }
  key_name[length] = L'\0';
  return 0;
}

static int to_base64(const BYTE *data, DWORD length, char *out, DWORD out_length) {
  return CryptBinaryToStringA(data, length, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, out,
                              &out_length)
             ? 0
             : -1;
}

/** The server's 65-byte uncompressed point (0x04 ‖ X ‖ Y), base64 on stdin. */
static int read_server_point(BYTE point[POINT_LEN]) {
  char text[256];
  size_t n = fread(text, 1, sizeof text - 1, stdin);
  text[n] = '\0';
  while (n > 0 && (text[n - 1] == '\n' || text[n - 1] == '\r' || text[n - 1] == ' ')) {
    text[--n] = '\0';
  }
  BYTE decoded[128];
  DWORD length = sizeof decoded;
  if (!CryptStringToBinaryA(text, 0, CRYPT_STRING_BASE64, decoded, &length, NULL, NULL)) return -1;
  if (length != POINT_LEN || decoded[0] != 0x04) return -1;
  memcpy(point, decoded, POINT_LEN);
  return 0;
}

static SECURITY_STATUS open_key(NCRYPT_PROV_HANDLE provider, NCRYPT_KEY_HANDLE *key) {
  return NCryptOpenKey(provider, key, key_name, 0, NCRYPT_SILENT_FLAG);
}

// The TPM provider rejects NCRYPT_SILENT_FLAG on delete (NTE_BAD_FLAGS). Deleting shows no UI
// either way: the key has no UI or PIN policy.
static SECURITY_STATUS delete_key(NCRYPT_KEY_HANDLE key) {
  return NCryptDeleteKey(key, 0);
}

/** Opens this user's key, creating it inside the provider (never in this process) if missing. */
static SECURITY_STATUS open_or_create_key(NCRYPT_PROV_HANDLE provider, NCRYPT_KEY_HANDLE *key) {
  SECURITY_STATUS status = open_key(provider, key);
  if (status != NTE_BAD_KEYSET) return status;

  status = NCryptCreatePersistedKey(provider, key, NCRYPT_ECDH_P256_ALGORITHM, key_name, 0, 0);
  if (status == NTE_EXISTS) return open_key(provider, key);
  if (status != ERROR_SUCCESS) return status;

  // The software provider's keys are not exportable unless asked; say so explicitly. TPM keys
  // never are, and the TPM may reject the property, which is fine.
  DWORD export_policy = 0;
  NCryptSetProperty(*key, NCRYPT_EXPORT_POLICY_PROPERTY, (PBYTE)&export_policy,
                    sizeof export_policy, 0);

  status = NCryptFinalizeKey(*key, NCRYPT_SILENT_FLAG);
  if (status != ERROR_SUCCESS) {
    if (delete_key(*key) != ERROR_SUCCESS) NCryptFreeObject(*key);
    *key = 0;
  }
  return status;
}

/** The key's public point as 0x04 ‖ X ‖ Y (CNG's ECC blobs hold X and Y big-endian). */
static SECURITY_STATUS public_point(NCRYPT_KEY_HANDLE key, BYTE point[POINT_LEN]) {
  BYTE blob[ECC_BLOB_LEN];
  DWORD size = 0;
  SECURITY_STATUS status =
      NCryptExportKey(key, 0, BCRYPT_ECCPUBLIC_BLOB, NULL, blob, sizeof blob, &size, 0);
  if (status != ERROR_SUCCESS) return status;
  const BCRYPT_ECCKEY_BLOB *header = (const BCRYPT_ECCKEY_BLOB *)blob;
  if (size != ECC_BLOB_LEN || header->cbKey != COORD_LEN) return NTE_BAD_DATA;
  point[0] = 0x04;
  memcpy(point + 1, blob + sizeof(BCRYPT_ECCKEY_BLOB), 2 * COORD_LEN);
  return ERROR_SUCCESS;
}

/** ECDH inside the provider: the 32-byte X coordinate, as WebCrypto and CryptoKit return it. */
/** `*bad_input` is set when the server point itself was refused, which says nothing of the key. */
static SECURITY_STATUS agree(NCRYPT_PROV_HANDLE provider, NCRYPT_KEY_HANDLE key,
                             const BYTE server_point[POINT_LEN], BYTE secret[COORD_LEN],
                             int *bad_input) {
  BYTE blob[ECC_BLOB_LEN];
  BCRYPT_ECCKEY_BLOB *header = (BCRYPT_ECCKEY_BLOB *)blob;
  header->dwMagic = BCRYPT_ECDH_PUBLIC_P256_MAGIC;
  header->cbKey = COORD_LEN;
  memcpy(blob + sizeof(BCRYPT_ECCKEY_BLOB), server_point + 1, 2 * COORD_LEN);

  NCRYPT_KEY_HANDLE server = 0;
  NCRYPT_SECRET_HANDLE agreed = 0;
  DWORD length = 0;
  // Importing validates the point: one that is not on the curve is refused.
  SECURITY_STATUS status =
      NCryptImportKey(provider, 0, BCRYPT_ECCPUBLIC_BLOB, NULL, &server, blob, sizeof blob, 0);
  *bad_input = status != ERROR_SUCCESS;
  if (status == ERROR_SUCCESS) {
    status = NCryptSecretAgreement(key, server, &agreed, NCRYPT_SILENT_FLAG);
  }
  if (status == ERROR_SUCCESS) {
    status = NCryptDeriveKey(agreed, BCRYPT_KDF_RAW_SECRET, NULL, secret, COORD_LEN, &length, 0);
  }
  if (status == ERROR_SUCCESS && length != COORD_LEN) status = NTE_BAD_LEN;
  if (status == ERROR_SUCCESS) {
    // CNG returns the raw secret little-endian; every other side uses big-endian.
    for (int i = 0; i < COORD_LEN / 2; i++) {
      BYTE swap = secret[i];
      secret[i] = secret[COORD_LEN - 1 - i];
      secret[COORD_LEN - 1 - i] = swap;
    }
  }
  if (agreed) NCryptFreeObject(agreed);
  if (server) NCryptFreeObject(server);
  return status;
}

static int run_agree(NCRYPT_PROV_HANDLE provider) {
  BYTE server_point[POINT_LEN];
  if (read_server_point(server_point) != 0) {
    return fail("serverPoint must be a base64 65-byte uncompressed P-256 point");
  }

  NCRYPT_KEY_HANDLE key = 0;
  SECURITY_STATUS status = open_or_create_key(provider, &key);
  if (status != ERROR_SUCCESS) {
    return fail_status("cannot open or create the key", status, key_exit_code(status));
  }

  BYTE point[POINT_LEN];
  BYTE secret[COORD_LEN];
  status = public_point(key, point);
  if (status != ERROR_SUCCESS) {
    NCryptFreeObject(key);
    // NTE_BAD_DATA here is public_point's own check: the key gave a public key of the wrong shape.
    int code = status == NTE_BAD_DATA ? EXIT_BROKEN_KEY : key_exit_code(status);
    return fail_status("cannot read the public key", status, code);
  }
  int bad_input = 0;
  status = agree(provider, key, server_point, secret, &bad_input);
  NCryptFreeObject(key);
  if (status != ERROR_SUCCESS) {
    SecureZeroMemory(secret, sizeof secret);
    if (bad_input) return fail_status("the server point was refused", status, EXIT_OTHER);
    return fail_status("key agreement failed", status, key_exit_code(status));
  }

  char secret_b64[64];
  char point_b64[128];
  int encoded = to_base64(secret, COORD_LEN, secret_b64, sizeof secret_b64) == 0 &&
                to_base64(point, POINT_LEN, point_b64, sizeof point_b64) == 0;
  if (encoded) printf("{\"secret\":\"%s\",\"publicKey\":\"%s\"}\n", secret_b64, point_b64);
  // The secret is not kept in this process's memory once it has been handed over.
  SecureZeroMemory(secret, sizeof secret);
  SecureZeroMemory(secret_b64, sizeof secret_b64);
  return encoded ? 0 : fail("cannot encode the result");
}

static int run_delete(NCRYPT_PROV_HANDLE provider) {
  NCRYPT_KEY_HANDLE key = 0;
  SECURITY_STATUS status = open_key(provider, &key);
  if (status == NTE_BAD_KEYSET) {
    printf("{\"deleted\":\"true\"}\n");
    return 0;
  }
  if (status != ERROR_SUCCESS) return fail_status("cannot open the key", status, EXIT_OTHER);
  status = delete_key(key);
  if (status != ERROR_SUCCESS) {
    NCryptFreeObject(key);
    return fail_status("cannot delete the key", status, EXIT_OTHER);
  }
  printf("{\"deleted\":\"true\"}\n");
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 4) return fail(USAGE);
  LPCWSTR name = provider_name(argv[2]);
  if (!name || set_key_name(argv[3]) != 0) return fail(USAGE);
  int run_agree_command = strcmp(argv[1], "agree") == 0;
  if (!run_agree_command && strcmp(argv[1], "delete") != 0) return fail(USAGE);

  NCRYPT_PROV_HANDLE provider = 0;
  SECURITY_STATUS status = NCryptOpenStorageProvider(&provider, name, 0);
  if (status != ERROR_SUCCESS) {
    return fail_status("cannot open the key storage provider", status, provider_exit_code(status));
  }

  int code = run_agree_command ? run_agree(provider) : run_delete(provider);
  NCryptFreeObject(provider);
  return code;
}
