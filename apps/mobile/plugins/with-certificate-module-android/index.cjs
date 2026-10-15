const {
  withPlugins,
  withDangerousMod,
  withMainApplication,
  withAppBuildGradle,
  withAndroidManifest,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const { getDefaultAndroidApplicationId, getPrebuildVariant } = require('../../config/variants.cjs');

/** @param {import('@expo/config-plugins').ExportedConfig} config */
function getAndroidApplicationPackage(config) {
  return config.android?.package || getDefaultAndroidApplicationId();
}

/** @param {import('@expo/config-plugins').ExportedConfig} config */
function isMtlsEnabled(config) {
  const value = config.extra?.lotusMtlsEnabled;
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false') {
      return false;
    }
    if (normalized === 'true') {
      return true;
    }
  }
  return true;
}

/** @param {string} androidPackage e.g. net.juspay.xynespaces */
function javaRootForPackage(platformProjectRoot, androidPackage) {
  const rel = androidPackage.split('.').join(path.sep);
  return path.join(platformProjectRoot, 'app', 'src', 'main', 'java', rel);
}

/**
 * Config plugin to add mTLS CertificateModule to Android project
 */
const withCertificateModuleAndroid = config => {
  return withDangerousMod(config, [
    'android',
    async config => {
      const { modRequest } = config;
      const { projectRoot, platformProjectRoot } = modRequest;
      const androidPackage = getAndroidApplicationPackage(config);

      const sourceDir = path.join(projectRoot, 'plugins', 'android-modules');
      const targetDir = javaRootForPackage(platformProjectRoot, androidPackage);

      const certTargetDir = path.join(targetDir, 'certificate');
      const webviewTargetDir = path.join(targetDir, 'webview');
      const httpTargetDir = path.join(targetDir, 'http');
      const networkSecurityConfigTargetDir = path.join(
        platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );

      for (const dir of [targetDir, certTargetDir, webviewTargetDir, httpTargetDir]) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      if (!fs.existsSync(networkSecurityConfigTargetDir)) {
        fs.mkdirSync(networkSecurityConfigTargetDir, { recursive: true });
      }

      const proxyTargetDir = path.join(targetDir, 'proxy');
      if (!fs.existsSync(proxyTargetDir)) {
        fs.mkdirSync(proxyTargetDir, { recursive: true });
      }

      const certFiles = [
        {
          source: 'CertificateModule.kt',
          target: path.join(certTargetDir, 'CertificateModule.kt'),
        },
        {
          source: 'CertificateManager.kt',
          target: path.join(certTargetDir, 'CertificateManager.kt'),
        },
        {
          source: 'CertificatePackage.kt',
          target: path.join(certTargetDir, 'CertificatePackage.kt'),
        },
      ];

      const webviewFiles = [
        {
          source: 'MtlsWebViewModule.kt',
          target: path.join(webviewTargetDir, 'MtlsWebViewModule.kt'),
        },
        {
          source: 'MtlsWebViewPackage.kt',
          target: path.join(webviewTargetDir, 'MtlsWebViewPackage.kt'),
        },
      ];

      const httpFiles = [
        {
          source: path.join('http', 'MtlsTransportPolicy.kt'),
          target: path.join(httpTargetDir, 'MtlsTransportPolicy.kt'),
        },
        {
          source: path.join('http', 'MtlsNetworkClient.kt'),
          target: path.join(httpTargetDir, 'MtlsNetworkClient.kt'),
        },
        {
          source: path.join('http', 'MtlsOkHttpFactory.kt'),
          target: path.join(httpTargetDir, 'MtlsOkHttpFactory.kt'),
        },
        {
          source: path.join('http', 'MtlsSocketModule.kt'),
          target: path.join(httpTargetDir, 'MtlsSocketModule.kt'),
        },
        {
          source: path.join('http', 'MtlsSocketPackage.kt'),
          target: path.join(httpTargetDir, 'MtlsSocketPackage.kt'),
        },
      ];

      const proxyFiles = [
        {
          source: path.join('proxy', 'MtlsProxyModule.kt'),
          target: path.join(proxyTargetDir, 'MtlsProxyModule.kt'),
        },
        {
          source: path.join('proxy', 'MtlsProxyServer.kt'),
          target: path.join(proxyTargetDir, 'MtlsProxyServer.kt'),
        },
        {
          source: path.join('proxy', 'MtlsProxyPackage.kt'),
          target: path.join(proxyTargetDir, 'MtlsProxyPackage.kt'),
        },
      ];

      const allFiles = [...certFiles, ...webviewFiles, ...httpFiles, ...proxyFiles];

      for (const { source, target } of allFiles) {
        const sourcePath = path.join(sourceDir, source);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, target);
        } else {
          // eslint-disable-next-line no-console -- config plugin logging
          console.warn(`[with-certificate-module-android] Source file not found: ${sourcePath}`);
        }
      }

      const networkSecurityConfigSource = path.join(sourceDir, 'network_security_config.xml');
      const networkSecurityConfigTarget = path.join(
        networkSecurityConfigTargetDir,
        'lotus_network_security_config.xml',
      );
      if (fs.existsSync(networkSecurityConfigSource)) {
        fs.copyFileSync(networkSecurityConfigSource, networkSecurityConfigTarget);
      } else {
        // eslint-disable-next-line no-console -- config plugin logging
        console.warn(
          `[with-certificate-module-android] Source file not found: ${networkSecurityConfigSource}`,
        );
      }

      return config;
    },
  ]);
};

/**
 * @param {string} contents
 * @param {string} androidPackage
 */
function applyCertificateImports(contents, androidPackage) {
  let next = contents.replace(/import com\.anonymous\.lotus\.[^\n]+\n/g, '');

  const lines = [
    `import ${androidPackage}.certificate.CertificatePackage`,
    `import ${androidPackage}.webview.MtlsWebViewPackage`,
    `import ${androidPackage}.http.MtlsOkHttpFactory`,
    `import ${androidPackage}.http.MtlsSocketPackage`,
    `import ${androidPackage}.proxy.MtlsProxyPackage`,
  ];

  // Expo SDK 55 replaced ReactNativeHostWrapper with ExpoReactHostFactory, so
  // anchor these app-local imports to the Kotlin package declaration instead
  // of an Expo implementation import that can change between SDK templates.
  const packageMatch = next.match(/^package [^\n]+\n/m);
  if (!lines.every(line => next.includes(line))) {
    for (const line of lines) {
      if (!next.includes(line)) {
        if (!packageMatch) {
          throw new Error(
            '[with-certificate-module-android] MainApplication.kt: missing package declaration',
          );
        }
        next = next.replace(packageMatch[0], `${packageMatch[0]}\n${line}\n`);
      }
    }
  }

  return next;
}

/**
 * Add package registration to MainApplication.kt
 */
const withCertificatePackageRegistration = config => {
  const androidPackage = getAndroidApplicationPackage(config);

  return withMainApplication(config, cfg => {
    let contents = cfg.modResults.contents;
    contents = applyCertificateImports(contents, androidPackage);

    if (!contents.includes('CertificatePackage()')) {
      contents = contents.replace(
        'PackageList(this).packages.apply {\n',
        'PackageList(this).packages.apply {\n              add(CertificatePackage())\n              add(MtlsWebViewPackage())\n              add(MtlsSocketPackage())\n              add(MtlsProxyPackage())\n',
      );
    } else if (!contents.includes('MtlsProxyPackage()')) {
      contents = contents.replace(
        'add(MtlsSocketPackage())\n',
        'add(MtlsSocketPackage())\n              add(MtlsProxyPackage())\n',
      );
    }

    if (!contents.includes('MtlsOkHttpFactory.install')) {
      contents = contents.replace(
        'override fun onCreate() {\n    super.onCreate()',
        'override fun onCreate() {\n    super.onCreate()\n    MtlsOkHttpFactory.install(this)',
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
};

/**
 * Mirror MTLS_ENABLED into Android BuildConfig so native code can avoid
 * keystore/certificate access when the feature is disabled by env.
 */
const withMtlsBuildConfig = config => {
  const mtlsEnabled = isMtlsEnabled(config);
  const variantKey = config.extra?.appVariant || getPrebuildVariant().key;
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
    config.extra?.lotusApiBaseUrl || fallbackApiBaseUrls[variantKey] || '',
  ).trim();
  const rawDashboardOrigin = String(
    config.extra?.lotusDashboardOrigin || fallbackDashboardOrigins[variantKey] || '',
  ).trim();
  let apiOrigin = '';
  let dashboardOrigin = '';
  try {
    const parsed = new URL(rawApiBaseUrl);
    if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
      apiOrigin = parsed.origin;
    }
  } catch {
    // Native transport will fail closed when no valid configured origin exists.
  }
  try {
    const parsed = new URL(rawDashboardOrigin);
    if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
      dashboardOrigin = parsed.origin;
    }
  } catch {
    // Native WebView client-certificate handling will fail closed.
  }

  return withAppBuildGradle(config, config => {
    const { modResults } = config;
    const fieldLine = `buildConfigField "boolean", "MTLS_ENABLED", "${mtlsEnabled}"`;
    const apiOriginLine = `buildConfigField "String", "API_ORIGIN", ${JSON.stringify(JSON.stringify(apiOrigin))}`;
    const dashboardOriginLine = `buildConfigField "String", "DASHBOARD_ORIGIN", ${JSON.stringify(JSON.stringify(dashboardOrigin))}`;
    const fieldRegex =
      /^[ \t]*buildConfigField\s+"boolean",\s+"MTLS_ENABLED",\s+"(?:true|false)"\s*$/m;
    let contents = modResults.contents;

    if (fieldRegex.test(contents)) {
      contents = contents.replace(fieldRegex, `        ${fieldLine}`);
    } else {
      const defaultConfigRegex = /(defaultConfig\s*\{\n)/;
      if (!defaultConfigRegex.test(contents)) {
        throw new Error(
          '[with-certificate-module-android] app/build.gradle: missing defaultConfig',
        );
      }
      contents = contents.replace(defaultConfigRegex, `$1        ${fieldLine}\n`);
    }

    const apiOriginRegex = /^[ \t]*buildConfigField\s+"String",\s+"API_ORIGIN",\s+.*$/m;
    if (apiOriginRegex.test(contents)) {
      contents = contents.replace(apiOriginRegex, `        ${apiOriginLine}`);
    } else {
      const defaultConfigRegex = /(defaultConfig\s*\{\n)/;
      contents = contents.replace(defaultConfigRegex, `$1        ${apiOriginLine}\n`);
    }

    const dashboardOriginRegex = /^[ \t]*buildConfigField\s+"String",\s+"DASHBOARD_ORIGIN",\s+.*$/m;
    if (dashboardOriginRegex.test(contents)) {
      contents = contents.replace(dashboardOriginRegex, `        ${dashboardOriginLine}`);
    } else {
      const defaultConfigRegex = /(defaultConfig\s*\{\n)/;
      contents = contents.replace(defaultConfigRegex, `$1        ${dashboardOriginLine}\n`);
    }

    modResults.contents = contents;
    return config;
  });
};

/**
 * Add Bouncy Castle dependency for CSR generation and NanoHTTPD for proxy server
 */
const withBouncyCastleDependency = config => {
  return withAppBuildGradle(config, config => {
    const { modResults } = config;
    let contents = modResults.contents;

    const dependencies = [
      `implementation 'org.bouncycastle:bcprov-jdk15on:1.70'`,
      `implementation 'org.bouncycastle:bcpkix-jdk15on:1.70'`,
      `implementation 'org.nanohttpd:nanohttpd:2.3.1'`,
    ];

    const dependenciesIndex = contents.indexOf('dependencies {');
    if (dependenciesIndex !== -1) {
      const insertIndex = contents.indexOf('\n', dependenciesIndex) + 1;
      for (const dependency of dependencies) {
        if (!contents.includes(dependency)) {
          contents =
            contents.slice(0, insertIndex) + `    ${dependency}\n` + contents.slice(insertIndex);
        }
      }
    }

    modResults.contents = contents;
    return config;
  });
};

/**
 * Configure cleartext traffic for the local media proxy without making the
 * production application a cleartext client for arbitrary hosts.
 */
const withLocalhostCleartext = config => {
  return withAndroidManifest(config, config => {
    const { manifest } = config.modResults;

    if (manifest.application && manifest.application.length > 0) {
      const application = manifest.application[0];
      const variantKey = config.extra?.appVariant || getPrebuildVariant().key;

      // Dev keeps its existing local-network workflow. Production and sandbox
      // use the network-security config below, which permits only loopback.
      application.$['android:usesCleartextTraffic'] = variantKey === 'dev' ? 'true' : 'false';
      application.$['android:networkSecurityConfig'] = '@xml/lotus_network_security_config';
    }

    return config;
  });
};

module.exports = config => {
  return withPlugins(config, [
    withCertificateModuleAndroid,
    withCertificatePackageRegistration,
    withMtlsBuildConfig,
    withBouncyCastleDependency,
    withLocalhostCleartext,
  ]);
};
