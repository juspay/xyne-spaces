import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { isApprovedWebSocketDestination } from '../../../src/utils/mtlsDestinationPolicy';

const androidPolicySource = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/http/MtlsTransportPolicy.kt'),
  'utf8',
);
const androidSocketSource = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/http/MtlsSocketModule.kt'),
  'utf8',
);
const androidCertificateSource = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/CertificateModule.kt'),
  'utf8',
);
const androidNetworkSource = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/http/MtlsNetworkClient.kt'),
  'utf8',
);
const androidDownloadAuthSource = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/downloads/AttachmentDownloadAuth.kt'),
  'utf8',
);
const iosPolicySource = readFileSync(
  resolve(process.cwd(), 'plugins/ios-modules/MtlsTransportPolicy.swift'),
  'utf8',
);
const iosSocketSource = readFileSync(
  resolve(process.cwd(), 'plugins/ios-modules/MtlsSocketModule.swift'),
  'utf8',
);
const iosCertificateSource = readFileSync(
  resolve(process.cwd(), 'plugins/ios-modules/CertificateModule.swift'),
  'utf8',
);
const androidPluginSource = readFileSync(
  resolve(process.cwd(), 'plugins/with-certificate-module-android/index.cjs'),
  'utf8',
);
const iosPluginSource = readFileSync(
  resolve(process.cwd(), 'plugins/with-certificate-module-ios/index.cjs'),
  'utf8',
);
const webViewPatchSource = readFileSync(
  resolve(process.cwd(), 'patches/react-native-webview+13.16.1.patch'),
  'utf8',
);
const webViewModuleSource = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/MtlsWebViewModule.kt'),
  'utf8',
);

describe('native transport destination policy', () => {
  it('enforces exact configured HTTP origins and loopback-only cleartext', () => {
    assert.match(androidPolicySource, /BuildConfig\.API_ORIGIN/);
    assert.match(androidPolicySource, /scheme == "https" && sameOrigin/);
    assert.match(androidPolicySource, /scheme == "http" \|\| scheme == "https"/);
    assert.match(iosPolicySource, /LotusApiOrigin/);
    assert.match(iosPolicySource, /scheme == "https" && sameOrigin/);
    assert.match(iosPolicySource, /scheme == "http" \|\| scheme == "https"/);
  });

  it('enforces secure WebSocket schemes and the same exact origin', () => {
    assert.match(androidPolicySource, /fun isApprovedWebSocketUrl/);
    assert.match(androidPolicySource, /scheme == "wss" && sameOrigin/);
    assert.match(iosPolicySource, /isApprovedWebSocketURL/);
    assert.match(iosPolicySource, /scheme == "wss" && sameOrigin/);
    assert.match(androidSocketSource, /MtlsTransportPolicy\.isApprovedWebSocketUrl\(url\)/);
    assert.match(iosSocketSource, /MtlsTransportPolicy\.isApprovedWebSocketURL\(urlString\)/);
    assert.match(androidPolicySource, /"wss" -> "https"/);
    assert.match(iosPolicySource, /case "wss":\s+originScheme = "https"/);
    assert.match(androidSocketSource, /followRedirects\(false\)/);
    assert.match(iosSocketSource, /willPerformHTTPRedirection/);
    assert.equal(
      isApprovedWebSocketDestination(
        'wss://app.spaces.xyne.juspay.net/zero',
        'https://app.spaces.xyne.juspay.net',
      ),
      true,
    );
    assert.equal(
      isApprovedWebSocketDestination(
        'wss://app.spaces.xyne.juspay.net.evil.test/zero',
        'https://app.spaces.xyne.juspay.net',
      ),
      false,
    );
  });

  it('applies the policy before native HTTP bridges send requests', () => {
    assert.match(
      androidCertificateSource,
      /if \(!MtlsTransportPolicy\.isApprovedHttpUrl\(url\)\)[\s\S]*UNAPPROVED_DESTINATION/,
    );
    assert.match(
      androidNetworkSource,
      /require\(MtlsTransportPolicy\.isApprovedHttpUrl\(urlString\)\)/,
    );
    assert.match(
      iosCertificateSource,
      /guard MtlsTransportPolicy\.isApprovedHTTPURL\(urlString\) else[\s\S]*UNAPPROVED_DESTINATION/,
    );
    assert.match(androidNetworkSource, /instanceFollowRedirects = false/);
    assert.match(
      androidNetworkSource,
      /require\(MtlsTransportPolicy\.isApprovedHttpUrl\(urlString\)\)[\s\S]*?MAX_DOWNLOAD_REDIRECTS/,
    );
    assert.match(
      androidNetworkSource,
      /isSameOrigin\(originalUrl, redirectedUrl\)[\s\S]*?Download redirect is outside the approved origin/,
    );
    assert.match(androidNetworkSource, /Download redirect limit exceeded/);
    assert.match(iosCertificateSource, /willPerformHTTPRedirection/);
    assert.match(iosCertificateSource, /approvedChallengeURL/);
    assert.match(iosCertificateSource, /MtlsFileDownloadController\] Rejecting redirect/);
    assert.match(iosCertificateSource, /Self\.isSameOrigin\(originURL, redirectURL\)/);
    assert.match(
      iosCertificateSource,
      /approvedChallengeURL\(challenge\.protectionSpace\)[\s\S]*?Self\.isSameOrigin\(originURL, challengeURLValue\)[\s\S]*?isApprovedHTTPURL\(challengeURL\)/,
    );
    assert.match(iosCertificateSource, /UNAPPROVED_DESTINATION/);
    assert.match(iosPluginSource, /delete config\.modResults\.LotusApiOrigin/);
  });

  it('bakes the configured origin into both native builds', () => {
    assert.match(androidPluginSource, /MtlsTransportPolicy\.kt/);
    assert.match(androidPluginSource, /buildConfigField "String", "API_ORIGIN"/);
    assert.match(iosPluginSource, /MtlsTransportPolicy\.swift/);
    assert.match(iosPluginSource, /LotusApiOrigin/);
  });

  it('keeps WebView bridges and identity-bearing permissions fail-closed', () => {
    assert.match(webViewPatchSource, /if \(!isMainFrame\)/);
    assert.match(webViewPatchSource, /message\.frameInfo\.isMainFrame/);
    assert.match(webViewPatchSource, /privileged WebView bridge disabled/);
    assert.match(webViewPatchSource, /setAllowedClientCertificateOrigins/);
    assert.match(webViewPatchSource, /setAllowedMediaCaptureOrigins/);
    assert.match(webViewPatchSource, /isAllowedClientCertificateRequest/);
    assert.match(webViewPatchSource, /isAllowedMediaCaptureOrigin/);
    assert.doesNotMatch(webViewPatchSource, /net\.juspay\.xynespaces/);
    assert.match(webViewPatchSource, /LotusWebViewOriginMatches/);
    assert.match(webViewPatchSource, /LotusDashboardOrigin/);
    assert.match(webViewPatchSource, /NSInteger originPort = origin\.port > 0/);
    assert.match(webViewModuleSource, /setAllowedClientCertificateOrigins/);
    assert.match(webViewModuleSource, /setAllowedMediaCaptureOrigins/);
    assert.match(webViewModuleSource, /Media capture is independent of mTLS enrollment/);
    assert.match(webViewModuleSource, /emptySet\(\)/);
  });

  it('keeps resumable downloads bound to a strong matching validator', () => {
    assert.match(androidNetworkSource, /fun hasUsableValidator\(\): Boolean/);
    assert.match(androidNetworkSource, /!it\.startsWith\("W\/", ignoreCase = true\)/);
    assert.match(androidNetworkSource, /storedEtag != null && storedEtag == responseEtag/);
    assert.match(
      androidNetworkSource,
      /storedLastModified != null && storedLastModified == responseLastModified/,
    );
    assert.doesNotMatch(androidNetworkSource, /removePrefix\("W\/"\)/);
    assert.match(
      androidNetworkSource,
      /writeDownloadValidators\(\s*validatorFile,\s*responseValidators,\s*\)/,
    );
    assert.doesNotMatch(
      androidNetworkSource,
      /responseValidators\.takeIf\(\{ it\.hasUsableValidator\(\) \}\) \?: storedValidators/,
    );
  });

  it('restores background download auth only from the protected native store', () => {
    assert.match(
      androidDownloadAuthSource,
      /AuthContextStore\.read\(context\.applicationContext\)/,
    );
    assert.doesNotMatch(androidDownloadAuthSource, /getSharedPreferences\(/);
    assert.doesNotMatch(androidDownloadAuthSource, /AUTH_TOKEN_KEY/);
  });
});
