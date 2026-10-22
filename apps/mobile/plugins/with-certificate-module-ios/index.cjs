const {
  withPlugins,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
  withInfoPlist,
} = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('../utils/fs.cjs');
const path = require('path');

/**
 * Copy certificate module files to iOS project
 */
const withCertificateModuleFiles = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const { modRequest } = config;
      const { projectRoot, platformProjectRoot } = modRequest;

      // Source directory for native modules
      const sourceDir = path.join(projectRoot, 'plugins', 'ios-modules');

      // Derive target directory from app name (removes spaces, matches Expo's behavior)
      const appName = config.name?.replace(/\s+/g, '') || 'lotus';
      const targetDir = path.join(platformProjectRoot, appName);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Files to copy
      const files = [
        'CertificateModule.swift',
        'CertificateModule.m',
        'MtlsTransportPolicy.swift',
        'PKCS10Builder.swift',
        'MtlsWebViewModule.swift',
        'MtlsWebViewModule.m',
        'MtlsSocketModule.swift',
        'MtlsSocketModule.m',
        'MtlsHTTPRequestHandler.swift',
        'MtlsHTTPRequestHandler.m',
        'MtlsProxyServer.swift',
        'MtlsProxyModule.swift',
        'MtlsProxyModule.m',
      ];

      // Copy files
      for (const file of files) {
        const sourcePath = path.join(sourceDir, file);
        const targetPath = path.join(targetDir, file);

        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`[with-certificate-module-ios] Copied ${file}`);
        } else {
          console.warn(`[with-certificate-module-ios] Source file not found: ${sourcePath}`);
        }
      }

      return config;
    },
  ]);
};

/**
 * Add files to Xcode project
 */
const withCertificateModuleXcode = config => {
  return withXcodeProject(config, config => {
    const { modResults: project } = config;
    // const { platformProjectRoot } = modRequest;

    const files = [
      'CertificateModule.swift',
      'CertificateModule.m',
      'MtlsTransportPolicy.swift',
      'PKCS10Builder.swift',
      'MtlsWebViewModule.swift',
      'MtlsWebViewModule.m',
      'MtlsSocketModule.swift',
      'MtlsSocketModule.m',
      'MtlsHTTPRequestHandler.swift',
      'MtlsHTTPRequestHandler.m',
      'MtlsProxyServer.swift',
      'MtlsProxyModule.swift',
      'MtlsProxyModule.m',
    ];

    // Derive app name from config (removes spaces, matches Expo's behavior)
    const appName = config.name?.replace(/\s+/g, '') || 'lotus';

    const targetUuid = project.getFirstTarget().uuid;
    const lotusGroup =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject()?.firstProject?.mainGroup;
    if (!lotusGroup) {
      throw new Error(
        '[with-certificate-module-ios] Could not resolve PBX group for native sources (mainGroup missing).',
      );
    }

    for (const file of files) {
      const filePath = path.join(appName, file);

      // Check if file already exists in project
      const existingFile = project.hasFile(filePath);
      if (existingFile) {
        console.log(`[with-certificate-module-ios] ${file} already in project`);
        continue;
      }

      // Add file to project
      const fileOptions = {
        target: targetUuid,
        lastKnownFileType: file.endsWith('.swift') ? 'sourcecode.swift' : undefined,
      };

      project.addSourceFile(filePath, fileOptions, lotusGroup);
      console.log(`[with-certificate-module-ios] Added ${file} to Xcode project`);
    }

    return config;
  });
};

const withWebViewBridgeHeaderImport = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const { modRequest } = config;
      const { platformProjectRoot } = modRequest;

      // Derive app name from config (removes spaces, matches Expo's behavior)
      const appName = config.name?.replace(/\s+/g, '') || 'lotus';
      const bridgeHeaderPath = path.join(
        platformProjectRoot,
        appName,
        `${appName}-Bridging-Header.h`,
      );

      const contents = readFileIfExists(bridgeHeaderPath);
      if (contents === null) {
        return config;
      }

      const importLine = '#import <react-native-webview/RNCWebViewImpl.h>';
      if (!contents.includes(importLine)) {
        fs.writeFileSync(bridgeHeaderPath, `${contents.trimEnd()}\n\n${importLine}\n`);
        console.log('[with-certificate-module-ios] Added RNCWebViewImpl import to bridging header');
      }

      return config;
    },
  ]);
};

/**
 * Add Keychain entitlements for certificate storage
 */
const withKeychainEntitlements = config => {
  return withEntitlementsPlist(config, config => {
    // Preserve aps-environment — push entitlement is configured via app.config.js / withVoipPushIOS.
    config.modResults['keychain-access-groups'] = [
      `$(AppIdentifierPrefix)${config.ios?.bundleIdentifier || 'net.juspay.xynespaces'}`,
    ];
    return config;
  });
};

/**
 * Add ATS exceptions for localhost proxy
 */
const withLocalhostATSExceptions = config => {
  return withInfoPlist(config, config => {
    const existingATS = config.modResults.NSAppTransportSecurity || {};

    // Build exception domains
    const existingDomains = existingATS.NSExceptionDomains || {};

    config.modResults.NSAppTransportSecurity = {
      ...existingATS,
      NSAllowsLocalNetworking: true,
      NSExceptionDomains: {
        ...existingDomains,
        localhost: {
          ...(existingDomains.localhost || {}),
          NSExceptionAllowsInsecureHTTPLoads: true,
          NSExceptionMinimumTLSVersion: 'TLSv1.0',
          NSExceptionRequiresForwardSecrecy: false,
          NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
        },
        '127.0.0.1': {
          ...(existingDomains['127.0.0.1'] || {}),
          NSExceptionAllowsInsecureHTTPLoads: true,
          NSExceptionMinimumTLSVersion: 'TLSv1.0',
          NSExceptionRequiresForwardSecrecy: false,
          NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
        },
      },
    };

    const fallbackApiBaseUrls = {
      dev: 'http://localhost:3001/api',
      sandbox: 'https://app.spaces.sandbox.xyne.juspay.net/api',
      prod: 'https://app.spaces.xyne.juspay.net/api',
    };
    const fallbackDashboardOrigins = {
      dev: 'http://localhost:5173',
      sandbox: 'https://app.spaces.sandbox.xyne.juspay.net',
      prod: 'https://app.spaces.xyne.juspay.net',
    };
    const rawApiBaseUrl = String(
      config.extra?.lotusApiBaseUrl ||
        fallbackApiBaseUrls[config.extra?.appVariant] ||
        fallbackApiBaseUrls.prod,
    ).trim();
    delete config.modResults.LotusApiOrigin;
    try {
      const parsed = new URL(rawApiBaseUrl);
      if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
        config.modResults.LotusApiOrigin = parsed.origin;
      }
    } catch {
      // The native policy will fail closed when no valid origin is configured.
      delete config.modResults.LotusApiOrigin;
    }

    delete config.modResults.LotusDashboardOrigin;
    const rawDashboardOrigin = String(
      config.extra?.lotusDashboardOrigin ||
        fallbackDashboardOrigins[config.extra?.appVariant] ||
        fallbackDashboardOrigins.prod,
    ).trim();
    try {
      const parsed = new URL(rawDashboardOrigin);
      if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
        config.modResults.LotusDashboardOrigin = parsed.origin;
      }
    } catch {
      // The native WebView policy will fail closed when no valid origin is configured.
      delete config.modResults.LotusDashboardOrigin;
    }

    console.log('[with-certificate-module-ios] Added ATS exceptions for localhost');
    return config;
  });
};

module.exports = config => {
  return withPlugins(config, [
    withCertificateModuleFiles,
    withCertificateModuleXcode,
    withWebViewBridgeHeaderImport,
    withKeychainEntitlements,
    withLocalhostATSExceptions,
  ]);
};
