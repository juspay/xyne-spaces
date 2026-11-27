// Sets the keychain display name (kSecAttrLabel) of a device certificate.
//
// Usage: keychain-label <certificate SHA-1, hex> <label>
//
// Only the display name changes; the certificate bytes are left as they are. The private key is
// not renamed: changing a key's attributes asks for the login password, while a certificate has
// no access control and is renamed silently.
//
// Exit codes: 0 renamed, 2 bad arguments, 3 certificate not found, 4 rename failed.

#include <CommonCrypto/CommonDigest.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <ctype.h>
#include <stdio.h>
#include <string.h>

static int sha1_matches(SecCertificateRef cert, const char *want_hex) {
    CFDataRef der = SecCertificateCopyData(cert);
    if (!der) return 0;
    unsigned char digest[CC_SHA1_DIGEST_LENGTH];
    CC_SHA1(CFDataGetBytePtr(der), (CC_LONG)CFDataGetLength(der), digest);
    CFRelease(der);

    char hex[CC_SHA1_DIGEST_LENGTH * 2 + 1];
    for (int i = 0; i < CC_SHA1_DIGEST_LENGTH; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
    if (strlen(want_hex) != sizeof(hex) - 1) return 0;
    for (size_t i = 0; i < sizeof(hex) - 1; i++) {
        if (tolower((unsigned char)want_hex[i]) != hex[i]) return 0;
    }
    return 1;
}

static OSStatus set_label(SecCertificateRef cert, CFStringRef label) {
    const void *query_keys[] = { kSecClass, kSecValueRef };
    const void *query_values[] = { kSecClassCertificate, cert };
    CFDictionaryRef query = CFDictionaryCreate(NULL, query_keys, query_values, 2,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    const void *attr_keys[] = { kSecAttrLabel };
    const void *attr_values[] = { label };
    CFDictionaryRef attrs = CFDictionaryCreate(NULL, attr_keys, attr_values, 1,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    OSStatus status = SecItemUpdate(query, attrs);
    CFRelease(query);
    CFRelease(attrs);
    return status;
}

int main(int argc, char **argv) {
    if (argc != 3 || argv[2][0] == '\0') {
        fprintf(stderr, "usage: keychain-label <certificate SHA-1> <label>\n");
        return 2;
    }
    CFStringRef label = CFStringCreateWithCString(NULL, argv[2], kCFStringEncodingUTF8);
    if (!label) {
        fprintf(stderr, "label is not valid UTF-8\n");
        return 2;
    }

    const void *keys[] = { kSecClass, kSecMatchLimit, kSecReturnRef };
    const void *values[] = { kSecClassCertificate, kSecMatchLimitAll, kCFBooleanTrue };
    CFDictionaryRef query = CFDictionaryCreate(NULL, keys, values, 3,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching(query, &result);
    CFRelease(query);
    if (status != errSecSuccess || !result || CFGetTypeID(result) != CFArrayGetTypeID()) {
        fprintf(stderr, "no certificates found (%d)\n", (int)status);
        if (result) CFRelease(result);
        CFRelease(label);
        return 3;
    }

    SecCertificateRef cert = NULL;
    CFArrayRef certs = (CFArrayRef)result;
    for (CFIndex i = 0; i < CFArrayGetCount(certs); i++) {
        SecCertificateRef candidate = (SecCertificateRef)CFArrayGetValueAtIndex(certs, i);
        if (sha1_matches(candidate, argv[1])) {
            cert = (SecCertificateRef)CFRetain(candidate);
            break;
        }
    }
    CFRelease(result);
    if (!cert) {
        fprintf(stderr, "certificate %s not found\n", argv[1]);
        CFRelease(label);
        return 3;
    }

    status = set_label(cert, label);
    if (status != errSecSuccess) fprintf(stderr, "renaming the certificate failed (%d)\n", (int)status);
    CFRelease(cert);
    CFRelease(label);
    return status == errSecSuccess ? 0 : 4;
}
